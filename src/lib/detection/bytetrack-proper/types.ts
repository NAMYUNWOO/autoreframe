export interface Detection {
  bbox: number[]; // [x1, y1, x2, y2] in tlbr format
  score: number;
  class: string;
  headCenterX?: number;
  headCenterY?: number;
}

export interface TrackParams {
  trackThresh: number;  // High confidence threshold (default 0.3)
  trackBuffer: number;  // Frames to keep lost tracks (default 30)
  matchThresh: number;  // IoU threshold for matching (default 0.5)
  minBoxArea: number;   // Minimum box area (default 100)
  lowThresh: number;    // Low confidence threshold for second stage (default 0.1)
  secondMatchThresh?: number; // IoU threshold for low score matching (default 0.5)
  unconfirmedMatchThresh?: number; // IoU threshold for unconfirmed tracks (default 0.7)
  maxTimeLost?: number; // Maximum frames to keep lost tracks (default 30)
}