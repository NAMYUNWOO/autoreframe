import { 
  BoundingBox, 
  Detection, 
  FrameTransform, 
  ReframingConfig,
  TrackedObject 
} from '@/types';
import { SmoothingAlgorithm, TargetSelector } from './algorithms';
import { StableFrameCalculator } from './stable-calculator';
import { BezierTrajectorySmoother } from './bezier-trajectory-smoother';
import { ASPECT_RATIOS } from './presets';

export class ReframingEngine {
  private smoother: SmoothingAlgorithm;
  private targetSelector: TargetSelector;
  private frameCalculator: StableFrameCalculator;
  private bezierTrajectorySmoother: BezierTrajectorySmoother;
  private config: ReframingConfig;
  private frameTransforms: Map<number, FrameTransform> = new Map();
  private useMultiPointStabilization: boolean = false; // Disable for now
  private useTrajectorySmoothing: boolean = false; // Disable old trajectory smoothing
  private useBezierSmoothing: boolean = true; // Use sync point based Bezier smoothing (half-fps sync)
  private initialTargetBox?: { width: number; height: number };
  
  constructor(config: ReframingConfig, initialTargetBox?: { width: number; height: number }) {
    this.config = config;
    // Always use aggressive smoothing optimized for ByteTrack
    this.smoother = new SmoothingAlgorithm(config.smoothness, true);
    this.targetSelector = new TargetSelector();
    this.frameCalculator = new StableFrameCalculator();
    this.bezierTrajectorySmoother = new BezierTrajectorySmoother();
    this.initialTargetBox = initialTargetBox;
    // Enable stable center to reduce jitter
    this.frameCalculator.setUseStableCenter(true);
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
      // When using ByteTrack, find matching detection by track ID
      const matchingDetection = detections.find(det => 
        det.trackId === selectedTrack.id
      );
      
      if (matchingDetection) {
        targets = [matchingDetection];
        // console.log(`Frame ${frameNumber}: Found matching detection for track ${selectedTrack.id}, head center: ${matchingDetection.headCenterX}, ${matchingDetection.headCenterY}`);
      } else {
        // Find the selected track in any detection
        const selectedBox = detections.find(det => det.trackId === selectedTrack.id);
        if (selectedBox) {
          targets = [selectedBox];
        } else {
          // Use the last known position from track
          const trackBox = selectedTrack.positions.get(frameNumber);
          if (trackBox) {
            targets = [trackBox];
          }
        }
      }
      // Don't process any other logic when manual selection is active
    } else if (this.config.trackingMode === 'single') {
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
      // Include all person detections  
      targets = detections.filter(d => d.class === 'person');
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
    
    let rawTransform: FrameTransform;
    
    // Use frame calculator
    rawTransform = this.frameCalculator.calculateOptimalFrame(
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
    frameHeight: number,
    fps: number = 30
  ): Map<number, FrameTransform> {
    // Reset smoother and calculator for new sequence
    this.smoother.reset();
    this.frameCalculator.reset();
    this.frameTransforms.clear();
    
    // Set FPS for trajectory smoother
    this.bezierTrajectorySmoother.setFPS(fps);

    // Create a map for quick detection lookup
    const detectionMap = new Map<number, Detection>();
    for (const detection of detections) {
      detectionMap.set(detection.frameNumber, detection);
    }

    // Get total frames from detections
    const maxFrame = Math.max(...detections.map(d => d.frameNumber));
    
    // Process every frame since ByteTrack provides interpolated data
    // console.log(`ReframingEngine: Processing ${maxFrame + 1} frames with ByteTrack interpolated data`);
    
    // If using Bezier smoothing and we have a selected track
    if (this.useBezierSmoothing && selectedTrack) {
      console.log('Using adaptive smoothing with velocity prediction for stable reframing');
      
      // Get smoothed trajectory for the entire sequence
      const outputRatio = ASPECT_RATIOS[this.config.outputRatio];
      
      // Use the provided initial target box if available, otherwise find from first detection
      let initialTargetBox: { width: number; height: number } | undefined = this.initialTargetBox;
      
      if (!initialTargetBox) {
        // Find the initial dimensions from the first detection of the selected track
        for (const detection of detections) {
          const targetBox = detection.boxes.find(box => box.trackId === selectedTrack.id);
          if (targetBox) {
            initialTargetBox = { width: targetBox.width, height: targetBox.height };
            // console.log(`ReframingEngine: Found initial target dimensions: ${targetBox.width}x${targetBox.height} from frame ${detection.frameNumber}`);
            break;
          }
        }
      } else {
        // console.log(`ReframingEngine: Using provided initial target dimensions: ${initialTargetBox.width}x${initialTargetBox.height}`);
      }
      
      const smoothedTransforms = this.bezierTrajectorySmoother.smoothTrajectory(
        detections,
        selectedTrack.id,
        frameWidth,
        frameHeight,
        outputRatio,
        initialTargetBox,
        this.config
      );
      
      // Use smoothed transforms
      this.frameTransforms = smoothedTransforms;
    } else {
      // Original processing
      for (let frameNumber = 0; frameNumber <= maxFrame; frameNumber++) {
        const detection = detectionMap.get(frameNumber);
        const boxes = detection ? detection.boxes : [];
        
        // Process frame to get raw transform
        const rawTransform = this.processFrame(
          frameNumber,
          boxes,
          selectedTrack,
          frameWidth,
          frameHeight
        );
        
        // Note: processFrame already applies smoothing internally
        this.frameTransforms.set(frameNumber, rawTransform);
      }
    }

    return this.frameTransforms;
  }

  updateConfig(config: Partial<ReframingConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.smoothness !== undefined) {
      this.smoother = new SmoothingAlgorithm(config.smoothness, true);
    }
    // Update frame calculator if needed
    this.frameCalculator.setUseStableCenter(true);
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