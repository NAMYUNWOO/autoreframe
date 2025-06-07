import { BoundingBox, Detection, FrameTransform } from '@/types';

interface TrajectoryPoint {
  frameNumber: number;
  timestamp: number;
  x: number;
  y: number;
  width: number;
  height: number;
  headX?: number;
  headY?: number;
}

interface SmoothedTrajectory {
  frameNumber: number;
  x: number;
  y: number;
  scale: number;
}

export class TrajectorySmoother {
  private fps: number = 30;
  private windowSize: number = 30; // 1 second window at 30fps
  
  /**
   * Smooth entire trajectory using multiple passes
   */
  smoothTrajectory(
    detections: Detection[],
    targetTrackId: string,
    frameWidth: number,
    frameHeight: number,
    outputRatio: number
  ): Map<number, FrameTransform> {
    // Step 1: Extract trajectory points for target
    const trajectory = this.extractTrajectory(detections, targetTrackId);
    
    if (trajectory.length === 0) {
      return new Map();
    }
    
    // Step 2: Apply Savitzky-Golay filter for smooth derivative
    const sgSmoothed = this.applySavitzkyGolay(trajectory);
    
    // Step 3: Apply directional consistency within 1-second windows
    const directionalSmoothed = this.applyDirectionalConsistency(sgSmoothed);
    
    // Step 4: Apply Kalman filter for final smoothing
    const kalmanSmoothed = this.applyKalmanFilter(directionalSmoothed);
    
    // Step 5: Convert to frame transforms
    return this.convertToFrameTransforms(kalmanSmoothed, frameWidth, frameHeight, outputRatio);
  }
  
  /**
   * Extract trajectory points from detections
   */
  private extractTrajectory(detections: Detection[], targetTrackId: string): TrajectoryPoint[] {
    const points: TrajectoryPoint[] = [];
    
    for (const detection of detections) {
      const targetBox = detection.boxes.find(box => box.trackId === targetTrackId);
      if (targetBox) {
        const point: TrajectoryPoint = {
          frameNumber: detection.frameNumber,
          timestamp: detection.timestamp,
          x: targetBox.x + targetBox.width / 2,
          y: targetBox.y + targetBox.height / 2,
          width: targetBox.width,
          height: targetBox.height
        };
        
        if (targetBox.headCenterX !== undefined && targetBox.headCenterY !== undefined) {
          point.headX = targetBox.headCenterX;
          point.headY = targetBox.headCenterY;
        }
        
        points.push(point);
      }
    }
    
    // Sort by frame number
    points.sort((a, b) => a.frameNumber - b.frameNumber);
    
    return points;
  }
  
  /**
   * Apply Savitzky-Golay filter for smooth derivatives
   * This preserves features while smoothing noise
   */
  private applySavitzkyGolay(trajectory: TrajectoryPoint[]): TrajectoryPoint[] {
    const windowSize = Math.min(21, Math.floor(trajectory.length / 2) * 2 + 1); // Ensure odd
    const polyOrder = Math.min(3, windowSize - 2);
    
    if (trajectory.length < windowSize) {
      return trajectory;
    }
    
    // Extract x and y coordinates
    const xCoords = trajectory.map(p => p.x);
    const yCoords = trajectory.map(p => p.y);
    const widths = trajectory.map(p => p.width);
    const heights = trajectory.map(p => p.height);
    
    // Apply filter
    const smoothedX = this.savitzkyGolayFilter(xCoords, windowSize, polyOrder);
    const smoothedY = this.savitzkyGolayFilter(yCoords, windowSize, polyOrder);
    const smoothedWidths = this.savitzkyGolayFilter(widths, windowSize, polyOrder);
    const smoothedHeights = this.savitzkyGolayFilter(heights, windowSize, polyOrder);
    
    // Reconstruct trajectory
    return trajectory.map((point, i) => ({
      ...point,
      x: smoothedX[i],
      y: smoothedY[i],
      width: smoothedWidths[i],
      height: smoothedHeights[i]
    }));
  }
  
  /**
   * Savitzky-Golay filter implementation
   */
  private savitzkyGolayFilter(data: number[], windowSize: number, polyOrder: number): number[] {
    const halfWindow = Math.floor(windowSize / 2);
    const result: number[] = [];
    
    // Generate convolution coefficients
    const coeffs = this.savitzkyGolayCoefficients(windowSize, polyOrder);
    
    for (let i = 0; i < data.length; i++) {
      let sum = 0;
      let coeffSum = 0;
      
      for (let j = -halfWindow; j <= halfWindow; j++) {
        const idx = i + j;
        if (idx >= 0 && idx < data.length) {
          sum += data[idx] * coeffs[j + halfWindow];
          coeffSum += coeffs[j + halfWindow];
        }
      }
      
      result.push(coeffSum > 0 ? sum / coeffSum : data[i]);
    }
    
    return result;
  }
  
  /**
   * Generate Savitzky-Golay coefficients
   */
  private savitzkyGolayCoefficients(windowSize: number, polyOrder: number): number[] {
    const halfWindow = Math.floor(windowSize / 2);
    const coeffs: number[] = [];
    
    // Simplified coefficient generation for polynomial order 2
    for (let i = -halfWindow; i <= halfWindow; i++) {
      // This is a simplified version - in production, use proper polynomial fitting
      const weight = 1 - Math.abs(i) / (halfWindow + 1);
      coeffs.push(weight);
    }
    
    // Normalize
    const sum = coeffs.reduce((a, b) => a + b, 0);
    return coeffs.map(c => c / sum);
  }
  
  /**
   * Apply directional consistency within 1-second windows
   */
  private applyDirectionalConsistency(trajectory: TrajectoryPoint[]): TrajectoryPoint[] {
    const smoothed = [...trajectory];
    const windowFrames = this.windowSize;
    
    for (let i = 0; i < smoothed.length; i++) {
      const windowStart = Math.max(0, i - Math.floor(windowFrames / 2));
      const windowEnd = Math.min(smoothed.length - 1, i + Math.floor(windowFrames / 2));
      
      // Calculate average direction in window
      let sumDx = 0, sumDy = 0;
      let count = 0;
      
      for (let j = windowStart; j < windowEnd; j++) {
        const dx = trajectory[j + 1].x - trajectory[j].x;
        const dy = trajectory[j + 1].y - trajectory[j].y;
        sumDx += dx;
        sumDy += dy;
        count++;
      }
      
      if (count > 0) {
        const avgDx = sumDx / count;
        const avgDy = sumDy / count;
        
        // Apply directional consistency
        if (i > 0) {
          const currentDx = smoothed[i].x - smoothed[i - 1].x;
          const currentDy = smoothed[i].y - smoothed[i - 1].y;
          
          // Blend current direction with average
          const blendFactor = 0.7;
          const newDx = currentDx * (1 - blendFactor) + avgDx * blendFactor;
          const newDy = currentDy * (1 - blendFactor) + avgDy * blendFactor;
          
          smoothed[i].x = smoothed[i - 1].x + newDx;
          smoothed[i].y = smoothed[i - 1].y + newDy;
        }
      }
    }
    
    return smoothed;
  }
  
  /**
   * Apply Kalman filter for optimal state estimation
   */
  private applyKalmanFilter(trajectory: TrajectoryPoint[]): TrajectoryPoint[] {
    // Kalman filter parameters
    const processNoise = 0.01;
    const measurementNoise = 1.0;
    
    // State: [x, y, vx, vy, width, height]
    let state = {
      x: trajectory[0].x,
      y: trajectory[0].y,
      vx: 0,
      vy: 0,
      width: trajectory[0].width,
      height: trajectory[0].height
    };
    
    // Covariance matrix (simplified)
    let P = 1.0;
    
    const filtered: TrajectoryPoint[] = [];
    
    for (let i = 0; i < trajectory.length; i++) {
      const dt = i > 0 ? 1 / this.fps : 0;
      
      // Prediction step
      if (i > 0) {
        state.x += state.vx * dt;
        state.y += state.vy * dt;
        P += processNoise;
      }
      
      // Update step
      const measurement = trajectory[i];
      const K = P / (P + measurementNoise); // Kalman gain
      
      // Update state with measurement
      state.x += K * (measurement.x - state.x);
      state.y += K * (measurement.y - state.y);
      state.width += K * (measurement.width - state.width);
      state.height += K * (measurement.height - state.height);
      
      // Update velocity
      if (i > 0) {
        state.vx = (state.x - filtered[i - 1].x) / dt;
        state.vy = (state.y - filtered[i - 1].y) / dt;
      }
      
      // Update covariance
      P *= (1 - K);
      
      filtered.push({
        ...trajectory[i],
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height
      });
    }
    
    return filtered;
  }
  
  /**
   * Convert smoothed trajectory to frame transforms
   */
  private convertToFrameTransforms(
    trajectory: TrajectoryPoint[],
    frameWidth: number,
    frameHeight: number,
    outputRatio: number
  ): Map<number, FrameTransform> {
    const transforms = new Map<number, FrameTransform>();
    
    // Calculate padding based on average box size
    const avgWidth = trajectory.reduce((sum, p) => sum + p.width, 0) / trajectory.length;
    const avgHeight = trajectory.reduce((sum, p) => sum + p.height, 0) / trajectory.length;
    const padding = 0.3; // 30% padding
    
    for (const point of trajectory) {
      // Use head position if available, otherwise use center
      const focusX = point.headX ?? point.x;
      const focusY = point.headY ?? point.y;
      
      // Calculate frame bounds with padding
      const frameW = point.width * (1 + padding * 2);
      const frameH = point.height * (1 + padding * 2);
      
      // Calculate scale to fit output ratio
      const currentRatio = frameW / frameH;
      let scale: number;
      
      if (currentRatio > outputRatio) {
        scale = frameWidth / frameW;
      } else {
        scale = frameHeight / frameH;
      }
      
      // Limit zoom
      scale = Math.min(scale, 1.5);
      
      transforms.set(point.frameNumber, {
        x: focusX,
        y: focusY,
        scale: scale,
        rotation: 0
      });
    }
    
    // Fill gaps between frames with interpolation
    const minFrame = Math.min(...trajectory.map(p => p.frameNumber));
    const maxFrame = Math.max(...trajectory.map(p => p.frameNumber));
    
    for (let frame = minFrame; frame <= maxFrame; frame++) {
      if (!transforms.has(frame)) {
        // Find surrounding frames
        let prevFrame = -1, nextFrame = -1;
        
        for (let f = frame - 1; f >= minFrame; f--) {
          if (transforms.has(f)) {
            prevFrame = f;
            break;
          }
        }
        
        for (let f = frame + 1; f <= maxFrame; f++) {
          if (transforms.has(f)) {
            nextFrame = f;
            break;
          }
        }
        
        if (prevFrame !== -1 && nextFrame !== -1) {
          const prev = transforms.get(prevFrame)!;
          const next = transforms.get(nextFrame)!;
          const t = (frame - prevFrame) / (nextFrame - prevFrame);
          
          transforms.set(frame, {
            x: prev.x + (next.x - prev.x) * t,
            y: prev.y + (next.y - prev.y) * t,
            scale: prev.scale + (next.scale - prev.scale) * t,
            rotation: 0
          });
        }
      }
    }
    
    return transforms;
  }
  
  setFPS(fps: number): void {
    this.fps = fps;
    this.windowSize = fps; // 1 second window
  }
}