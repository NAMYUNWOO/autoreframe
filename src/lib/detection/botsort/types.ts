export interface Detection {
  bbox: number[];  // [x1, y1, x2, y2] in tlbr format
  score: number;
  class: string;
  headCenterX?: number;
  headCenterY?: number;
  features?: number[];  // Optional appearance features
}

export interface TrackParams {
  trackThresh: number;
  trackBuffer: number;
  matchThresh: number;
  minBoxArea: number;
  lowThresh: number;
  secondMatchThresh: number;
  unconfirmedMatchThresh: number;
  maxTimeLost: number;
  // BoT-SORT specific params
  cmcMethod: 'sparse' | 'orb' | 'ecc' | 'file' | 'none';
  useCMC: boolean;
  useAppearance: boolean;
  appearanceThresh: number;
  proximityThresh: number;
  fusionAlpha: number;  // Weight for IoU vs appearance fusion
}