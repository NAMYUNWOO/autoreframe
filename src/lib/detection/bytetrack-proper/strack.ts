import { KalmanFilter } from './kalman-filter';
import { Detection } from './types';

export enum TrackState {
  New = 0,
  Tracked = 1,
  Lost = 2,
  Removed = 3
}

export class STrack {
  private static _count = 0;
  
  trackId: number;
  isActivated: boolean = false;
  state: TrackState = TrackState.New;
  
  private _tlwh: number[] = [0, 0, 0, 0];
  private kalmanFilter: KalmanFilter | null = null;
  mean: number[] | null = null;
  covariance: number[][] | null = null;
  
  score: number = 0;
  frameId: number = 0;
  startFrame: number = 0;
  trackletLen: number = 0;
  
  // Additional properties
  class: string = 'person';
  headCenterX?: number;
  headCenterY?: number;
  
  constructor(tlwh: number[], score: number) {
    this._tlwh = [...tlwh];
    this.score = score;
  }
  
  static fromDetection(det: Detection, frameId: number): STrack {
    // Convert tlbr to tlwh
    const [x1, y1, x2, y2] = det.bbox;
    const tlwh = [x1, y1, x2 - x1, y2 - y1];
    
    const track = new STrack(tlwh, det.score);
    track.class = det.class || 'person';
    track.headCenterX = det.headCenterX;
    track.headCenterY = det.headCenterY;
    track.frameId = frameId;
    
    return track;
  }
  
  static resetId(): void {
    STrack._count = 0;
  }
  
  private static nextId(): number {
    STrack._count += 1;
    return STrack._count;
  }
  
  activate(kalmanFilter: KalmanFilter, frameId: number): void {
    this.kalmanFilter = kalmanFilter;
    this.trackId = STrack.nextId();
    
    const measurement = this.tlwhToXyah(this._tlwh);
    [this.mean, this.covariance] = this.kalmanFilter.initiate(measurement);
    
    this.trackletLen = 0;
    this.state = TrackState.Tracked;
    
    // Always activate for our use case (5-frame sampling)
    this.isActivated = true;
    
    this.frameId = frameId;
    this.startFrame = frameId;
  }
  
  reActivate(det: Detection, frameId: number, newId: boolean = false): void {
    const [x1, y1, x2, y2] = det.bbox;
    const tlwh = [x1, y1, x2 - x1, y2 - y1];
    
    const measurement = this.tlwhToXyah(tlwh);
    [this.mean, this.covariance] = this.kalmanFilter!.update(
      this.mean!,
      this.covariance!,
      measurement
    );
    
    this.trackletLen = 0;
    this.state = TrackState.Tracked;
    this.isActivated = true;
    this.frameId = frameId;
    
    if (newId) {
      this.trackId = STrack.nextId();
    }
    
    this.score = det.score;
    this._tlwh = tlwh;
    this.headCenterX = det.headCenterX;
    this.headCenterY = det.headCenterY;
  }
  
  update(det: Detection, frameId: number): void {
    this.frameId = frameId;
    this.trackletLen += 1;
    
    const [x1, y1, x2, y2] = det.bbox;
    const tlwh = [x1, y1, x2 - x1, y2 - y1];
    
    const measurement = this.tlwhToXyah(tlwh);
    [this.mean, this.covariance] = this.kalmanFilter!.update(
      this.mean!,
      this.covariance!,
      measurement
    );
    
    this.state = TrackState.Tracked;
    this.isActivated = true;
    this.score = det.score;
    this._tlwh = tlwh;
    this.headCenterX = det.headCenterX;
    this.headCenterY = det.headCenterY;
  }
  
  predict(): void {
    if (!this.mean || !this.covariance || !this.kalmanFilter) return;
    
    const meanState = [...this.mean];
    if (this.state !== TrackState.Tracked) {
      meanState[7] = 0; // Zero velocity when not tracked
    }
    
    [this.mean, this.covariance] = this.kalmanFilter.predict(
      meanState,
      this.covariance
    );
  }
  
  markLost(): void {
    this.state = TrackState.Lost;
  }
  
  markRemoved(): void {
    this.state = TrackState.Removed;
  }
  
  get tlwh(): number[] {
    if (!this.mean) {
      return [...this._tlwh];
    }
    
    const ret = this.mean.slice(0, 4);
    ret[2] *= ret[3]; // width = aspect_ratio * height
    ret[0] -= ret[2] / 2; // x = center_x - width/2
    ret[1] -= ret[3] / 2; // y = center_y - height/2
    
    return ret;
  }
  
  get tlbr(): number[] {
    const ret = this.tlwh;
    ret[2] += ret[0]; // x2 = x1 + width
    ret[3] += ret[1]; // y2 = y1 + height
    return ret;
  }
  
  private tlwhToXyah(tlwh: number[]): number[] {
    const ret = [...tlwh];
    ret[0] += ret[2] / 2; // center_x = x + width/2
    ret[1] += ret[3] / 2; // center_y = y + height/2
    ret[2] /= ret[3]; // aspect_ratio = width/height
    // ret[3] is height
    return ret;
  }
  
  clone(): STrack {
    const cloned = new STrack(this._tlwh, this.score);
    cloned.trackId = this.trackId;
    cloned.isActivated = this.isActivated;
    cloned.state = this.state;
    cloned.kalmanFilter = this.kalmanFilter;
    cloned.mean = this.mean ? [...this.mean] : null;
    cloned.covariance = this.covariance ? this.covariance.map(row => [...row]) : null;
    cloned.frameId = this.frameId;
    cloned.startFrame = this.startFrame;
    cloned.trackletLen = this.trackletLen;
    cloned.class = this.class;
    cloned.headCenterX = this.headCenterX;
    cloned.headCenterY = this.headCenterY;
    return cloned;
  }
}