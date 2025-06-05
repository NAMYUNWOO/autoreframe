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

    if (this.config.targetSelection === 'manual' && selectedTrack) {
      // STRICTLY use only manually selected track
      const trackBox = selectedTrack.positions.get(frameNumber);
      if (trackBox) {
        targets = [trackBox];
      } else {
        // No detection for this frame - use interpolation
        const nearestBox = this.findNearestTrackPosition(selectedTrack, frameNumber);
        if (nearestBox) {
          targets = [nearestBox];
        }
      }
      // Don't process any other logic when manual selection is active
    } else if (this.config.trackingMode === 'single' && this.config.targetSelection !== 'manual') {
      // Select single target based on strategy
      if (this.config.targetSelection !== 'manual') {
        const target = this.targetSelector.selectTarget(
          detections,
          this.config.targetSelection,
          frameWidth,
          frameHeight
        );
        if (target) {
          targets = [target];
        }
      }
    } else if (this.config.trackingMode === 'multi') {
      // Include all head detections
      targets = detections.filter(d => d.class === 'head');
    } else {
      // Auto mode - include primary target and nearby objects
      if (this.config.targetSelection !== 'manual') {
        const primaryTarget = this.targetSelector.selectTarget(
          detections.filter(d => d.class === 'head'),
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

    // Create a map for quick detection lookup
    const detectionMap = new Map<number, Detection>();
    for (const detection of detections) {
      detectionMap.set(detection.frameNumber, detection);
    }

    // Get total frames from detections
    const maxFrame = Math.max(...detections.map(d => d.frameNumber));
    
    // First pass: Process frames with actual detections
    const keyframeTransforms = new Map<number, FrameTransform>();
    for (const detection of detections) {
      const boxes = detection.boxes;
      const transform = this.processFrame(
        detection.frameNumber,
        boxes,
        selectedTrack,
        frameWidth,
        frameHeight
      );
      keyframeTransforms.set(detection.frameNumber, transform);
    }
    
    // Second pass: Interpolate between keyframes for smooth trajectory
    for (let frameNumber = 0; frameNumber <= maxFrame; frameNumber++) {
      if (keyframeTransforms.has(frameNumber)) {
        // Already processed
        continue;
      }
      
      // Find surrounding keyframes
      let prevKeyframe: number | null = null;
      let nextKeyframe: number | null = null;
      
      for (let i = frameNumber - 1; i >= 0; i--) {
        if (keyframeTransforms.has(i)) {
          prevKeyframe = i;
          break;
        }
      }
      
      for (let i = frameNumber + 1; i <= maxFrame; i++) {
        if (keyframeTransforms.has(i)) {
          nextKeyframe = i;
          break;
        }
      }
      
      // Interpolate transform
      let interpolatedTransform: FrameTransform;
      
      if (prevKeyframe !== null && nextKeyframe !== null) {
        const prevTransform = keyframeTransforms.get(prevKeyframe)!;
        const nextTransform = keyframeTransforms.get(nextKeyframe)!;
        const t = (frameNumber - prevKeyframe) / (nextKeyframe - prevKeyframe);
        
        // Smooth interpolation using cubic easing
        const easeT = this.cubicEase(t);
        
        interpolatedTransform = {
          x: prevTransform.x + (nextTransform.x - prevTransform.x) * easeT,
          y: prevTransform.y + (nextTransform.y - prevTransform.y) * easeT,
          scale: prevTransform.scale + (nextTransform.scale - prevTransform.scale) * easeT,
          rotation: 0
        };
      } else if (prevKeyframe !== null) {
        // Use last known position
        interpolatedTransform = keyframeTransforms.get(prevKeyframe)!;
      } else if (nextKeyframe !== null) {
        // Use next known position
        interpolatedTransform = keyframeTransforms.get(nextKeyframe)!;
      } else {
        // Fallback to center
        interpolatedTransform = {
          x: frameWidth / 2,
          y: frameHeight / 2,
          scale: 1,
          rotation: 0
        };
      }
      
      // Apply smoothing to interpolated transform
      const smoothedTransform = this.smoother.smooth(interpolatedTransform);
      this.frameTransforms.set(frameNumber, smoothedTransform);
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

  private findNearestTrackPosition(track: TrackedObject, targetFrame: number): BoundingBox | null {
    let nearestBox: BoundingBox | null = null;
    let minDistance = Infinity;

    // Look for nearest detection within 30 frames
    for (let offset = 1; offset <= 30; offset++) {
      // Check before
      const beforeFrame = targetFrame - offset;
      if (track.positions.has(beforeFrame)) {
        return track.positions.get(beforeFrame)!;
      }

      // Check after
      const afterFrame = targetFrame + offset;
      if (track.positions.has(afterFrame)) {
        return track.positions.get(afterFrame)!;
      }
    }

    return nearestBox;
  }

  private cubicEase(t: number): number {
    // Cubic ease in-out for smooth interpolation
    if (t < 0.5) {
      return 4 * t * t * t;
    } else {
      const p = 2 * t - 2;
      return 1 + p * p * p / 2;
    }
  }
}