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

interface BatchDetectionTask {
  imageData: ImageData;
  frameNumber: number;
  timestamp: number;
}

export function useParallelObjectDetection(maxConcurrency: number = 3) {
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [trackedObjects, setTrackedObjects] = useState<TrackedObject[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [targetDetection, setTargetDetection] = useState<Detection | null>(null);
  const [headOffsetRatio, setHeadOffsetRatio] = useState<{ x: number; y: number } | null>(null);
  
  // Multiple detectors for parallel processing
  const detectorsRef = useRef<PersonYOLODetector[]>([]);
  const byteTrackerRef = useRef<ByteTrackInterpolator | null>(null);
  const detectorPoolRef = useRef<PersonYOLODetector[]>([]);

  // Initialize multiple detectors
  useEffect(() => {
    const initDetectors = async () => {
      try {
        console.log(`Initializing ${maxConcurrency} PersonYOLODetectors for parallel processing...`);
        
        // Create detector pool
        const detectorPromises = [];
        for (let i = 0; i < maxConcurrency; i++) {
          detectorPromises.push((async () => {
            const detector = new PersonYOLODetector();
            await detector.initialize();
            detector.setConfidenceThreshold(0.3);
            return detector;
          })());
        }
        
        const detectors = await Promise.all(detectorPromises);
        detectorsRef.current = detectors;
        detectorPoolRef.current = [...detectors];
        
        setIsModelLoaded(true);
        console.log(`${maxConcurrency} models loaded successfully for parallel processing!`);
      } catch (error) {
        console.error('Failed to initialize detectors:', error);
        setIsModelLoaded(false);
      }
    };

    initDetectors();

    return () => {
      detectorsRef.current.forEach(detector => detector.dispose());
      detectorsRef.current = [];
      detectorPoolRef.current = [];
    };
  }, [maxConcurrency]);

  const getAvailableDetector = useCallback((): PersonYOLODetector | null => {
    return detectorPoolRef.current.pop() || null;
  }, []);

  const releaseDetector = useCallback((detector: PersonYOLODetector) => {
    detectorPoolRef.current.push(detector);
  }, []);

  const detectFrameBatch = useCallback(async (
    tasks: BatchDetectionTask[]
  ): Promise<Map<number, Detection>> => {
    const results = new Map<number, Detection>();
    
    // Process tasks in parallel
    const detectionPromises = tasks.map(async (task) => {
      const detector = getAvailableDetector();
      if (!detector) {
        // Wait for detector to become available
        await new Promise(resolve => setTimeout(resolve, 50));
        return detectFrameBatch([task]);
      }
      
      try {
        const boxes = await detector.detect(task.imageData, task.frameNumber);
        
        // Use ByteTracker for temporal consistency
        if (!byteTrackerRef.current) {
          const defaultConfig = getAdaptiveConfig(30);
          byteTrackerRef.current = new ByteTrackInterpolator(defaultConfig.byteTracker);
        }
        
        const detection = byteTrackerRef.current.processFrame(boxes, task.frameNumber, task.timestamp);
        results.set(task.frameNumber, detection);
      } catch (error) {
        console.error(`Detection failed for frame ${task.frameNumber}:`, error);
      } finally {
        releaseDetector(detector);
      }
    });
    
    await Promise.all(detectionPromises);
    return results;
  }, [getAvailableDetector, releaseDetector]);

  const processVideo = useCallback(async (
    processFrames: (onFrame: (imageData: ImageData, frameNumber: number, timestamp: number) => Promise<void>) => Promise<void>,
    metadata: { fps: number; duration: number }
  ) => {
    if (!isModelLoaded) {
      throw new Error('Models not loaded');
    }

    setIsProcessing(true);
    setDetections([]);
    if (byteTrackerRef.current) {
      byteTrackerRef.current.reset();
    }

    // Extract target track ID if using ByteTrack
    let targetTrackId: string | null = null;
    if (targetDetection && targetDetection.boxes.length > 0) {
      const targetBox = targetDetection.boxes[0];
      if (targetBox.trackId) {
        targetTrackId = targetBox.trackId;
      }
    }

    const totalFrames = Math.floor(metadata.fps * metadata.duration);
    const sampleInterval = detectionConfig.sampleInterval;
    const detectionBatches: Map<number, BatchDetectionTask[]> = new Map();
    const allImageData: Map<number, ImageData> = new Map();
    
    try {
      // First pass: collect all frames and organize detection batches
      await processFrames(async (imageData, frameNumber, timestamp) => {
        // Store all image data
        allImageData.set(frameNumber, imageData);
        
        // Check if this frame needs detection
        const isFirstFrame = frameNumber === 0;
        const isLastFrame = frameNumber === totalFrames - 1;
        const isSampleFrame = frameNumber % sampleInterval === 0;
        
        if (isFirstFrame || isLastFrame || isSampleFrame) {
          const batchIndex = Math.floor(frameNumber / (sampleInterval * maxConcurrency));
          if (!detectionBatches.has(batchIndex)) {
            detectionBatches.set(batchIndex, []);
          }
          detectionBatches.get(batchIndex)!.push({
            imageData,
            frameNumber,
            timestamp
          });
        }
      });

      // Second pass: process detection batches in parallel
      const detectionResults = new Map<number, Detection>();
      const batchKeys = Array.from(detectionBatches.keys()).sort((a, b) => a - b);
      
      for (const batchKey of batchKeys) {
        const batch = detectionBatches.get(batchKey)!;
        const batchResults = await detectFrameBatch(batch);
        
        // Merge results
        batchResults.forEach((detection, frameNumber) => {
          detectionResults.set(frameNumber, detection);
        });
        
        // Update UI periodically
        const progress = ((batchKey + 1) / batchKeys.length) * 100;
        const currentDetections = byteTrackerRef.current!.getAllDetections(
          Math.max(...Array.from(detectionResults.keys())), 
          metadata.fps
        );
        setDetections(currentDetections);
      }

      // Final interpolation for all frames
      const allDetections = byteTrackerRef.current!.getAllDetections(totalFrames, metadata.fps);
      
      // Head center interpolation (same as original)
      if (targetTrackId && headOffsetRatio) {
        allDetections.forEach(det => {
          det.boxes.forEach(box => {
            if (box.trackId === targetTrackId && (box.headCenterX === undefined || box.headCenterY === undefined)) {
              box.headCenterX = box.x + box.width * headOffsetRatio.x;
              box.headCenterY = box.y + box.height * headOffsetRatio.y;
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
  }, [isModelLoaded, detectFrameBatch, targetDetection, headOffsetRatio, maxConcurrency]);

  const selectTrack = useCallback((trackId: string | null) => {
    setSelectedTrackId(trackId);
    
    // Update tracked objects to mark the selected track
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
    detectorsRef.current.forEach(detector => {
      detector.setConfidenceThreshold(threshold);
    });
    
    // Reinitialize ByteTracker with new thresholds
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
    
    // Calculate relative head position
    if (detection.boxes.length > 0) {
      const box = detection.boxes[0];
      if (box.headCenterX !== undefined && box.headCenterY !== undefined) {
        const relativeX = (box.headCenterX - box.x) / box.width;
        const relativeY = (box.headCenterY - box.y) / box.height;
        setHeadOffsetRatio({ x: relativeX, y: relativeY });
      } else {
        // Smart default based on aspect ratio
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
    processVideo,
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