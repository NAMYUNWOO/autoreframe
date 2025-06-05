import { BoundingBox, TrackedObject } from '@/types';

export class ObjectTracker {
  private trackedObjects: Map<string, TrackedObject> = new Map();
  private frameCount: number = 0;
  private iouThreshold: number = 0.3;
  private maxFramesLost: number = 10;
  private nextId: number = 1;

  track(detections: BoundingBox[], frameNumber: number): BoundingBox[] {
    this.frameCount = frameNumber;
    const trackedDetections: BoundingBox[] = [];
    const unassignedDetections = [...detections];
    const activeTrackers = new Map<string, TrackedObject>();

    // Match existing tracks with new detections
    for (const [trackId, tracker] of this.trackedObjects) {
      let bestMatch: BoundingBox | null = null;
      let bestIou = 0;
      let bestIndex = -1;

      // Find best matching detection
      unassignedDetections.forEach((detection, index) => {
        const lastPosition = tracker.positions.get(frameNumber - 1);
        if (lastPosition && detection.class === tracker.label) {
          const iou = this.calculateIOU(lastPosition, detection);
          if (iou > bestIou && iou > this.iouThreshold) {
            bestIou = iou;
            bestMatch = detection;
            bestIndex = index;
          }
        }
      });

      if (bestMatch) {
        // Update existing track
        bestMatch.trackId = trackId;
        tracker.positions.set(frameNumber, bestMatch);
        tracker.lastFrame = frameNumber;
        trackedDetections.push(bestMatch);
        activeTrackers.set(trackId, tracker);
        
        // Remove from unassigned
        unassignedDetections.splice(bestIndex, 1);
      } else if (frameNumber - tracker.lastFrame < this.maxFramesLost) {
        // Keep track alive but mark as lost
        activeTrackers.set(trackId, tracker);
      }
    }

    // Create new tracks for unassigned detections
    for (const detection of unassignedDetections) {
      const trackId = `track_${this.nextId++}`;
      detection.trackId = trackId;
      
      const newTracker: TrackedObject = {
        id: trackId,
        firstFrame: frameNumber,
        lastFrame: frameNumber,
        positions: new Map([[frameNumber, detection]]),
        label: detection.class,
        selected: false
      };
      
      activeTrackers.set(trackId, newTracker);
      trackedDetections.push(detection);
    }

    this.trackedObjects = activeTrackers;
    return trackedDetections;
  }

  private calculateIOU(box1: BoundingBox, box2: BoundingBox): number {
    const x1 = Math.max(box1.x, box2.x);
    const y1 = Math.max(box1.y, box2.y);
    const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
    const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);

    if (x2 < x1 || y2 < y1) return 0;

    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = box1.width * box1.height;
    const area2 = box2.width * box2.height;
    const union = area1 + area2 - intersection;

    return intersection / union;
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
  }
}