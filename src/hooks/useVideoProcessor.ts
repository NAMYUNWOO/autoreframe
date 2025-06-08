import { useState, useCallback, useRef } from 'react';
import { VideoProcessor } from '@/lib/video/processor';
import { VideoMetadata, ProcessingStatus } from '@/types';

export function useVideoProcessor() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [status, setStatus] = useState<ProcessingStatus>({
    stage: 'idle',
    progress: 0,
    message: ''
  });
  const [error, setError] = useState<string | null>(null);
  
  const processorRef = useRef<VideoProcessor | null>(null);

  const loadVideo = useCallback(async (file: File) => {
    try {
      setError(null);
      setVideoFile(file);
      setStatus({
        stage: 'uploading',
        progress: 0,
        message: 'Loading video...'
      });

      // Create new processor
      if (processorRef.current) {
        processorRef.current.dispose();
      }
      processorRef.current = new VideoProcessor();

      // Load video
      const videoMetadata = await processorRef.current.loadVideo(file);
      setMetadata(videoMetadata);
      
      setStatus({
        stage: 'idle',
        progress: 100,
        message: 'Video loaded successfully'
      });

      return videoMetadata;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load video';
      setError(message);
      setStatus({
        stage: 'error',
        progress: 0,
        message,
        error: message
      });
      throw err;
    }
  }, []);

  const processFrames = useCallback(async (
    onFrame: (imageData: ImageData, frameNumber: number, timestamp: number) => Promise<void>
  ) => {
    if (!processorRef.current || !metadata) {
      throw new Error('No video loaded');
    }

    try {
      setError(null);
      await processorRef.current.processFrames(onFrame, setStatus);
      // Set status to idle after processing completes
      setStatus({
        stage: 'idle',
        progress: 100,
        message: 'Analysis complete'
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process frames';
      setError(message);
      setStatus({
        stage: 'error',
        progress: 0,
        message,
        error: message
      });
      throw err;
    }
  }, [metadata]);

  const getVideoElement = useCallback(() => {
    return processorRef.current?.getVideoElement() || null;
  }, []);

  const getCanvas = useCallback(() => {
    return processorRef.current?.getCanvas() || null;
  }, []);

  const reset = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.dispose();
      processorRef.current = null;
    }
    setVideoFile(null);
    setMetadata(null);
    setStatus({
      stage: 'idle',
      progress: 0,
      message: ''
    });
    setError(null);
  }, []);

  return {
    videoFile,
    metadata,
    status,
    error,
    loadVideo,
    processFrames,
    getVideoElement,
    getCanvas,
    reset
  };
}