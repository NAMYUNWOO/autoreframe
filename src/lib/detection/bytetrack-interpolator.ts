import { ByteTracker } from './bytetrack-proper/byte-tracker';
import { BoundingBox, Detection } from '@/types';

interface TrackSegment {
  trackId: string;
  frames: Map<number, BoundingBox>;
  startFrame: number;
  endFrame: number;
}

export class ByteTrackInterpolator {
  private byteTracker: ByteTracker;
  private detections: Map<number, Detection> = new Map();
  private trackSegments: Map<string, TrackSegment> = new Map();
  
  constructor(byteTrackerParams?: any) {
    console.log('ByteTrackInterpolator constructor called with params:', byteTrackerParams);
    this.byteTracker = new ByteTracker(byteTrackerParams);
  }
  
  /**
   * Process a frame with ByteTracker and store the result
   */
  processFrame(boxes: BoundingBox[], frameNumber: number, timestamp: number): Detection {
    if (frameNumber === 213) {
      console.log(`Frame 213: ByteTrackInterpolator.processFrame`);
    }
    
    // Run ByteTracker to get tracked boxes
    const trackedBoxes = this.byteTracker.update(boxes, frameNumber);
    
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
        
        // Linear interpolation with smooth easing
        const easedProgress = this.easeInOutCubic(progress);
        
        const interpolatedBox: BoundingBox = {
          x: prevBox.x + (nextBox.x - prevBox.x) * easedProgress,
          y: prevBox.y + (nextBox.y - prevBox.y) * easedProgress,
          width: prevBox.width + (nextBox.width - prevBox.width) * easedProgress,
          height: prevBox.height + (nextBox.height - prevBox.height) * easedProgress,
          confidence: Math.min(prevBox.confidence, nextBox.confidence) * 0.9, // Slightly lower confidence for interpolated
          class: prevBox.class,
          classId: prevBox.classId,
          trackId: prevBox.trackId
        };
        
        // Interpolate head center if available
        if (prevBox.headCenterX !== undefined && prevBox.headCenterY !== undefined &&
            nextBox.headCenterX !== undefined && nextBox.headCenterY !== undefined) {
          interpolatedBox.headCenterX = prevBox.headCenterX + (nextBox.headCenterX - prevBox.headCenterX) * easedProgress;
          interpolatedBox.headCenterY = prevBox.headCenterY + (nextBox.headCenterY - prevBox.headCenterY) * easedProgress;
        } else if (prevBox.headCenterX !== undefined && prevBox.headCenterY !== undefined) {
          // Use previous head center if only one is available
          interpolatedBox.headCenterX = prevBox.headCenterX;
          interpolatedBox.headCenterY = prevBox.headCenterY;
        }
        
        interpolatedBoxes.push(interpolatedBox);
      } else if (prevFrame !== null) {
        // Only have previous frame - use motion prediction
        const prevBox = segment.frames.get(prevFrame)!;
        const frameDiff = frameNumber - prevFrame;
        
        // If gap is small (< 5 frames), use last position
        if (frameDiff < 5) {
          interpolatedBoxes.push({
            ...prevBox,
            confidence: prevBox.confidence * Math.pow(0.95, frameDiff) // Decay confidence
          });
        }
      } else if (nextFrame !== null) {
        // Only have next frame
        const nextBox = segment.frames.get(nextFrame)!;
        const frameDiff = nextFrame - frameNumber;
        
        // If gap is small (< 5 frames), use next position
        if (frameDiff < 5) {
          interpolatedBoxes.push({
            ...nextBox,
            confidence: nextBox.confidence * Math.pow(0.95, frameDiff) // Decay confidence
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
    this.byteTracker.reset();
    this.detections.clear();
    this.trackSegments.clear();
  }
}