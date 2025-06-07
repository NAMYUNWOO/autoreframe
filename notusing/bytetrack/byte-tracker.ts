import { BoundingBox } from '@/types';
import { STrack, TrackState } from './strack';
import { KalmanFilter } from './kalman-filter';
import { iouDistance, fuseScore, linearAssignment } from './matching';

export interface ByteTrackerConfig {
  trackThresh: number;
  trackBuffer: number;
  matchThresh: number;
  frameRate: number;
  mot20?: boolean;
}

export class ByteTracker {
  private trackedStracks: STrack[] = [];
  private lostStracks: STrack[] = [];
  private removedStracks: STrack[] = [];
  private frameId: number = 0;
  private kalmanFilter: KalmanFilter;
  private detThresh: number;
  private maxTimeLost: number;
  private config: ByteTrackerConfig;

  constructor(config: ByteTrackerConfig) {
    this.config = config;
    this.detThresh = config.trackThresh; // Don't add 0.1 to avoid too high threshold
    this.maxTimeLost = Math.floor(config.frameRate / 30.0 * config.trackBuffer);
    this.kalmanFilter = new KalmanFilter();
  }

  /**
   * Update tracker with new detections
   */
  update(detections: BoundingBox[]): BoundingBox[] {
    this.frameId++;
    
    const activatedStracks: STrack[] = [];
    const refindStracks: STrack[] = [];
    const lostStracks: STrack[] = [];
    const removedStracks: STrack[] = [];

    // Convert detections to STrack format
    const scores = detections.map(d => d.confidence);
    
    // Split detections into high and low confidence
    const remainInds = scores.map((s, i) => ({ score: s, index: i }))
      .filter(item => item.score > this.config.trackThresh);
    const lowInds = scores.map((s, i) => ({ score: s, index: i }))
      .filter(item => item.score > 0.3 && item.score <= this.config.trackThresh); // Higher low threshold

    // High confidence detections
    const dets: STrack[] = remainInds.map(item => {
      const det = detections[item.index];
      return new STrack([det.x, det.y, det.width, det.height], item.score);
    });

    // Low confidence detections
    const detsSecond: STrack[] = lowInds.map(item => {
      const det = detections[item.index];
      return new STrack([det.x, det.y, det.width, det.height], item.score);
    });
    

    // Separate unconfirmed and tracked stracks
    const unconfirmed: STrack[] = [];
    const trackedStracks: STrack[] = [];
    
    for (const track of this.trackedStracks) {
      if (!track.isActivated) {
        unconfirmed.push(track);
      } else {
        trackedStracks.push(track);
      }
    }

    // Step 2: First association with high score detection boxes
    const strackPool = this.jointStracks(trackedStracks, this.lostStracks);
    
    // Predict current location with KF
    STrack.multiPredict(strackPool);
    
    let dists = iouDistance(strackPool, dets);
    if (!this.config.mot20) {
      dists = fuseScore(dists, dets);
    }
    
    const [matches, uTrack, uDetection] = linearAssignment(dists, this.config.matchThresh, dets.length);

    for (const [iTracked, iDet] of matches) {
      const track = strackPool[iTracked];
      const det = dets[iDet];
      
      if (track.state === TrackState.Tracked) {
        track.update(det, this.frameId);
        activatedStracks.push(track);
      } else {
        track.reActivate(det, this.frameId, false);
        refindStracks.push(track);
      }
    }

    // Step 3: Second association with low score detection boxes
    const rTrackedStracks = uTrack
      .map(i => strackPool[i])
      .filter(track => track.state === TrackState.Tracked);
    
    const dists2 = iouDistance(rTrackedStracks, detsSecond);
    const [matches2, uTrack2, uDetectionSecond] = linearAssignment(dists2, 0.5, detsSecond.length);

    for (const [iTracked, iDet] of matches2) {
      const track = rTrackedStracks[iTracked];
      const det = detsSecond[iDet];
      
      if (track.state === TrackState.Tracked) {
        track.update(det, this.frameId);
        activatedStracks.push(track);
      } else {
        track.reActivate(det, this.frameId, false);
        refindStracks.push(track);
      }
    }

    for (const it of uTrack2) {
      const track = rTrackedStracks[it];
      if (track.state !== TrackState.Lost) {
        track.markLost();
        lostStracks.push(track);
      }
    }

    // Deal with unconfirmed tracks
    const unconfirmedDets = uDetection.map(i => dets[i]);
    const dists3 = iouDistance(unconfirmed, unconfirmedDets);
    const fusedDists3 = this.config.mot20 ? dists3 : fuseScore(dists3, unconfirmedDets);
    const [matches3, uUnconfirmed, uDetection3] = linearAssignment(fusedDists3, 0.7, unconfirmedDets.length);

    for (const [iTracked, iDet] of matches3) {
      unconfirmed[iTracked].update(unconfirmedDets[iDet], this.frameId);
      activatedStracks.push(unconfirmed[iTracked]);
    }

    for (const it of uUnconfirmed) {
      const track = unconfirmed[it];
      track.markRemoved();
      removedStracks.push(track);
    }

    // Step 4: Init new stracks
    // Map uDetection3 indices back to original detection indices
    const unmatchedDetIndices = uDetection3.map(i => uDetection[i]);
    
    for (const detIdx of unmatchedDetIndices) {
      const track = dets[detIdx];
      if (track.score < this.detThresh) {
        continue;
      }
      track.activate(this.kalmanFilter, this.frameId);
      activatedStracks.push(track);
    }

    // Step 5: Update state
    for (const track of this.lostStracks) {
      if (this.frameId - track.endFrame > this.maxTimeLost) {
        track.markRemoved();
        removedStracks.push(track);
      }
    }

    // Update tracked stracks
    this.trackedStracks = this.trackedStracks.filter(t => t.state === TrackState.Tracked);
    this.trackedStracks = this.jointStracks(this.trackedStracks, activatedStracks);
    this.trackedStracks = this.jointStracks(this.trackedStracks, refindStracks);
    this.lostStracks = this.subStracks(this.lostStracks, this.trackedStracks);
    this.lostStracks.push(...lostStracks);
    this.lostStracks = this.subStracks(this.lostStracks, this.removedStracks);
    this.removedStracks.push(...removedStracks);
    
    // Remove duplicate stracks
    const [uniqueTracked, uniqueLost] = this.removeDuplicateStracks(this.trackedStracks, this.lostStracks);
    this.trackedStracks = uniqueTracked;
    this.lostStracks = uniqueLost;

    // Get output stracks
    const outputStracks = this.trackedStracks.filter(track => track.isActivated);

    // Convert back to BoundingBox format with track IDs
    const result = outputStracks.map(track => {
      const tlwh = track.tlwh;
      return {
        x: tlwh[0],
        y: tlwh[1],
        width: tlwh[2],
        height: tlwh[3],
        confidence: track.score,
        class: 'person',
        classId: 0,
        trackId: `track_${track.trackId}`
      };
    });
    
    return result;
  }

  /**
   * Join two lists of tracks
   */
  private jointStracks(tlista: STrack[], tlistb: STrack[]): STrack[] {
    const exists = new Map<number, boolean>();
    const res: STrack[] = [];
    
    for (const t of tlista) {
      exists.set(t.trackId, true);
      res.push(t);
    }
    
    for (const t of tlistb) {
      if (!exists.has(t.trackId)) {
        exists.set(t.trackId, true);
        res.push(t);
      }
    }
    
    return res;
  }

  /**
   * Subtract tlistb from tlista
   */
  private subStracks(tlista: STrack[], tlistb: STrack[]): STrack[] {
    const stracks = new Map<number, STrack>();
    
    for (const t of tlista) {
      stracks.set(t.trackId, t);
    }
    
    for (const t of tlistb) {
      stracks.delete(t.trackId);
    }
    
    return Array.from(stracks.values());
  }

  /**
   * Remove duplicate tracks based on IoU
   */
  private removeDuplicateStracks(stracksa: STrack[], stracksb: STrack[]): [STrack[], STrack[]] {
    const pdist = iouDistance(stracksa, stracksb);
    const dupa: number[] = [];
    const dupb: number[] = [];
    
    for (let i = 0; i < pdist.length; i++) {
      for (let j = 0; j < pdist[i].length; j++) {
        if (pdist[i][j] < 0.15) {
          const timep = stracksa[i].frameId - stracksa[i].startFrame;
          const timeq = stracksb[j].frameId - stracksb[j].startFrame;
          
          if (timep > timeq) {
            dupb.push(j);
          } else {
            dupa.push(i);
          }
        }
      }
    }
    
    const resa = stracksa.filter((_, i) => !dupa.includes(i));
    const resb = stracksb.filter((_, i) => !dupb.includes(i));
    
    return [resa, resb];
  }

  /**
   * Reset the tracker
   */
  reset(): void {
    this.trackedStracks = [];
    this.lostStracks = [];
    this.removedStracks = [];
    this.frameId = 0;
  }

  dispose(): void {
    this.kalmanFilter.dispose();
  }
}