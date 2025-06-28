import { useState, useCallback, useRef, useEffect } from 'react';
import { PersonYOLODetector } from '@/lib/detection/person-yolo';
import { ByteTrackInterpolator } from '@/lib/detection/bytetrack-interpolator';
import { HeadDetector } from '@/lib/detection/head-detector';
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
  
  // Check if mobile device
  const isMobile = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
    return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
  }, []);
  
  // For parallel processing - disable on mobile
  const secondDetectorRef = useRef<PersonYOLODetector | null>(null);
  const enableParallel = !isMobile();

  // Initialize detector
  useEffect(() => {
    const initDetector = async () => {
      try {
        console.log('Initializing PersonYOLODetector...');
        detectorRef.current = new PersonYOLODetector();
        await detectorRef.current.initialize();
        
        // Set initial confidence threshold to match UI default (30%)
        detectorRef.current.setConfidenceThreshold(0.3);
        
        // Initialize second detector for parallel processing
        if (enableParallel) {
          console.log('Initializing second detector for parallel processing...');
          secondDetectorRef.current = new PersonYOLODetector();
          await secondDetectorRef.current.initialize();
          secondDetectorRef.current.setConfidenceThreshold(0.3);
        }
        
        // Initialize head detector if head detection is enabled
        if (useHeadDetection) {
          headDetectorRef.current = new HeadDetector();
          await headDetectorRef.current.initialize();
          console.log('Head detector initialized');
        }
        
        setIsModelLoaded(true);
        console.log('Model loaded successfully!');
      } catch (error) {
        console.error('Failed to initialize detectors:', error);
        if (error instanceof Error) {
          console.error('Error details:', error.stack);
        }
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
      if (secondDetectorRef.current) {
        secondDetectorRef.current.dispose();
      }
    };
  }, [useHeadDetection, enableParallel]);

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
      const defaultConfig = getAdaptiveConfig(30);
      byteTrackerRef.current = new ByteTrackInterpolator(defaultConfig.byteTracker);
    }
    
    const detection = byteTrackerRef.current.processFrame(boxes, frameNumber, timestamp);

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
    const sampleInterval = detectionConfig.sampleInterval; // Use config value
    let processedFrames = 0;
    let detectionFrameCount = 0; // Count only frames where detection runs
    
    // Check if mobile for progressive processing
    const isMobileDevice = isMobile();
    
    try {
      if (isMobileDevice) {
        // Mobile: Progressive processing in chunks
        const CHUNK_SIZE = 30; // Process 30 frames at a time on mobile
        console.log(`[Mobile] Progressive processing: ${totalFrames} frames in chunks of ${CHUNK_SIZE}`);
        
        // Create a custom frame processor that processes chunks
        let globalFrameCounter = 0;
        
        for (let chunkStart = 0; chunkStart < totalFrames; chunkStart += CHUNK_SIZE) {
          const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalFrames);
          
          console.log(`[Mobile] Processing chunk: frames ${chunkStart} to ${chunkEnd - 1}`);
          
          // Reset frame counter for processFrames
          globalFrameCounter = 0;
          
          // Process frames but only handle current chunk
          await processFrames(async (imageData, frameNumber, timestamp) => {
            // processFrames always starts from 0, so we need to track actual frame
            const actualFrame = globalFrameCounter++;
            
            // Skip frames outside current chunk
            if (actualFrame < chunkStart || actualFrame >= chunkEnd) {
              return;
            }
            
            processedFrames++;
            
            // Detect on first frame, last frame, and sample frames
            const isFirstFrame = actualFrame === 0;
            const isLastFrame = actualFrame === totalFrames - 1;
            const isSampleFrame = actualFrame % sampleInterval === 0;
            
            if (isFirstFrame || isLastFrame || isSampleFrame) {
              // Process detection immediately for mobile
              if (!byteTrackerRef.current) {
                const defaultConfig = getAdaptiveConfig(30);
                byteTrackerRef.current = new ByteTrackInterpolator(defaultConfig.byteTracker);
              }
              
              const boxes = await detectorRef.current!.detect(imageData, actualFrame);
              const detection = byteTrackerRef.current.processFrame(boxes, actualFrame, timestamp);
              detectionFrameCount++;
              
              // Run head detection if needed (same as desktop)
              if (useHeadDetection && headDetectorRef.current && detection.boxes.length > 0 && 
                  (actualFrame === 0 || actualFrame === totalFrames - 1 || actualFrame % 5 === 0)) {
                for (const box of detection.boxes) {
                  try {
                    const headResult = await headDetectorRef.current.detectHeadInBox(
                      imageData,
                      box,
                      0.05
                    );
                    
                    if (headResult) {
                      box.headCenterX = headResult.x + headResult.width / 2;
                      box.headCenterY = headResult.y + headResult.height / 2;
                    } else {
                      // Smart head position estimation
                      const aspectRatio = box.width / box.height;
                      if (aspectRatio > 1.5) {
                        box.headCenterX = box.x + box.width * 0.15;
                        box.headCenterY = box.y + box.height * 0.5;
                      } else if (aspectRatio < 0.5) {
                        box.headCenterX = box.x + box.width / 2;
                        box.headCenterY = box.y + box.height * 0.15;
                      } else {
                        box.headCenterX = box.x + box.width / 2;
                        box.headCenterY = box.y + box.height * 0.25;
                      }
                    }
                  } catch (error) {
                    // Fallback to estimation
                    const aspectRatio = box.width / box.height;
                    if (aspectRatio > 1.5) {
                      box.headCenterX = box.x + box.width * 0.15;
                      box.headCenterY = box.y + box.height * 0.5;
                    } else if (aspectRatio < 0.5) {
                      box.headCenterX = box.x + box.width / 2;
                      box.headCenterY = box.y + box.height * 0.15;
                    } else {
                      box.headCenterX = box.x + box.width / 2;
                      box.headCenterY = box.y + box.height * 0.25;
                    }
                  }
                }
              }
              
              // Update UI periodically
              if (actualFrame % 10 === 0 || actualFrame === totalFrames - 1) {
                const currentDetections = byteTrackerRef.current!.getAllDetections(actualFrame + 1, metadata.fps);
                setDetections(currentDetections);
              }
            }
          });
          
          // Clean up after each chunk
          console.log(`[Mobile] Chunk ${chunkStart}-${chunkEnd} completed, cleaning memory`);
          
          // Force garbage collection if available
          if ((window as any).gc) {
            (window as any).gc();
          }
          
          // Small delay to allow memory cleanup
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Break if we've processed all frames to avoid re-processing
          if (chunkEnd >= totalFrames) {
            break;
          }
        }
      } else {
        // Desktop: Original batch processing
        // Collect frames for batch processing
        const detectionTasks: FrameDetectionTask[] = [];
        const frameDataMap = new Map<number, ImageData>();
        
        // First pass: collect frames
        await processFrames(async (imageData, frameNumber, timestamp) => {
          processedFrames++;
          frameDataMap.set(frameNumber, imageData);
          
          // Detect on first frame, last frame, and sample frames
          const isFirstFrame = frameNumber === 0;
          const isLastFrame = frameNumber === totalFrames - 1;
          const isSampleFrame = frameNumber % sampleInterval === 0;
          
          if (isFirstFrame || isLastFrame || isSampleFrame) {
            detectionTasks.push({ imageData, frameNumber, timestamp });
          }
        });
        
        // Second pass: process detections with parallel YOLO inference but sequential ByteTracker
        const useParallel = enableParallel && secondDetectorRef.current && detectionTasks.length > 10 && !isMobile();
        console.log(`Processing ${detectionTasks.length} detection tasks (parallel: ${useParallel})`);
      
      if (useParallel) {
        // First, run YOLO detection in parallel
        const yoloResults = new Map<number, BoundingBox[]>();
        
        // Split tasks for parallel YOLO processing
        const midPoint = Math.floor(detectionTasks.length / 2);
        const firstHalf = detectionTasks.slice(0, midPoint);
        const secondHalf = detectionTasks.slice(midPoint);
        
        await Promise.all([
          // First half with primary detector
          (async () => {
            for (const task of firstHalf) {
              const detector = detectorRef.current!;
              const boxes = await detector.detect(task.imageData, task.frameNumber);
              yoloResults.set(task.frameNumber, boxes);
            }
          })(),
          // Second half with secondary detector
          (async () => {
            for (const task of secondHalf) {
              const detector = secondDetectorRef.current!;
              const boxes = await detector.detect(task.imageData, task.frameNumber);
              yoloResults.set(task.frameNumber, boxes);
            }
          })()
        ]);
        
        // Then, process ByteTracker sequentially to maintain temporal consistency
        for (const task of detectionTasks) {
          const boxes = yoloResults.get(task.frameNumber)!;
          
          if (!byteTrackerRef.current) {
            const defaultConfig = getAdaptiveConfig(30);
            byteTrackerRef.current = new ByteTrackInterpolator(defaultConfig.byteTracker);
          }
          
          const detection = byteTrackerRef.current.processFrame(boxes, task.frameNumber, task.timestamp);
          detectionFrameCount++;
          
          // Run head detection if needed
          if (useHeadDetection && headDetectorRef.current && detection.boxes.length > 0 && 
              (task.frameNumber === 0 || task.frameNumber === totalFrames - 1 || task.frameNumber % 5 === 0)) {
            for (const box of detection.boxes) {
              try {
                const headResult = await headDetectorRef.current.detectHeadInBox(
                  task.imageData,
                  box,
                  0.05
                );
                
                if (headResult) {
                  box.headCenterX = headResult.x + headResult.width / 2;
                  box.headCenterY = headResult.y + headResult.height / 2;
                } else {
                  // Smart head position estimation
                  const aspectRatio = box.width / box.height;
                  if (aspectRatio > 1.5) {
                    box.headCenterX = box.x + box.width * 0.15;
                    box.headCenterY = box.y + box.height * 0.5;
                  } else if (aspectRatio < 0.5) {
                    box.headCenterX = box.x + box.width / 2;
                    box.headCenterY = box.y + box.height * 0.15;
                  } else {
                    box.headCenterX = box.x + box.width / 2;
                    box.headCenterY = box.y + box.height * 0.25;
                  }
                }
              } catch (error) {
                // Fallback to estimation
                const aspectRatio = box.width / box.height;
                if (aspectRatio > 1.5) {
                  box.headCenterX = box.x + box.width * 0.15;
                  box.headCenterY = box.y + box.height * 0.5;
                } else if (aspectRatio < 0.5) {
                  box.headCenterX = box.x + box.width / 2;
                  box.headCenterY = box.y + box.height * 0.15;
                } else {
                  box.headCenterX = box.x + box.width / 2;
                  box.headCenterY = box.y + box.height * 0.25;
                }
              }
            }
          }
          
          // Update UI periodically
          if (task.frameNumber % 30 === 0 || task.frameNumber === totalFrames - 1) {
            const currentDetections = byteTrackerRef.current!.getAllDetections(Math.min(task.frameNumber + 1, totalFrames), metadata.fps);
            setDetections(currentDetections);
            
            // Debug log
            const trackCount = new Set(currentDetections.flatMap(d => d.boxes.map(b => b.trackId)).filter(id => id !== undefined)).size;
            console.log(`Frame ${task.frameNumber}: ${currentDetections.length} detections, ${trackCount} tracks`);
          }
        }
      } else {
        // Sequential processing (fallback for small number of detection tasks or mobile)
        const isMobileDevice = isMobile();
        let processedCount = 0;
        
        for (const task of detectionTasks) {
          if (!byteTrackerRef.current) {
            const defaultConfig = getAdaptiveConfig(30);
            byteTrackerRef.current = new ByteTrackInterpolator(defaultConfig.byteTracker);
          }
          
          const boxes = await detectorRef.current!.detect(task.imageData, task.frameNumber);
          const detection = byteTrackerRef.current.processFrame(boxes, task.frameNumber, task.timestamp);
          
          // Mobile: Delete frame data immediately after processing
          if (isMobileDevice) {
            frameDataMap.delete(task.frameNumber);
          }
          detectionFrameCount++;
          
          // Head detection (same logic as parallel processing)
          if (useHeadDetection && headDetectorRef.current && detection.boxes.length > 0 && 
              (task.frameNumber === 0 || task.frameNumber === totalFrames - 1 || task.frameNumber % 5 === 0)) {
            for (const box of detection.boxes) {
              try {
                const headResult = await headDetectorRef.current.detectHeadInBox(
                  task.imageData,
                  box,
                  0.05
                );
                
                if (headResult) {
                  box.headCenterX = headResult.x + headResult.width / 2;
                  box.headCenterY = headResult.y + headResult.height / 2;
                } else {
                  const aspectRatio = box.width / box.height;
                  if (aspectRatio > 1.5) {
                    box.headCenterX = box.x + box.width * 0.15;
                    box.headCenterY = box.y + box.height * 0.5;
                  } else if (aspectRatio < 0.5) {
                    box.headCenterX = box.x + box.width / 2;
                    box.headCenterY = box.y + box.height * 0.15;
                  } else {
                    box.headCenterX = box.x + box.width / 2;
                    box.headCenterY = box.y + box.height * 0.25;
                  }
                }
              } catch (error) {
                const aspectRatio = box.width / box.height;
                if (aspectRatio > 1.5) {
                  box.headCenterX = box.x + box.width * 0.15;
                  box.headCenterY = box.y + box.height * 0.5;
                } else if (aspectRatio < 0.5) {
                  box.headCenterX = box.x + box.width / 2;
                  box.headCenterY = box.y + box.height * 0.15;
                } else {
                  box.headCenterX = box.x + box.width / 2;
                  box.headCenterY = box.y + box.height * 0.25;
                }
              }
            }
          }
          
          // UI update (same logic as parallel processing)
          if (task.frameNumber % 10 === 0 || task.frameNumber === totalFrames - 1) {
            const currentDetections = byteTrackerRef.current!.getAllDetections(Math.min(task.frameNumber + 1, totalFrames), metadata.fps);
            setDetections(currentDetections);
          }
          
          // Mobile: Batch memory cleanup
          if (isMobileDevice) {
            processedCount++;
            
            // Every 5 detections, force garbage collection if available
            if (processedCount % 5 === 0) {
              console.log(`Mobile: Processed ${processedCount} detections, cleaning memory...`);
              
              // Clear any remaining old frame data
              const currentFrame = task.frameNumber;
              for (const [frame] of frameDataMap) {
                if (frame < currentFrame - 5) {
                  frameDataMap.delete(frame);
                }
              }
              
              // Force garbage collection if available
              if ((window as any).gc) {
                (window as any).gc();
              }
              
              // Small delay to allow memory cleanup
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          }
        }
      }
      } // Close desktop processing block

      // Final interpolation for all frames
      console.log(`Getting all detections for ${totalFrames} frames...`);
      let allDetections: Detection[];
      
      // Get all detections with interpolation from ByteTrackInterpolator
      allDetections = byteTrackerRef.current!.getAllDetections(totalFrames, metadata.fps);
      console.log(`Total detections after interpolation: ${allDetections.length}`);
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
      
      // Mobile: Memory already cleaned in chunks, no need for additional cleanup
      
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
  }, [isModelLoaded, targetDetection, useHeadDetection, useByteTrack, enableParallel, isMobile]);

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
    
    if (secondDetectorRef.current) {
      secondDetectorRef.current.setConfidenceThreshold(threshold);
    }
    
    // Also update ByteTracker thresholds
    if (byteTrackerRef.current) {
      // Reinitialize ByteTracker with new thresholds
      byteTrackerRef.current = new ByteTrackInterpolator({
        trackThresh: threshold, // Use the same threshold as detector
        trackBuffer: 30,
        matchThresh: 0.5, // Lowered to handle larger movements with 5-frame sampling
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