import { useState, useCallback, useRef, useEffect } from 'react';
import { PersonYOLODetector } from '@/lib/detection/person-yolo';
import { ByteTrackInterpolator } from '@/lib/detection/bytetrack-interpolator';
import { Detection, BoundingBox, TrackedObject } from '@/types';
import { detectionConfig } from '@/config/detection';
import { getAdaptiveConfig } from '@/config/detection-adaptive';

// Helper function to calculate IoU between two bounding boxes
function calculateIoU(box1: BoundingBox, box2: BoundingBox): number {
  const x1 = Math.max(box1.x, box2.x);
  const y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
  const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);
  
  if (x2 < x1 || y2 < y1) return 0;
  
  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = box1.width * box1.height;
  const area2 = box2.width * box2.height;
  const union = area1 + area2 - intersection;
  
  return union > 0 ? intersection / union : 0;
}

interface FrameDetectionTask {
  imageData: ImageData;
  frameNumber: number;
  timestamp: number;
}

export function useObjectDetectionOptimized(enableParallel: boolean = true) {
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [trackedObjects, setTrackedObjects] = useState<TrackedObject[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [targetDetection, setTargetDetection] = useState<Detection | null>(null);
  const [headOffsetRatio, setHeadOffsetRatio] = useState<{ x: number; y: number } | null>(null);
  
  const detectorRef = useRef<PersonYOLODetector | null>(null);
  const byteTrackerRef = useRef<ByteTrackInterpolator | null>(null);
  
  // For parallel processing
  const workerDetectorRef = useRef<PersonYOLODetector | null>(null);
  const parallelEnabled = enableParallel;

  // Initialize detector(s)
  useEffect(() => {
    const initDetector = async () => {
      try {
        console.log('Initializing PersonYOLODetector...');
        detectorRef.current = new PersonYOLODetector();
        await detectorRef.current.initialize();
        detectorRef.current.setConfidenceThreshold(0.3);
        
        // Initialize second detector for parallel processing
        if (parallelEnabled) {
          console.log('Initializing second detector for parallel processing...');
          workerDetectorRef.current = new PersonYOLODetector();
          await workerDetectorRef.current.initialize();
          workerDetectorRef.current.setConfidenceThreshold(0.3);
        }
        
        setIsModelLoaded(true);
        console.log('Model(s) loaded successfully!');
      } catch (error) {
        console.error('Failed to initialize detectors:', error);
        setIsModelLoaded(false);
      }
    };

    initDetector();

    return () => {
      if (detectorRef.current) {
        detectorRef.current.dispose();
      }
      if (workerDetectorRef.current) {
        workerDetectorRef.current.dispose();
      }
    };
  }, [parallelEnabled]);

  const detectFrame = useCallback(async (
    imageData: ImageData | HTMLVideoElement | HTMLCanvasElement,
    frameNumber: number,
    timestamp: number,
    targetTrackId?: string | null,
    useWorkerDetector: boolean = false
  ): Promise<Detection> => {
    if (!isModelLoaded) {
      throw new Error('Model not loaded');
    }

    const detector = useWorkerDetector && workerDetectorRef.current 
      ? workerDetectorRef.current 
      : detectorRef.current!;

    // Detect objects
    const boxes = await detector.detect(imageData, frameNumber);
    
    // Always use ByteTrack for consistency
    if (!byteTrackerRef.current) {
      const defaultConfig = getAdaptiveConfig(30);
      byteTrackerRef.current = new ByteTrackInterpolator(defaultConfig.byteTracker);
    }
    
    const detection = byteTrackerRef.current.processFrame(boxes, frameNumber, timestamp);
    return detection;
  }, [isModelLoaded]);

  const processVideoOptimized = useCallback(async (
    processFrames: (onFrame: (imageData: ImageData, frameNumber: number, timestamp: number) => Promise<void>) => Promise<void>,
    metadata: { fps: number; duration: number }
  ) => {
    if (!isModelLoaded) {
      throw new Error('Model not loaded');
    }

    setIsProcessing(true);
    setDetections([]);
    if (byteTrackerRef.current) {
      byteTrackerRef.current.reset();
    }

    let targetTrackId: string | null = null;
    if (targetDetection && targetDetection.boxes.length > 0) {
      const targetBox = targetDetection.boxes[0];
      if (targetBox.trackId) {
        targetTrackId = targetBox.trackId;
      }
    }

    const totalFrames = Math.floor(metadata.fps * metadata.duration);
    const sampleInterval = detectionConfig.sampleInterval;
    
    // Collect frames that need detection
    const detectionFrames: FrameDetectionTask[] = [];
    const allFrameData = new Map<number, ImageData>();
    
    try {
      // First pass: collect frames
      await processFrames(async (imageData, frameNumber, timestamp) => {
        allFrameData.set(frameNumber, imageData);
        
        const isFirstFrame = frameNumber === 0;
        const isLastFrame = frameNumber === totalFrames - 1;
        const isSampleFrame = frameNumber % sampleInterval === 0;
        
        if (isFirstFrame || isLastFrame || isSampleFrame) {
          detectionFrames.push({ imageData, frameNumber, timestamp });
        }
      });

      // Process detections with optimized batching
      if (parallelEnabled && workerDetectorRef.current) {
        // Parallel processing: split work between two detectors
        const midPoint = Math.floor(detectionFrames.length / 2);
        const firstHalf = detectionFrames.slice(0, midPoint);
        const secondHalf = detectionFrames.slice(midPoint);
        
        const processHalf = async (frames: FrameDetectionTask[], useWorker: boolean) => {
          for (const frame of frames) {
            await detectFrame(frame.imageData, frame.frameNumber, frame.timestamp, targetTrackId, useWorker);
            
            // Update UI periodically
            if (frame.frameNumber % 30 === 0 || frame.frameNumber === totalFrames - 1) {
              const currentDetections = byteTrackerRef.current!.getAllDetections(frame.frameNumber, metadata.fps);
              setDetections(currentDetections);
            }
          }
        };
        
        // Process both halves in parallel
        await Promise.all([
          processHalf(firstHalf, false),
          processHalf(secondHalf, true)
        ]);
      } else {
        // Sequential processing (fallback)
        for (const frame of detectionFrames) {
          await detectFrame(frame.imageData, frame.frameNumber, frame.timestamp, targetTrackId);
          
          // Update UI periodically
          if (frame.frameNumber % 30 === 0 || frame.frameNumber === totalFrames - 1) {
            const currentDetections = byteTrackerRef.current!.getAllDetections(frame.frameNumber, metadata.fps);
            setDetections(currentDetections);
          }
        }
      }

      // Final interpolation for all frames
      const allDetections = byteTrackerRef.current!.getAllDetections(totalFrames, metadata.fps);
      
      // Head center interpolation
      if (targetTrackId && headOffsetRatio) {
        allDetections.forEach(det => {
          det.boxes.forEach(box => {
            if (box.trackId === targetTrackId && (box.headCenterX === undefined || box.headCenterY === undefined)) {
              const aspectRatio = box.width / box.height;
              if (aspectRatio > 1.5) {
                // Horizontal pose
                box.headCenterX = box.x + box.width * 0.15;
                box.headCenterY = box.y + box.height * 0.5;
              } else if (aspectRatio < 0.5) {
                // Very tall - standing
                box.headCenterX = box.x + box.width * 0.5;
                box.headCenterY = box.y + box.height * 0.15;
              } else {
                // Use stored offset ratio
                box.headCenterX = box.x + box.width * headOffsetRatio.x;
                box.headCenterY = box.y + box.height * headOffsetRatio.y;
              }
            }
          });
        });
      }
      
      setDetections(allDetections);
      
      // Extract tracked objects
      const finalTrackMap = new Map<string, TrackedObject>();
      
      allDetections.forEach((detection) => {
        detection.boxes.forEach((box) => {
          if (box.trackId) {
            if (!finalTrackMap.has(box.trackId)) {
              finalTrackMap.set(box.trackId, {
                id: box.trackId,
                firstFrame: detection.frameNumber,
                lastFrame: detection.frameNumber,
                positions: new Map(),
                label: box.class,
                selected: false
              });
            }
            
            const track = finalTrackMap.get(box.trackId)!;
            track.lastFrame = detection.frameNumber;
            track.positions.set(detection.frameNumber, box);
          }
        });
      });
      
      setTrackedObjects(Array.from(finalTrackMap.values()));
      
      // Auto-select target track
      if (targetDetection) {
        const targetBox = targetDetection.boxes[0];
        if (targetBox) {
          let bestTrack: TrackedObject | null = null;
          let bestScore = 0;
          
          const tracks = Array.from(finalTrackMap.values());
          tracks.forEach(track => {
            const trackBox = track.positions.get(targetDetection.frameNumber);
            if (trackBox) {
              const iou = calculateIoU(targetBox, trackBox);
              if (iou > bestScore) {
                bestScore = iou;
                bestTrack = track;
              }
            }
          });
          
          if (bestTrack && bestScore > 0.5) {
            setSelectedTrackId(bestTrack.id);
            bestTrack.selected = true;
          }
        }
      }
      
      return allDetections;
    } finally {
      setIsProcessing(false);
    }
  }, [isModelLoaded, detectFrame, targetDetection, headOffsetRatio, parallelEnabled]);

  const selectTrack = useCallback((trackId: string | null) => {
    setSelectedTrackId(trackId);
    setTrackedObjects(prev => prev.map(track => ({
      ...track,
      selected: track.id === trackId
    })));
  }, []);

  const getSelectedTrack = useCallback((): TrackedObject | null => {
    if (!selectedTrackId) return null;
    return trackedObjects.find(obj => obj.id === selectedTrackId) || null;
  }, [selectedTrackId, trackedObjects]);

  const setConfidenceThreshold = useCallback((threshold: number) => {
    if (detectorRef.current) {
      detectorRef.current.setConfidenceThreshold(threshold);
    }
    if (workerDetectorRef.current) {
      workerDetectorRef.current.setConfidenceThreshold(threshold);
    }
    
    if (byteTrackerRef.current) {
      byteTrackerRef.current = new ByteTrackInterpolator({
        trackThresh: threshold,
        trackBuffer: 30,
        matchThresh: 0.5,
        minBoxArea: 100,
        lowThresh: Math.max(0.1, threshold * 0.5)
      });
    }
  }, []);

  const setTargetHead = useCallback((detection: Detection) => {
    setTargetDetection(detection);
    
    if (detection.boxes.length > 0) {
      const box = detection.boxes[0];
      if (box.headCenterX !== undefined && box.headCenterY !== undefined) {
        const relativeX = (box.headCenterX - box.x) / box.width;
        const relativeY = (box.headCenterY - box.y) / box.height;
        setHeadOffsetRatio({ x: relativeX, y: relativeY });
      } else {
        const aspectRatio = box.width / box.height;
        let defaultX = 0.5;
        let defaultY = 0.25;
        
        if (aspectRatio > 1.5) {
          defaultX = 0.2;
          defaultY = 0.5;
        } else if (aspectRatio < 0.5) {
          defaultY = 0.15;
        }
        
        setHeadOffsetRatio({ x: defaultX, y: defaultY });
      }
    }
  }, []);

  const selectByteTrackId = useCallback((trackId: string) => {
    if (trackId) {
      setSelectedTrackId(trackId);
      setTrackedObjects(prev => prev.map(track => ({
        ...track,
        selected: track.id === trackId
      })));
    }
  }, []);

  const reset = useCallback(() => {
    setDetections([]);
    setTrackedObjects([]);
    setSelectedTrackId(null);
    setTargetDetection(null);
    setHeadOffsetRatio(null);
    if (byteTrackerRef.current) {
      byteTrackerRef.current.reset();
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
    processVideo: processVideoOptimized,
    selectTrack,
    getSelectedTrack,
    setConfidenceThreshold,
    setTargetHead,
    selectByteTrackId,
    reset,
    useByteTrack: true,
    setUseByteTrack: () => {}
  };
}