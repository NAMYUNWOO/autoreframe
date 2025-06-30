import { BotSort } from './bot-sort';
import { BoundingBox, Detection } from '@/types';

interface TrackSegment {
  trackId: string;
  frames: Map<number, BoundingBox>;
  startFrame: number;
  endFrame: number;
}

export class BotSortInterpolator {
  private botSort: BotSort;
  private detections: Map<number, Detection> = new Map();
  private trackSegments: Map<string, TrackSegment> = new Map();
  private frameImages: Map<number, ImageData> = new Map();
  
  constructor(botSortParams?: any) {
    this.botSort = new BotSort(botSortParams);
  }
  
  /**
   * Process a frame with BoT-SORT and store the result
   */
  async processFrame(
    boxes: BoundingBox[], 
    frameNumber: number, 
    timestamp: number,
    frameImage?: ImageData
  ): Promise<Detection> {
    // Store frame image for potential CMC
    if (frameImage) {
      this.frameImages.set(frameNumber, frameImage);
      
      // Keep only last 10 frames to save memory
      if (this.frameImages.size > 10) {
        const oldestFrame = Math.min(...Array.from(this.frameImages.keys()));
        this.frameImages.delete(oldestFrame);
      }
    }
    
    // Run BoT-SORT to get tracked boxes
    const trackedBoxes = await this.botSort.update(boxes, frameNumber, frameImage);
    
    // Create detection object
    const detection: Detection = {
      frameNumber,
      timestamp,
      boxes: trackedBoxes
    };
    
    // Store detection
    this.detections.set(frameNumber, detection);
    
    // Update track segments
    this.updateTrackSegments(trackedBoxes, frameNumber);
    
    return detection;
  }
  
  /**
   * Update track segments for interpolation
   */
  private updateTrackSegments(boxes: BoundingBox[], frameNumber: number): void {
    for (const box of boxes) {
      if (!box.trackId) continue;
      
      if (!this.trackSegments.has(box.trackId)) {
        this.trackSegments.set(box.trackId, {
          trackId: box.trackId,
          frames: new Map(),
          startFrame: frameNumber,
          endFrame: frameNumber
        });
      }
      
      const segment = this.trackSegments.get(box.trackId)!;
      segment.frames.set(frameNumber, box);
      segment.startFrame = Math.min(segment.startFrame, frameNumber);
      segment.endFrame = Math.max(segment.endFrame, frameNumber);
    }
  }
  
  /**
   * Get all detections with interpolation for missing frames
   */
  getAllDetections(totalFrames: number, fps: number): Detection[] {
    const allDetections: Detection[] = [];
    
    // Process each frame
    for (let frame = 0; frame < totalFrames; frame++) {
      // If we have actual detection, use it
      if (this.detections.has(frame)) {
        allDetections.push(this.detections.get(frame)!);
      } else {
        // Otherwise, interpolate
        const interpolated = this.interpolateFrame(frame, fps);
        if (interpolated) {
          allDetections.push(interpolated);
        }
      }
    }
    
    return allDetections;
  }
  
  /**
   * Interpolate boxes for a missing frame
   */
  private interpolateFrame(frameNumber: number, fps: number): Detection | null {
    const interpolatedBoxes: BoundingBox[] = [];
    
    // Check each track segment
    for (const segment of this.trackSegments.values()) {
      // Skip if frame is outside track's lifetime
      if (frameNumber < segment.startFrame || frameNumber > segment.endFrame) {
        continue;
      }
      
      // Find surrounding keyframes
      let prevFrame: number | null = null;
      let nextFrame: number | null = null;
      
      // Find closest previous frame
      for (let f = frameNumber - 1; f >= segment.startFrame; f--) {
        if (segment.frames.has(f)) {
          prevFrame = f;
          break;
        }
      }
      
      // Find closest next frame
      for (let f = frameNumber + 1; f <= segment.endFrame; f++) {
        if (segment.frames.has(f)) {
          nextFrame = f;
          break;
        }
      }
      
      // Interpolate if we have both frames
      if (prevFrame !== null && nextFrame !== null) {
        const prevBox = segment.frames.get(prevFrame)!;
        const nextBox = segment.frames.get(nextFrame)!;
        const progress = (frameNumber - prevFrame) / (nextFrame - prevFrame);
        
        // Use Kalman prediction for short gaps, linear interpolation for longer gaps
        const frameDiff = nextFrame - prevFrame;
        
        if (frameDiff <= 5) {
          // For short gaps, use smooth interpolation
          const easedProgress = this.easeInOutCubic(progress);
          
          const interpolatedBox: BoundingBox = {
            x: prevBox.x + (nextBox.x - prevBox.x) * easedProgress,
            y: prevBox.y + (nextBox.y - prevBox.y) * easedProgress,
            width: prevBox.width + (nextBox.width - prevBox.width) * easedProgress,
            height: prevBox.height + (nextBox.height - prevBox.height) * easedProgress,
            confidence: Math.min(prevBox.confidence, nextBox.confidence) * 0.95,
            class: prevBox.class,
            classId: prevBox.classId,
            trackId: prevBox.trackId
          };
          
          // Interpolate head center if available
          if (prevBox.headCenterX !== undefined && prevBox.headCenterY !== undefined &&
              nextBox.headCenterX !== undefined && nextBox.headCenterY !== undefined) {
            interpolatedBox.headCenterX = prevBox.headCenterX + (nextBox.headCenterX - prevBox.headCenterX) * easedProgress;
            interpolatedBox.headCenterY = prevBox.headCenterY + (nextBox.headCenterY - prevBox.headCenterY) * easedProgress;
          }
          
          interpolatedBoxes.push(interpolatedBox);
        } else {
          // For longer gaps, use linear interpolation with lower confidence
          const interpolatedBox: BoundingBox = {
            x: prevBox.x + (nextBox.x - prevBox.x) * progress,
            y: prevBox.y + (nextBox.y - prevBox.y) * progress,
            width: prevBox.width + (nextBox.width - prevBox.width) * progress,
            height: prevBox.height + (nextBox.height - prevBox.height) * progress,
            confidence: Math.min(prevBox.confidence, nextBox.confidence) * Math.pow(0.9, frameDiff / 5),
            class: prevBox.class,
            classId: prevBox.classId,
            trackId: prevBox.trackId
          };
          
          interpolatedBoxes.push(interpolatedBox);
        }
      } else if (prevFrame !== null) {
        // Only have previous frame - use last known position for very short gaps
        const prevBox = segment.frames.get(prevFrame)!;
        const frameDiff = frameNumber - prevFrame;
        
        if (frameDiff < 3) {
          interpolatedBoxes.push({
            ...prevBox,
            confidence: prevBox.confidence * Math.pow(0.95, frameDiff)
          });
        }
      } else if (nextFrame !== null) {
        // Only have next frame
        const nextBox = segment.frames.get(nextFrame)!;
        const frameDiff = nextFrame - frameNumber;
        
        if (frameDiff < 3) {
          interpolatedBoxes.push({
            ...nextBox,
            confidence: nextBox.confidence * Math.pow(0.95, frameDiff)
          });
        }
      }
    }
    
    if (interpolatedBoxes.length > 0) {
      return {
        frameNumber,
        timestamp: frameNumber / fps,
        boxes: interpolatedBoxes
      };
    }
    
    return null;
  }
  
  /**
   * Cubic ease-in-out function for smooth interpolation
   */
  private easeInOutCubic(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  
  /**
   * Reset the interpolator
   */
  reset(): void {
    this.botSort.reset();
    this.detections.clear();
    this.trackSegments.clear();
    this.frameImages.clear();
  }
}