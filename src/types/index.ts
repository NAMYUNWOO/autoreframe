export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  rotation?: number;
  totalFrames?: number; // Exact frame count from MediaInfo
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
  classId: number;
  trackId?: string;
  headCenterX?: number;
  headCenterY?: number;
  features?: number[];  // Optional appearance features for BoT-SORT
}

export interface Detection {
  frameNumber: number;
  timestamp: number;
  boxes: BoundingBox[];
}

export interface ReframingConfig {
  outputRatio: AspectRatio;
  trackingMode: TrackingMode;
  smoothness: number;
  padding: number;
  targetSelection: TargetSelectionStrategy;
  reframeBoxSize?: number;
  reframeBoxOffset?: { x: number; y: number };
}

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | 'custom';

export type TrackingMode = 'single' | 'multi' | 'auto';

export type TargetSelectionStrategy = 'largest' | 'centered' | 'most-confident' | 'manual';

export interface FrameTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface ProcessingStatus {
  stage: 'idle' | 'uploading' | 'analyzing' | 'reframing' | 'exporting' | 'complete' | 'error';
  progress: number;
  message: string;
  error?: string;
}

export interface ExportOptions {
  format?: 'mp4' | 'webm' | 'mov'; // Optional, defaults to 'mp4'
  quality: number; // CRF value (0-51, lower is better)
  codec: string;
  bitrate?: number; // Max bitrate in bits per second
}

export interface TrackedObject {
  id: string;
  firstFrame: number;
  lastFrame: number;
  positions: Map<number, BoundingBox>;
  label: string;
  selected: boolean;
}