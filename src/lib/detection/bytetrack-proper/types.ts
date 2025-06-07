export enum TrackState {
  New = 1,
  Tracked = 2,
  Lost = 3,
  Removed = 4
}

export interface Detection {
  bbox: number[]; // [x1, y1, x2, y2] in tlbr format
  score: number;
  class: string;
  headCenterX?: number;
  headCenterY?: number;
}

export interface TrackParams {
  trackThresh: number;  // High confidence threshold (default 0.5)
  trackBuffer: number;  // Frames to keep lost tracks (default 30)
  matchThresh: number;  // IoU threshold for matching (default 0.8)
  minBoxArea: number;   // Minimum box area (default 10)
  lowThresh: number;    // Low confidence threshold for second stage (default 0.1)
}