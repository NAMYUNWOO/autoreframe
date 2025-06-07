import { Detection, FrameTransform } from '@/types';
import { TrajectoryInterpolator } from './trajectory-interpolator';
import { ReframeSizeCalculator } from './reframe-size-calculator';

interface TrajectoryPoint {
  frame: number;
  x: number;
  y: number;
  headX?: number;
  headY?: number;
  width: number;
  height: number;
}

interface ControlPoint {
  frame: number;
  x: number;
  y: number;
}

export class BezierTrajectorySmoother {
  private fps: number = 30;
  private segmentDuration: number = 2; // 2 second segments for bezier curves
  private interpolator: TrajectoryInterpolator;
  private initialTargetDimensions: { width: number; height: number } | null = null;
  
  constructor() {
    this.interpolator = new TrajectoryInterpolator();
  }
  
  /**
   * Create smooth trajectory using Bezier curves
   */
  smoothTrajectory(
    detections: Detection[],
    targetTrackId: string,
    frameWidth: number,
    frameHeight: number,
    outputRatio: number,
    initialTargetBox?: { width: number; height: number }
  ): Map<number, FrameTransform> {
    console.log('BezierTrajectorySmoother: Starting trajectory smoothing');
    
    // Store initial target dimensions if provided
    if (initialTargetBox) {
      this.initialTargetDimensions = initialTargetBox;
      console.log(`Using initial target dimensions: ${initialTargetBox.width}x${initialTargetBox.height}`);
    }
    
    // Step 1: First interpolate missing frames
    const totalFrames = Math.max(...detections.map(d => d.frameNumber)) + 1;
    const interpolatedDetections = this.interpolator.interpolateTrajectory(
      detections,
      targetTrackId,
      totalFrames
    );
    
    // Step 2: Extract trajectory points from interpolated data
    const rawPoints = this.extractTrajectory(interpolatedDetections, targetTrackId);
    if (rawPoints.length === 0) {
      return new Map();
    }
    
    console.log(`Extracted ${rawPoints.length} trajectory points from interpolated data`);
    
    // Check if we have head center data
    const hasHeadData = rawPoints.some(p => p.headX !== undefined && p.headY !== undefined);
    console.log(`Head tracking data available: ${hasHeadData}`);
    
    // Step 3: Calculate consistent frame dimensions
    // If we have initial target dimensions from selection, use those
    // Otherwise, calculate from the first few frames
    let consistentDimensions: { width: number; height: number };
    if (this.initialTargetDimensions) {
      consistentDimensions = this.initialTargetDimensions;
      console.log(`Using initial selection dimensions: ${consistentDimensions.width}x${consistentDimensions.height}`);
    } else {
      // Use first frame's dimensions as the baseline
      if (rawPoints.length > 0) {
        consistentDimensions = { width: rawPoints[0].width, height: rawPoints[0].height };
        console.log(`Using first frame dimensions: ${consistentDimensions.width}x${consistentDimensions.height}`);
      } else {
        // Fallback to median calculation
        consistentDimensions = this.calculateConsistentDimensions(rawPoints);
        console.log(`Using median dimensions: ${consistentDimensions.width}x${consistentDimensions.height}`);
      }
    }
    
    // Step 4: Apply initial smoothing to raw points to remove jitter
    const preSmoothPoints = this.applyMovingAverage(
      rawPoints.map(p => ({
        frame: p.frame,
        x: p.headX ?? p.x,
        y: p.headY ?? p.y
      })),
      5 // Small window for initial smoothing
    );
    
    // Step 5: Create key points for Bezier curves (every N seconds)
    const keyPoints = this.selectKeyPointsFromSmoothed(preSmoothPoints);
    console.log(`Selected ${keyPoints.length} key points for Bezier curves`);
    
    // Step 6: Generate Bezier control points
    const controlPoints = this.generateBezierControlPoints(keyPoints);
    
    // Step 7: Interpolate smooth trajectory using Bezier curves
    const smoothedTrajectory = this.interpolateBezierTrajectory(
      controlPoints,
      rawPoints[0].frame,
      rawPoints[rawPoints.length - 1].frame
    );
    
    // Step 8: Apply final smoothing with larger moving average
    const finalTrajectory = this.applyMovingAverage(smoothedTrajectory, 30); // 1 second window
    
    // Step 9: Convert to frame transforms with consistent dimensions
    return this.createFrameTransforms(
      finalTrajectory,
      consistentDimensions,
      frameWidth,
      frameHeight,
      outputRatio,
      hasHeadData
    );
  }
  
  /**
   * Extract trajectory points from detections
   */
  private extractTrajectory(detections: Detection[], targetTrackId: string): TrajectoryPoint[] {
    const points: TrajectoryPoint[] = [];
    
    for (const detection of detections) {
      const targetBox = detection.boxes.find(box => box.trackId === targetTrackId);
      if (targetBox) {
        points.push({
          frame: detection.frameNumber,
          x: targetBox.x + targetBox.width / 2,
          y: targetBox.y + targetBox.height / 2,
          headX: targetBox.headCenterX,
          headY: targetBox.headCenterY,
          width: targetBox.width,
          height: targetBox.height
        });
      }
    }
    
    return points.sort((a, b) => a.frame - b.frame);
  }
  
  /**
   * Calculate consistent dimensions using percentiles to avoid outliers
   */
  private calculateConsistentDimensions(points: TrajectoryPoint[]): { width: number; height: number } {
    const widths = points.map(p => p.width).sort((a, b) => a - b);
    const heights = points.map(p => p.height).sort((a, b) => a - b);
    
    // Use 25th to 75th percentile range
    const p25 = Math.floor(points.length * 0.25);
    const p75 = Math.floor(points.length * 0.75);
    
    const widthRange = widths.slice(p25, p75);
    const heightRange = heights.slice(p25, p75);
    
    // Calculate median of the range
    const medianWidth = widthRange[Math.floor(widthRange.length / 2)];
    const medianHeight = heightRange[Math.floor(heightRange.length / 2)];
    
    return {
      width: medianWidth,
      height: medianHeight
    };
  }
  
  /**
   * Select key points from smoothed trajectory
   */
  private selectKeyPointsFromSmoothed(smoothedPoints: ControlPoint[]): ControlPoint[] {
    const segmentFrames = this.segmentDuration * this.fps;
    const keyPoints: ControlPoint[] = [];
    
    // Always include first point
    keyPoints.push(smoothedPoints[0]);
    
    // Add key points at regular intervals
    let currentFrame = smoothedPoints[0].frame + segmentFrames;
    while (currentFrame < smoothedPoints[smoothedPoints.length - 1].frame) {
      // Find closest point to current frame
      const closestPoint = smoothedPoints.find(p => p.frame >= currentFrame) || smoothedPoints[smoothedPoints.length - 1];
      if (closestPoint && !keyPoints.some(kp => kp.frame === closestPoint.frame)) {
        keyPoints.push(closestPoint);
      }
      currentFrame += segmentFrames;
    }
    
    // Always include last point
    const lastPoint = smoothedPoints[smoothedPoints.length - 1];
    if (!keyPoints.some(kp => kp.frame === lastPoint.frame)) {
      keyPoints.push(lastPoint);
    }
    
    return keyPoints;
  }
  
  /**
   * Select key points for Bezier curves (old method)
   */
  private selectKeyPoints(points: TrajectoryPoint[]): ControlPoint[] {
    const segmentFrames = this.segmentDuration * this.fps;
    const keyPoints: ControlPoint[] = [];
    
    // Always include first point
    keyPoints.push({
      frame: points[0].frame,
      x: points[0].headX ?? points[0].x,
      y: points[0].headY ?? points[0].y
    });
    
    // Add key points at regular intervals
    let currentFrame = points[0].frame + segmentFrames;
    while (currentFrame < points[points.length - 1].frame) {
      // Find closest point to current frame
      const closestPoint = this.findClosestPoint(points, currentFrame);
      if (closestPoint) {
        keyPoints.push({
          frame: closestPoint.frame,
          x: closestPoint.headX ?? closestPoint.x,
          y: closestPoint.headY ?? closestPoint.y
        });
      }
      currentFrame += segmentFrames;
    }
    
    // Always include last point
    const lastPoint = points[points.length - 1];
    keyPoints.push({
      frame: lastPoint.frame,
      x: lastPoint.headX ?? lastPoint.x,
      y: lastPoint.headY ?? lastPoint.y
    });
    
    return keyPoints;
  }
  
  /**
   * Find closest point to target frame
   */
  private findClosestPoint(points: TrajectoryPoint[], targetFrame: number): TrajectoryPoint | null {
    let closest: TrajectoryPoint | null = null;
    let minDistance = Infinity;
    
    for (const point of points) {
      const distance = Math.abs(point.frame - targetFrame);
      if (distance < minDistance) {
        minDistance = distance;
        closest = point;
      }
    }
    
    return closest;
  }
  
  /**
   * Generate Bezier control points for smooth curves
   */
  private generateBezierControlPoints(keyPoints: ControlPoint[]): ControlPoint[] {
    if (keyPoints.length < 2) return keyPoints;
    
    const controlPoints: ControlPoint[] = [];
    
    // Add first point
    controlPoints.push(keyPoints[0]);
    
    // Generate control points for each segment
    for (let i = 0; i < keyPoints.length - 1; i++) {
      const p0 = keyPoints[Math.max(0, i - 1)];
      const p1 = keyPoints[i];
      const p2 = keyPoints[i + 1];
      const p3 = keyPoints[Math.min(keyPoints.length - 1, i + 2)];
      
      // Calculate tangent for smooth curves
      const tension = 0.5; // Higher tension for smoother curves
      
      // Control point 1
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      
      // Control point 2
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;
      
      // Add control points
      controlPoints.push({
        frame: p1.frame + (p2.frame - p1.frame) * 0.33,
        x: cp1x,
        y: cp1y
      });
      
      controlPoints.push({
        frame: p1.frame + (p2.frame - p1.frame) * 0.67,
        x: cp2x,
        y: cp2y
      });
      
      // Add end point of segment
      if (i === keyPoints.length - 2) {
        controlPoints.push(p2);
      }
    }
    
    return controlPoints;
  }
  
  /**
   * Interpolate smooth trajectory using Bezier curves
   */
  private interpolateBezierTrajectory(
    controlPoints: ControlPoint[],
    startFrame: number,
    endFrame: number
  ): ControlPoint[] {
    const trajectory: ControlPoint[] = [];
    
    // For each frame, calculate position on Bezier curve
    for (let frame = startFrame; frame <= endFrame; frame++) {
      // Find which segment this frame belongs to
      let segmentIndex = 0;
      for (let i = 0; i < controlPoints.length - 1; i++) {
        if (frame >= controlPoints[i].frame && frame <= controlPoints[i + 1].frame) {
          segmentIndex = i;
          break;
        }
      }
      
      // Calculate t parameter for Bezier curve
      const p0 = controlPoints[Math.max(0, segmentIndex - 1)];
      const p1 = controlPoints[segmentIndex];
      const p2 = controlPoints[Math.min(controlPoints.length - 1, segmentIndex + 1)];
      const p3 = controlPoints[Math.min(controlPoints.length - 1, segmentIndex + 2)];
      
      const segmentDuration = p2.frame - p1.frame;
      const t = segmentDuration > 0 ? (frame - p1.frame) / segmentDuration : 0;
      
      // Cubic Bezier interpolation
      const point = this.cubicBezier(p0, p1, p2, p3, t);
      trajectory.push({
        frame,
        x: point.x,
        y: point.y
      });
    }
    
    return trajectory;
  }
  
  /**
   * Cubic Bezier interpolation
   */
  private cubicBezier(p0: ControlPoint, p1: ControlPoint, p2: ControlPoint, p3: ControlPoint, t: number): { x: number; y: number } {
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    
    return {
      x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
      y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
    };
  }
  
  /**
   * Apply moving average for final smoothing
   */
  private applyMovingAverage(trajectory: ControlPoint[], windowSize: number): ControlPoint[] {
    const smoothed: ControlPoint[] = [];
    const halfWindow = Math.floor(windowSize / 2);
    
    for (let i = 0; i < trajectory.length; i++) {
      let sumX = 0, sumY = 0, count = 0;
      
      for (let j = Math.max(0, i - halfWindow); j <= Math.min(trajectory.length - 1, i + halfWindow); j++) {
        sumX += trajectory[j].x;
        sumY += trajectory[j].y;
        count++;
      }
      
      smoothed.push({
        frame: trajectory[i].frame,
        x: sumX / count,
        y: sumY / count
      });
    }
    
    return smoothed;
  }
  
  /**
   * Convert smooth trajectory to frame transforms
   */
  private createFrameTransforms(
    trajectory: ControlPoint[],
    dimensions: { width: number; height: number },
    frameWidth: number,
    frameHeight: number,
    outputRatio: number,
    hasHeadData: boolean = false
  ): Map<number, FrameTransform> {
    const transforms = new Map<number, FrameTransform>();
    
    // Use ReframeSizeCalculator to determine optimal reframe dimensions
    // If we have head data, use head-based framing for better portrait shots
    const reframeDimensions = hasHeadData 
      ? ReframeSizeCalculator.calculateHeadBasedReframeSize(
          dimensions,
          frameWidth,
          frameHeight,
          outputRatio
        )
      : ReframeSizeCalculator.calculateOptimalReframeSize(
          dimensions,
          frameWidth,
          frameHeight,
          outputRatio
        );
    
    // Extract calculated values
    const scale = reframeDimensions.scale;
    const consistentWidth = reframeDimensions.width;
    const consistentHeight = reframeDimensions.height;
    
    console.log(`BezierTrajectorySmoother: Using consistent scale: ${scale}, dimensions: ${consistentWidth}x${consistentHeight}`);
    
    // Create transforms with smooth trajectory and consistent scale
    for (const point of trajectory) {
      // Ensure frame bounds with consistent dimensions
      const halfWidth = consistentWidth / 2;
      const halfHeight = consistentHeight / 2;
      
      // Clamp position to ensure frame stays within video bounds
      const clampedX = Math.max(halfWidth, Math.min(frameWidth - halfWidth, point.x));
      const clampedY = Math.max(halfHeight, Math.min(frameHeight - halfHeight, point.y));
      
      if (point.frame >= 299 && point.frame <= 300) {
        console.log(`Frame ${point.frame}: Transform - center=(${clampedX}, ${clampedY}), scale=${scale}, box size=${consistentWidth}x${consistentHeight}`);
      }
      
      transforms.set(point.frame, {
        x: clampedX,
        y: clampedY,
        scale: scale,
        rotation: 0
      });
    }
    
    return transforms;
  }
  
  setFPS(fps: number): void {
    this.fps = fps;
  }
}