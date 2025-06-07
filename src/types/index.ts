export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  rotation?: number;
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
  format: 'mp4' | 'webm';
  quality: number;
  codec: string;
  bitrate?: number;
}

export interface TrackedObject {
  id: string;
  firstFrame: number;
  lastFrame: number;
  positions: Map<number, BoundingBox>;
  label: string;
  selected: boolean;
}