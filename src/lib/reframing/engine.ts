import { 
  BoundingBox, 
  Detection, 
  FrameTransform, 
  ReframingConfig,
  TrackedObject 
} from '@/types';
import { SmoothingAlgorithm, TargetSelector, FrameCalculator } from './algorithms';
import { ASPECT_RATIOS } from './presets';

export class ReframingEngine {
  private smoother: SmoothingAlgorithm;
  private targetSelector: TargetSelector;
  private frameCalculator: FrameCalculator;
  private config: ReframingConfig;
  private frameTransforms: Map<number, FrameTransform> = new Map();
  
  constructor(config: ReframingConfig) {
    this.config = config;
    this.smoother = new SmoothingAlgorithm(config.smoothness);
    this.targetSelector = new TargetSelector();
    this.frameCalculator = new FrameCalculator();
  }

  processFrame(
    frameNumber: number,
    detections: BoundingBox[],
    selectedTrack: TrackedObject | null,
    frameWidth: number,
    frameHeight: number
  ): FrameTransform {
    let targets: BoundingBox[] = [];

    if (this.config.trackingMode === 'manual' && selectedTrack) {
      // Use manually selected track
      const trackBox = selectedTrack.positions.get(frameNumber);
      if (trackBox) {
        targets = [trackBox];
      }
    } else if (this.config.trackingMode === 'single') {
      // Select single target based on strategy
      const target = this.targetSelector.selectTarget(
        detections,
        this.config.targetSelection,
        frameWidth,
        frameHeight
      );
      if (target) {
        targets = [target];
      }
    } else if (this.config.trackingMode === 'multi') {
      // Include all person detections
      targets = detections.filter(d => d.class === 'person');
    } else {
      // Auto mode - include primary target and nearby objects
      const primaryTarget = this.targetSelector.selectTarget(
        detections.filter(d => d.class === 'person'),
        this.config.targetSelection,
        frameWidth,
        frameHeight
      );
      
      if (primaryTarget) {
        targets = [primaryTarget];
        // Include other objects near the primary target
        const threshold = Math.min(frameWidth, frameHeight) * 0.3;
        targets.push(...detections.filter(d => {
          if (d === primaryTarget) return false;
          const dx = (d.x + d.width / 2) - (primaryTarget.x + primaryTarget.width / 2);
          const dy = (d.y + d.height / 2) - (primaryTarget.y + primaryTarget.height / 2);
          return Math.sqrt(dx * dx + dy * dy) < threshold;
        }));
      }
    }

    // Calculate optimal frame for targets
    const outputRatio = ASPECT_RATIOS[this.config.outputRatio];
    const rawTransform = this.frameCalculator.calculateOptimalFrame(
      targets,
      outputRatio,
      frameWidth,
      frameHeight,
      this.config.padding
    );

    // Apply smoothing
    const smoothedTransform = this.smoother.smooth(rawTransform);
    
    // Store transform
    this.frameTransforms.set(frameNumber, smoothedTransform);
    
    return smoothedTransform;
  }

  processAllFrames(
    detections: Detection[],
    selectedTrack: TrackedObject | null,
    frameWidth: number,
    frameHeight: number
  ): Map<number, FrameTransform> {
    // Reset smoother for new sequence
    this.smoother.reset();
    this.frameTransforms.clear();

    // Process each frame
    for (const detection of detections) {
      this.processFrame(
        detection.frameNumber,
        detection.boxes,
        selectedTrack,
        frameWidth,
        frameHeight
      );
    }

    return this.frameTransforms;
  }

  updateConfig(config: Partial<ReframingConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.smoothness !== undefined) {
      this.smoother = new SmoothingAlgorithm(config.smoothness);
    }
  }

  getTransform(frameNumber: number): FrameTransform | undefined {
    return this.frameTransforms.get(frameNumber);
  }

  getAllTransforms(): Map<number, FrameTransform> {
    return new Map(this.frameTransforms);
  }
}