import { KalmanFilter } from './kalman-filter';
import { TrackState, Detection } from './types';

let trackIdCount = 0;

export class STrack {
  public trackId: number;
  public isActivated: boolean;
  public state: TrackState;
  public score: number;
  public class: string;
  public headCenterX?: number;
  public headCenterY?: number;
  
  private kalmanFilter: KalmanFilter;
  private mean: number[];
  private covariance: number[][];
  public frameId: number;
  private startFrame: number;
  private trackletLen: number;
  
  constructor() {
    this.trackId = 0;
    this.isActivated = false;
    this.state = TrackState.New;
    this.score = 0;
    this.class = 'person';
    
    this.kalmanFilter = new KalmanFilter();
    this.mean = [];
    this.covariance = [];
    this.frameId = 0;
    this.startFrame = 0;
    this.trackletLen = 0;
  }

  /**
   * Initialize track from detection
   */
  static fromDetection(det: Detection, frameId: number): STrack {
    const track = new STrack();
    track.activate(det, frameId);
    return track;
  }

  /**
   * Activate track with detection
   */
  activate(det: Detection, frameId: number): void {
    [this.mean, this.covariance] = this.kalmanFilter.initiate(det.bbox);
    
    this.trackletLen = 0;
    this.state = TrackState.Tracked;
    
    if (frameId === 1) {
      this.isActivated = true;
    }
    
    this.frameId = frameId;
    this.startFrame = frameId;
    this.score = det.score;
    this.class = det.class;
    this.headCenterX = det.headCenterX;
    this.headCenterY = det.headCenterY;
    
    if (this.trackId === 0) {
      this.trackId = this.nextId();
    }
  }

  /**
   * Re-activate a lost track
   */
  reActivate(det: Detection, frameId: number, newId: boolean = false): void {
    [this.mean, this.covariance] = this.kalmanFilter.update(this.mean, this.covariance, det.bbox);
    
    this.trackletLen = 0;
    this.state = TrackState.Tracked;
    this.isActivated = true;
    this.frameId = frameId;
    this.score = det.score;
    this.headCenterX = det.headCenterX;
    this.headCenterY = det.headCenterY;
    
    if (newId) {
      this.trackId = this.nextId();
    }
  }

  /**
   * Update track with new detection
   */
  update(det: Detection, frameId: number): void {
    this.frameId = frameId;
    this.trackletLen++;
    
    [this.mean, this.covariance] = this.kalmanFilter.update(this.mean, this.covariance, det.bbox);
    
    this.state = TrackState.Tracked;
    this.isActivated = true;
    this.score = det.score;
    this.headCenterX = det.headCenterX;
    this.headCenterY = det.headCenterY;
  }

  /**
   * Predict next state
   */
  predict(): void {
    if (this.state !== TrackState.Tracked) {
      this.mean[7] = 0; // Reset height velocity for lost tracks
    }
    
    [this.mean, this.covariance] = this.kalmanFilter.predict(this.mean, this.covariance);
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

  /**
   * Get current bounding box
   */
  get tlbr(): number[] {
    if (this.mean.length === 0) {
      return [0, 0, 0, 0];
    }
    return this.kalmanFilter.stateToBbox(this.mean);
  }

  /**
   * Get current position as tlwh format
   */
  get tlwh(): number[] {
    const [x1, y1, x2, y2] = this.tlbr;
    return [x1, y1, x2 - x1, y2 - y1];
  }

  /**
   * Static method to get next track ID
   */
  private nextId(): number {
    trackIdCount += 1;
    return trackIdCount;
  }

  /**
   * Reset track ID counter
   */
  static resetId(): void {
    trackIdCount = 0;
  }

  /**
   * Get track age (frames since start)
   */
  get age(): number {
    return this.frameId - this.startFrame;
  }
}