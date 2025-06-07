import { BoundingBox, TrackedObject, Detection } from '@/types';

export class ObjectTracker {
  private trackedObjects: Map<string, TrackedObject> = new Map();
  private frameCount: number = 0;
  private iouThreshold: number = 0.3;
  private maxFramesLost: number = 10;
  private nextId: number = 1;
  private targetDetection: Detection | null = null;
  private targetTrackId: string | null = null;
  private velocityHistory: Map<string, { vx: number; vy: number }[]> = new Map();
  private maxVelocityChange: number = 50; // Max pixels per frame change in velocity

  track(detections: BoundingBox[], frameNumber: number): BoundingBox[] {
    this.frameCount = frameNumber;
    const trackedDetections: BoundingBox[] = [];
    const unassignedDetections = [...detections];
    const activeTrackers = new Map<string, TrackedObject>();

    // Match existing tracks with new detections
    for (const [trackId, tracker] of this.trackedObjects) {
      let bestMatch: BoundingBox | undefined;
      let bestScore = 0;
      let bestIndex = -1;

      // Get predicted position based on velocity
      const predictedPos = this.getPredictedPosition(trackId, tracker, frameNumber);

      // Find best matching detection
      unassignedDetections.forEach((detection, index) => {
        if (detection.class === tracker.label) {
          const isTargetTrack = trackId === this.targetTrackId;
          
          // Get last known position (use interpolated positions for smoother tracking)
          const lastKnownPositions = this.getLastKnownPositions(tracker, frameNumber, 5);
          if (lastKnownPositions.length === 0) return;
          
          const lastPosition = lastKnownPositions[0];
          const iou = this.calculateIOU(lastPosition, detection);
          const distScore = this.calculateDistanceScore(predictedPos || lastPosition, detection);
          
          // For target track, use much stricter matching
          if (isTargetTrack) {
            // Only accept if it's very close to predicted position
            const distance = this.calculateDistance(predictedPos || lastPosition, detection);
            if (distance < this.maxVelocityChange * 3) { // Allow 3x expected movement
              bestScore = 1000; // Very high score for target
              bestMatch = detection;
              bestIndex = index;
            }
          } else {
            // For non-target tracks, use normal scoring
            const score = iou * 0.5 + distScore * 0.5;
            if (score > bestScore && score > 0.3) {
              bestScore = score;
              bestMatch = detection;
              bestIndex = index;
            }
          }
        }
      });

      if (bestMatch !== undefined && bestIndex !== -1) {
        // Update existing track
        const trackedBox: BoundingBox = {
          x: bestMatch.x,
          y: bestMatch.y,
          width: bestMatch.width,
          height: bestMatch.height,
          confidence: bestMatch.confidence,
          class: bestMatch.class,
          classId: bestMatch.classId,
          trackId: trackId
        };
        tracker.positions.set(frameNumber, trackedBox);
        tracker.lastFrame = frameNumber;
        trackedDetections.push(trackedBox);
        activeTrackers.set(trackId, tracker);
        
        // Update velocity
        this.updateVelocity(trackId, tracker, frameNumber);
        
        // Remove from unassigned
        unassignedDetections.splice(bestIndex, 1);
      } else if (frameNumber - tracker.lastFrame < this.maxFramesLost || trackId === this.targetTrackId) {
        // Keep track alive but mark as lost
        // Target track NEVER dies - it persists throughout the entire video
        activeTrackers.set(trackId, tracker);
        
        // For target track, ALWAYS use predicted position
        if (trackId === this.targetTrackId) {
          const predictedBox = predictedPos || this.extrapolateMissingPosition(tracker, frameNumber);
          if (predictedBox) {
            const trackedPredictedBox: BoundingBox = {
              ...predictedBox,
              trackId: trackId,
              confidence: 0.5 // Lower confidence for predicted
            };
            tracker.positions.set(frameNumber, trackedPredictedBox);
            tracker.lastFrame = frameNumber; // Update last frame to keep track alive
            trackedDetections.push(trackedPredictedBox);
            
            // Update velocity for predicted position
            this.updateVelocity(trackId, tracker, frameNumber);
          }
        }
      }
    }

    // Create new tracks for unassigned detections
    for (const detection of unassignedDetections) {
      // If we have a target track, check if this detection might be the lost target
      if (this.targetTrackId && this.trackedObjects.has(this.targetTrackId)) {
        const targetTracker = this.trackedObjects.get(this.targetTrackId)!;
        const lastTargetPos = this.getLastKnownPositions(targetTracker, frameNumber, 10)[0];
        
        if (lastTargetPos) {
          const distance = this.calculateDistance(lastTargetPos, detection);
          // If detection is reasonably close to last known target position, assign it to target track
          if (distance < this.maxVelocityChange * 10) { // Allow larger distance for lost tracks
            const trackedBox: BoundingBox = {
              x: detection.x,
              y: detection.y,
              width: detection.width,
              height: detection.height,
              confidence: detection.confidence,
              class: detection.class,
              classId: detection.classId,
              trackId: this.targetTrackId
            };
            
            targetTracker.positions.set(frameNumber, trackedBox);
            targetTracker.lastFrame = frameNumber;
            activeTrackers.set(this.targetTrackId, targetTracker);
            trackedDetections.push(trackedBox);
            
            // Update velocity
            this.updateVelocity(this.targetTrackId, targetTracker, frameNumber);
            continue; // Skip creating new track
          }
        }
      }
      
      const trackId = `track_${this.nextId++}`;
      const trackedBox: BoundingBox = {
        x: detection.x,
        y: detection.y,
        width: detection.width,
        height: detection.height,
        confidence: detection.confidence,
        class: detection.class,
        classId: detection.classId,
        trackId: trackId
      };
      
      const newTracker: TrackedObject = {
        id: trackId,
        firstFrame: frameNumber,
        lastFrame: frameNumber,
        positions: new Map([[frameNumber, trackedBox]]),
        label: detection.class,
        selected: false
      };
      
      // Check if this is the target detection (only if we don't have a target track yet)
      if (this.targetDetection && !this.targetTrackId) {
        const targetBox = this.targetDetection.boxes[0]; // Use first box from target
        const similarity = this.calculateSimilarity(detection, targetBox);
        if (similarity > 0.7) { // High similarity threshold
          this.targetTrackId = trackId;
          newTracker.selected = true;
        }
      }
      
      activeTrackers.set(trackId, newTracker);
      trackedDetections.push(trackedBox);
    }

    this.trackedObjects = activeTrackers;
    return trackedDetections;
  }

  private calculateIOU(box1: BoundingBox | null, box2: BoundingBox | null): number {
    if (!box1 || !box2) return 0;
    
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

  getTrackedObjects(): TrackedObject[] {
    return Array.from(this.trackedObjects.values());
  }

  selectTrack(trackId: string): void {
    const track = this.trackedObjects.get(trackId);
    if (track) {
      // Deselect all others
      this.trackedObjects.forEach(t => t.selected = false);
      track.selected = true;
    }
  }

  getSelectedTrack(): TrackedObject | null {
    for (const track of this.trackedObjects.values()) {
      if (track.selected) return track;
    }
    return null;
  }

  reset(): void {
    this.trackedObjects.clear();
    this.frameCount = 0;
    this.nextId = 1;
    this.targetDetection = null;
    this.targetTrackId = null;
    this.velocityHistory.clear();
  }

  setTargetDetection(detection: Detection): void {
    this.targetDetection = detection;
    this.targetTrackId = null; // Reset track ID to find new match
  }

  getTargetTrack(): TrackedObject | null {
    if (!this.targetTrackId) return null;
    return this.trackedObjects.get(this.targetTrackId) || null;
  }

  private calculateSimilarity(box1: BoundingBox, box2: BoundingBox): number {
    // Calculate similarity based on IOU and relative position
    const iou = this.calculateIOU(box1, box2);
    
    // Calculate position similarity (normalized by image dimensions)
    const centerX1 = box1.x + box1.width / 2;
    const centerY1 = box1.y + box1.height / 2;
    const centerX2 = box2.x + box2.width / 2;
    const centerY2 = box2.y + box2.height / 2;
    
    // Assuming max distance is diagonal of a 1920x1080 frame
    const maxDistance = Math.sqrt(1920 * 1920 + 1080 * 1080);
    const distance = Math.sqrt(Math.pow(centerX1 - centerX2, 2) + Math.pow(centerY1 - centerY2, 2));
    const positionSimilarity = 1 - (distance / maxDistance);
    
    // Calculate size similarity
    const sizeRatio = Math.min(box1.width * box1.height, box2.width * box2.height) / 
                     Math.max(box1.width * box1.height, box2.width * box2.height);
    
    // Weighted combination
    return iou * 0.5 + positionSimilarity * 0.3 + sizeRatio * 0.2;
  }

  private getPredictedPosition(trackId: string, tracker: TrackedObject, frameNumber: number): BoundingBox | null {
    const velocities = this.velocityHistory.get(trackId);
    if (!velocities || velocities.length === 0) return null;

    const lastPosition = tracker.positions.get(tracker.lastFrame);
    if (!lastPosition) return null;

    // Get average velocity from recent frames
    const recentVelocities = velocities.slice(-5);
    let avgVx = 0, avgVy = 0;
    for (const v of recentVelocities) {
      avgVx += v.vx;
      avgVy += v.vy;
    }
    avgVx /= recentVelocities.length;
    avgVy /= recentVelocities.length;

    // Predict position
    const frameDiff = frameNumber - tracker.lastFrame;
    return {
      x: lastPosition.x + avgVx * frameDiff,
      y: lastPosition.y + avgVy * frameDiff,
      width: lastPosition.width,
      height: lastPosition.height,
      confidence: lastPosition.confidence,
      class: lastPosition.class,
      classId: lastPosition.classId
    };
  }

  private calculateDistanceScore(predicted: BoundingBox | null, actual: BoundingBox | null): number {
    if (!predicted || !actual) return 0;
    
    const centerX1 = predicted.x + predicted.width / 2;
    const centerY1 = predicted.y + predicted.height / 2;
    const centerX2 = actual.x + actual.width / 2;
    const centerY2 = actual.y + actual.height / 2;
    
    const distance = Math.sqrt(Math.pow(centerX1 - centerX2, 2) + Math.pow(centerY1 - centerY2, 2));
    const maxExpectedDistance = this.maxVelocityChange * 2; // Allow some margin
    
    return Math.max(0, 1 - (distance / maxExpectedDistance));
  }

  private updateVelocity(trackId: string, tracker: TrackedObject, frameNumber: number): void {
    const currentPos = tracker.positions.get(frameNumber);
    const prevPos = tracker.positions.get(frameNumber - 1);
    
    if (!currentPos || !prevPos) return;

    const vx = (currentPos.x + currentPos.width / 2) - (prevPos.x + prevPos.width / 2);
    const vy = (currentPos.y + currentPos.height / 2) - (prevPos.y + prevPos.height / 2);

    if (!this.velocityHistory.has(trackId)) {
      this.velocityHistory.set(trackId, []);
    }

    const velocities = this.velocityHistory.get(trackId)!;
    velocities.push({ vx, vy });

    // Keep only recent velocities
    if (velocities.length > 10) {
      velocities.shift();
    }
  }

  private getLastKnownPositions(tracker: TrackedObject, currentFrame: number, maxLookback: number): BoundingBox[] {
    const positions: BoundingBox[] = [];
    
    for (let i = 0; i < maxLookback; i++) {
      const frame = currentFrame - i - 1;
      if (frame < 0) break;
      
      const pos = tracker.positions.get(frame);
      if (pos) {
        positions.push(pos);
      }
    }
    
    return positions;
  }

  private calculateDistance(box1: BoundingBox | null, box2: BoundingBox | null): number {
    if (!box1 || !box2) return Infinity;
    
    const centerX1 = box1.x + box1.width / 2;
    const centerY1 = box1.y + box1.height / 2;
    const centerX2 = box2.x + box2.width / 2;
    const centerY2 = box2.y + box2.height / 2;
    
    return Math.sqrt(Math.pow(centerX1 - centerX2, 2) + Math.pow(centerY1 - centerY2, 2));
  }

  private extrapolateMissingPosition(tracker: TrackedObject, frameNumber: number): BoundingBox | null {
    // Get last few known positions
    const recentPositions = this.getLastKnownPositions(tracker, frameNumber, 5);
    if (recentPositions.length === 0) return null;
    
    const lastPos = recentPositions[0];
    
    // If we have velocity history, use it for better prediction
    const velocities = this.velocityHistory.get(tracker.id);
    if (velocities && velocities.length > 0) {
      // Use average of recent velocities
      const recentVels = velocities.slice(-3);
      let avgVx = 0, avgVy = 0;
      for (const v of recentVels) {
        avgVx += v.vx;
        avgVy += v.vy;
      }
      avgVx /= recentVels.length;
      avgVy /= recentVels.length;
      
      // Calculate frames since last known position
      const lastKnownFrame = tracker.lastFrame;
      const frameDiff = frameNumber - lastKnownFrame;
      
      return {
        x: lastPos.x + avgVx * frameDiff,
        y: lastPos.y + avgVy * frameDiff,
        width: lastPos.width,
        height: lastPos.height,
        confidence: lastPos.confidence * 0.8, // Reduce confidence for extrapolated
        class: lastPos.class,
        classId: lastPos.classId
      };
    }
    
    // Fallback: use last known position
    return { ...lastPos };
  }
}