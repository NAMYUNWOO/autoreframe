import { BoundingBox } from '@/types';

export interface ByteTrackerV2Config {
  trackThresh: number;
  trackBuffer: number; 
  matchThresh: number;
  frameRate: number;
  mot20?: boolean;
}

interface SimpleTrack {
  id: number;
  tlbr: number[]; // [x1, y1, x2, y2]
  score: number;
  isActivated: boolean;
  frameId: number;
  startFrame: number;
  trackletLen: number;
}

let globalTrackId = 0;

export class ByteTrackerV2 {
  private trackedTracks: SimpleTrack[] = [];
  private lostTracks: SimpleTrack[] = [];
  private removedTracks: SimpleTrack[] = [];
  private frameId: number = 0;
  private config: ByteTrackerV2Config;
  private detThresh: number;
  private maxTimeLost: number;

  constructor(config: ByteTrackerV2Config) {
    this.config = config;
    this.detThresh = config.trackThresh + 0.1;
    this.maxTimeLost = Math.floor(config.frameRate / 30.0 * config.trackBuffer);
  }

  update(detections: BoundingBox[]): BoundingBox[] {
    this.frameId++;
    
    // Convert detections to tlbr format
    const currentDetections = detections.map(det => ({
      tlbr: [det.x, det.y, det.x + det.width, det.y + det.height],
      score: det.confidence,
      box: det
    }));

    // Split into high and low confidence detections
    const highDetections = currentDetections.filter(d => d.score > this.config.trackThresh);
    const lowDetections = currentDetections.filter(d => 
      d.score > 0.1 && d.score <= this.config.trackThresh
    );

    // Separate activated tracks and unconfirmed tracks
    const activatedTracks = this.trackedTracks.filter(t => t.isActivated);
    const unconfirmedTracks = this.trackedTracks.filter(t => !t.isActivated);

    // Step 1: Match with high score detections
    const trackPool = [...activatedTracks, ...this.lostTracks];
    const matchesHigh = this.matchTracks(trackPool, highDetections);

    // Update matched tracks
    for (const [trackIdx, detIdx] of matchesHigh.matched) {
      const track = trackPool[trackIdx];
      const det = highDetections[detIdx];
      this.updateTrack(track, det);
    }

    // Step 2: Match remaining tracks with low score detections
    const remainingTracks = matchesHigh.unmatchedTracks.map(i => trackPool[i]);
    const matchesLow = this.matchTracks(remainingTracks, lowDetections);

    for (const [trackIdx, detIdx] of matchesLow.matched) {
      const track = remainingTracks[trackIdx];
      const det = lowDetections[detIdx];
      this.updateTrack(track, det);
    }

    // Mark unmatched tracks as lost
    for (const idx of matchesLow.unmatchedTracks) {
      const track = remainingTracks[idx];
      if (track.frameId === this.frameId - 1) {
        this.markLost(track);
      }
    }

    // Step 3: Match unconfirmed tracks
    const unmatchedHighDets = matchesHigh.unmatchedDetections.map(i => highDetections[i]);
    const matchesUnconfirmed = this.matchTracks(unconfirmedTracks, unmatchedHighDets);

    for (const [trackIdx, detIdx] of matchesUnconfirmed.matched) {
      const track = unconfirmedTracks[trackIdx];
      const det = unmatchedHighDets[detIdx];
      this.updateTrack(track, det);
      track.isActivated = true;
    }

    // Remove unmatched unconfirmed tracks
    for (const idx of matchesUnconfirmed.unmatchedTracks) {
      const track = unconfirmedTracks[idx];
      this.removeTrack(track);
    }

    // Step 4: Initialize new tracks from unmatched high confidence detections
    const newDetections = matchesUnconfirmed.unmatchedDetections.map(i => unmatchedHighDets[i]);
    for (const det of newDetections) {
      if (det.score >= this.detThresh) {
        const newTrack = this.createTrack(det);
        this.trackedTracks.push(newTrack);
      }
    }

    // Remove tracks that have been lost for too long
    this.lostTracks = this.lostTracks.filter(track => {
      if (this.frameId - track.frameId > this.maxTimeLost) {
        this.removedTracks.push(track);
        return false;
      }
      return true;
    });

    // Clean up tracked tracks
    this.trackedTracks = this.trackedTracks.filter(t => 
      t.frameId >= this.frameId - 1 && !this.removedTracks.includes(t)
    );

    // Return active tracks as bounding boxes
    const activeTracks = this.trackedTracks.filter(t => t.isActivated);
    return activeTracks.map(track => {
      const [x1, y1, x2, y2] = track.tlbr;
      return {
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
        confidence: track.score,
        class: 'person',
        classId: 0,
        trackId: `track_${track.id}`
      };
    });
  }

  private matchTracks(tracks: SimpleTrack[], detections: any[]) {
    const matched: Array<[number, number]> = [];
    const unmatchedTracks: number[] = [];
    const unmatchedDetections: number[] = [];

    if (tracks.length === 0) {
      return {
        matched,
        unmatchedTracks,
        unmatchedDetections: detections.map((_, i) => i)
      };
    }

    if (detections.length === 0) {
      return {
        matched,
        unmatchedTracks: tracks.map((_, i) => i),
        unmatchedDetections
      };
    }

    // Calculate IoU distance matrix
    const costMatrix: number[][] = [];
    for (const track of tracks) {
      const row: number[] = [];
      for (const det of detections) {
        const iou = this.calculateIoU(track.tlbr, det.tlbr);
        row.push(1 - iou);
      }
      costMatrix.push(row);
    }

    // Simple greedy matching
    const usedTracks = new Set<number>();
    const usedDets = new Set<number>();
    const candidates: Array<{cost: number, trackIdx: number, detIdx: number}> = [];

    for (let i = 0; i < tracks.length; i++) {
      for (let j = 0; j < detections.length; j++) {
        if (costMatrix[i][j] < this.config.matchThresh) {
          candidates.push({cost: costMatrix[i][j], trackIdx: i, detIdx: j});
        }
      }
    }

    candidates.sort((a, b) => a.cost - b.cost);

    for (const candidate of candidates) {
      if (!usedTracks.has(candidate.trackIdx) && !usedDets.has(candidate.detIdx)) {
        matched.push([candidate.trackIdx, candidate.detIdx]);
        usedTracks.add(candidate.trackIdx);
        usedDets.add(candidate.detIdx);
      }
    }

    // Find unmatched
    for (let i = 0; i < tracks.length; i++) {
      if (!usedTracks.has(i)) unmatchedTracks.push(i);
    }
    for (let i = 0; i < detections.length; i++) {
      if (!usedDets.has(i)) unmatchedDetections.push(i);
    }

    return { matched, unmatchedTracks, unmatchedDetections };
  }

  private calculateIoU(box1: number[], box2: number[]): number {
    const [x1_1, y1_1, x2_1, y2_1] = box1;
    const [x1_2, y1_2, x2_2, y2_2] = box2;

    const xi1 = Math.max(x1_1, x1_2);
    const yi1 = Math.max(y1_1, y1_2);
    const xi2 = Math.min(x2_1, x2_2);
    const yi2 = Math.min(y2_1, y2_2);

    if (xi2 < xi1 || yi2 < yi1) return 0;

    const intersection = (xi2 - xi1) * (yi2 - yi1);
    const area1 = (x2_1 - x1_1) * (y2_1 - y1_1);
    const area2 = (x2_2 - x1_2) * (y2_2 - y1_2);
    const union = area1 + area2 - intersection;

    return intersection / union;
  }

  private createTrack(detection: any): SimpleTrack {
    return {
      id: ++globalTrackId,
      tlbr: detection.tlbr,
      score: detection.score,
      isActivated: this.frameId === 1, // Activate immediately on first frame
      frameId: this.frameId,
      startFrame: this.frameId,
      trackletLen: 0
    };
  }

  private updateTrack(track: SimpleTrack, detection: any): void {
    track.tlbr = detection.tlbr;
    track.score = detection.score;
    track.frameId = this.frameId;
    track.trackletLen++;
  }

  private markLost(track: SimpleTrack): void {
    const idx = this.trackedTracks.indexOf(track);
    if (idx !== -1) {
      this.trackedTracks.splice(idx, 1);
      this.lostTracks.push(track);
    }
  }

  private removeTrack(track: SimpleTrack): void {
    const idx = this.trackedTracks.indexOf(track);
    if (idx !== -1) {
      this.trackedTracks.splice(idx, 1);
      this.removedTracks.push(track);
    }
  }

  reset(): void {
    this.trackedTracks = [];
    this.lostTracks = [];
    this.removedTracks = [];
    this.frameId = 0;
  }
}