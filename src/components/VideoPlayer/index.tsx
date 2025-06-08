'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Detection, FrameTransform, VideoMetadata, ReframingConfig } from '@/types';
import { ReframeSizeCalculatorV2 } from '@/lib/reframing/reframe-size-calculator-v2';

interface VideoPlayerProps {
  videoElement: HTMLVideoElement | null;
  metadata: VideoMetadata | null;
  detections: Detection[];
  currentTransform?: FrameTransform;
  transforms?: Map<number, FrameTransform>;
  getFrameTransform?: (frameNumber: number) => FrameTransform | undefined;
  showDetections: boolean;
  showReframing: boolean;
  outputRatio: string;
  reframingConfig?: ReframingConfig;
  initialTargetBox?: { width: number; height: number } | null;
}

export function VideoPlayer({
  videoElement,
  metadata,
  detections,
  currentTransform,
  transforms,
  getFrameTransform,
  showDetections,
  showReframing,
  outputRatio,
  reframingConfig,
  initialTargetBox
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const animationFrameRef = useRef<number>(0);

  useEffect(() => {
    if (!videoElement || !containerRef.current) return;

    // Add video to container
    containerRef.current.appendChild(videoElement);
    videoElement.className = 'w-full h-full object-contain';

    // Set up event listeners
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(videoElement.currentTime);
    const handleLoadedMetadata = () => setDuration(videoElement.duration);

    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);
    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePause);
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
      videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      
      if (containerRef.current?.contains(videoElement)) {
        containerRef.current.removeChild(videoElement);
      }
    };
  }, [videoElement]);

  const drawOverlay = useCallback(() => {
    if (!overlayCanvasRef.current || !videoElement || !metadata) return;

    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d')!;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get current frame number
    const frameNumber = Math.floor(currentTime * metadata.fps);
    
    // Draw detections
    if (showDetections) {
      const detection = detections.find(d => d.frameNumber === frameNumber);
      if (detection) {
        detection.boxes.forEach(box => {
          // Set color based on track ID
          let boxColor = '#00ff00';
          let bgColor = 'rgba(0, 255, 0, 0.8)';
          
          if (box.trackId) {
            const trackNum = parseInt(box.trackId);
            const hue = (trackNum * 137.508) % 360; // Golden angle for distinct colors
            boxColor = `hsl(${hue}, 70%, 50%)`;
            bgColor = `hsla(${hue}, 70%, 50%, 0.8)`;
          }
          
          // Draw bounding box
          ctx.strokeStyle = boxColor;
          ctx.lineWidth = 2;
          ctx.strokeRect(box.x, box.y, box.width, box.height);
          
          // Draw label with background
          const trackIdLabel = box.trackId ? `ID:${box.trackId} ` : '';
          const label = `${trackIdLabel}${box.class} ${(box.confidence * 100).toFixed(0)}%`;
          
          ctx.font = 'bold 14px Arial';
          const textMetrics = ctx.measureText(label);
          const padding = 4;
          
          // Label background
          ctx.fillStyle = bgColor;
          ctx.fillRect(
            box.x, 
            box.y - 22, 
            textMetrics.width + padding * 2, 
            20
          );
          
          // Label text
          ctx.fillStyle = 'white';
          ctx.fillText(label, box.x + padding, box.y - 6);
          
          // Draw head center if available
          if (box.headCenterX !== undefined && box.headCenterY !== undefined) {
            // Draw head center point
            ctx.fillStyle = boxColor;
            ctx.beginPath();
            ctx.arc(box.headCenterX, box.headCenterY, 6, 0, 2 * Math.PI);
            ctx.fill();
            
            // Draw head center crosshair
            ctx.strokeStyle = boxColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            // Horizontal line
            ctx.moveTo(box.headCenterX - 15, box.headCenterY);
            ctx.lineTo(box.headCenterX + 15, box.headCenterY);
            // Vertical line
            ctx.moveTo(box.headCenterX, box.headCenterY - 15);
            ctx.lineTo(box.headCenterX, box.headCenterY + 15);
            ctx.stroke();
            
            // Draw "HEAD" label
            ctx.fillStyle = bgColor;
            ctx.font = 'bold 12px Arial';
            const headLabel = 'HEAD';
            const headMetrics = ctx.measureText(headLabel);
            ctx.fillRect(
              box.headCenterX - headMetrics.width / 2 - 4,
              box.headCenterY - 25,
              headMetrics.width + 8,
              16
            );
            ctx.fillStyle = 'white';
            ctx.fillText(headLabel, box.headCenterX - headMetrics.width / 2, box.headCenterY - 12);
          }
        });
      }
    }

    // Draw reframing overlay
    // Get the transform for the current frame if getFrameTransform is provided
    const frameTransform = getFrameTransform ? getFrameTransform(frameNumber) : currentTransform;
    
    if (showReframing && frameTransform) {
      // Debug: Log every 10 frames to see if transform changes
      if (frameNumber % 10 === 0) {
        // console.log(`VideoPlayer: Frame ${frameNumber}, transform position: (${frameTransform.x.toFixed(1)}, ${frameTransform.y.toFixed(1)}), scale: ${frameTransform.scale.toFixed(2)}`);
      }
      
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 5]);
      
      // Calculate reframing rectangle using the same method as TrajectoryEditor and Export
      const outputAspectRatio = outputRatio === '16:9' ? 16/9 : 
                               outputRatio === '9:16' ? 9/16 : 
                               outputRatio === '1:1' ? 1 : 
                               outputRatio === '4:3' ? 4/3 : 3/4;
      
      let width: number, height: number;
      
      if (initialTargetBox && reframingConfig) {
        // Use the same calculator for consistency
        const calculatedDimensions = ReframeSizeCalculatorV2.calculateOptimalReframeSize(
          initialTargetBox,
          metadata.width,
          metadata.height,
          outputAspectRatio,
          reframingConfig
        );
        width = calculatedDimensions.width;
        height = calculatedDimensions.height;
      } else {
        // Fallback to scale-based calculation
        const baseCropW = metadata.width / frameTransform.scale;
        const baseCropH = metadata.height / frameTransform.scale;
        
        width = baseCropW;
        height = baseCropH;
        const cropAspectRatio = width / height;
        
        if (Math.abs(cropAspectRatio - outputAspectRatio) > 0.01) {
          if (cropAspectRatio > outputAspectRatio) {
            width = height * outputAspectRatio;
          } else {
            height = width / outputAspectRatio;
          }
        }
      }
      
      const x = frameTransform.x - width / 2;
      const y = frameTransform.y - height / 2;
      
      
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);
      
      // Draw center crosshair
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 1;
      const crossSize = 20;
      ctx.beginPath();
      ctx.moveTo(frameTransform.x - crossSize, frameTransform.y);
      ctx.lineTo(frameTransform.x + crossSize, frameTransform.y);
      ctx.moveTo(frameTransform.x, frameTransform.y - crossSize);
      ctx.lineTo(frameTransform.x, frameTransform.y + crossSize);
      ctx.stroke();
    }

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(drawOverlay);
    }
  }, [videoElement, metadata, detections, currentTransform, getFrameTransform, showDetections, showReframing, outputRatio, currentTime, isPlaying, reframingConfig, initialTargetBox]);

  useEffect(() => {
    drawOverlay();
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [drawOverlay]);

  // Force redraw when showDetections, showReframing, or currentTime changes
  useEffect(() => {
    drawOverlay();
  }, [showDetections, showReframing, currentTime, drawOverlay]);

  useEffect(() => {
    if (!metadata || !overlayCanvasRef.current) return;
    
    overlayCanvasRef.current.width = metadata.width;
    overlayCanvasRef.current.height = metadata.height;
  }, [metadata]);

  const handlePlayPause = () => {
    if (!videoElement) return;
    
    if (isPlaying) {
      videoElement.pause();
    } else {
      videoElement.play();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoElement) return;
    
    const time = parseFloat(e.target.value);
    videoElement.currentTime = time;
    setCurrentTime(time);
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full">
      <div 
        className="relative bg-black rounded-xl overflow-hidden" 
        style={{ 
          aspectRatio: metadata ? `${metadata.width}/${metadata.height}` : '16/9',
          maxHeight: 'calc(100vh - 300px)'
        }}
      >
        <div ref={containerRef} className="absolute inset-0" />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        />
      </div>
      
      <div className="mt-4">
        <div className="flex items-center gap-4">
          <button
            onClick={handlePlayPause}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            disabled={!videoElement}
          >
            {isPlaying ? (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              </svg>
            )}
          </button>
          
          <div className="flex-1 flex items-center gap-3">
            <span className="text-sm text-gray-400 w-12">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={currentTime}
              onChange={handleSeek}
              className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 
                         [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white 
                         [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
              disabled={!videoElement}
            />
            <span className="text-sm text-gray-400 w-12 text-right">
              {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}