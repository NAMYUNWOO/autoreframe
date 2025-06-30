import { KalmanFilterNSA } from './kalman-filter-nsa';
import { 
  iouDistance, 
  embeddingDistance, 
  fuseDistance, 
  fuseScore,
  linearAssignment,
  gateCostMatrix
} from './matching';
import { STrack, TrackState } from './strack';
import { BoundingBox } from '@/types';
import { TrackParams, Detection } from './types';
import { CameraMotionCompensation } from './camera-motion-compensation';
import { detectionConfig } from '@/config/detection';

export class BotSort {
  private trackedStracks: STrack[] = [];
  private lostStracks: STrack[] = [];
  private removedStracks: STrack[] = [];
  private frameId: number = 0;
  private detFrameId: number = 0; // Actual frame number for detections
  private kalmanFilter: KalmanFilterNSA;
  private params: TrackParams;
  private cmc: CameraMotionCompensation | null = null;
  
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
      maxTimeLost: params.maxTimeLost ?? detectionConfig.byteTracker.maxTimeLost,
      // BoT-SORT specific defaults
      cmcMethod: params.cmcMethod ?? 'sparse',
      useCMC: params.useCMC ?? true,
      useAppearance: params.useAppearance ?? false,  // Disabled by default for browser performance
      appearanceThresh: params.appearanceThresh ?? 0.5,
      proximityThresh: params.proximityThresh ?? 0.5,
      fusionAlpha: params.fusionAlpha ?? 0.7  // 0.7 weight for IoU, 0.3 for appearance
    };
    
    this.kalmanFilter = new KalmanFilterNSA();
    
    // Initialize camera motion compensation if enabled
    if (this.params.useCMC && this.params.cmcMethod !== 'none') {
      this.cmc = new CameraMotionCompensation();
    }
    
    STrack.resetId();
  }
  
  /**
   * Update tracker with new detections
   */
  async update(
    boxes: BoundingBox[], 
    frameNumber: number,
    frameImage?: ImageData
  ): Promise<BoundingBox[]> {
    this.frameId++;
    this.detFrameId = frameNumber; // Store actual frame number
    
    console.log(`\n[BoT-SORT] Frame ${frameNumber}: ${boxes.length} detections`);
    
    // Convert BoundingBox to Detection format
    const detections: Detection[] = boxes.map(box => ({
      bbox: [box.x, box.y, box.x + box.width, box.y + box.height],
      score: box.confidence,
      class: box.class,
      headCenterX: box.headCenterX,
      headCenterY: box.headCenterY,
      features: box.features
    }));
    
    // Apply camera motion compensation
    let warp = { a: 1, b: 0, tx: 0, ty: 0 };
    if (this.params.useCMC && this.cmc && frameImage) {
      warp = await this.cmc.apply(frameImage);
      
      // Apply compensation to all existing tracks
      const allTracks = [...this.trackedStracks, ...this.lostStracks];
      STrack.multiCMC(allTracks, warp);
    }
    
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
    
    console.log(`[BoT-SORT] Tracked: ${trackedStracks.length}, Lost: ${this.lostStracks.length}`);
    
    // Multi-step prediction for frame gaps (important for 5-frame sampling)
    for (const track of strackPool) {
      // Use detFrameId instead of internal frameId for accurate frame difference
      const frameDiff = this.detFrameId - track.frameId;
      if (frameDiff > 0) {
        console.log(`[BoT-SORT] Track ${track.trackId}: predicting ${frameDiff} steps (last seen: ${track.frameId})`);
        const beforePos = [...track.tlwh];
        // Predict for each skipped frame
        for (let i = 0; i < frameDiff; i++) {
          track.predict();
        }
        const afterPos = [...track.tlwh];
        console.log(`[BoT-SORT] Track ${track.trackId}: moved from [${beforePos.slice(0,2).map(n => n.toFixed(1))}] to [${afterPos.slice(0,2).map(n => n.toFixed(1))}]`);
      }
    }
    
    /** Step 2: First association with high score detection boxes */
    let matches: Array<[number, number]> = [];
    let uTrackIdx: number[] = [];
    let uDetIdx: number[] = [];
    
    if (strackPool.length > 0 && highDetections.length > 0) {
      // Compute distances
      const iouDists = iouDistance(strackPool, highDetections);
      let dists = iouDists;
      
      // Fuse with appearance features if enabled
      if (this.params.useAppearance) {
        const embDists = embeddingDistance(strackPool, highDetections);
        dists = fuseDistance(iouDists, embDists, this.params.fusionAlpha);
      }
      
      // Fuse with detection scores
      dists = fuseScore(dists, highDetections);
      
      // Gate cost matrix by proximity
      dists = gateCostMatrix(dists, strackPool, highDetections, this.params.proximityThresh);
      
      [matches, uTrackIdx, uDetIdx] = linearAssignment(dists, this.params.matchThresh);
      
      console.log(`[BoT-SORT] Step 2 matches: ${matches.length}`);
      
      for (const [itrack, idet] of matches) {
        const track = strackPool[itrack];
        const det = highDetections[idet];
        
        console.log(`[BoT-SORT] Matched track ${track.trackId} with detection at [${det.bbox.slice(0,2).map(n => n.toFixed(1))}]`);
        
        if (track.state === TrackState.Tracked) {
          track.update(det, this.detFrameId);
          activatedStracks.push(track);
        } else {
          track.reActivate(det, this.detFrameId);
          refindStracks.push(track);
        }
      }
    } else {
      uTrackIdx = Array.from({ length: strackPool.length }, (_, i) => i);
      uDetIdx = Array.from({ length: highDetections.length }, (_, i) => i);
    }
    
    /** Step 3: Second association with low score detection boxes (motion only) */
    const remainingTrackedIdx = uTrackIdx.filter(i => strackPool[i].state === TrackState.Tracked);
    const remainingTracks = remainingTrackedIdx.map(i => strackPool[i]);
    
    if (remainingTracks.length > 0 && lowDetections.length > 0) {
      const dists = iouDistance(remainingTracks, lowDetections);
      const [matches2, uTrackIdx2, _] = linearAssignment(dists, this.params.secondMatchThresh ?? 0.5);
      
      for (const [itrack, idet] of matches2) {
        const track = remainingTracks[itrack];
        const det = lowDetections[idet];
        track.update(det, this.detFrameId);
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
      const iouDists = iouDistance(unconfirmedStracks, remainingHighDets);
      let dists = iouDists;
      
      // Only use IoU for unconfirmed tracks
      const [matches3, uUnconfirmedIdx, uDetIdx3] = linearAssignment(
        dists, 
        this.params.unconfirmedMatchThresh ?? 0.7
      );
      
      for (const [itrack, idet] of matches3) {
        const track = unconfirmedStracks[itrack];
        const det = remainingHighDets[idet];
        track.update(det, this.detFrameId);
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
    
    /** Step 5: Try to match with lost tracks (important for 5-frame sampling) */
    const remainingHighDets2 = uDetIdx.map(i => highDetections[i]);
    
    if (this.lostStracks.length > 0 && remainingHighDets2.length > 0) {
      // Lost tracks were already predicted in Step 1
      const dists = iouDistance(this.lostStracks, remainingHighDets2);
      
      // Adaptive threshold based on how long the track has been lost
      // Recently lost tracks get more lenient threshold for occlusion handling
      const adaptiveMatches: Array<[number, number]> = [];
      
      for (let i = 0; i < this.lostStracks.length; i++) {
        const track = this.lostStracks[i];
        const framesLost = this.detFrameId - track.frameId;
        
        // More lenient threshold for recently lost tracks (occlusion)
        // Stricter threshold for long-lost tracks (prevent wrong associations)
        let adaptiveThresh: number;
        if (framesLost <= 10) {
          adaptiveThresh = 0.7;  // Recent occlusion - more lenient
        } else if (framesLost <= 20) {
          adaptiveThresh = 0.5;  // Medium duration
        } else {
          adaptiveThresh = 0.3;  // Long lost - very strict
        }
        
        for (let j = 0; j < remainingHighDets2.length; j++) {
          if (dists[i][j] < adaptiveThresh) {
            adaptiveMatches.push([i, j]);
            break;  // One detection per track
          }
        }
      }
      
      // Process matches
      const matchedDetIdx = new Set<number>();
      for (const [itrack, idet] of adaptiveMatches) {
        if (!matchedDetIdx.has(idet)) {
          const track = this.lostStracks[itrack];
          const det = remainingHighDets2[idet];
          track.reActivate(det, this.detFrameId);
          refindStracks.push(track);
          matchedDetIdx.add(idet);
        }
      }
      
      // Update remaining detections
      uDetIdx = uDetIdx.filter((_, idx) => !matchedDetIdx.has(idx));
    }
    
    /** Step 6: Init new tracks */
    console.log(`[BoT-SORT] Unmatched detections: ${uDetIdx.length}`);
    for (const idx of uDetIdx) {
      const det = highDetections[idx];
      if (det.score < this.params.trackThresh) continue;
      
      const track = STrack.fromDetection(det, this.detFrameId);
      track.activate(this.kalmanFilter, this.detFrameId);
      activatedStracks.push(track);
      console.log(`[BoT-SORT] Created new track ${track.trackId} at [${det.bbox.slice(0,2).map(n => n.toFixed(1))}]`);
    }
    
    /** Step 7: Update state */
    // Remove timeout lost tracks
    for (const track of this.lostStracks) {
      if (this.detFrameId - track.frameId > (this.params.maxTimeLost ?? 30)) {
        track.markRemoved();
        removedStracks.push(track);
      }
    }
    
    // Update tracked list
    this.trackedStracks = [
      ...activatedStracks,
      ...refindStracks
    ].filter(t => t.state === TrackState.Tracked);
    
    // Update lost list (remove reactivated tracks)
    this.lostStracks = this.subStracks(
      [...this.lostStracks, ...lostStracks],
      [...this.trackedStracks, ...removedStracks, ...refindStracks]
    );
    
    // Update removed list
    this.removedStracks = [...this.removedStracks, ...removedStracks];
    
    // Remove duplicate tracks
    [this.trackedStracks, this.lostStracks] = this.removeDuplicateStracks(
      this.trackedStracks, 
      this.lostStracks
    );
    
    // Return all tracked stracks (not just activated ones)
    // This is how original BoT-SORT works
    const outputStracks = this.trackedStracks;
    
    console.log(`[BoT-SORT] Returning ${outputStracks.length} tracks`);
    for (const track of outputStracks) {
      console.log(`[BoT-SORT] Output track ${track.trackId}: pos=[${track.tlwh.slice(0,2).map(n => n.toFixed(1))}], state=${TrackState[track.state]}`);
    }
    
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
        const frameDiff = this.detFrameId - track.frameId;
        
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
    this.detFrameId = 0;
    if (this.cmc) {
      this.cmc.reset();
    }
    STrack.resetId();
  }
}