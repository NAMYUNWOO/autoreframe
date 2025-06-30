import { KalmanFilterNSA } from './kalman-filter-nsa';
import { Detection } from './types';

export enum TrackState {
  New = 0,
  Tracked = 1,
  Lost = 2,
  Removed = 3
}

export class STrack {
  private static _count = 0;
  
  trackId: number = 0;
  isActivated: boolean = false;
  state: TrackState = TrackState.New;
  
  score: number = 0;
  class: string = '';
  headCenterX?: number;
  headCenterY?: number;
  
  // Enhanced features for BoT-SORT
  features: number[] = [];  // Appearance features
  smoothFeatures: number[] = [];  // EMA of features
  featuresHistory: number[][] = [];  // Feature history
  alpha: number = 0.9;  // EMA alpha
  
  private _tlwh: number[] = [0, 0, 0, 0];
  private kalmanFilter: KalmanFilterNSA | null = null;
  
  mean: number[] = [];
  covariance: number[][] = [];
  
  frameId: number = 0;
  startFrame: number = 0;
  trackletLen: number = 0;
  
  constructor() {}
  
  static fromDetection(det: Detection, frameId: number): STrack {
    const track = new STrack();
    track._tlwh = STrack.tlbrToTlwh(det.bbox);
    track.score = det.score;
    track.class = det.class;
    track.headCenterX = det.headCenterX;
    track.headCenterY = det.headCenterY;
    track.frameId = frameId;
    track.startFrame = frameId;
    track.trackletLen = 0;
    
    // Initialize features if available
    if (det.features) {
      track.features = [...det.features];
      track.smoothFeatures = [...det.features];
      track.featuresHistory = [det.features];
    }
    
    return track;
  }
  
  /**
   * Activate a new track
   */
  activate(kalmanFilter: KalmanFilterNSA, frameId: number): void {
    this.kalmanFilter = kalmanFilter;
    this.trackId = this.nextId();
    
    const [mean, covariance] = this.kalmanFilter.initiate(this.tlwh);
    this.mean = mean;
    this.covariance = covariance;
    
    this.trackletLen = 0;
    this.state = TrackState.Tracked;
    // For sparse detection (every 5 frames), activate immediately
    // to avoid losing tracks between detections
    this.isActivated = true;
    this.frameId = frameId;
    this.startFrame = frameId;
  }
  
  /**
   * Reactivate a lost track
   */
  reActivate(det: Detection, frameId: number, newId: boolean = false): void {
    this._tlwh = STrack.tlbrToTlwh(det.bbox);
    this.score = det.score;
    this.class = det.class;
    this.headCenterX = det.headCenterX;
    this.headCenterY = det.headCenterY;
    this.trackletLen = 0;
    this.state = TrackState.Tracked;
    this.isActivated = true;
    this.frameId = frameId;
    
    if (newId) {
      this.trackId = this.nextId();
    }
    
    // Update with Kalman filter
    if (this.kalmanFilter) {
      const [mean, covariance] = this.kalmanFilter.update(
        this.mean,
        this.covariance,
        this._tlwh  // Use the new detection, not the old mean
      );
      this.mean = mean;
      this.covariance = covariance;
    }
    
    // Update features with EMA
    this.updateFeatures(det.features);
  }
  
  /**
   * Update track with new detection
   */
  update(det: Detection, frameId: number): void {
    this.frameId = frameId;
    this.trackletLen++;
    
    const oldTlwh = [...this._tlwh];
    this._tlwh = STrack.tlbrToTlwh(det.bbox);
    this.score = det.score;
    this.class = det.class;
    this.headCenterX = det.headCenterX;
    this.headCenterY = det.headCenterY;
    
    console.log(`[STrack] Track ${this.trackId} update at frame ${frameId}: old pos=[${oldTlwh.slice(0,2).map(n => n.toFixed(1))}], new detection=[${this._tlwh.slice(0,2).map(n => n.toFixed(1))}]`);
    
    // Update with Kalman filter
    if (this.kalmanFilter) {
      const beforeMean = [...this.mean];
      const [mean, covariance] = this.kalmanFilter.update(
        this.mean,
        this.covariance,
        this._tlwh  // Use the new detection, not the old mean
      );
      this.mean = mean;
      this.covariance = covariance;
      console.log(`[STrack] Track ${this.trackId} Kalman update: mean changed from [${beforeMean.slice(0,2).map(n => n.toFixed(1))}] to [${this.mean.slice(0,2).map(n => n.toFixed(1))}]`);
    }
    
    // Update features with EMA
    this.updateFeatures(det.features);
    
    this.state = TrackState.Tracked;
    this.isActivated = true;
  }
  
  /**
   * Update appearance features with exponential moving average
   */
  private updateFeatures(newFeatures?: number[]): void {
    if (!newFeatures || newFeatures.length === 0) return;
    
    if (this.smoothFeatures.length === 0) {
      this.smoothFeatures = [...newFeatures];
    } else {
      // EMA update: smooth_feat = alpha * smooth_feat + (1-alpha) * new_feat
      for (let i = 0; i < newFeatures.length; i++) {
        this.smoothFeatures[i] = this.alpha * this.smoothFeatures[i] + 
                                  (1 - this.alpha) * newFeatures[i];
      }
    }
    
    this.features = [...newFeatures];
    this.featuresHistory.push(newFeatures);
    
    // Keep only last 10 feature vectors
    if (this.featuresHistory.length > 10) {
      this.featuresHistory.shift();
    }
  }
  
  /**
   * Predict next state
   */
  predict(): void {
    const beforeVelocity = [this.mean[4], this.mean[5]];
    
    if (this.state !== TrackState.Tracked) {
      // For lost tracks, gradually reduce velocity instead of stopping immediately
      // This helps with occlusion scenarios
      const decayFactor = 0.9;  // Decay velocity by 10% each frame
      this.mean[4] *= decayFactor;  // Decay velocity in x
      this.mean[5] *= decayFactor;  // Decay velocity in y
      this.mean[6] *= decayFactor;  // Decay velocity in width
      this.mean[7] *= decayFactor;  // Decay velocity in height
      
      // Stop completely if velocity is very small
      if (Math.abs(this.mean[4]) < 0.5) this.mean[4] = 0;
      if (Math.abs(this.mean[5]) < 0.5) this.mean[5] = 0;
      
      console.log(`[STrack] Track ${this.trackId} is lost, decaying velocity to [${this.mean[4].toFixed(2)}, ${this.mean[5].toFixed(2)}]`);
    }
    
    if (this.kalmanFilter) {
      const beforePos = [this.mean[0], this.mean[1]];
      const [mean, covariance] = this.kalmanFilter.predict(this.mean, this.covariance);
      this.mean = mean;
      this.covariance = covariance;
      const afterPos = [this.mean[0], this.mean[1]];
      console.log(`[STrack] Track ${this.trackId} predict: pos [${beforePos.map(n => n.toFixed(1))}] -> [${afterPos.map(n => n.toFixed(1))}], vel=[${beforeVelocity.map(n => n.toFixed(2))}]`);
    }
  }
  
  /**
   * Apply camera motion compensation
   */
  applyCMC(warp: { a: number, b: number, tx: number, ty: number }): void {
    // Transform the track position using the warp matrix
    const cx = this.mean[0] + this.mean[2] / 2;
    const cy = this.mean[1] + this.mean[3] / 2;
    
    const newCx = warp.a * cx - warp.b * cy + warp.tx;
    const newCy = warp.b * cx + warp.a * cy + warp.ty;
    
    // Update position while keeping size the same
    this.mean[0] = newCx - this.mean[2] / 2;
    this.mean[1] = newCy - this.mean[3] / 2;
    
    // Also update velocity based on the rotation
    const vx = this.mean[4];
    const vy = this.mean[5];
    this.mean[4] = warp.a * vx - warp.b * vy;
    this.mean[5] = warp.b * vx + warp.a * vy;
  }
  
  /**
   * Multi-track camera motion compensation
   */
  static multiCMC(tracks: STrack[], warp: { a: number, b: number, tx: number, ty: number }): void {
    for (const track of tracks) {
      track.applyCMC(warp);
    }
  }
  
  markLost(): void {
    this.state = TrackState.Lost;
  }
  
  markRemoved(): void {
    this.state = TrackState.Removed;
  }
  
  get tlwh(): number[] {
    if (this.mean.length === 0) {
      console.log(`[STrack] Track ${this.trackId} tlwh: using _tlwh (no mean) = [${this._tlwh.map(n => n.toFixed(1))}]`);
      return [...this._tlwh];
    }
    
    const ret = [...this.mean.slice(0, 4)];
    ret[2] = Math.max(0, ret[2]);
    ret[3] = Math.max(0, ret[3]);
    // Only log for debugging specific issues
    if (this.trackId <= 5) { // Limit logging to first few tracks
      console.log(`[STrack] Track ${this.trackId} tlwh: using mean = [${ret.map(n => n.toFixed(1))}]`);
    }
    return ret;
  }
  
  get tlbr(): number[] {
    const [x, y, w, h] = this.tlwh;
    return [x, y, x + w, y + h];
  }
  
  static tlwhToTlbr(tlwh: number[]): number[] {
    const [x, y, w, h] = tlwh;
    return [x, y, x + w, y + h];
  }
  
  static tlbrToTlwh(tlbr: number[]): number[] {
    const [x1, y1, x2, y2] = tlbr;
    return [x1, y1, x2 - x1, y2 - y1];
  }
  
  static resetId(): void {
    STrack._count = 0;
  }
  
  private nextId(): number {
    STrack._count += 1;
    return STrack._count;
  }
  
  /**
   * Clone the track for interpolation
   */
  clone(): STrack {
    const cloned = new STrack();
    cloned.trackId = this.trackId;
    cloned.isActivated = this.isActivated;
    cloned.state = this.state;
    cloned.score = this.score;
    cloned.class = this.class;
    cloned.headCenterX = this.headCenterX;
    cloned.headCenterY = this.headCenterY;
    cloned._tlwh = [...this._tlwh];
    cloned.mean = [...this.mean];
    cloned.covariance = this.covariance.map(row => [...row]);
    cloned.frameId = this.frameId;
    cloned.startFrame = this.startFrame;
    cloned.trackletLen = this.trackletLen;
    cloned.kalmanFilter = this.kalmanFilter;
    cloned.features = [...this.features];
    cloned.smoothFeatures = [...this.smoothFeatures];
    return cloned;
  }
}