import { Detection, FrameTransform, ReframingConfig } from '@/types';
import { TrajectoryInterpolator } from './trajectory-interpolator';
import { ReframeSizeCalculatorV2, ReframingSettings } from './reframe-size-calculator-v2';

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
  private segmentDuration: number = 0.5; // Shorter segments for smoother curves
  private interpolator: TrajectoryInterpolator;
  private initialTargetDimensions: { width: number; height: number } | null = null;
  
  constructor() {
    this.interpolator = new TrajectoryInterpolator();
  }
  
  /**
   * Create smooth trajectory using adaptive smoothing
   */
  smoothTrajectory(
    detections: Detection[],
    targetTrackId: string,
    frameWidth: number,
    frameHeight: number,
    outputRatio: number,
    initialTargetBox?: { width: number; height: number },
    reframingConfig?: ReframingConfig
  ): Map<number, FrameTransform> {
    // Store initial target dimensions if provided
    if (initialTargetBox) {
      this.initialTargetDimensions = initialTargetBox;
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
    
    // Check if we have head center data
    const hasHeadData = rawPoints.some(p => p.headX !== undefined && p.headY !== undefined);
    
    // Step 3: Calculate consistent frame dimensions
    let consistentDimensions: { width: number; height: number };
    if (this.initialTargetDimensions) {
      consistentDimensions = this.initialTargetDimensions;
    } else {
      if (rawPoints.length > 0) {
        consistentDimensions = { width: rawPoints[0].width, height: rawPoints[0].height };
      } else {
        consistentDimensions = this.calculateConsistentDimensions(rawPoints);
      }
    }
    
    // Step 4: Apply adaptive smoothing based on movement speed
    const smoothedPoints = this.applyAdaptiveSmoothing(
      rawPoints.map(p => ({
        frame: p.frame,
        x: p.headX ?? p.x,
        y: p.headY ?? p.y
      }))
    );
    
    // Step 5: Select key points with shorter intervals for better tracking
    const keyPoints = this.selectAdaptiveKeyPoints(smoothedPoints);
    
    // Step 6: Generate smooth Bezier curves with velocity prediction
    const controlPoints = this.generatePredictiveBezierControlPoints(keyPoints);
    
    // Step 7: Interpolate trajectory
    const smoothedTrajectory = this.interpolateBezierTrajectory(
      controlPoints,
      rawPoints[0].frame,
      rawPoints[rawPoints.length - 1].frame
    );
    
    // Step 8: Apply final stabilization
    const stabilizedTrajectory = this.applyFinalStabilization(smoothedTrajectory);
    
    // Step 9: Convert to frame transforms
    return this.createFrameTransforms(
      stabilizedTrajectory,
      consistentDimensions,
      frameWidth,
      frameHeight,
      outputRatio,
      hasHeadData,
      reframingConfig
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
   * Apply adaptive smoothing based on movement patterns
   */
  private applyAdaptiveSmoothing(points: ControlPoint[]): ControlPoint[] {
    if (points.length < 3) return points;
    
    const smoothed: ControlPoint[] = [];
    
    // Calculate both short-term and long-term velocities
    const shortTermWindow = 5;  // ~0.17s at 30fps
    const longTermWindow = 30;  // ~1s at 30fps
    
    // Analyze motion patterns
    const motionAnalysis = this.analyzeMotionPatterns(points, shortTermWindow, longTermWindow);
    
    // Apply adaptive smoothing based on motion analysis
    for (let i = 0; i < points.length; i++) {
      if (i === 0 || i === points.length - 1) {
        smoothed.push(points[i]);
        continue;
      }
      
      const analysis = motionAnalysis[i];
      
      // Determine smoothing strategy based on motion pattern
      let windowSize: number;
      let predictionWeight: number;
      
      if (analysis.isConsistentMotion && !analysis.isSuddenChange) {
        // Consistent motion: strong smoothing + prediction
        windowSize = 25;
        predictionWeight = 0.3;
      } else if (analysis.isSuddenChange) {
        // Sudden change: minimal smoothing for quick response
        windowSize = 5;
        predictionWeight = 0.1;
      } else {
        // Variable motion: moderate smoothing
        windowSize = 15;
        predictionWeight = 0.2;
      }
      
      // Apply smoothing with motion prediction
      const smoothedPoint = this.applySmoothingWithPrediction(
        points, 
        i, 
        windowSize, 
        analysis.avgVelocity,
        predictionWeight
      );
      
      smoothed.push(smoothedPoint);
    }
    
    return smoothed;
  }
  
  /**
   * Analyze motion patterns at each point
   */
  private analyzeMotionPatterns(
    points: ControlPoint[], 
    shortWindow: number, 
    longWindow: number
  ): Array<{
    avgVelocity: { x: number; y: number };
    velocityVariance: number;
    isConsistentMotion: boolean;
    isSuddenChange: boolean;
  }> {
    const analysis: Array<any> = [];
    
    for (let i = 0; i < points.length; i++) {
      // Calculate short-term velocity
      const shortVel = this.calculateAverageVelocity(points, i, shortWindow);
      
      // Calculate long-term velocity
      const longVel = this.calculateAverageVelocity(points, i, longWindow);
      
      // Calculate velocity variance (motion consistency)
      const variance = this.calculateVelocityVariance(points, i, longWindow);
      
      // Detect sudden changes
      const velocityDiff = Math.sqrt(
        Math.pow(shortVel.x - longVel.x, 2) + 
        Math.pow(shortVel.y - longVel.y, 2)
      );
      const avgSpeed = Math.sqrt(longVel.x * longVel.x + longVel.y * longVel.y);
      const isSuddenChange = velocityDiff > avgSpeed * 0.5;
      
      // Determine if motion is consistent
      const isConsistentMotion = variance < avgSpeed * 0.3;
      
      analysis.push({
        avgVelocity: longVel,
        velocityVariance: variance,
        isConsistentMotion,
        isSuddenChange
      });
    }
    
    return analysis;
  }
  
  /**
   * Calculate average velocity over a window
   */
  private calculateAverageVelocity(
    points: ControlPoint[], 
    centerIdx: number, 
    windowSize: number
  ): { x: number; y: number } {
    let vxSum = 0, vySum = 0, count = 0;
    
    const startIdx = Math.max(1, centerIdx - windowSize);
    const endIdx = Math.min(points.length - 1, centerIdx + windowSize);
    
    for (let i = startIdx; i < endIdx; i++) {
      const dx = points[i].x - points[i-1].x;
      const dy = points[i].y - points[i-1].y;
      const dt = points[i].frame - points[i-1].frame;
      
      if (dt > 0) {
        vxSum += dx / dt;
        vySum += dy / dt;
        count++;
      }
    }
    
    return {
      x: count > 0 ? vxSum / count : 0,
      y: count > 0 ? vySum / count : 0
    };
  }
  
  /**
   * Calculate velocity variance (measure of motion consistency)
   */
  private calculateVelocityVariance(
    points: ControlPoint[], 
    centerIdx: number, 
    windowSize: number
  ): number {
    const velocities: Array<{ x: number; y: number }> = [];
    
    const startIdx = Math.max(1, centerIdx - windowSize);
    const endIdx = Math.min(points.length - 1, centerIdx + windowSize);
    
    // Collect velocities
    for (let i = startIdx; i < endIdx; i++) {
      const dx = points[i].x - points[i-1].x;
      const dy = points[i].y - points[i-1].y;
      const dt = points[i].frame - points[i-1].frame;
      
      if (dt > 0) {
        velocities.push({ x: dx / dt, y: dy / dt });
      }
    }
    
    if (velocities.length < 2) return 0;
    
    // Calculate mean velocity
    const meanVel = velocities.reduce(
      (acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }),
      { x: 0, y: 0 }
    );
    meanVel.x /= velocities.length;
    meanVel.y /= velocities.length;
    
    // Calculate variance
    const variance = velocities.reduce((acc, v) => {
      const dx = v.x - meanVel.x;
      const dy = v.y - meanVel.y;
      return acc + Math.sqrt(dx * dx + dy * dy);
    }, 0) / velocities.length;
    
    return variance;
  }
  
  /**
   * Apply smoothing with motion prediction
   */
  private applySmoothingWithPrediction(
    points: ControlPoint[],
    centerIdx: number,
    windowSize: number,
    avgVelocity: { x: number; y: number },
    predictionWeight: number
  ): ControlPoint {
    let weightedX = 0, weightedY = 0, totalWeight = 0;
    
    // Apply Gaussian smoothing
    const sigma = windowSize / 3;
    const halfWindow = Math.floor(windowSize / 2);
    
    for (let j = Math.max(0, centerIdx - halfWindow); 
         j <= Math.min(points.length - 1, centerIdx + halfWindow); j++) {
      const distance = Math.abs(j - centerIdx);
      const weight = Math.exp(-(distance * distance) / (2 * sigma * sigma));
      
      weightedX += points[j].x * weight;
      weightedY += points[j].y * weight;
      totalWeight += weight;
    }
    
    const smoothedX = weightedX / totalWeight;
    const smoothedY = weightedY / totalWeight;
    
    // Apply motion prediction to compensate for smoothing delay
    const lagFrames = halfWindow / 2; // Estimated lag
    const predictedX = smoothedX + avgVelocity.x * lagFrames * predictionWeight;
    const predictedY = smoothedY + avgVelocity.y * lagFrames * predictionWeight;
    
    return {
      frame: points[centerIdx].frame,
      x: predictedX,
      y: predictedY
    };
  }
  
  /**
   * Select adaptive key points based on movement patterns
   */
  private selectAdaptiveKeyPoints(points: ControlPoint[]): ControlPoint[] {
    const keyPoints: ControlPoint[] = [];
    const segmentFrames = this.segmentDuration * this.fps;
    
    // Always include first point
    keyPoints.push(points[0]);
    
    let lastKeyFrame = points[0].frame;
    
    for (let i = 1; i < points.length - 1; i++) {
      const point = points[i];
      
      // Add key point at regular intervals or when significant direction change
      if (point.frame - lastKeyFrame >= segmentFrames) {
        keyPoints.push(point);
        lastKeyFrame = point.frame;
      } else if (i > 1) {
        // Check for direction change
        const prev = points[i-1];
        const next = points[i+1];
        
        const angle1 = Math.atan2(point.y - prev.y, point.x - prev.x);
        const angle2 = Math.atan2(next.y - point.y, next.x - point.x);
        const angleDiff = Math.abs(angle2 - angle1);
        
        if (angleDiff > Math.PI / 4) { // 45 degree change
          keyPoints.push(point);
          lastKeyFrame = point.frame;
        }
      }
    }
    
    // Always include last point
    keyPoints.push(points[points.length - 1]);
    
    return keyPoints;
  }
  
  /**
   * Generate Bezier control points with velocity prediction
   */
  private generatePredictiveBezierControlPoints(keyPoints: ControlPoint[]): ControlPoint[] {
    if (keyPoints.length < 2) return keyPoints;
    
    const controlPoints: ControlPoint[] = [];
    controlPoints.push(keyPoints[0]);
    
    for (let i = 0; i < keyPoints.length - 1; i++) {
      const p0 = keyPoints[Math.max(0, i - 1)];
      const p1 = keyPoints[i];
      const p2 = keyPoints[i + 1];
      const p3 = keyPoints[Math.min(keyPoints.length - 1, i + 2)];
      
      // Calculate velocities for prediction
      const v1x = i > 0 ? (p1.x - p0.x) / (p1.frame - p0.frame) : 0;
      const v1y = i > 0 ? (p1.y - p0.y) / (p1.frame - p0.frame) : 0;
      const v2x = (p2.x - p1.x) / (p2.frame - p1.frame);
      const v2y = (p2.y - p1.y) / (p2.frame - p1.frame);
      
      const tension = 0.5;  // Increased for smoother curves
      const predictionFactor = 0.2;  // Reduced for less aggressive prediction
      
      // Control point 1 with velocity prediction
      const cp1x = p1.x + (p2.x - p0.x) * tension + v1x * (p2.frame - p1.frame) * predictionFactor;
      const cp1y = p1.y + (p2.y - p0.y) * tension + v1y * (p2.frame - p1.frame) * predictionFactor;
      
      // Control point 2 with velocity prediction
      const cp2x = p2.x - (p3.x - p1.x) * tension - v2x * (p2.frame - p1.frame) * predictionFactor;
      const cp2y = p2.y - (p3.y - p1.y) * tension - v2y * (p2.frame - p1.frame) * predictionFactor;
      
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
      
      if (i === keyPoints.length - 2) {
        controlPoints.push(p2);
      }
    }
    
    return controlPoints;
  }
  
  /**
   * Apply final stabilization to reduce jitter
   */
  private applyFinalStabilization(trajectory: ControlPoint[]): ControlPoint[] {
    // Analyze overall motion to determine stabilization strength
    const motionStats = this.analyzeOverallMotion(trajectory);
    
    // First pass: Apply adaptive median filter
    const medianFiltered: ControlPoint[] = [];
    const baseMedianSize = motionStats.hasHighFrequencyNoise ? 5 : 3;
    
    for (let i = 0; i < trajectory.length; i++) {
      if (i < baseMedianSize || i >= trajectory.length - baseMedianSize) {
        medianFiltered.push(trajectory[i]);
        continue;
      }
      
      // Check local motion intensity
      const localMotion = this.getLocalMotionIntensity(trajectory, i, 10);
      const medianSize = localMotion > motionStats.avgMotion * 2 ? 3 : baseMedianSize;
      
      const xValues: number[] = [];
      const yValues: number[] = [];
      
      for (let j = Math.max(0, i - medianSize); 
           j <= Math.min(trajectory.length - 1, i + medianSize); j++) {
        xValues.push(trajectory[j].x);
        yValues.push(trajectory[j].y);
      }
      
      xValues.sort((a, b) => a - b);
      yValues.sort((a, b) => a - b);
      
      medianFiltered.push({
        frame: trajectory[i].frame,
        x: xValues[Math.floor(xValues.length / 2)],
        y: yValues[Math.floor(yValues.length / 2)]
      });
    }
    
    // Second pass: Apply gentle smoothing only where needed
    const stabilized: ControlPoint[] = [];
    
    for (let i = 0; i < medianFiltered.length; i++) {
      if (i < 2 || i >= medianFiltered.length - 2) {
        stabilized.push(medianFiltered[i]);
        continue;
      }
      
      // Check if this point needs stabilization
      const jitter = this.calculateLocalJitter(medianFiltered, i);
      
      if (jitter < motionStats.avgMotion * 0.1) {
        // Low jitter: no additional smoothing needed
        stabilized.push(medianFiltered[i]);
      } else {
        // Apply light smoothing
        const smoothingWindow = 3;
        let sumX = 0, sumY = 0, count = 0;
        
        for (let j = i - smoothingWindow; j <= i + smoothingWindow; j++) {
          if (j >= 0 && j < medianFiltered.length) {
            sumX += medianFiltered[j].x;
            sumY += medianFiltered[j].y;
            count++;
          }
        }
        
        stabilized.push({
          frame: medianFiltered[i].frame,
          x: sumX / count,
          y: sumY / count
        });
      }
    }
    
    return stabilized;
  }
  
  /**
   * Analyze overall motion characteristics
   */
  private analyzeOverallMotion(trajectory: ControlPoint[]): {
    avgMotion: number;
    maxMotion: number;
    hasHighFrequencyNoise: boolean;
  } {
    let totalMotion = 0;
    let maxMotion = 0;
    let highFreqChanges = 0;
    
    for (let i = 1; i < trajectory.length; i++) {
      const dx = trajectory[i].x - trajectory[i-1].x;
      const dy = trajectory[i].y - trajectory[i-1].y;
      const motion = Math.sqrt(dx * dx + dy * dy);
      
      totalMotion += motion;
      maxMotion = Math.max(maxMotion, motion);
      
      // Check for high frequency changes
      if (i > 1) {
        const prevDx = trajectory[i-1].x - trajectory[i-2].x;
        const prevDy = trajectory[i-1].y - trajectory[i-2].y;
        
        const dirChange = Math.abs(Math.atan2(dy, dx) - Math.atan2(prevDy, prevDx));
        if (dirChange > Math.PI / 4) {
          highFreqChanges++;
        }
      }
    }
    
    return {
      avgMotion: totalMotion / (trajectory.length - 1),
      maxMotion: maxMotion,
      hasHighFrequencyNoise: highFreqChanges > trajectory.length * 0.2
    };
  }
  
  /**
   * Get local motion intensity
   */
  private getLocalMotionIntensity(
    trajectory: ControlPoint[], 
    centerIdx: number, 
    windowSize: number
  ): number {
    let totalMotion = 0;
    let count = 0;
    
    const start = Math.max(1, centerIdx - windowSize);
    const end = Math.min(trajectory.length - 1, centerIdx + windowSize);
    
    for (let i = start; i < end; i++) {
      const dx = trajectory[i].x - trajectory[i-1].x;
      const dy = trajectory[i].y - trajectory[i-1].y;
      totalMotion += Math.sqrt(dx * dx + dy * dy);
      count++;
    }
    
    return count > 0 ? totalMotion / count : 0;
  }
  
  /**
   * Calculate local jitter
   */
  private calculateLocalJitter(
    trajectory: ControlPoint[], 
    centerIdx: number
  ): number {
    if (centerIdx < 2 || centerIdx >= trajectory.length - 2) return 0;
    
    // Calculate expected position based on surrounding points
    const expectedX = (trajectory[centerIdx - 1].x + trajectory[centerIdx + 1].x) / 2;
    const expectedY = (trajectory[centerIdx - 1].y + trajectory[centerIdx + 1].y) / 2;
    
    // Calculate deviation
    const dx = trajectory[centerIdx].x - expectedX;
    const dy = trajectory[centerIdx].y - expectedY;
    
    return Math.sqrt(dx * dx + dy * dy);
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
   * Convert smooth trajectory to frame transforms
   */
  private createFrameTransforms(
    trajectory: ControlPoint[],
    dimensions: { width: number; height: number },
    frameWidth: number,
    frameHeight: number,
    outputRatio: number,
    hasHeadData: boolean = false,
    reframingConfig?: ReframingConfig
  ): Map<number, FrameTransform> {
    const transforms = new Map<number, FrameTransform>();
    
    // Convert ReframingConfig to ReframingSettings
    const settings: Partial<ReframingSettings> = reframingConfig ? {
      outputRatio: reframingConfig.outputRatio,
      padding: reframingConfig.padding,
      smoothness: reframingConfig.smoothness
    } : {};
    
    // Use ReframeSizeCalculatorV2 to determine optimal reframe dimensions
    // If we have head data, use head-based framing for better portrait shots
    const reframeDimensions = hasHeadData 
      ? ReframeSizeCalculatorV2.calculateHeadBasedReframeSize(
          dimensions,
          frameWidth,
          frameHeight,
          outputRatio,
          settings
        )
      : ReframeSizeCalculatorV2.calculateOptimalReframeSize(
          dimensions,
          frameWidth,
          frameHeight,
          outputRatio,
          settings
        );
    
    // Extract calculated values
    const scale = reframeDimensions.scale;
    const consistentWidth = reframeDimensions.width;
    const consistentHeight = reframeDimensions.height;
    
    
    // Create transforms with smooth trajectory and consistent scale
    for (const point of trajectory) {
      // Ensure frame bounds with consistent dimensions
      const halfWidth = consistentWidth / 2;
      const halfHeight = consistentHeight / 2;
      
      // Apply offset if provided
      let targetX = point.x;
      let targetY = point.y;
      
      if (settings?.reframeBoxOffset) {
        // The offset represents where the target should be positioned within the reframe box
        // When the user drags the box right, the target moves left within it
        // So we need to subtract the offset to get the correct box position
        targetX -= settings.reframeBoxOffset.x;
        targetY -= settings.reframeBoxOffset.y;
      }
      
      // Clamp position to ensure frame stays within video bounds
      const clampedX = Math.max(halfWidth, Math.min(frameWidth - halfWidth, targetX));
      const clampedY = Math.max(halfHeight, Math.min(frameHeight - halfHeight, targetY));
      
      
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