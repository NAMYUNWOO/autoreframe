import { useState, useCallback, useRef, useEffect } from 'react';
import { ReframingEngine } from '@/lib/reframing/engine';
import { FFmpegExporter } from '@/lib/video/ffmpeg-exporter';
import { SimpleExporter } from '@/lib/video/simple-exporter';
import { 
  ReframingConfig, 
  FrameTransform, 
  Detection, 
  TrackedObject,
  VideoMetadata,
  ExportOptions,
  AspectRatio
} from '@/types';
import { REFRAMING_PRESETS } from '@/lib/reframing/presets';

export function useReframing() {
  const [config, setConfig] = useState<ReframingConfig>(REFRAMING_PRESETS['instagram-reel']);
  const [transforms, setTransforms] = useState<Map<number, FrameTransform>>(new Map());
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [currentPreset, setCurrentPreset] = useState('instagram-reel');
  
  const engineRef = useRef<ReframingEngine | null>(null);
  const ffmpegExporterRef = useRef<FFmpegExporter | null>(null);
  const simpleExporterRef = useRef<SimpleExporter | null>(null);

  // Initialize reframing engine
  useEffect(() => {
    engineRef.current = new ReframingEngine(config);
  }, []);

  // Update engine when config changes
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateConfig(config);
    }
  }, [config]);

  const processReframing = useCallback(async (
    detections: Detection[],
    selectedTrack: TrackedObject | null,
    metadata: VideoMetadata
  ) => {
    if (!engineRef.current) {
      throw new Error('Reframing engine not initialized');
    }

    setIsProcessing(true);
    try {
      const frameTransforms = engineRef.current.processAllFrames(
        detections,
        selectedTrack,
        metadata.width,
        metadata.height
      );
      
      setTransforms(frameTransforms);
      return frameTransforms;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const updateConfig = useCallback((updates: Partial<ReframingConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  const applyPreset = useCallback((presetName: string) => {
    const preset = REFRAMING_PRESETS[presetName];
    if (preset) {
      setConfig(preset);
      setCurrentPreset(presetName);
    }
  }, []);

  const exportVideo = useCallback(async (
    videoElement: HTMLVideoElement,
    metadata: VideoMetadata,
    options: ExportOptions = {
      format: 'mp4',
      quality: 0.9,
      codec: 'h264'
    }
  ): Promise<Blob> => {
    if (!transforms.size) {
      throw new Error('No reframing data available');
    }

    setIsExporting(true);
    setExportProgress(0);

    try {
      let blob: Blob;
      
      // Try FFmpeg first if MP4 is requested
      if (options.format === 'mp4') {
        try {
          console.log('Trying FFmpeg export...');
          const response = await fetch(videoElement.src);
          const videoBlob = await response.blob();
          
          if (!ffmpegExporterRef.current) {
            ffmpegExporterRef.current = new FFmpegExporter();
          }
          
          blob = await ffmpegExporterRef.current.export(
            videoBlob,
            transforms,
            metadata,
            config.outputRatio,
            options,
            (progress) => setExportProgress(progress)
          );
        } catch (ffmpegError) {
          console.error('FFmpeg export failed, falling back to simple export:', ffmpegError);
          // Fall back to simple export
          options.format = 'webm'; // Force WebM for fallback
          
          if (!simpleExporterRef.current) {
            simpleExporterRef.current = new SimpleExporter();
          }
          
          blob = await simpleExporterRef.current.export(
            videoElement,
            transforms,
            metadata,
            config.outputRatio,
            options,
            (progress) => setExportProgress(progress)
          );
        }
      } else {
        // Use simple export for WebM
        console.log('Using simple export for WebM...');
        if (!simpleExporterRef.current) {
          simpleExporterRef.current = new SimpleExporter();
        }
        
        blob = await simpleExporterRef.current.export(
          videoElement,
          transforms,
          metadata,
          config.outputRatio,
          options,
          (progress) => setExportProgress(progress)
        );
      }

      return blob;
    } finally {
      setIsExporting(false);
      setExportProgress(100);
    }
  }, [transforms, config.outputRatio]);

  const getFrameTransform = useCallback((frameNumber: number): FrameTransform | undefined => {
    return transforms.get(frameNumber);
  }, [transforms]);

  const updateTransform = useCallback((frameNumber: number, transform: FrameTransform) => {
    setTransforms(prev => {
      const newMap = new Map(prev);
      newMap.set(frameNumber, transform);
      return newMap;
    });
  }, []);

  const cancelExport = useCallback(() => {
    // Currently not implemented for FrameAccurateExporter
    console.warn('Export cancellation not implemented');
  }, []);

  const reset = useCallback(() => {
    setTransforms(new Map());
    setIsProcessing(false);
    setIsExporting(false);
    setExportProgress(0);
  }, []);

  return {
    config,
    currentPreset,
    transforms,
    isProcessing,
    isExporting,
    exportProgress,
    processReframing,
    updateConfig,
    applyPreset,
    exportVideo,
    getFrameTransform,
    updateTransform,
    cancelExport,
    reset
  };
}