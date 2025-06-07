import { BoundingBox, FrameTransform } from '@/types';

interface BoxCorners {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
  center: { x: number; y: number };
  headCenter?: { x: number; y: number };
}

interface StabilizedPoint {
  x: number;
  y: number;
  weight: number;
}

export class MultiPointStabilizer {
  private cornerHistory: BoxCorners[] = [];
  private maxHistorySize: number = 30;
  private smoothingFactor: number = 0.85; // Higher = more stable, lower = more responsive
  
  calculateStableFrame(
    target: BoundingBox & { headCenterX?: number; headCenterY?: number },
    outputRatio: number,
    frameWidth: number,
    frameHeight: number,
    padding: number = 0.2
  ): FrameTransform {
    // Extract all corner points
    const corners: BoxCorners = {
      topLeft: { x: target.x, y: target.y },
      topRight: { x: target.x + target.width, y: target.y },
      bottomLeft: { x: target.x, y: target.y + target.height },
      bottomRight: { x: target.x + target.width, y: target.y + target.height },
      center: { x: target.x + target.width / 2, y: target.y + target.height / 2 }
    };
    
    // Add head center if available
    if (target.headCenterX !== undefined && target.headCenterY !== undefined) {
      corners.headCenter = { x: target.headCenterX, y: target.headCenterY };
    }
    
    // Store history
    this.cornerHistory.push(corners);
    if (this.cornerHistory.length > this.maxHistorySize) {
      this.cornerHistory.shift();
    }
    
    // Calculate stabilized points using weighted average of multiple frames
    const stabilizedPoints = this.calculateStabilizedPoints();
    
    // Determine focus point based on motion and pose
    const focusPoint = this.calculateFocusPoint(stabilizedPoints, target);
    
    // Calculate stable bounding box from stabilized corners
    const stableBounds = this.calculateStableBounds(stabilizedPoints);
    
    // Add dynamic padding based on motion
    const motionPadding = this.calculateMotionPadding(padding);
    
    // Calculate final frame bounds
    const frameBounds = {
      minX: stableBounds.minX - stableBounds.width * motionPadding,
      maxX: stableBounds.maxX + stableBounds.width * motionPadding,
      minY: stableBounds.minY - stableBounds.height * motionPadding,
      maxY: stableBounds.maxY + stableBounds.height * motionPadding
    };
    
    // Ensure bounds are within frame
    frameBounds.minX = Math.max(0, frameBounds.minX);
    frameBounds.minY = Math.max(0, frameBounds.minY);
    frameBounds.maxX = Math.min(frameWidth, frameBounds.maxX);
    frameBounds.maxY = Math.min(frameHeight, frameBounds.maxY);
    
    const targetWidth = frameBounds.maxX - frameBounds.minX;
    const targetHeight = frameBounds.maxY - frameBounds.minY;
    
    // Calculate scale to fit the output ratio
    const targetRatio = targetWidth / targetHeight;
    let scale: number;
    
    if (targetRatio > outputRatio) {
      scale = frameWidth / targetWidth;
    } else {
      scale = frameHeight / targetHeight;
    }
    
    // Limit maximum zoom
    scale = Math.min(scale, 1.5);
    
    return {
      x: focusPoint.x,
      y: focusPoint.y,
      scale: scale,
      rotation: 0
    };
  }
  
  private calculateStabilizedPoints(): {
    topLeft: StabilizedPoint;
    topRight: StabilizedPoint;
    bottomLeft: StabilizedPoint;
    bottomRight: StabilizedPoint;
    center: StabilizedPoint;
    headCenter?: StabilizedPoint;
  } {
    if (this.cornerHistory.length === 0) {
      throw new Error('No corner history available');
    }
    
    const latest = this.cornerHistory[this.cornerHistory.length - 1];
    
    if (this.cornerHistory.length < 3) {
      // Not enough history, return latest points
      return {
        topLeft: { ...latest.topLeft, weight: 1 },
        topRight: { ...latest.topRight, weight: 1 },
        bottomLeft: { ...latest.bottomLeft, weight: 1 },
        bottomRight: { ...latest.bottomRight, weight: 1 },
        center: { ...latest.center, weight: 1 },
        headCenter: latest.headCenter ? { ...latest.headCenter, weight: 1 } : undefined
      };
    }
    
    // Calculate weighted average using exponential smoothing
    const stabilized = {
      topLeft: this.exponentialSmooth('topLeft'),
      topRight: this.exponentialSmooth('topRight'),
      bottomLeft: this.exponentialSmooth('bottomLeft'),
      bottomRight: this.exponentialSmooth('bottomRight'),
      center: this.exponentialSmooth('center'),
      headCenter: latest.headCenter ? this.exponentialSmooth('headCenter') : undefined
    };
    
    return stabilized;
  }
  
  private exponentialSmooth(cornerName: keyof BoxCorners): StabilizedPoint {
    const values = this.cornerHistory
      .filter(h => h[cornerName] !== undefined)
      .map(h => h[cornerName] as { x: number; y: number });
    
    if (values.length === 0) {
      return { x: 0, y: 0, weight: 0 };
    }
    
    let smoothedX = values[0].x;
    let smoothedY = values[0].y;
    
    // Apply exponential smoothing
    for (let i = 1; i < values.length; i++) {
      smoothedX = smoothedX * this.smoothingFactor + values[i].x * (1 - this.smoothingFactor);
      smoothedY = smoothedY * this.smoothingFactor + values[i].y * (1 - this.smoothingFactor);
    }
    
    return { x: smoothedX, y: smoothedY, weight: 1 };
  }
  
  private calculateFocusPoint(
    stabilizedPoints: ReturnType<typeof this.calculateStabilizedPoints>,
    currentBox: BoundingBox & { headCenterX?: number; headCenterY?: number }
  ): { x: number; y: number } {
    // If head center is available, use it as primary focus
    if (stabilizedPoints.headCenter) {
      return {
        x: stabilizedPoints.headCenter.x,
        y: stabilizedPoints.headCenter.y
      };
    }
    
    // Otherwise, use a weighted combination based on pose
    const aspectRatio = currentBox.width / currentBox.height;
    
    if (aspectRatio > 1.5) {
      // Horizontal pose - focus on left side where head likely is
      return {
        x: stabilizedPoints.topLeft.x * 0.7 + stabilizedPoints.center.x * 0.3,
        y: stabilizedPoints.center.y
      };
    } else if (aspectRatio < 0.5) {
      // Very tall pose - focus on upper portion
      return {
        x: stabilizedPoints.center.x,
        y: stabilizedPoints.topLeft.y * 0.7 + stabilizedPoints.center.y * 0.3
      };
    } else {
      // Normal pose - use center with slight bias toward top
      return {
        x: stabilizedPoints.center.x,
        y: stabilizedPoints.center.y * 0.9 + stabilizedPoints.topLeft.y * 0.1
      };
    }
  }
  
  private calculateStableBounds(stabilizedPoints: ReturnType<typeof this.calculateStabilizedPoints>) {
    return {
      minX: Math.min(stabilizedPoints.topLeft.x, stabilizedPoints.bottomLeft.x),
      maxX: Math.max(stabilizedPoints.topRight.x, stabilizedPoints.bottomRight.x),
      minY: Math.min(stabilizedPoints.topLeft.y, stabilizedPoints.topRight.y),
      maxY: Math.max(stabilizedPoints.bottomLeft.y, stabilizedPoints.bottomRight.y),
      width: Math.abs(stabilizedPoints.topRight.x - stabilizedPoints.topLeft.x),
      height: Math.abs(stabilizedPoints.bottomLeft.y - stabilizedPoints.topLeft.y)
    };
  }
  
  private calculateMotionPadding(basePadding: number): number {
    if (this.cornerHistory.length < 3) {
      return basePadding;
    }
    
    // Calculate motion velocity
    const recent = this.cornerHistory.slice(-3);
    let totalMotion = 0;
    
    for (let i = 1; i < recent.length; i++) {
      const dx = recent[i].center.x - recent[i-1].center.x;
      const dy = recent[i].center.y - recent[i-1].center.y;
      totalMotion += Math.sqrt(dx * dx + dy * dy);
    }
    
    const avgMotion = totalMotion / (recent.length - 1);
    
    // More motion = more padding
    const motionFactor = Math.min(avgMotion / 50, 1); // Normalize to 0-1
    return basePadding + basePadding * motionFactor * 0.5; // Up to 50% more padding for fast motion
  }
  
  reset(): void {
    this.cornerHistory = [];
  }
  
  setSmoothingFactor(factor: number): void {
    this.smoothingFactor = Math.max(0.1, Math.min(0.95, factor));
  }
}