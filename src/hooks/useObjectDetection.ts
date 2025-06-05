import { useState, useCallback, useRef, useEffect } from 'react';
import { PersonYOLODetector } from '@/lib/detection/person-yolo';
import { ObjectTracker } from '@/lib/detection/tracker';
import { DetectionInterpolator } from '@/lib/detection/interpolator';
import { Detection, BoundingBox, TrackedObject } from '@/types';

export function useObjectDetection() {
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [trackedObjects, setTrackedObjects] = useState<TrackedObject[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [targetDetection, setTargetDetection] = useState<Detection | null>(null);
  
  const detectorRef = useRef<PersonYOLODetector | null>(null);
  const trackerRef = useRef<ObjectTracker | null>(null);
  const interpolatorRef = useRef<DetectionInterpolator | null>(null);

  // Initialize detector
  useEffect(() => {
    const initDetector = async () => {
      try {
        detectorRef.current = new PersonYOLODetector();
        await detectorRef.current.initialize();
        setIsModelLoaded(true);
      } catch (error) {
        console.error('Failed to initialize Person detector:', error);
        setIsModelLoaded(false);
      }
    };

    initDetector();

    return () => {
      if (detectorRef.current) {
        detectorRef.current.dispose();
      }
    };
  }, []);

  // Initialize tracker and interpolator
  useEffect(() => {
    trackerRef.current = new ObjectTracker();
    interpolatorRef.current = new DetectionInterpolator();
  }, []);

  const detectFrame = useCallback(async (
    imageData: ImageData | HTMLVideoElement | HTMLCanvasElement,
    frameNumber: number,
    timestamp: number
  ): Promise<Detection> => {
    if (!detectorRef.current || !isModelLoaded) {
      throw new Error('Model not loaded');
    }

    // Detect objects
    const boxes = await detectorRef.current.detect(imageData);
    
    // Track objects
    const trackedBoxes = trackerRef.current!.track(boxes, frameNumber);
    
    const detection: Detection = {
      frameNumber,
      timestamp,
      boxes: trackedBoxes
    };

    return detection;
  }, [isModelLoaded]);

  const processVideo = useCallback(async (
    processFrames: (onFrame: (imageData: ImageData, frameNumber: number, timestamp: number) => Promise<void>) => Promise<void>,
    metadata: { fps: number; duration: number }
  ) => {
    if (!isModelLoaded) {
      throw new Error('Model not loaded');
    }

    setIsProcessing(true);
    setDetections([]);
    trackerRef.current!.reset();
    interpolatorRef.current!.reset();

    // If we have a target detection, initialize tracker with it
    if (targetDetection && trackerRef.current) {
      trackerRef.current.setTargetDetection(targetDetection);
    }

    const totalFrames = Math.floor(metadata.fps * metadata.duration);
    // Detect every 5 frames, including first and last
    const sampleInterval = 5;
    let processedFrames = 0;

    try {
      await processFrames(async (imageData, frameNumber, timestamp) => {
        processedFrames++;
        
        // Detect on first frame, last frame, and every 5 frames
        const isFirstFrame = frameNumber === 0;
        const isLastFrame = frameNumber === totalFrames - 1;
        const isSampleFrame = frameNumber % sampleInterval === 0;
        
        if (isFirstFrame || isLastFrame || isSampleFrame) {
          const detection = await detectFrame(imageData, frameNumber, timestamp);
          interpolatorRef.current!.addKeyframe(detection);
          
          // Update UI periodically
          if (frameNumber % 10 === 0 || isLastFrame) {
            const interpolated = interpolatorRef.current!.interpolate(processedFrames, metadata.fps);
            setDetections(interpolated);
            setTrackedObjects(trackerRef.current!.getTrackedObjects());
          }
        }
      });

      // Final interpolation for all frames
      const allDetections = interpolatorRef.current!.interpolate(totalFrames, metadata.fps);
      setDetections(allDetections);
      setTrackedObjects(trackerRef.current!.getTrackedObjects());
      
      // Auto-select the target track if available
      if (targetDetection && trackerRef.current) {
        const targetTrack = trackerRef.current.getTargetTrack();
        if (targetTrack) {
          setSelectedTrackId(targetTrack.id);
        }
      }
      
      return allDetections;
    } finally {
      setIsProcessing(false);
    }
  }, [isModelLoaded, detectFrame, targetDetection]);

  const selectTrack = useCallback((trackId: string | null) => {
    setSelectedTrackId(trackId);
    if (trackId && trackerRef.current) {
      trackerRef.current.selectTrack(trackId);
    }
  }, []);

  const getSelectedTrack = useCallback((): TrackedObject | null => {
    if (!selectedTrackId) return null;
    return trackedObjects.find(obj => obj.id === selectedTrackId) || null;
  }, [selectedTrackId, trackedObjects]);

  const setConfidenceThreshold = useCallback((threshold: number) => {
    if (detectorRef.current) {
      detectorRef.current.setConfidenceThreshold(threshold);
    }
  }, []);

  const setTargetHead = useCallback((detection: Detection) => {
    setTargetDetection(detection);
  }, []);

  const reset = useCallback(() => {
    setDetections([]);
    setTrackedObjects([]);
    setSelectedTrackId(null);
    setTargetDetection(null);
    if (trackerRef.current) {
      trackerRef.current.reset();
    }
    if (interpolatorRef.current) {
      interpolatorRef.current.reset();
    }
  }, []);

  return {
    isModelLoaded,
    isProcessing,
    detections,
    trackedObjects,
    selectedTrackId,
    targetDetection,
    detectFrame,
    processVideo,
    selectTrack,
    getSelectedTrack,
    setConfidenceThreshold,
    setTargetHead,
    reset
  };
}