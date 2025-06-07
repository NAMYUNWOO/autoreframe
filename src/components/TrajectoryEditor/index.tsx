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
  const [selectedKeyframe, setSelectedKeyframe] = useState<number | null>(null);
  const [keyframes, setKeyframes] = useState<Set<number>>(new Set());

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
      
      // Debug log to verify consistency
      if (currentFrame % 30 === 0) {
        const scaleFromTransform = metadata.width / (metadata.width / transform.scale);
        console.log(`TrajectoryEditor Frame ${currentFrame}:`);
        console.log(`  Initial target box: ${initialTargetBox.width}x${initialTargetBox.height}`);
        console.log(`  Calculated dimensions: ${cropW.toFixed(0)}x${cropH.toFixed(0)}`);
        console.log(`  Scale from transform: ${transform.scale.toFixed(2)}, dimensions from scale: ${(metadata.width/transform.scale).toFixed(0)}x${(metadata.height/transform.scale).toFixed(0)}`);
        console.log(`  Config: padding=${(reframingConfig.padding * 100).toFixed(0)}%, outputRatio=${reframingConfig.outputRatio}`);
        if (reframingConfig.reframeBoxOffset) {
          console.log(`  Offset: x=${reframingConfig.reframeBoxOffset.x}, y=${reframingConfig.reframeBoxOffset.y}`);
        }
      }
    } else {
      // Fallback to scale-based calculation
      cropW = metadata.width / transform.scale;
      cropH = metadata.height / transform.scale;
      console.warn('TrajectoryEditor: No initial target box provided, using scale-based calculation');
    }
    
    // The transform position is already adjusted by the offset in BezierTrajectorySmoother
    // So we just use it directly
    const cropX = transform.x - cropW / 2;
    const cropY = transform.y - cropH / 2;

    // Draw reframe rectangle
    overlayCtx.strokeStyle = keyframes.has(currentFrame) ? '#00ff00' : '#ffff00';
    overlayCtx.lineWidth = 3;
    overlayCtx.strokeRect(cropX, cropY, cropW, cropH);

    // Draw center point (reframe box center)
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
    for (let frame = Math.max(0, currentFrame - 30); frame <= Math.min(currentFrame + 30, Math.floor(metadata.duration * metadata.fps)); frame++) {
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

    // Draw keyframe indicators
    keyframes.forEach(frame => {
      if (Math.abs(frame - currentFrame) <= 30) {
        const t = transforms.get(frame);
        if (t) {
          overlayCtx.fillStyle = frame === selectedKeyframe ? '#00ff00' : '#ffff00';
          overlayCtx.fillRect(t.x - 4, t.y - 4, 8, 8);
        }
      }
    });
  }, [videoElement, currentFrame, transforms, metadata, outputWidth, outputHeight, keyframes, selectedKeyframe, reframingConfig, initialTargetBox]);

  // Update display when frame changes
  useEffect(() => {
    drawFrame();
  }, [currentFrame, drawFrame]);

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!overlayCanvasRef.current) return;

    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * metadata.width;
    const y = (e.clientY - rect.top) / rect.height * metadata.height;

    // Check if clicking on a keyframe
    let clickedKeyframe: number | null = null;
    keyframes.forEach(frame => {
      const t = transforms.get(frame);
      if (t && Math.abs(t.x - x) < 20 && Math.abs(t.y - y) < 20) {
        clickedKeyframe = frame;
      }
    });

    if (clickedKeyframe !== null) {
      setSelectedKeyframe(clickedKeyframe);
      setCurrentFrame(clickedKeyframe);
    } else {
      // Add new keyframe at current position
      setKeyframes(prev => new Set([...prev, currentFrame]));
      setSelectedKeyframe(currentFrame);
    }

    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || selectedKeyframe === null || !overlayCanvasRef.current) return;

    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * metadata.width;
    const y = (e.clientY - rect.top) / rect.height * metadata.height;

    // Update transform
    const currentTransform = transforms.get(selectedKeyframe) || {
      x: metadata.width / 2,
      y: metadata.height / 2,
      scale: 1,
      rotation: 0
    };

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

    const newTransform: FrameTransform = {
      ...currentTransform,
      x: Math.max(boundsWidth / 2, Math.min(metadata.width - boundsWidth / 2, x)),
      y: Math.max(boundsHeight / 2, Math.min(metadata.height - boundsHeight / 2, y))
    };

    onUpdateTransform(selectedKeyframe, newTransform);
    drawFrame();
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Handle timeline scrubbing
  const handleTimelineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const frame = parseInt(e.target.value);
    setCurrentFrame(frame);
    if (videoElement) {
      videoElement.currentTime = frame / metadata.fps;
    }
  };

  // Add keyframe
  const addKeyframe = () => {
    setKeyframes(prev => new Set([...prev, currentFrame]));
  };

  // Remove keyframe
  const removeKeyframe = () => {
    if (selectedKeyframe !== null) {
      setKeyframes(prev => {
        const newSet = new Set(prev);
        newSet.delete(selectedKeyframe);
        return newSet;
      });
      setSelectedKeyframe(null);
    }
  };

  // Interpolate between keyframes
  const interpolateKeyframes = () => {
    const sortedKeyframes = Array.from(keyframes).sort((a, b) => a - b);
    
    for (let i = 0; i < sortedKeyframes.length - 1; i++) {
      const startFrame = sortedKeyframes[i];
      const endFrame = sortedKeyframes[i + 1];
      const startTransform = transforms.get(startFrame);
      const endTransform = transforms.get(endFrame);

      if (startTransform && endTransform) {
        for (let frame = startFrame + 1; frame < endFrame; frame++) {
          const t = (frame - startFrame) / (endFrame - startFrame);
          const interpolated: FrameTransform = {
            x: startTransform.x + (endTransform.x - startTransform.x) * t,
            y: startTransform.y + (endTransform.y - startTransform.y) * t,
            scale: startTransform.scale + (endTransform.scale - startTransform.scale) * t,
            rotation: 0
          };
          onUpdateTransform(frame, interpolated);
        }
      }
    }
  };

  return (
    <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
      <h3 className="text-lg font-semibold text-white mb-4">Trajectory Editor</h3>
      
      <div className="mb-4 text-sm text-gray-300">
        <p>• Click to add keyframes (green squares)</p>
        <p>• Drag keyframes to adjust position</p>
        <p>• Yellow box shows current reframe area</p>
        <p>• Red dot: reframe box center</p>
        {reframingConfig?.reframeBoxOffset && (
          <p>• Green crosshair: target person position</p>
        )}
        <p>• Cyan line shows trajectory path</p>
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
          Frame: {currentFrame} / {Math.floor(metadata.duration * metadata.fps)}
        </label>
        <input
          type="range"
          min="0"
          max={Math.floor(metadata.duration * metadata.fps)}
          value={currentFrame}
          onChange={handleTimelineChange}
          className="w-full"
        />
      </div>

      {/* Controls */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={addKeyframe}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Add Keyframe
        </button>
        <button
          onClick={removeKeyframe}
          disabled={selectedKeyframe === null}
          className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
        >
          Remove Keyframe
        </button>
        <button
          onClick={interpolateKeyframes}
          disabled={keyframes.size < 2}
          className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50"
        >
          Interpolate
        </button>
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