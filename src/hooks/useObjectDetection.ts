import { useState, useCallback, useRef, useEffect } from 'react';
import { YOLODetector } from '@/lib/detection/yolo';
import { ObjectTracker } from '@/lib/detection/tracker';
import { Detection, BoundingBox, TrackedObject } from '@/types';

export function useObjectDetection() {
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [trackedObjects, setTrackedObjects] = useState<TrackedObject[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const detectorRef = useRef<YOLODetector | null>(null);
  const trackerRef = useRef<ObjectTracker | null>(null);

  // Initialize detector
  useEffect(() => {
    const initDetector = async () => {
      try {
        detectorRef.current = new YOLODetector();
        await detectorRef.current.initialize();
        setIsModelLoaded(true);
      } catch (error) {
        console.error('Failed to initialize YOLO detector:', error);
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

  // Initialize tracker
  useEffect(() => {
    trackerRef.current = new ObjectTracker();
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
    processFrames: (onFrame: (imageData: ImageData, frameNumber: number, timestamp: number) => Promise<void>) => Promise<void>
  ) => {
    if (!isModelLoaded) {
      throw new Error('Model not loaded');
    }

    setIsProcessing(true);
    setDetections([]);
    trackerRef.current!.reset();

    const allDetections: Detection[] = [];

    try {
      await processFrames(async (imageData, frameNumber, timestamp) => {
        const detection = await detectFrame(imageData, frameNumber, timestamp);
        allDetections.push(detection);
        
        // Update detections periodically for UI feedback
        if (frameNumber % 10 === 0) {
          setDetections([...allDetections]);
          setTrackedObjects(trackerRef.current!.getTrackedObjects());
        }
      });

      setDetections(allDetections);
      setTrackedObjects(trackerRef.current!.getTrackedObjects());
    } finally {
      setIsProcessing(false);
    }

    return allDetections;
  }, [isModelLoaded, detectFrame]);

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

  const reset = useCallback(() => {
    setDetections([]);
    setTrackedObjects([]);
    setSelectedTrackId(null);
    if (trackerRef.current) {
      trackerRef.current.reset();
    }
  }, []);

  return {
    isModelLoaded,
    isProcessing,
    detections,
    trackedObjects,
    selectedTrackId,
    detectFrame,
    processVideo,
    selectTrack,
    getSelectedTrack,
    setConfidenceThreshold,
    reset
  };
}