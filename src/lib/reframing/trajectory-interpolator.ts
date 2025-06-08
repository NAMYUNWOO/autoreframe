import { Detection, BoundingBox } from '@/types';

interface InterpolatedPoint {
  frame: number;
  x: number;
  y: number;
  width: number;
  height: number;
  headX?: number;
  headY?: number;
}

export class TrajectoryInterpolator {
  /**
   * Interpolate missing frames for a specific track
   */
  interpolateTrajectory(
    detections: Detection[],
    targetTrackId: string,
    totalFrames: number
  ): Detection[] {
    // console.log(`TrajectoryInterpolator: Interpolating trajectory for track ${targetTrackId}`);
    
    // Extract all existing points for the target track
    const existingPoints = new Map<number, BoundingBox>();
    
    for (const detection of detections) {
      const targetBox = detection.boxes.find(box => box.trackId === targetTrackId);
      if (targetBox) {
        existingPoints.set(detection.frameNumber, targetBox);
      }
    }
    
    // console.log(`Found ${existingPoints.size} existing points out of ${totalFrames} total frames`);
    
    // Create full detection array with interpolated data
    const interpolatedDetections: Detection[] = [];
    
    // First, add all existing detections
    const existingDetectionMap = new Map<number, Detection>();
    for (const detection of detections) {
      existingDetectionMap.set(detection.frameNumber, detection);
    }
    
    for (let frame = 0; frame < totalFrames; frame++) {
      if (existingDetectionMap.has(frame)) {
        // Use existing detection
        interpolatedDetections.push(existingDetectionMap.get(frame)!);
      } else {
        // Interpolate missing frame
        const interpolatedBox = this.interpolateFrame(frame, existingPoints, targetTrackId);
        if (interpolatedBox) {
          // Create a new detection with the interpolated box
          let timestamp = frame / 30; // Default to 30fps
          if (existingDetectionMap.size > 0) {
            const firstDetection = existingDetectionMap.values().next().value;
            if (firstDetection && firstDetection.frameNumber > 0) {
              timestamp = frame * (firstDetection.timestamp / firstDetection.frameNumber);
            }
          }
            
          interpolatedDetections.push({
            frameNumber: frame,
            timestamp: timestamp,
            boxes: [interpolatedBox]
          });
        } else {
          // If we can't interpolate, create empty detection to maintain frame continuity
          let timestamp = frame / 30; // Default to 30fps
          if (existingDetectionMap.size > 0) {
            const firstDetection = existingDetectionMap.values().next().value;
            if (firstDetection && firstDetection.frameNumber > 0) {
              timestamp = frame * (firstDetection.timestamp / firstDetection.frameNumber);
            }
          }
            
          interpolatedDetections.push({
            frameNumber: frame,
            timestamp: timestamp,
            boxes: []
          });
        }
      }
    }
    
    // console.log(`Created ${interpolatedDetections.length} detections after interpolation`);
    
    return interpolatedDetections;
  }
  
  /**
   * Interpolate a single frame
   */
  private interpolateFrame(
    targetFrame: number,
    existingPoints: Map<number, BoundingBox>,
    trackId: string
  ): BoundingBox | null {
    // Find surrounding frames with detections
    let prevFrame = -1;
    let nextFrame = -1;
    
    // Find previous frame with detection
    for (let f = targetFrame - 1; f >= 0; f--) {
      if (existingPoints.has(f)) {
        prevFrame = f;
        break;
      }
    }
    
    // Find next frame with detection
    const maxFrame = Math.max(...Array.from(existingPoints.keys()));
    for (let f = targetFrame + 1; f <= maxFrame; f++) {
      if (existingPoints.has(f)) {
        nextFrame = f;
        break;
      }
    }
    
    // Interpolate based on available frames
    if (prevFrame !== -1 && nextFrame !== -1) {
      // Linear interpolation between two frames
      const prevBox = existingPoints.get(prevFrame)!;
      const nextBox = existingPoints.get(nextFrame)!;
      const t = (targetFrame - prevFrame) / (nextFrame - prevFrame);
      
      // Use ease-in-out for smoother interpolation
      const easeT = this.easeInOutCubic(t);
      
      const interpolatedBox: BoundingBox = {
        x: prevBox.x + (nextBox.x - prevBox.x) * easeT,
        y: prevBox.y + (nextBox.y - prevBox.y) * easeT,
        width: prevBox.width + (nextBox.width - prevBox.width) * easeT,
        height: prevBox.height + (nextBox.height - prevBox.height) * easeT,
        confidence: Math.min(prevBox.confidence, nextBox.confidence) * 0.9,
        class: prevBox.class,
        classId: prevBox.classId,
        trackId: trackId
      };
      
      // Interpolate head center if available
      if (prevBox.headCenterX !== undefined && prevBox.headCenterY !== undefined &&
          nextBox.headCenterX !== undefined && nextBox.headCenterY !== undefined) {
        interpolatedBox.headCenterX = prevBox.headCenterX + (nextBox.headCenterX - prevBox.headCenterX) * easeT;
        interpolatedBox.headCenterY = prevBox.headCenterY + (nextBox.headCenterY - prevBox.headCenterY) * easeT;
      } else if (prevBox.headCenterX !== undefined && prevBox.headCenterY !== undefined) {
        // Use relative position from previous frame
        const relX = (prevBox.headCenterX - prevBox.x) / prevBox.width;
        const relY = (prevBox.headCenterY - prevBox.y) / prevBox.height;
        interpolatedBox.headCenterX = interpolatedBox.x + interpolatedBox.width * relX;
        interpolatedBox.headCenterY = interpolatedBox.y + interpolatedBox.height * relY;
      }
      
      return interpolatedBox;
    } else if (prevFrame !== -1) {
      // Only have previous frame - use motion prediction
      const prevBox = existingPoints.get(prevFrame)!;
      
      // Look for earlier frame to calculate velocity
      let prevPrevFrame = -1;
      for (let f = prevFrame - 1; f >= 0; f--) {
        if (existingPoints.has(f)) {
          prevPrevFrame = f;
          break;
        }
      }
      
      if (prevPrevFrame !== -1) {
        const prevPrevBox = existingPoints.get(prevPrevFrame)!;
        const dt = prevFrame - prevPrevFrame;
        const vx = (prevBox.x - prevPrevBox.x) / dt;
        const vy = (prevBox.y - prevPrevBox.y) / dt;
        const vw = (prevBox.width - prevPrevBox.width) / dt;
        const vh = (prevBox.height - prevPrevBox.height) / dt;
        
        const timeDiff = targetFrame - prevFrame;
        
        const predictedBox: BoundingBox = {
          x: prevBox.x + vx * timeDiff,
          y: prevBox.y + vy * timeDiff,
          width: prevBox.width + vw * timeDiff,
          height: prevBox.height + vh * timeDiff,
          confidence: prevBox.confidence * Math.pow(0.95, timeDiff),
          class: prevBox.class,
          classId: prevBox.classId,
          trackId: trackId
        };
        
        // Predict head position
        if (prevBox.headCenterX !== undefined && prevBox.headCenterY !== undefined &&
            prevPrevBox.headCenterX !== undefined && prevPrevBox.headCenterY !== undefined) {
          const vhx = (prevBox.headCenterX - prevPrevBox.headCenterX) / dt;
          const vhy = (prevBox.headCenterY - prevPrevBox.headCenterY) / dt;
          predictedBox.headCenterX = prevBox.headCenterX + vhx * timeDiff;
          predictedBox.headCenterY = prevBox.headCenterY + vhy * timeDiff;
        }
        
        return predictedBox;
      } else {
        // No velocity information, just copy previous
        return { ...prevBox, confidence: prevBox.confidence * 0.9 };
      }
    } else if (nextFrame !== -1) {
      // Only have next frame - use it with reduced confidence
      const nextBox = existingPoints.get(nextFrame)!;
      return { ...nextBox, confidence: nextBox.confidence * 0.9 };
    }
    
    return null;
  }
  
  private easeInOutCubic(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}