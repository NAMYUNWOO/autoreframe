import { useState, useCallback, useRef, useEffect } from 'react';
import { PersonYOLODetector } from '@/lib/detection/person-yolo';
import { ByteTrackInterpolator } from '@/lib/detection/bytetrack-interpolator';
import { HeadDetector } from '@/lib/detection/head-detector';
import { Detection, BoundingBox, TrackedObject } from '@/types';

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

export function useObjectDetection() {
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [trackedObjects, setTrackedObjects] = useState<TrackedObject[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [targetDetection, setTargetDetection] = useState<Detection | null>(null);
  // Always use ByteTrack for consistency
  const useByteTrack = true;
  const [useHeadDetection, setUseHeadDetection] = useState(false); // Disable head detection - model not reliable
  const [headOffsetRatio, setHeadOffsetRatio] = useState<{ x: number; y: number } | null>(null); // Relative head position
  
  const detectorRef = useRef<PersonYOLODetector | null>(null);
  const byteTrackerRef = useRef<ByteTrackInterpolator | null>(null);
  const headDetectorRef = useRef<HeadDetector | null>(null);

  // Initialize detector
  useEffect(() => {
    const initDetector = async () => {
      try {
        detectorRef.current = new PersonYOLODetector();
        await detectorRef.current.initialize();
        
        // Set initial confidence threshold to match UI default (30%)
        detectorRef.current.setConfidenceThreshold(0.3);
        
        // Initialize head detector if head detection is enabled
        if (useHeadDetection) {
          headDetectorRef.current = new HeadDetector();
          await headDetectorRef.current.initialize();
          // console.log('Head detector initialized');
        }
        
        setIsModelLoaded(true);
      } catch (error) {
        // console.error('Failed to initialize detectors:', error);
        setIsModelLoaded(false);
      }
    };

    initDetector();

    return () => {
      if (detectorRef.current) {
        detectorRef.current.dispose();
      }
      if (headDetectorRef.current) {
        headDetectorRef.current.dispose();
      }
    };
  }, [useHeadDetection]);

  // Initialize ByteTracker will be done when confidence threshold is set

  const detectFrame = useCallback(async (
    imageData: ImageData | HTMLVideoElement | HTMLCanvasElement,
    frameNumber: number,
    timestamp: number,
    targetTrackId?: string | null
  ): Promise<Detection> => {
    if (!detectorRef.current || !isModelLoaded) {
      throw new Error('Model not loaded');
    }

    // Detect objects
    const boxes = await detectorRef.current.detect(imageData, frameNumber);
    
    // Always use ByteTrack for consistency
    if (!byteTrackerRef.current) {
      // console.warn('ByteTracker not initialized, using default params');
      byteTrackerRef.current = new ByteTrackInterpolator({
        trackThresh: 0.3,
        trackBuffer: 30,
        matchThresh: 0.8,
        minBoxArea: 100,
        lowThresh: 0.1
      });
    }
    
    if (frameNumber === 213) {
      // console.log(`Frame 213: Before ByteTracker - ${boxes.length} boxes from YOLO`);
      boxes.forEach((box, i) => {
        // console.log(`  YOLO box ${i}: confidence=${box.confidence}, class=${box.class}`);
      });
    }
    
    const detection = byteTrackerRef.current.processFrame(boxes, frameNumber, timestamp);

    // Don't run head detection here - it will be done selectively in processVideo

    return detection;
  }, [isModelLoaded, useHeadDetection]);

  const processVideo = useCallback(async (
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
    } else {
      // console.warn('ByteTracker not initialized before processVideo');
    }

    // Extract target track ID and head center if using ByteTrack
    let targetTrackId: string | null = null;
    if (useByteTrack && targetDetection && targetDetection.boxes.length > 0) {
      const targetBox = targetDetection.boxes[0];
      if (targetBox.trackId) {
        targetTrackId = targetBox.trackId;
        // console.log('Target track ID for head center propagation:', targetTrackId);
      }
    }

    const totalFrames = Math.floor(metadata.fps * metadata.duration);
    // When using ByteTracker, we should only call it on frames where we actually run detection
    // to avoid breaking temporal consistency
    const sampleInterval = 5; // Detect every 5 frames
    let processedFrames = 0;
    let detectionFrameCount = 0; // Count only frames where detection runs

    try {
      await processFrames(async (imageData, frameNumber, timestamp) => {
        processedFrames++;
        
        // Detect on first frame, last frame, and sample frames
        const isFirstFrame = frameNumber === 0;
        const isLastFrame = frameNumber === totalFrames - 1;
        const isSampleFrame = frameNumber % sampleInterval === 0;
        
        if (isFirstFrame || isLastFrame || isSampleFrame) {
          if (frameNumber === 213) {
            // console.log(`Frame 213: This is a sample frame, running detection`);
          }
          const detection = await detectFrame(imageData, frameNumber, timestamp, targetTrackId);
          
          // Run head detection only on key frames: first, last, and every 5 frames
          if (useHeadDetection && headDetectorRef.current && detection.boxes.length > 0 && 
              (isFirstFrame || isLastFrame || frameNumber % 5 === 0)) {
            // console.log(`Running head detection for frame ${frameNumber} with ${detection.boxes.length} persons`);
            
            for (const box of detection.boxes) {
              try {
                const headResult = await headDetectorRef.current.detectHeadInBox(
                  imageData,
                  box,
                  0.05 // 5% padding
                );
                
                if (headResult) {
                  box.headCenterX = headResult.x + headResult.width / 2;
                  box.headCenterY = headResult.y + headResult.height / 2;
                  // console.log(`Frame ${frameNumber}: Head detected for track ${box.trackId} at (${box.headCenterX}, ${box.headCenterY})`);
                } else {
                  // Smart head position estimation based on aspect ratio and pose
                  const aspectRatio = box.width / box.height;
                  if (aspectRatio > 1.5) {
                    // Wide box - person likely horizontal (like figure skating)
                    // For figure skating, head is usually at one of the ends
                    // We'll check which end based on the frame context
                    // For now, assume head is at the higher end (top of image)
                    if (box.y < box.y + box.height / 2) {
                      // Top part of box is higher, head likely on left
                      box.headCenterX = box.x + box.width * 0.15;
                      box.headCenterY = box.y + box.height * 0.5;
                    } else {
                      // Head likely on right
                      box.headCenterX = box.x + box.width * 0.85;
                      box.headCenterY = box.y + box.height * 0.5;
                    }
                  } else if (aspectRatio < 0.5) {
                    // Very tall box - person standing upright
                    box.headCenterX = box.x + box.width / 2;
                    box.headCenterY = box.y + box.height * 0.15;
                  } else {
                    // Normal standing pose
                    box.headCenterX = box.x + box.width / 2;
                    box.headCenterY = box.y + box.height * 0.25;
                  }
                  // console.log(`Frame ${frameNumber}: Head estimated (no detection) for track ${box.trackId} at (${box.headCenterX}, ${box.headCenterY}), aspect ratio: ${aspectRatio.toFixed(2)})`);
                }
              } catch (error) {
                // console.error(`Head detection failed for frame ${frameNumber}, track ${box.trackId}:`, error);
                // Fallback to estimation
                const aspectRatio = box.width / box.height;
                if (aspectRatio > 1.5) {
                  // Wide box - horizontal pose
                  box.headCenterX = box.x + box.width * 0.15;
                  box.headCenterY = box.y + box.height * 0.5;
                } else if (aspectRatio < 0.5) {
                  // Very tall box - upright
                  box.headCenterX = box.x + box.width / 2;
                  box.headCenterY = box.y + box.height * 0.15;
                } else {
                  box.headCenterX = box.x + box.width / 2;
                  box.headCenterY = box.y + box.height * 0.25;
                }
              }
            }
          }
          
          // ByteTrack handles its own interpolation
        } else {
          // For non-sample frames, don't call ByteTracker
          // This maintains temporal consistency by only updating on frames with actual detections
          
          // Update UI periodically
          if (frameNumber % 10 === 0 || isLastFrame) {
            let currentDetections: Detection[];
            
            // Get all detections with interpolation from ByteTrackInterpolator
            currentDetections = byteTrackerRef.current!.getAllDetections(processedFrames, metadata.fps);
            // Head centers are already set by detectFrame for key frames
            
            setDetections(currentDetections);
            
            // Extract tracked objects from detections
            const trackMap = new Map<string, TrackedObject>();
            
            currentDetections.forEach((detection) => {
              detection.boxes.forEach((box) => {
                if (box.trackId) {
                  if (!trackMap.has(box.trackId)) {
                    trackMap.set(box.trackId, {
                      id: box.trackId,
                      firstFrame: detection.frameNumber,
                      lastFrame: detection.frameNumber,
                      positions: new Map(),
                      label: box.class,
                      selected: false
                    });
                  }
                  
                  const track = trackMap.get(box.trackId)!;
                  track.lastFrame = detection.frameNumber;
                  track.positions.set(detection.frameNumber, box);
                }
              });
            });
            
            setTrackedObjects(Array.from(trackMap.values()));
          }
        }
      });

      // Final interpolation for all frames
      let allDetections: Detection[];
      
      // Get all detections with interpolation from ByteTrackInterpolator
      allDetections = byteTrackerRef.current!.getAllDetections(totalFrames, metadata.fps);
      // Head centers are already set by detectFrame for key frames
      // For interpolated frames, we need to interpolate head positions
      
      if (targetTrackId) {
          // console.log(`Processing ${allDetections.length} detections for head center interpolation`);
          
          // Create a map of head positions for key frames
          const headPositions = new Map<number, { x: number; y: number; relX: number; relY: number }>();
          
          allDetections.forEach(det => {
            det.boxes.forEach(box => {
              if (box.trackId === targetTrackId && box.headCenterX !== undefined && box.headCenterY !== undefined) {
                // Store both absolute and relative positions
                headPositions.set(det.frameNumber, {
                  x: box.headCenterX,
                  y: box.headCenterY,
                  relX: (box.headCenterX - box.x) / box.width,
                  relY: (box.headCenterY - box.y) / box.height
                });
              }
            });
          });
          
          // Interpolate head positions for frames without head detection
          allDetections.forEach(det => {
            det.boxes.forEach(box => {
              if (box.trackId === targetTrackId && (box.headCenterX === undefined || box.headCenterY === undefined)) {
                // Find nearest key frames with head positions
                const frameNum = det.frameNumber;
                let prevFrame = -1;
                let nextFrame = -1;
                
                for (const [frame, _] of headPositions) {
                  if (frame < frameNum && frame > prevFrame) prevFrame = frame;
                  if (frame > frameNum && (nextFrame === -1 || frame < nextFrame)) nextFrame = frame;
                }
                
                if (prevFrame !== -1 && headPositions.has(prevFrame)) {
                  // Use relative position from previous frame
                  const prevPos = headPositions.get(prevFrame)!;
                  box.headCenterX = box.x + box.width * prevPos.relX;
                  box.headCenterY = box.y + box.height * prevPos.relY;
                } else {
                  // Fallback to smart estimation
                  const aspectRatio = box.width / box.height;
                  if (aspectRatio > 1.5) {
                    // Horizontal pose - head at left end for figure skating
                    box.headCenterX = box.x + box.width * 0.15;
                    box.headCenterY = box.y + box.height * 0.5;
                  } else if (aspectRatio < 0.5) {
                    // Very tall - standing upright
                    box.headCenterX = box.x + box.width * 0.5;
                    box.headCenterY = box.y + box.height * 0.15;
                  } else {
                    box.headCenterX = box.x + box.width * 0.5;
                    box.headCenterY = box.y + box.height * 0.25;
                  }
                }
              }
            });
        });
      }
      
      setDetections(allDetections);
      
      // Extract tracked objects from detections
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
      
      // Auto-select the target track if available
      if (targetDetection) {
        // Find the track that best matches the target detection
        const targetBox = targetDetection.boxes[0];
        if (targetBox) {
          let bestTrack: TrackedObject | null = null;
          let bestScore = 0;
          
          const tracks = Array.from(finalTrackMap.values());
          tracks.forEach(track => {
            // Get the track's position at the target frame
            const trackBox = track.positions.get(targetDetection.frameNumber);
            if (trackBox) {
              // Calculate IoU between target and track box
              const iou = calculateIoU(targetBox, trackBox);
              if (iou > bestScore) {
                bestScore = iou;
                bestTrack = track;
              }
            }
          });
          
          if (bestTrack && bestScore > 0.5) {
            const track = bestTrack as TrackedObject;
            setSelectedTrackId(track.id);
            track.selected = true;
          }
        }
      }
      
      return allDetections;
    } finally {
      setIsProcessing(false);
    }
  }, [isModelLoaded, detectFrame, targetDetection, useHeadDetection]);

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
    // console.log(`useObjectDetection: setConfidenceThreshold called with ${threshold}`);
    
    if (detectorRef.current) {
      detectorRef.current.setConfidenceThreshold(threshold);
      // console.log(`PersonYOLODetector threshold set to ${threshold}`);
    }
    
    // Also update ByteTracker thresholds
    if (byteTrackerRef.current) {
      // Reinitialize ByteTracker with new thresholds
      byteTrackerRef.current = new ByteTrackInterpolator({
        trackThresh: threshold, // Use the same threshold as detector
        trackBuffer: 30,
        matchThresh: 0.8,
        minBoxArea: 100,
        lowThresh: Math.max(0.1, threshold * 0.5) // Low threshold is half of main threshold
      });
      // console.log(`ByteTracker reinitialized with trackThresh=${threshold}, lowThresh=${Math.max(0.1, threshold * 0.5)}`);
    }
  }, []);

  const setTargetHead = useCallback((detection: Detection) => {
    setTargetDetection(detection);
    
    // Calculate relative head position if head center is available
    if (detection.boxes.length > 0) {
      const box = detection.boxes[0];
      if (box.headCenterX !== undefined && box.headCenterY !== undefined) {
        // Calculate relative position of head within the box
        const relativeX = (box.headCenterX - box.x) / box.width;
        const relativeY = (box.headCenterY - box.y) / box.height;
        setHeadOffsetRatio({ x: relativeX, y: relativeY });
        // console.log(`Head offset ratio set: x=${relativeX}, y=${relativeY}`);
      } else {
        // Smart default based on box aspect ratio
        // For horizontal poses (like figure skating), head is typically on one side
        const aspectRatio = box.width / box.height;
        let defaultX = 0.5;
        let defaultY = 0.25;
        
        if (aspectRatio > 1.5) {
          // Wide box - person likely horizontal
          // Head is usually at one end (we'll guess left for now)
          defaultX = 0.2;
          defaultY = 0.5;
          // console.log('Detected horizontal pose, adjusting head position');
        } else if (aspectRatio < 0.5) {
          // Tall box - person likely standing
          defaultY = 0.15; // Head higher for standing poses
        }
        
        setHeadOffsetRatio({ x: defaultX, y: defaultY });
        // console.log(`Using smart default head offset ratio: x=${defaultX}, y=${defaultY} (aspect ratio: ${aspectRatio.toFixed(2)})`);
      }
    }
    // console.log('Target detection set for tracking');
  }, []);

  const selectByteTrackId = useCallback((trackId: string) => {
    if (trackId) {
      setSelectedTrackId(trackId);
      setTrackedObjects(prev => prev.map(track => ({
        ...track,
        selected: track.id === trackId
      })));
      // console.log('Selected ByteTrack ID:', trackId);
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
    processVideo,
    selectTrack,
    getSelectedTrack,
    setConfidenceThreshold,
    setTargetHead,
    selectByteTrackId,
    reset,
    useByteTrack: true,
    setUseByteTrack: () => {} // No-op since we always use ByteTrack
  };
}