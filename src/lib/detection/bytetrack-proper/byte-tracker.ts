import { KalmanFilter } from './kalman-filter';
import { iouDistance, linearAssignment } from './matching';
import { STrack, TrackState } from './strack';
import { BoundingBox } from '@/types';
import { TrackParams, Detection } from './types';
import { detectionConfig } from '@/config/detection';

export class ByteTracker {
  private trackedStracks: STrack[] = [];
  private lostStracks: STrack[] = [];
  private removedStracks: STrack[] = [];
  private frameId: number = 0;
  private detectionFrameId: number = 0; // Actual frame number when detection runs
  private kalmanFilter: KalmanFilter;
  private params: TrackParams;
  private sampleInterval: number = 5; // We detect every 5 frames
  
  constructor(params: Partial<TrackParams> = {}) {
    // Use config values as defaults, allow override via params
    this.params = {
      trackThresh: params.trackThresh ?? detectionConfig.byteTracker.trackThresh,
      trackBuffer: params.trackBuffer ?? detectionConfig.byteTracker.trackBuffer,
      matchThresh: params.matchThresh ?? detectionConfig.byteTracker.matchThresh,
      minBoxArea: params.minBoxArea ?? detectionConfig.byteTracker.minBoxArea,
      lowThresh: params.lowThresh ?? detectionConfig.byteTracker.lowThresh,
      secondMatchThresh: params.secondMatchThresh ?? detectionConfig.byteTracker.secondMatchThresh,
      unconfirmedMatchThresh: params.unconfirmedMatchThresh ?? detectionConfig.byteTracker.unconfirmedMatchThresh,
      maxTimeLost: params.maxTimeLost ?? detectionConfig.byteTracker.maxTimeLost
    };
    
    this.sampleInterval = detectionConfig.sampleInterval;
    
    this.kalmanFilter = new KalmanFilter();
    STrack.resetId();
  }
  
  /**
   * Update tracker with new detections
   * @param boxes Detection boxes from YOLO
   * @param frameNumber Actual frame number in video
   * @returns Tracked boxes with IDs
   */
  update(boxes: BoundingBox[], frameNumber: number): BoundingBox[] {
    this.frameId++;
    this.detectionFrameId = frameNumber;
    
    // Convert BoundingBox to Detection format
    const detections: Detection[] = boxes.map(box => ({
      bbox: [box.x, box.y, box.x + box.width, box.y + box.height],
      score: box.confidence,
      class: box.class,
      headCenterX: box.headCenterX,
      headCenterY: box.headCenterY
    }));
    
    // Separate high and low confidence detections
    const highDetections = detections.filter(d => d.score >= this.params.trackThresh);
    const lowDetections = detections.filter(d => 
      d.score >= this.params.lowThresh && d.score < this.params.trackThresh
    );
    
    // Lists to store results
    const activatedStracks: STrack[] = [];
    const refindStracks: STrack[] = [];
    const lostStracks: STrack[] = [];
    const removedStracks: STrack[] = [];
    
    // Separate confirmed and unconfirmed tracks
    const unconfirmedStracks: STrack[] = [];
    const trackedStracks: STrack[] = [];
    
    for (const track of this.trackedStracks) {
      if (!track.isActivated) {
        unconfirmedStracks.push(track);
      } else {
        trackedStracks.push(track);
      }
    }
    
    /** Step 1: Predict current location of tracks */
    const strackPool = [...trackedStracks, ...this.lostStracks];
    
    // Multi-step prediction for 5-frame interval
    for (const track of strackPool) {
      const frameDiff = frameNumber - track.frameId;
      // Predict multiple steps if we haven't seen this track for several frames
      for (let i = 0; i < frameDiff; i++) {
        track.predict();
      }
    }
    
    /** Step 2: First association with high score detection boxes */
    let matches: Array<[number, number]> = [];
    let uTrackIdx: number[] = [];
    let uDetIdx: number[] = [];
    
    if (strackPool.length > 0 && highDetections.length > 0) {
      const dists = iouDistance(strackPool, highDetections);
      [matches, uTrackIdx, uDetIdx] = linearAssignment(dists, this.params.matchThresh);
      
      for (const [itrack, idet] of matches) {
        const track = strackPool[itrack];
        const det = highDetections[idet];
        
        if (track.state === TrackState.Tracked) {
          track.update(det, frameNumber);
          activatedStracks.push(track);
        } else {
          track.reActivate(det, frameNumber);
          refindStracks.push(track);
        }
      }
    } else {
      uTrackIdx = Array.from({ length: strackPool.length }, (_, i) => i);
      uDetIdx = Array.from({ length: highDetections.length }, (_, i) => i);
    }
    
    /** Step 3: Second association with low score detection boxes */
    const remainingTrackedIdx = uTrackIdx.filter(i => strackPool[i].state === TrackState.Tracked);
    const remainingTracks = remainingTrackedIdx.map(i => strackPool[i]);
    
    if (remainingTracks.length > 0 && lowDetections.length > 0) {
      const dists = iouDistance(remainingTracks, lowDetections);
      const [matches2, uTrackIdx2, _] = linearAssignment(dists, this.params.secondMatchThresh ?? 0.5);
      
      for (const [itrack, idet] of matches2) {
        const track = remainingTracks[itrack];
        const det = lowDetections[idet];
        track.update(det, frameNumber);
        activatedStracks.push(track);
      }
      
      // Mark unmatched tracks as lost
      for (let i = 0; i < remainingTracks.length; i++) {
        if (!matches2.some(m => m[0] === i)) {
          const track = remainingTracks[i];
          track.markLost();
          lostStracks.push(track);
        }
      }
    } else {
      // All unmatched tracked become lost
      for (const idx of remainingTrackedIdx) {
        const track = strackPool[idx];
        track.markLost();
        lostStracks.push(track);
      }
    }
    
    /** Step 4: Deal with unconfirmed tracks */
    const remainingHighDets = uDetIdx.map(i => highDetections[i]);
    
    if (unconfirmedStracks.length > 0 && remainingHighDets.length > 0) {
      const dists = iouDistance(unconfirmedStracks, remainingHighDets);
      const [matches3, uUnconfirmedIdx, uDetIdx3] = linearAssignment(
        dists, 
        this.params.unconfirmedMatchThresh ?? 0.7
      );
      
      for (const [itrack, idet] of matches3) {
        const track = unconfirmedStracks[itrack];
        const det = remainingHighDets[idet];
        track.update(det, frameNumber);
        activatedStracks.push(track);
      }
      
      // Remove unmatched unconfirmed tracks
      for (const idx of uUnconfirmedIdx) {
        const track = unconfirmedStracks[idx];
        track.markRemoved();
        removedStracks.push(track);
      }
      
      // Update remaining detection indices
      uDetIdx = uDetIdx3.map(i => uDetIdx[i]);
    }
    
    /** Step 5: Try to associate with lost tracks before creating new ones */
    const remainingHighDets2 = uDetIdx.map(i => highDetections[i]);
    const allLostTracks = [...this.lostStracks, ...this.removedStracks];
    
    if (allLostTracks.length > 0 && remainingHighDets2.length > 0) {
      // Very lenient threshold for lost track association
      const dists = iouDistance(allLostTracks, remainingHighDets2);
      const [matches4, uLostIdx, uDetIdx4] = linearAssignment(dists, 0.9); // Very lenient
      
      for (const [itrack, idet] of matches4) {
        const track = allLostTracks[itrack];
        const det = remainingHighDets2[idet];
        track.reActivate(det, frameNumber);
        refindStracks.push(track);
        
        // Remove from lost/removed lists
        this.lostStracks = this.lostStracks.filter(t => t.trackId !== track.trackId);
        this.removedStracks = this.removedStracks.filter(t => t.trackId !== track.trackId);
      }
      
      // Update remaining detections
      uDetIdx = uDetIdx4.map(i => uDetIdx[i]);
    }
    
    /** Step 6: Init new tracks only for truly unmatched detections */
    for (const idx of uDetIdx) {
      const det = highDetections[idx];
      if (det.score < this.params.trackThresh) continue;
      
      const track = STrack.fromDetection(det, frameNumber);
      track.activate(this.kalmanFilter, frameNumber);
      activatedStracks.push(track);
    }
    
    /** Step 7: Update state */
    // Remove timeout lost tracks
    for (const track of this.lostStracks) {
      if (frameNumber - track.frameId > (this.params.maxTimeLost ?? 30)) {
        track.markRemoved();
        removedStracks.push(track);
      }
    }
    
    // Update tracked list
    this.trackedStracks = [
      ...activatedStracks,
      ...refindStracks
    ].filter(t => t.state === TrackState.Tracked);
    
    // Update lost list
    this.lostStracks = this.subStracks(
      [...this.lostStracks, ...lostStracks],
      [...this.trackedStracks, ...removedStracks]
    );
    
    // Update removed list
    this.removedStracks = [...this.removedStracks, ...removedStracks];
    
    // Remove duplicate tracks
    [this.trackedStracks, this.lostStracks] = this.removeDuplicateStracks(
      this.trackedStracks, 
      this.lostStracks
    );
    
    // Filter activated tracks
    const outputStracks = this.trackedStracks.filter(t => t.isActivated);
    
    return this.convertToOutput(outputStracks);
  }
  
  /**
   * Get interpolated positions for all frames
   */
  getInterpolatedTracks(frameNumber: number): BoundingBox[] {
    const allTracks = [...this.trackedStracks, ...this.lostStracks];
    const outputBoxes: BoundingBox[] = [];
    
    for (const track of allTracks) {
      if (track.frameId <= frameNumber && track.startFrame <= frameNumber) {
        // Predict to current frame
        const tempTrack = track.clone();
        const frameDiff = frameNumber - track.frameId;
        
        for (let i = 0; i < frameDiff; i++) {
          tempTrack.predict();
        }
        
        const box = this.convertTrackToBox(tempTrack);
        if (box) outputBoxes.push(box);
      }
    }
    
    return outputBoxes;
  }
  
  private subStracks(tlista: STrack[], tlistb: STrack[]): STrack[] {
    const trackIds = new Set(tlistb.map(t => t.trackId));
    return tlista.filter(t => !trackIds.has(t.trackId));
  }
  
  private removeDuplicateStracks(tracksa: STrack[], tracksb: STrack[]): [STrack[], STrack[]] {
    const pdist = this.calcIoUs(tracksa, tracksb);
    const pairs: Array<[number, number]> = [];
    
    for (let i = 0; i < pdist.length; i++) {
      for (let j = 0; j < pdist[i].length; j++) {
        if (pdist[i][j] < 0.15) {
          pairs.push([i, j]);
        }
      }
    }
    
    const dupa: number[] = [];
    const dupb: number[] = [];
    
    for (const [a, b] of pairs) {
      const timep = tracksa[a].frameId - tracksa[a].startFrame;
      const timeq = tracksb[b].frameId - tracksb[b].startFrame;
      
      if (timep > timeq) {
        dupb.push(b);
      } else {
        dupa.push(a);
      }
    }
    
    const resa = tracksa.filter((_, i) => !dupa.includes(i));
    const resb = tracksb.filter((_, i) => !dupb.includes(i));
    
    return [resa, resb];
  }
  
  private calcIoUs(tracksa: STrack[], tracksb: STrack[]): number[][] {
    const ious: number[][] = [];
    
    for (const ta of tracksa) {
      const row: number[] = [];
      const [x1a, y1a, x2a, y2a] = ta.tlbr;
      
      for (const tb of tracksb) {
        const [x1b, y1b, x2b, y2b] = tb.tlbr;
        
        const xi1 = Math.max(x1a, x1b);
        const yi1 = Math.max(y1a, y1b);
        const xi2 = Math.min(x2a, x2b);
        const yi2 = Math.min(y2a, y2b);
        
        const interArea = Math.max(0, xi2 - xi1) * Math.max(0, yi2 - yi1);
        const boxaArea = (x2a - x1a) * (y2a - y1a);
        const boxbArea = (x2b - x1b) * (y2b - y1b);
        const unionArea = boxaArea + boxbArea - interArea;
        
        const iou = unionArea > 0 ? 1 - interArea / unionArea : 1;
        row.push(iou);
      }
      ious.push(row);
    }
    
    return ious;
  }
  
  private convertTrackToBox(track: STrack): BoundingBox | null {
    const [x, y, w, h] = track.tlwh;
    
    if (w <= 0 || h <= 0) return null;
    
    return {
      x,
      y,
      width: w,
      height: h,
      class: track.class,
      classId: 0,
      confidence: track.score,
      trackId: String(track.trackId),
      headCenterX: track.headCenterX,
      headCenterY: track.headCenterY
    };
  }
  
  private convertToOutput(tracks: STrack[]): BoundingBox[] {
    return tracks
      .map(track => this.convertTrackToBox(track))
      .filter((box): box is BoundingBox => box !== null);
  }
  
  reset(): void {
    this.trackedStracks = [];
    this.lostStracks = [];
    this.removedStracks = [];
    this.frameId = 0;
    this.detectionFrameId = 0;
    STrack.resetId();
  }
}