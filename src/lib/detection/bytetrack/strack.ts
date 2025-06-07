import { KalmanFilter } from './kalman-filter';

export enum TrackState {
  New = 0,
  Tracked = 1,
  Lost = 2,
  Removed = 3
}

let trackIdCounter = 1; // Start from 1 for clearer IDs

export class STrack {
  private static sharedKalman = new KalmanFilter();
  
  public trackId: number = -1;
  public state: TrackState = TrackState.New;
  public isActivated: boolean = false;
  public score: number;
  public frameId: number = -1;
  public startFrame: number = -1;
  public trackletLen: number = 0;
  
  private _tlwh: Float32Array;
  public mean: Float32Array | null = null;
  public covariance: Float32Array | null = null;
  private kalmanFilter: KalmanFilter | null = null;

  constructor(tlwh: number[], score: number) {
    this._tlwh = new Float32Array(tlwh);
    this.score = score;
  }

  /**
   * Get current position in format (top left x, top left y, width, height)
   */
  get tlwh(): Float32Array {
    if (this.mean === null) {
      return this._tlwh.slice();
    }
    const ret = this.mean.slice(0, 4);
    ret[2] *= ret[3]; // width = aspect_ratio * height
    ret[0] -= ret[2] / 2; // x = center_x - width/2
    ret[1] -= ret[3] / 2; // y = center_y - height/2
    return ret;
  }

  /**
   * Get bounding box in format (min x, min y, max x, max y)
   */
  get tlbr(): Float32Array {
    const ret = this.tlwh;
    ret[2] += ret[0]; // max_x = x + width
    ret[3] += ret[1]; // max_y = y + height
    return ret;
  }

  /**
   * Convert tlwh to xyah format (center x, center y, aspect ratio, height)
   */
  static tlwhToXyah(tlwh: Float32Array): number[] {
    const ret = Array.from(tlwh);
    ret[0] += ret[2] / 2; // center_x = x + width/2
    ret[1] += ret[3] / 2; // center_y = y + height/2
    ret[2] /= ret[3]; // aspect_ratio = width/height
    return ret;
  }

  /**
   * Convert tlbr to tlwh format
   */
  static tlbrToTlwh(tlbr: number[]): number[] {
    const ret = [...tlbr];
    ret[2] -= ret[0]; // width = max_x - min_x
    ret[3] -= ret[1]; // height = max_y - min_y
    return ret;
  }

  /**
   * Predict state for next frame
   */
  predict(): void {
    if (this.state !== TrackState.Tracked) {
      this.mean![7] = 0; // Reset velocity if not tracked
    }
    const [newMean, newCov] = this.kalmanFilter!.predict(this.mean!, this.covariance!);
    this.mean = newMean;
    this.covariance = newCov;
  }

  /**
   * Multi-track prediction
   */
  static multiPredict(tracks: STrack[]): void {
    if (tracks.length === 0) return;
    
    for (const track of tracks) {
      track.predict();
    }
  }

  /**
   * Start a new tracklet
   */
  activate(kalmanFilter: KalmanFilter, frameId: number): void {
    this.kalmanFilter = kalmanFilter;
    this.trackId = trackIdCounter++;
    const xyah = STrack.tlwhToXyah(this._tlwh);
    const [mean, covariance] = this.kalmanFilter.initiate(xyah);
    this.mean = mean;
    this.covariance = covariance;
    
    this.trackletLen = 0;
    this.state = TrackState.Tracked;
    // Always activate immediately for browser environment
    this.isActivated = true;
    this.frameId = frameId;
    this.startFrame = frameId;
  }

  /**
   * Re-activate a track
   */
  reActivate(newTrack: STrack, frameId: number, newId: boolean = false): void {
    const xyah = STrack.tlwhToXyah(newTrack.tlwh);
    const [newMean, newCov] = this.kalmanFilter!.update(this.mean!, this.covariance!, xyah);
    this.mean = newMean;
    this.covariance = newCov;
    
    this.trackletLen = 0;
    this.state = TrackState.Tracked;
    this.isActivated = true;
    this.frameId = frameId;
    if (newId) {
      this.trackId = trackIdCounter++;
    }
    this.score = newTrack.score;
  }

  /**
   * Update a matched track
   */
  update(newTrack: STrack, frameId: number): void {
    this.frameId = frameId;
    this.trackletLen += 1;
    
    const newTlwh = newTrack.tlwh;
    const xyah = STrack.tlwhToXyah(newTlwh);
    const [newMean, newCov] = this.kalmanFilter!.update(this.mean!, this.covariance!, xyah);
    this.mean = newMean;
    this.covariance = newCov;
    
    this.state = TrackState.Tracked;
    this.isActivated = true;
    this.score = newTrack.score;
  }

  /**
   * Mark track as lost
   */
  markLost(): void {
    this.state = TrackState.Lost;
  }

  /**
   * Mark track as removed
   */
  markRemoved(): void {
    this.state = TrackState.Removed;
  }

  get endFrame(): number {
    return this.frameId;
  }

  /**
   * Get shared Kalman filter instance
   */
  static getSharedKalman(): KalmanFilter {
    return STrack.sharedKalman;
  }
}