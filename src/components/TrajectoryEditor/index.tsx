'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { FrameTransform, VideoMetadata, ReframingConfig } from '@/types';
import { getOutputDimensions } from '@/lib/reframing/presets';
import { ReframeSizeCalculatorV2 } from '@/lib/reframing/reframe-size-calculator-v2';

interface TrajectoryEditorProps {
  videoElement: HTMLVideoElement | null;
  transforms: Map<number, FrameTransform>;
  metadata: VideoMetadata;
  outputRatio: string;
  reframingConfig?: ReframingConfig;
  initialTargetBox?: { width: number; height: number } | null;
  onUpdateTransform: (frameNumber: number, transform: FrameTransform) => void;
  onConfirm: () => void;
}

export function TrajectoryEditor({
  videoElement,
  transforms,
  metadata,
  outputRatio,
  reframingConfig,
  initialTargetBox,
  onUpdateTransform,
  onConfirm
}: TrajectoryEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number } | null>(null);
  const [originalTransform, setOriginalTransform] = useState<FrameTransform | null>(null);
  
  // Interpolation state
  const [startFrame, setStartFrame] = useState<number | null>(null);
  const [endFrame, setEndFrame] = useState<number | null>(null);

  // Initialize on mount - moved after drawFrame definition
  const [isInitialized, setIsInitialized] = useState(false);

  // Get output dimensions
  const { width: outputWidth, height: outputHeight } = getOutputDimensions(
    metadata.width,
    metadata.height,
    outputRatio as any
  );

  // Draw current frame
  const drawFrame = useCallback(() => {
    if (!videoElement || !canvasRef.current || !overlayCanvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const overlayCanvas = overlayCanvasRef.current;
    const overlayCtx = overlayCanvas.getContext('2d');

    if (!ctx || !overlayCtx) return;

    // Draw video frame
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

    // Clear overlay
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Get current transform
    const transform = transforms.get(currentFrame) || {
      x: metadata.width / 2,
      y: metadata.height / 2,
      scale: 1,
      rotation: 0
    };

    // Calculate crop rectangle using the exact same method as during reframing
    const outputAspectRatio = outputWidth / outputHeight;
    
    let cropW: number, cropH: number;
    
    // If we have the initial target box and reframing config, calculate the exact dimensions
    if (initialTargetBox && reframingConfig) {
      // Use the same calculator that was used during reframing with the actual initial target box
      const calculatedDimensions = ReframeSizeCalculatorV2.calculateOptimalReframeSize(
        initialTargetBox,
        metadata.width,
        metadata.height,
        outputAspectRatio,
        reframingConfig
      );
      cropW = calculatedDimensions.width;
      cropH = calculatedDimensions.height;
      
    } else {
      // Fallback to scale-based calculation
      cropW = metadata.width / transform.scale;
      cropH = metadata.height / transform.scale;
    }
    
    // The transform position is already adjusted by the offset in BezierTrajectorySmoother
    // So we just use it directly
    const cropX = transform.x - cropW / 2;
    const cropY = transform.y - cropH / 2;

    // Draw reframe rectangle
    overlayCtx.strokeStyle = '#ffff00';
    overlayCtx.lineWidth = 3;
    overlayCtx.strokeRect(cropX, cropY, cropW, cropH);

    // Draw nearby frame centers (before current frame)
    for (let i = 1; i <= 3; i++) {
      const prevFrame = currentFrame - i;
      if (prevFrame >= 0) {
        const prevTransform = transforms.get(prevFrame);
        if (prevTransform) {
          overlayCtx.strokeStyle = '#ff0000'; // Red border
          overlayCtx.lineWidth = 2;
          
          // Fill color transitions from white to light red
          if (i === 1) {
            overlayCtx.fillStyle = '#ffcccc'; // 약간 연한 빨강
          } else if (i === 2) {
            overlayCtx.fillStyle = '#ffe6e6'; // 연한 빨강
          } else {
            overlayCtx.fillStyle = '#ffffff'; // 흰색
          }
          
          overlayCtx.beginPath();
          overlayCtx.arc(prevTransform.x, prevTransform.y, 6, 0, Math.PI * 2);
          overlayCtx.fill();
          overlayCtx.stroke();
        }
      }
    }

    // Draw nearby frame centers (after current frame)
    for (let i = 1; i <= 3; i++) {
      const nextFrame = currentFrame + i;
      const maxFrame = Math.floor(metadata.duration * metadata.fps) - 1;
      if (nextFrame <= maxFrame) {
        const nextTransform = transforms.get(nextFrame);
        if (nextTransform) {
          overlayCtx.strokeStyle = '#ff0000'; // Red border
          overlayCtx.lineWidth = 2;
          
          // Fill color transitions from dark red to black
          if (i === 1) {
            overlayCtx.fillStyle = '#cc0000'; // 검정이 약간 들어간 빨강
          } else if (i === 2) {
            overlayCtx.fillStyle = '#660000'; // 검정이 많이 들어간 빨강
          } else {
            overlayCtx.fillStyle = '#000000'; // 검정
          }
          
          overlayCtx.beginPath();
          overlayCtx.arc(nextTransform.x, nextTransform.y, 6, 0, Math.PI * 2);
          overlayCtx.fill();
          overlayCtx.stroke();
        }
      }
    }

    // Draw center point (reframe box center) - current frame
    overlayCtx.fillStyle = '#ff0000';
    overlayCtx.beginPath();
    overlayCtx.arc(transform.x, transform.y, 8, 0, Math.PI * 2);
    overlayCtx.fill();
    
    // If we have an offset, also draw the original target position
    if (reframingConfig?.reframeBoxOffset) {
      const originalTargetX = transform.x + reframingConfig.reframeBoxOffset.x;
      const originalTargetY = transform.y + reframingConfig.reframeBoxOffset.y;
      
      // Draw crosshair at original target position
      overlayCtx.strokeStyle = '#00ff00';
      overlayCtx.lineWidth = 2;
      overlayCtx.beginPath();
      overlayCtx.moveTo(originalTargetX - 10, originalTargetY);
      overlayCtx.lineTo(originalTargetX + 10, originalTargetY);
      overlayCtx.moveTo(originalTargetX, originalTargetY - 10);
      overlayCtx.lineTo(originalTargetX, originalTargetY + 10);
      overlayCtx.stroke();
      
      // Draw line connecting box center to target
      overlayCtx.strokeStyle = '#00ff00';
      overlayCtx.lineWidth = 1;
      overlayCtx.setLineDash([3, 3]);
      overlayCtx.beginPath();
      overlayCtx.moveTo(transform.x, transform.y);
      overlayCtx.lineTo(originalTargetX, originalTargetY);
      overlayCtx.stroke();
      overlayCtx.setLineDash([]);
    }

    // Draw trajectory path
    overlayCtx.strokeStyle = '#00ffff';
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([5, 5]);
    overlayCtx.beginPath();

    let firstPoint = true;
    for (let frame = Math.max(0, currentFrame - 30); frame <= Math.min(currentFrame + 30, Math.floor(metadata.duration * metadata.fps) - 1); frame++) {
      const t = transforms.get(frame);
      if (t) {
        if (firstPoint) {
          overlayCtx.moveTo(t.x, t.y);
          firstPoint = false;
        } else {
          overlayCtx.lineTo(t.x, t.y);
        }
      }
    }
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);
    
    // Draw Start and End frame markers if set
    if (startFrame !== null) {
      const transformStart = transforms.get(startFrame);
      if (transformStart) {
        overlayCtx.strokeStyle = '#00ff00'; // Green for Start Frame
        overlayCtx.lineWidth = 3;
        overlayCtx.fillStyle = 'rgba(0, 255, 0, 0.3)';
        overlayCtx.beginPath();
        overlayCtx.arc(transformStart.x, transformStart.y, 12, 0, Math.PI * 2);
        overlayCtx.fill();
        overlayCtx.stroke();
        
        // Label
        overlayCtx.fillStyle = '#00ff00';
        overlayCtx.font = 'bold 14px Arial';
        overlayCtx.fillText('Start', transformStart.x - 15, transformStart.y - 15);
      }
    }
    
    if (endFrame !== null) {
      const transformEnd = transforms.get(endFrame);
      if (transformEnd) {
        overlayCtx.strokeStyle = '#0088ff'; // Blue for End Frame
        overlayCtx.lineWidth = 3;
        overlayCtx.fillStyle = 'rgba(0, 136, 255, 0.3)';
        overlayCtx.beginPath();
        overlayCtx.arc(transformEnd.x, transformEnd.y, 12, 0, Math.PI * 2);
        overlayCtx.fill();
        overlayCtx.stroke();
        
        // Label
        overlayCtx.fillStyle = '#0088ff';
        overlayCtx.font = 'bold 14px Arial';
        overlayCtx.fillText('End', transformEnd.x - 10, transformEnd.y - 15);
      }
    }
    
    // Draw interpolation line between Start and End if both are set
    if (startFrame !== null && endFrame !== null) {
      const transformStart = transforms.get(startFrame);
      const transformEnd = transforms.get(endFrame);
      if (transformStart && transformEnd) {
        overlayCtx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
        overlayCtx.lineWidth = 2;
        overlayCtx.setLineDash([5, 5]);
        overlayCtx.beginPath();
        overlayCtx.moveTo(transformStart.x, transformStart.y);
        overlayCtx.lineTo(transformEnd.x, transformEnd.y);
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);
      }
    }
  }, [videoElement, currentFrame, transforms, metadata, outputWidth, outputHeight, reframingConfig, initialTargetBox, startFrame, endFrame]);

  // Update display when frame changes
  useEffect(() => {
    drawFrame();
  }, [currentFrame, drawFrame]);

  // Initialize video position on mount
  useEffect(() => {
    if (!isInitialized && videoElement && drawFrame) {
      const initializeVideo = async () => {
        // Set to frame 0
        videoElement.currentTime = 0;
        
        // Wait for seek to complete
        await new Promise<void>((resolve) => {
          const handleSeeked = () => {
            videoElement.removeEventListener('seeked', handleSeeked);
            resolve();
          };
          videoElement.addEventListener('seeked', handleSeeked);
          
          // Timeout fallback in case seeked event doesn't fire
          setTimeout(resolve, 500);
        });
        
        // Draw the frame
        drawFrame();
        setIsInitialized(true);
      };
      
      initializeVideo();
    }
  }, [isInitialized, videoElement, drawFrame]);

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!overlayCanvasRef.current) return;

    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * metadata.width;
    const y = (e.clientY - rect.top) / rect.height * metadata.height;

    // Get current transform
    const currentTransform = transforms.get(currentFrame);
    if (!currentTransform) return;

    // Calculate reframe box dimensions
    const outputAspectRatio = outputWidth / outputHeight;
    let cropW: number, cropH: number;
    
    if (initialTargetBox && reframingConfig) {
      const calculatedDimensions = ReframeSizeCalculatorV2.calculateOptimalReframeSize(
        initialTargetBox,
        metadata.width,
        metadata.height,
        outputAspectRatio,
        reframingConfig
      );
      cropW = calculatedDimensions.width;
      cropH = calculatedDimensions.height;
    } else {
      cropW = metadata.width / currentTransform.scale;
      cropH = metadata.height / currentTransform.scale;
    }
    
    const cropX = currentTransform.x - cropW / 2;
    const cropY = currentTransform.y - cropH / 2;

    // Check if clicking inside the reframe box
    if (x >= cropX && x <= cropX + cropW && y >= cropY && y <= cropY + cropH) {
      setIsDragging(true);
      setDragStartPos({ x, y });
      setOriginalTransform({ ...currentTransform });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !dragStartPos || !originalTransform || !overlayCanvasRef.current) return;

    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / rect.width * metadata.width;
    const mouseY = (e.clientY - rect.top) / rect.height * metadata.height;

    // Calculate movement delta
    const deltaX = mouseX - dragStartPos.x;
    const deltaY = mouseY - dragStartPos.y;

    // Calculate bounds based on the actual reframe dimensions
    let boundsWidth = outputWidth;
    let boundsHeight = outputHeight;
    
    if (initialTargetBox && reframingConfig) {
      const outputAspectRatio = outputWidth / outputHeight;
      const calculatedDimensions = ReframeSizeCalculatorV2.calculateOptimalReframeSize(
        initialTargetBox,
        metadata.width,
        metadata.height,
        outputAspectRatio,
        reframingConfig
      );
      boundsWidth = calculatedDimensions.width;
      boundsHeight = calculatedDimensions.height;
    }

    // Apply delta to original position
    const newX = originalTransform.x + deltaX;
    const newY = originalTransform.y + deltaY;

    // Calculate new position with bounds checking
    const newTransform: FrameTransform = {
      ...originalTransform,
      x: Math.max(boundsWidth / 2, Math.min(metadata.width - boundsWidth / 2, newX)),
      y: Math.max(boundsHeight / 2, Math.min(metadata.height - boundsHeight / 2, newY))
    };

    // Update the transform for the current frame
    onUpdateTransform(currentFrame, newTransform);
    drawFrame();
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragStartPos(null);
    setOriginalTransform(null);
  };

  // Handle timeline scrubbing
  const handleTimelineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const frame = parseInt(e.target.value);
    setCurrentFrame(frame);
    if (videoElement) {
      videoElement.currentTime = frame / metadata.fps;
    }
  };
  
  // Set Start Frame
  const setStartFrameHandler = () => {
    setStartFrame(currentFrame);
  };
  
  // Set End Frame
  const setEndFrameHandler = () => {
    setEndFrame(currentFrame);
  };
  
  // Clear interpolation frames
  const clearInterpolationFrames = () => {
    setStartFrame(null);
    setEndFrame(null);
  };
  
  // Perform interpolation
  const interpolateFrames = () => {
    if (startFrame === null || endFrame === null) return;
    if (startFrame === endFrame) return;
    
    const firstFrame = Math.min(startFrame, endFrame);
    const lastFrame = Math.max(startFrame, endFrame);
    
    const transformStart = transforms.get(firstFrame);
    const transformEnd = transforms.get(lastFrame);
    
    if (!transformStart || !transformEnd) return;
    
    // Interpolate all frames between start and end
    for (let frame = firstFrame + 1; frame < lastFrame; frame++) {
      const t = (frame - firstFrame) / (lastFrame - firstFrame);
      
      const interpolatedTransform: FrameTransform = {
        x: transformStart.x + (transformEnd.x - transformStart.x) * t,
        y: transformStart.y + (transformEnd.y - transformStart.y) * t,
        scale: transformStart.scale + (transformEnd.scale - transformStart.scale) * t,
        rotation: 0
      };
      
      onUpdateTransform(frame, interpolatedTransform);
    }
    
    // Clear selection after interpolation
    clearInterpolationFrames();
    drawFrame();
  };


  return (
    <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
      <h3 className="text-lg font-semibold text-white mb-4">Trajectory Editor</h3>
      
      <div className="mb-4 text-sm text-gray-300">
        <p>• Drag the yellow box to adjust reframe position</p>
        <p>• Use timeline to navigate frames</p>
        <p>• Red dot: current frame reframe center</p>
        <p>• Black dots with red border: nearby frames (±3) reframe centers</p>
        {reframingConfig?.reframeBoxOffset && (
          <p>• Green crosshair: target person position</p>
        )}
        <p>• Cyan line shows trajectory path (±30 frames)</p>
      </div>

      <div 
        className="relative mb-4 bg-black rounded-lg overflow-hidden flex items-center justify-center"
        style={{ 
          maxHeight: 'calc(100vh - 500px)',
          aspectRatio: `${metadata.width}/${metadata.height}`
        }}
      >
        <canvas
          ref={canvasRef}
          width={metadata.width}
          height={metadata.height}
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: 'contain' }}
        />
        <canvas
          ref={overlayCanvasRef}
          width={metadata.width}
          height={metadata.height}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          style={{ objectFit: 'contain' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>

      {/* Timeline */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-200 mb-2">
          Frame: {currentFrame} / {Math.floor(metadata.duration * metadata.fps) - 1}
        </label>
        <input
          type="range"
          min="0"
          max={Math.floor(metadata.duration * metadata.fps) - 1}
          value={currentFrame}
          onChange={handleTimelineChange}
          className="w-full"
        />
      </div>
      
      {/* Interpolation Controls */}
      <div className="mb-4 p-4 bg-black/20 rounded-lg">
        <h4 className="text-sm font-medium text-gray-200 mb-3">Linear Interpolation</h4>
        <div className="flex gap-2 mb-2">
          <button
            onClick={setStartFrameHandler}
            className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${
              startFrame === currentFrame 
                ? 'bg-green-500 text-white' 
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            {startFrame !== null ? `Start Frame: ${startFrame}` : 'Set Start Frame'}
          </button>
          <button
            onClick={setEndFrameHandler}
            className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${
              endFrame === currentFrame 
                ? 'bg-blue-500 text-white' 
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            {endFrame !== null ? `End Frame: ${endFrame}` : 'Set End Frame'}
          </button>
        </div>
        {startFrame !== null && endFrame !== null && startFrame !== endFrame && (
          <div className="text-xs text-gray-400 mb-2">
            Will interpolate {Math.abs(endFrame - startFrame) - 1} frames between start ({Math.min(startFrame, endFrame)}) and end ({Math.max(startFrame, endFrame)})
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={interpolateFrames}
            disabled={startFrame === null || endFrame === null || startFrame === endFrame}
            className="flex-1 px-3 py-2 bg-gradient-to-r from-green-500 to-blue-500 text-white text-sm rounded-lg
                     hover:from-green-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Interpolate
          </button>
          <button
            onClick={clearInterpolationFrames}
            disabled={startFrame === null && endFrame === null}
            className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear
          </button>
        </div>
      </div>

      <button
        onClick={onConfirm}
        className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium rounded-lg
                   hover:from-blue-600 hover:to-purple-700 transition-all transform hover:scale-[1.02]"
      >
        Apply Changes
      </button>
    </div>
  );
}