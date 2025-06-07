import { BoundingBox } from '@/types';
import { ByteTrackerV2 } from './bytetrack-v2';

/**
 * Continuous ByteTracker that maintains tracking state across sparse detections
 */
export class ContinuousByteTracker {
  private tracker: ByteTrackerV2;
  private lastDetections: Map<string, BoundingBox> = new Map();
  private lastFrameNumber: number = -1;
  private velocityMap: Map<string, {vx: number, vy: number}> = new Map();

  constructor(config: any) {
    this.tracker = new ByteTrackerV2(config);
  }

  /**
   * Update tracker with new detections
   * This method handles sparse detections by interpolating missing frames
   */
  update(detections: BoundingBox[], frameNumber: number): BoundingBox[] {
    // If this is consecutive frame, just update normally
    if (frameNumber === this.lastFrameNumber + 1) {
      const results = this.tracker.update(detections);
      this.updateState(results, frameNumber);
      return results;
    }

    // If there's a gap, we need to fill in the missing frames
    if (this.lastFrameNumber >= 0 && frameNumber > this.lastFrameNumber + 1) {
      const frameGap = frameNumber - this.lastFrameNumber - 1;
      
      // Interpolate missing frames using last known positions and velocities
      for (let i = 1; i <= frameGap; i++) {
        const interpolatedDetections = this.interpolateDetections(i / (frameGap + 1));
        this.tracker.update(interpolatedDetections);
      }
    }

    // Now update with the actual detections
    const results = this.tracker.update(detections);
    this.updateState(results, frameNumber);
    return results;
  }

  private interpolateDetections(progress: number): BoundingBox[] {
    const interpolated: BoundingBox[] = [];
    
    for (const [trackId, lastBox] of this.lastDetections) {
      const velocity = this.velocityMap.get(trackId) || {vx: 0, vy: 0};
      
      interpolated.push({
        x: lastBox.x + velocity.vx * progress,
        y: lastBox.y + velocity.vy * progress,
        width: lastBox.width,
        height: lastBox.height,
        confidence: lastBox.confidence * 0.9, // Slightly reduce confidence for interpolated
        class: lastBox.class,
        classId: lastBox.classId,
        trackId: trackId
      });
    }
    
    return interpolated;
  }

  private updateState(detections: BoundingBox[], frameNumber: number): void {
    // Update velocities
    for (const det of detections) {
      if (det.trackId) {
        const lastDet = this.lastDetections.get(det.trackId);
        if (lastDet && this.lastFrameNumber >= 0) {
          const framesDiff = frameNumber - this.lastFrameNumber;
          const vx = (det.x - lastDet.x) / framesDiff;
          const vy = (det.y - lastDet.y) / framesDiff;
          this.velocityMap.set(det.trackId, {vx, vy});
        }
      }
    }

    // Update last detections
    this.lastDetections.clear();
    for (const det of detections) {
      if (det.trackId) {
        this.lastDetections.set(det.trackId, det);
      }
    }
    
    this.lastFrameNumber = frameNumber;
  }

  reset(): void {
    this.tracker.reset();
    this.lastDetections.clear();
    this.velocityMap.clear();
    this.lastFrameNumber = -1;
  }
}