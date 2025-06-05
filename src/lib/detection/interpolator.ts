import { BoundingBox, Detection } from '@/types';

export class DetectionInterpolator {
  private keyframeDetections: Map<number, Detection> = new Map();
  private interpolatedDetections: Map<number, Detection> = new Map();
  
  constructor() {}
  
  addKeyframe(detection: Detection): void {
    this.keyframeDetections.set(detection.frameNumber, detection);
  }
  
  interpolate(totalFrames: number, fps: number): Detection[] {
    const detections: Detection[] = [];
    const keyframes = Array.from(this.keyframeDetections.entries()).sort((a, b) => a[0] - b[0]);
    
    if (keyframes.length === 0) return [];
    
    for (let frame = 0; frame < totalFrames; frame++) {
      // Check if we have a keyframe for this frame
      const keyframe = this.keyframeDetections.get(frame);
      if (keyframe) {
        detections.push(keyframe);
        continue;
      }
      
      // Find surrounding keyframes
      let prevKeyframe: [number, Detection] | null = null;
      let nextKeyframe: [number, Detection] | null = null;
      
      for (let i = 0; i < keyframes.length; i++) {
        if (keyframes[i][0] < frame) {
          prevKeyframe = keyframes[i];
        } else if (keyframes[i][0] > frame && !nextKeyframe) {
          nextKeyframe = keyframes[i];
          break;
        }
      }
      
      // Interpolate detection
      const interpolated = this.interpolateFrame(
        frame,
        prevKeyframe,
        nextKeyframe,
        fps
      );
      
      if (interpolated) {
        detections.push(interpolated);
      }
    }
    
    return detections;
  }
  
  private interpolateFrame(
    frameNumber: number,
    prevKeyframe: [number, Detection] | null,
    nextKeyframe: [number, Detection] | null,
    fps: number
  ): Detection | null {
    // If we only have previous keyframe, use last known position
    if (prevKeyframe && !nextKeyframe) {
      return {
        frameNumber,
        timestamp: frameNumber / fps,
        boxes: prevKeyframe[1].boxes.map(box => ({ ...box }))
      };
    }
    
    // If we only have next keyframe, use next known position
    if (!prevKeyframe && nextKeyframe) {
      return {
        frameNumber,
        timestamp: frameNumber / fps,
        boxes: nextKeyframe[1].boxes.map(box => ({ ...box }))
      };
    }
    
    // If we have both keyframes, interpolate
    if (prevKeyframe && nextKeyframe) {
      const [prevFrame, prevDetection] = prevKeyframe;
      const [nextFrame, nextDetection] = nextKeyframe;
      
      const progress = (frameNumber - prevFrame) / (nextFrame - prevFrame);
      
      // Match boxes between frames by track ID
      const interpolatedBoxes: BoundingBox[] = [];
      
      // Process boxes from previous frame
      for (const prevBox of prevDetection.boxes) {
        if (!prevBox.trackId) continue;
        
        // Find matching box in next frame
        const nextBox = nextDetection.boxes.find(box => box.trackId === prevBox.trackId);
        
        if (nextBox) {
          // Interpolate between previous and next box
          interpolatedBoxes.push(this.interpolateBox(prevBox, nextBox, progress));
        } else {
          // Box disappeared, use previous position (could also fade out)
          interpolatedBoxes.push({ ...prevBox });
        }
      }
      
      // Add new boxes that appeared in next frame
      for (const nextBox of nextDetection.boxes) {
        if (!nextBox.trackId) continue;
        
        const existsInPrev = prevDetection.boxes.some(box => box.trackId === nextBox.trackId);
        if (!existsInPrev) {
          // New box appeared, use next position (could also fade in)
          interpolatedBoxes.push({ ...nextBox });
        }
      }
      
      return {
        frameNumber,
        timestamp: frameNumber / fps,
        boxes: interpolatedBoxes
      };
    }
    
    return null;
  }
  
  private interpolateBox(box1: BoundingBox, box2: BoundingBox, progress: number): BoundingBox {
    return {
      x: box1.x + (box2.x - box1.x) * progress,
      y: box1.y + (box2.y - box1.y) * progress,
      width: box1.width + (box2.width - box1.width) * progress,
      height: box1.height + (box2.height - box1.height) * progress,
      confidence: box1.confidence + (box2.confidence - box1.confidence) * progress,
      class: box1.class,
      classId: box1.classId,
      trackId: box1.trackId
    };
  }
  
  reset(): void {
    this.keyframeDetections.clear();
    this.interpolatedDetections.clear();
  }
}