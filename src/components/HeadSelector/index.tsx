'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Detection, BoundingBox } from '@/types';

interface HeadSelectorProps {
  videoElement: HTMLVideoElement | null;
  onSelectHead: (box: BoundingBox) => void;
  onConfirm: () => void;
  confidenceThreshold?: number;
}

export function HeadSelector({ videoElement, onSelectHead, onConfirm, confidenceThreshold = 0.3 }: HeadSelectorProps) {
  const [detections, setDetections] = useState<BoundingBox[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  // Detect heads in first frame
  const detectFirstFrame = useCallback(async () => {
    if (!videoElement || !canvasRef.current || !overlayCanvasRef.current) return;

    setIsDetecting(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const overlayCanvas = overlayCanvasRef.current;
    const overlayCtx = overlayCanvas.getContext('2d');

    if (!ctx || !overlayCtx) return;

    // Ensure video is at first frame
    videoElement.currentTime = 0;
    await new Promise(resolve => {
      videoElement.onseeked = () => resolve(null);
    });

    // Set canvas size
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    overlayCanvas.width = videoElement.videoWidth;
    overlayCanvas.height = videoElement.videoHeight;

    // Draw first frame
    ctx.drawImage(videoElement, 0, 0);
    console.log('Canvas size:', canvas.width, 'x', canvas.height);

    // Import and run detection
    try {
      console.log('Importing PersonYOLODetector...');
      const { PersonYOLODetector } = await import('@/lib/detection/person-yolo');
      const detector = new PersonYOLODetector();
      
      console.log('Initializing detector...');
      await detector.initialize();
      
      // Set a lower threshold for initial detection to ensure we catch all persons
      detector.setConfidenceThreshold(0.3);
      
      console.log('Running detection on first frame...');
      const personDetections = await detector.detect(canvas);
      console.log('Raw detections found:', personDetections.length);
      
      // Always use ByteTracker for consistency
      console.log('Applying ByteTracker...');
      const { ByteTracker } = await import('@/lib/detection/bytetrack-proper/byte-tracker');
      const byteTracker = new ByteTracker({
        trackThresh: confidenceThreshold,
        trackBuffer: 30,
        matchThresh: 0.8,
        minBoxArea: 100,
        lowThresh: Math.max(0.1, confidenceThreshold * 0.5)
      });
      console.log('HeadSelector: ByteTracker using threshold', confidenceThreshold);
      
      // Process first frame with ByteTracker
      const finalDetections = byteTracker.update(personDetections);
      console.log('ByteTracker detections:', finalDetections.length);
        
        // Try to detect heads for each person
        const useHeadDetection = false; // Disable head detection - model not reliable
        
        if (useHeadDetection) {
          try {
            console.log('Initializing head detector...');
            const { HeadDetector } = await import('@/lib/detection/head-detector');
            const headDetector = new HeadDetector();
            await headDetector.initialize();
            
            console.log('Detecting heads in tracked persons...');
            for (const detection of finalDetections) {
              const headResult = await headDetector.detectHeadInBox(
                canvas,
                detection,
                0.05 // 5% padding
              );
              
              if (headResult) {
                // Add head center to detection
                detection.headCenterX = headResult.x + headResult.width / 2;
                detection.headCenterY = headResult.y + headResult.height / 2;
                console.log(`Head detected for track ${detection.trackId}:`);
                console.log(`  Person box: (${detection.x}, ${detection.y}, ${detection.width}, ${detection.height})`);
                console.log(`  Head box: (${headResult.x}, ${headResult.y}, ${headResult.width}, ${headResult.height})`);
                console.log(`  Head center: (${detection.headCenterX}, ${detection.headCenterY})`);
                
                // Verify head is within person box
                if (detection.headCenterX < detection.x || 
                    detection.headCenterX > detection.x + detection.width ||
                    detection.headCenterY < detection.y || 
                    detection.headCenterY > detection.y + detection.height) {
                  console.warn(`WARNING: Head center is outside person box!`);
                }
              } else {
                // Smart head position estimation based on box aspect ratio
                const aspectRatio = detection.width / detection.height;
                
                if (aspectRatio > 1.5) {
                  // Wide box - person likely horizontal (like figure skating)
                  // For figure skating, head is typically at the left side when horizontal
                  detection.headCenterX = detection.x + detection.width * 0.15; // Head at left end
                  detection.headCenterY = detection.y + detection.height * 0.5;
                  console.log(`Head estimated for horizontal pose (figure skating), track ${detection.trackId} at (${detection.headCenterX}, ${detection.headCenterY})`);
                } else {
                  // Normal standing pose
                  detection.headCenterX = detection.x + detection.width / 2;
                  detection.headCenterY = detection.y + detection.height * 0.25;
                  console.log(`Head estimated for track ${detection.trackId} at (${detection.headCenterX}, ${detection.headCenterY})`);
                }
              }
            }
            
            headDetector.dispose();
          } catch (headError) {
            console.warn('Head detection failed, using estimates:', headError);
            // Use estimated head positions
            for (const detection of finalDetections) {
              const aspectRatio = detection.width / detection.height;
              if (aspectRatio > 1.5) {
                detection.headCenterX = detection.x + detection.width * 0.15;
                detection.headCenterY = detection.y + detection.height * 0.5;
              } else {
                detection.headCenterX = detection.x + detection.width / 2;
                detection.headCenterY = detection.y + detection.height * 0.25;
              }
            }
          }
        } else {
          // Use estimated head positions when head detection is disabled
          console.log('Using estimated head positions (head detection disabled)');
          for (const detection of finalDetections) {
            const aspectRatio = detection.width / detection.height;
            if (aspectRatio > 1.5) {
              detection.headCenterX = detection.x + detection.width * 0.15;
              detection.headCenterY = detection.y + detection.height * 0.5;
              console.log(`Head estimated for horizontal pose, track ${detection.trackId} at (${detection.headCenterX}, ${detection.headCenterY})`);
            } else {
              detection.headCenterX = detection.x + detection.width / 2;
              detection.headCenterY = detection.y + detection.height * 0.25;
              console.log(`Head estimated for track ${detection.trackId} at (${detection.headCenterX}, ${detection.headCenterY})`);
            }
          }
        }
      
      setDetections(finalDetections);
      detector.dispose();

      // Draw detections
      if (finalDetections.length > 0) {
        drawDetections(overlayCtx, finalDetections);
      } else {
        console.warn('No persons detected in the first frame');
      }
    } catch (error) {
      console.error('Failed to detect persons:', error);
      if (error instanceof Error) {
        alert(`Failed to detect persons: ${error.message}`);
      } else {
        alert('Failed to detect persons in the first frame. Please try a different video or ensure there are visible people in the first frame.');
      }
    } finally {
      setIsDetecting(false);
    }
  }, [videoElement, onSelectHead, confidenceThreshold]);

  // Draw detection boxes
  const drawDetections = (ctx: CanvasRenderingContext2D, detections: BoundingBox[]) => {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    detections.forEach((detection, index) => {
      const isSelected = index === selectedIndex;
      
      // Draw bounding box
      ctx.strokeStyle = isSelected ? '#00ff00' : '#ff0000';
      ctx.lineWidth = isSelected ? 4 : 2;
      ctx.strokeRect(detection.x, detection.y, detection.width, detection.height);
      
      // Draw label
      ctx.fillStyle = isSelected ? '#00ff00' : '#ff0000';
      ctx.font = 'bold 16px Arial';
      const trackIdLabel = detection.trackId ? `ID-${detection.trackId}: ` : '';
      const label = `${trackIdLabel}person ${(detection.confidence * 100).toFixed(0)}%`;
      const textMetrics = ctx.measureText(label);
      
      ctx.fillRect(
        detection.x,
        detection.y - 20,
        textMetrics.width + 8,
        20
      );
      
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, detection.x + 4, detection.y - 4);
      
      // Draw head center if available
      if (detection.headCenterX && detection.headCenterY) {
        ctx.fillStyle = isSelected ? '#00ff00' : '#ff0000';
        ctx.beginPath();
        ctx.arc(detection.headCenterX, detection.headCenterY, 5, 0, 2 * Math.PI);
        ctx.fill();
        
        // Draw crosshair
        ctx.strokeStyle = isSelected ? '#00ff00' : '#ff0000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(detection.headCenterX - 10, detection.headCenterY);
        ctx.lineTo(detection.headCenterX + 10, detection.headCenterY);
        ctx.moveTo(detection.headCenterX, detection.headCenterY - 10);
        ctx.lineTo(detection.headCenterX, detection.headCenterY + 10);
        ctx.stroke();
      }
    });
  };

  // Handle canvas click
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!overlayCanvasRef.current || detections.length === 0) return;

    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * overlayCanvasRef.current.width;
    const y = (event.clientY - rect.top) / rect.height * overlayCanvasRef.current.height;

    // Find clicked detection
    for (let i = 0; i < detections.length; i++) {
      const det = detections[i];
      if (
        x >= det.x &&
        x <= det.x + det.width &&
        y >= det.y &&
        y <= det.y + det.height
      ) {
        setSelectedIndex(i);
        onSelectHead(det);
        
        // Redraw with selection
        const ctx = overlayCanvasRef.current.getContext('2d');
        if (ctx) {
          drawDetections(ctx, detections);
        }
        break;
      }
    }
  };

  // Auto-detect on mount
  useEffect(() => {
    if (videoElement) {
      detectFirstFrame();
    }
  }, [videoElement, detectFirstFrame]);

  return (
    <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
      <h3 className="text-lg font-semibold text-white mb-4">Select Target Person</h3>
      
      <div className="mb-4 text-sm text-gray-300">
        <p>Click on the person you want to track throughout the video.</p>
        <p>The selected person will be highlighted in green.</p>
      </div>

      <div 
        className="relative mb-4 bg-black rounded-lg overflow-hidden flex items-center justify-center"
        style={{ 
          maxHeight: 'calc(100vh - 400px)',
          aspectRatio: videoElement ? `${videoElement.videoWidth}/${videoElement.videoHeight}` : '16/9'
        }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: 'contain' }}
        />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full cursor-pointer"
          style={{ objectFit: 'contain' }}
          onClick={handleCanvasClick}
        />
        
        {isDetecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
            <div className="text-white flex items-center space-x-2">
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Detecting heads...</span>
            </div>
          </div>
        )}
      </div>

      {detections.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-300">
            Found {detections.length} person{detections.length > 1 ? 's' : ''} in the first frame.
            {selectedIndex !== null && ` Person ${selectedIndex + 1} selected.`}
          </p>
        </div>
      )}

      <button
        onClick={onConfirm}
        disabled={selectedIndex === null}
        className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium rounded-lg
                   hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-all transform hover:scale-[1.02]"
      >
        Confirm Selection & Start Detection
      </button>
    </div>
  );
}