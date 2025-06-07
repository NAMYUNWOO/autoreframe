import { STrack } from './strack';
import { iouDistance, fuseScore, linearAssignment } from './matching';
import { TrackState, Detection, TrackParams } from './types';
import { BoundingBox } from '@/types';

export class ByteTracker {
  private trackedStracks: STrack[] = [];
  private lostStracks: STrack[] = [];
  private removedStracks: STrack[] = [];
  private frameId: number = 0;
  private params: TrackParams;
  
  constructor(params: Partial<TrackParams> = {}) {
    this.params = {
      trackThresh: params.trackThresh || 0.5,
      trackBuffer: params.trackBuffer || 30,
      matchThresh: params.matchThresh || 0.8,
      minBoxArea: params.minBoxArea || 10,
      lowThresh: params.lowThresh || 0.1
    };
    
    console.log('ByteTracker initialized with params:', this.params);
    
    STrack.resetId();
  }

  /**
   * Update tracker with new detections
   */
  update(boxes: BoundingBox[], frameNumber?: number): BoundingBox[] {
    this.frameId++;
    
    if (frameNumber && frameNumber >= 210 && frameNumber <= 214) {
      console.log(`Frame ${frameNumber}: ByteTracker.update - frameId=${this.frameId}, input boxes: ${boxes.length}`);
      if (frameNumber === 213) {
        boxes.forEach((box, i) => {
          console.log(`  Frame 213 - Input box ${i}: confidence=${box.confidence.toFixed(3)}, class=${box.class}`);
        });
      }
    }
    
    // Convert BoundingBox to Detection format
    const detections: Detection[] = boxes.map(box => ({
      bbox: [box.x, box.y, box.x + box.width, box.y + box.height], // Convert to tlbr
      score: box.confidence,
      class: box.class,
      headCenterX: box.headCenterX,
      headCenterY: box.headCenterY
    }));
    
    // Filter detections by area
    const validDetections = detections.filter(det => {
      const [x1, y1, x2, y2] = det.bbox;
      const area = (x2 - x1) * (y2 - y1);
      return area > this.params.minBoxArea;
    });
    
    // Separate detections by confidence
    // For debugging: log actual scores
    if (frameNumber === 213 && validDetections.length > 0) {
      const scores = validDetections.map(d => d.score.toFixed(3)).join(', ');
      console.log(`Frame 213: ByteTracker scores=[${scores}], trackThresh=${this.params.trackThresh}, lowThresh=${this.params.lowThresh}`);
    }
    
    const highDetections = validDetections.filter(det => det.score >= this.params.trackThresh);
    const lowDetections = validDetections.filter(det => 
      det.score >= this.params.lowThresh && det.score < this.params.trackThresh
    );
    
    if (frameNumber === 213) {
      console.log(`Frame 213: Valid detections: ${validDetections.length}, high: ${highDetections.length}, low: ${lowDetections.length}`);
    }
    
    // Initialize new tracks for first frame
    if (this.frameId === 1) {
      const activatedStracks: STrack[] = [];
      for (const det of highDetections) {
        const track = STrack.fromDetection(det, this.frameId);
        activatedStracks.push(track);
      }
      this.trackedStracks = activatedStracks;
      return this.convertToOutput(this.trackedStracks);
    }
    
    if (frameNumber === 213) {
      console.log(`Frame 213: ByteTracker frameId=${this.frameId}, not first frame, continuing...`);
      console.log(`Frame 213: Current tracked: ${this.trackedStracks.length}, lost: ${this.lostStracks.length}`);
    }
    
    // Predict current tracks
    const strack_pool = [...this.trackedStracks, ...this.lostStracks];
    for (const track of strack_pool) {
      track.predict();
    }
    
    const activatedStracks: STrack[] = [];
    const refindStracks: STrack[] = [];
    const lostStracks: STrack[] = [];
    const removedStracks: STrack[] = [];
    
    /** Step 1: First association with high score detections */
    const unconfirmedStracks: STrack[] = [];
    const trackedStracks: STrack[] = [];
    
    for (const track of this.trackedStracks) {
      if (!track.isActivated) {
        unconfirmedStracks.push(track);
      } else {
        trackedStracks.push(track);
      }
    }
    
    if (frameNumber === 213) {
      console.log(`Frame 213: Step 1 - trackedStracks: ${trackedStracks.length}, unconfirmedStracks: ${unconfirmedStracks.length}`);
    }
    
    // Associate confirmed tracks with high detections
    const dists = iouDistance(trackedStracks, highDetections);
    const fusedDists = fuseScore(dists, highDetections);
    const [matches, uTrackIdx, uDetIdx] = linearAssignment(fusedDists, this.params.matchThresh);
    
    // Update matched tracks
    for (const [itrack, idet] of matches) {
      const track = trackedStracks[itrack];
      const det = highDetections[idet];
      track.update(det, this.frameId);
      activatedStracks.push(track);
    }
    
    // Process unmatched tracks and detections
    const remainTrackIdx = uTrackIdx;
    const remainDetIdx = uDetIdx;
    
    if (frameNumber === 213) {
      console.log(`Frame 213: After Step 1 - unmatched tracks: ${remainTrackIdx.length}, unmatched detections: ${remainDetIdx.length}`);
    }
    
    // Mark unmatched tracks
    for (const idx of uTrackIdx) {
      trackedStracks[idx].markLost();
    }
    
    /** Step 2: Second association with low score detections */
    if (lowDetections.length > 0) {
      // Get remaining tracks
      const remainingTracks = remainTrackIdx.map(i => trackedStracks[i]);
      
      const dists2 = iouDistance(remainingTracks, lowDetections);
      const [matches2, uTrackIdx2, _] = linearAssignment(dists2, 0.5);
      
      for (const [itrack, idet] of matches2) {
        const track = remainingTracks[itrack];
        const det = lowDetections[idet];
        track.update(det, this.frameId);
        activatedStracks.push(track);
      }
      
      // Update remaining unmatched tracks
      for (let i = 0; i < remainingTracks.length; i++) {
        if (!matches2.some(m => m[0] === i)) {
          lostStracks.push(remainingTracks[i]);
        }
      }
    } else {
      // All unmatched tracks become lost
      for (const idx of remainTrackIdx) {
        lostStracks.push(trackedStracks[idx]);
      }
    }
    
    /** Step 3: Deal with unconfirmed tracks */
    const remainingHighDets = remainDetIdx.map(i => highDetections[i]);
    
    if (frameNumber === 213) {
      console.log(`Frame 213: Step 3 - remaining high detections: ${remainingHighDets.length}, unconfirmed tracks: ${unconfirmedStracks.length}`);
    }
    
    const dists3 = iouDistance(unconfirmedStracks, remainingHighDets);
    const [matches3, uTrackIdx3, uDetIdx3] = linearAssignment(dists3, 0.7);
    
    for (const [itrack, idet] of matches3) {
      const track = unconfirmedStracks[itrack];
      const det = remainingHighDets[idet];
      track.update(det, this.frameId);
      activatedStracks.push(track);
    }
    
    // Remove unmatched unconfirmed tracks
    for (const idx of uTrackIdx3) {
      const track = unconfirmedStracks[idx];
      track.markRemoved();
      removedStracks.push(track);
    }
    
    /** Step 4: Init new tracks */
    const newDetIdx = uDetIdx3.map(i => remainDetIdx[i]);
    const newDetections = newDetIdx.map(i => highDetections[i]);
    
    if (frameNumber === 213) {
      console.log(`Frame 213: Step 4 - New detections to track: ${newDetections.length}`);
    }
    
    for (const det of newDetections) {
      const track = STrack.fromDetection(det, this.frameId);
      if (frameNumber === 213) {
        console.log(`Frame 213: Creating new track, isActivated=${track.isActivated}`);
      }
      if (!track.isActivated) {
        activatedStracks.push(track);
      }
    }
    
    /** Step 5: Associate with lost tracks */
    const allLostTracks = [...this.lostStracks, ...lostStracks];
    const dists4 = iouDistance(allLostTracks, highDetections);
    const [matches4, uTrackIdx4, _] = linearAssignment(dists4, this.params.matchThresh);
    
    for (const [itrack, idet] of matches4) {
      const track = allLostTracks[itrack];
      const det = highDetections[idet];
      track.reActivate(det, this.frameId, false);
      refindStracks.push(track);
    }
    
    // Remove lost tracks that exceed buffer
    for (const idx of uTrackIdx4) {
      const track = allLostTracks[idx];
      if (this.frameId - track.frameId > this.params.trackBuffer) {
        track.markRemoved();
        removedStracks.push(track);
      }
    }
    
    /** Step 6: Update track states */
    // Merge track lists
    this.trackedStracks = this.jointStracks(
      this.jointStracks(activatedStracks, refindStracks),
      lostStracks.filter(t => t.state === TrackState.Lost)
    );
    
    // Filter by state
    this.trackedStracks = this.trackedStracks.filter(t => t.state === TrackState.Tracked);
    this.lostStracks = this.subStracks(allLostTracks, this.trackedStracks);
    this.lostStracks = this.subStracks(this.lostStracks, removedStracks);
    
    // Remove duplicate tracks
    this.removeDuplicateStracks();
    
    // Get output tracks
    const outputStracks = this.trackedStracks.filter(track => track.isActivated);
    
    if (frameNumber === 213) {
      console.log(`Frame 213: ByteTracker output - detections: ${boxes.length}, tracked: ${outputStracks.length}, lost: ${this.lostStracks.length}`);
    }
    
    const output = this.convertToOutput(outputStracks);
    
    if (frameNumber === 213) {
      output.forEach((box, i) => {
        console.log(`  Frame 213 - Output box ${i}: trackId=${box.trackId}, confidence=${box.confidence.toFixed(3)}`);
      });
    }
    
    return output;
  }

  /**
   * Remove duplicate tracks with high IoU
   */
  private removeDuplicateStracks(): void {
    const ious = this.calcIoUs(this.trackedStracks, this.trackedStracks);
    const pairs: Array<[number, number]> = [];
    
    for (let i = 0; i < ious.length; i++) {
      for (let j = i + 1; j < ious[i].length; j++) {
        if (ious[i][j] > 0.15) {
          pairs.push([i, j]);
        }
      }
    }
    
    const toRemove = new Set<number>();
    for (const [i, j] of pairs) {
      const track1 = this.trackedStracks[i];
      const track2 = this.trackedStracks[j];
      
      if (track1.age < track2.age) {
        toRemove.add(i);
      } else {
        toRemove.add(j);
      }
    }
    
    this.trackedStracks = this.trackedStracks.filter((_, idx) => !toRemove.has(idx));
  }

  /**
   * Calculate IoU matrix between two track lists
   */
  private calcIoUs(tracks1: STrack[], tracks2: STrack[]): number[][] {
    const ious: number[][] = [];
    
    for (const track1 of tracks1) {
      const row: number[] = [];
      for (const track2 of tracks2) {
        const [x1_1, y1_1, x2_1, y2_1] = track1.tlbr;
        const [x1_2, y1_2, x2_2, y2_2] = track2.tlbr;
        
        const xi1 = Math.max(x1_1, x1_2);
        const yi1 = Math.max(y1_1, y1_2);
        const xi2 = Math.min(x2_1, x2_2);
        const yi2 = Math.min(y2_1, y2_2);
        
        const interArea = Math.max(0, xi2 - xi1) * Math.max(0, yi2 - yi1);
        const box1Area = (x2_1 - x1_1) * (y2_1 - y1_1);
        const box2Area = (x2_2 - x1_2) * (y2_2 - y1_2);
        const unionArea = box1Area + box2Area - interArea;
        
        row.push(unionArea > 0 ? interArea / unionArea : 0);
      }
      ious.push(row);
    }
    
    return ious;
  }

  /**
   * Joint two track lists
   */
  private jointStracks(tracks1: STrack[], tracks2: STrack[]): STrack[] {
    const exists = new Map<number, STrack>();
    const result: STrack[] = [];
    
    for (const track of tracks1) {
      exists.set(track.trackId, track);
      result.push(track);
    }
    
    for (const track of tracks2) {
      if (!exists.has(track.trackId)) {
        result.push(track);
      }
    }
    
    return result;
  }

  /**
   * Subtract tracks2 from tracks1
   */
  private subStracks(tracks1: STrack[], tracks2: STrack[]): STrack[] {
    const trackIds = new Set(tracks2.map(t => t.trackId));
    return tracks1.filter(t => !trackIds.has(t.trackId));
  }

  /**
   * Convert STrack to BoundingBox output
   */
  private convertToOutput(tracks: STrack[]): BoundingBox[] {
    return tracks.map(track => {
      const [x, y, w, h] = track.tlwh;
      const box: BoundingBox = {
        x,
        y,
        width: w,
        height: h,
        class: track.class,
        classId: 0, // person class
        confidence: track.score,
        trackId: `${track.trackId}`
      };
      
      // Preserve head center if available
      if (track.headCenterX !== undefined && track.headCenterY !== undefined) {
        box.headCenterX = track.headCenterX;
        box.headCenterY = track.headCenterY;
      }
      
      return box;
    });
  }

  /**
   * Reset tracker state
   */
  reset(): void {
    this.trackedStracks = [];
    this.lostStracks = [];
    this.removedStracks = [];
    this.frameId = 0;
    STrack.resetId();
  }
}