import { BoundingBox, FrameTransform } from '@/types';

// Extended BoundingBox type to include head center
interface BoxWithHead extends BoundingBox {
  headCenterX?: number;
  headCenterY?: number;
}

interface BoxHistory {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export class StableFrameCalculator {
  private boxHistory: BoxHistory[] = [];
  private maxHistorySize: number = 30;
  private useStableCenter: boolean = true;
  
  calculateOptimalFrame(
    targets: BoundingBox[],
    outputRatio: number,
    frameWidth: number,
    frameHeight: number,
    padding: number = 0.1
  ): FrameTransform {
    if (targets.length === 0) {
      return {
        x: frameWidth / 2,
        y: frameHeight / 2,
        scale: 1,
        rotation: 0
      };
    }

    // For single target tracking (which is our case with manual selection)
    if (targets.length === 1) {
      const target = targets[0] as BoxWithHead;
      
      // Calculate various center points
      const geometricCenterX = target.x + target.width / 2;
      const geometricCenterY = target.y + target.height / 2;
      
      // Use actual head center if available, otherwise estimate
      let headCenterX: number;
      let headCenterY: number;
      
      if (target.headCenterX !== undefined && target.headCenterY !== undefined) {
        // Use detected head center
        headCenterX = target.headCenterX;
        headCenterY = target.headCenterY;
        console.log(`Frame ${this.boxHistory.length}: Using detected head center: (${headCenterX.toFixed(2)}, ${headCenterY.toFixed(2)}) for box at (${target.x.toFixed(2)}, ${target.y.toFixed(2)})`);
      } else {
        // Fallback: estimate head position
        headCenterX = geometricCenterX;
        headCenterY = target.y + target.height * 0.3; // 30% from top
        console.log(`Frame ${this.boxHistory.length}: No head center detected, estimating: (${headCenterX.toFixed(2)}, ${headCenterY.toFixed(2)})`);
      }
      
      // Store history
      this.boxHistory.push({
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
        centerX: headCenterX,
        centerY: headCenterY
      });
      
      // Keep history size limited
      if (this.boxHistory.length > this.maxHistorySize) {
        this.boxHistory.shift();
      }
      
      // Calculate stable center using weighted average
      let stableCenterX = headCenterX;
      let stableCenterY = headCenterY;
      
      if (this.boxHistory.length >= 5) {
        // Use median of recent centers to remove outliers
        const recentCenters = this.boxHistory.slice(-10);
        
        // Sort centers
        const sortedX = recentCenters.map(h => h.centerX).sort((a, b) => a - b);
        const sortedY = recentCenters.map(h => h.centerY).sort((a, b) => a - b);
        
        // Get median
        const midIdx = Math.floor(sortedX.length / 2);
        const medianX = sortedX[midIdx];
        const medianY = sortedY[midIdx];
        
        // Weighted average between current and median
        const weight = 0.7; // How much to trust the median
        stableCenterX = medianX * weight + headCenterX * (1 - weight);
        stableCenterY = medianY * weight + headCenterY * (1 - weight);
      }
      
      // Calculate stable box dimensions using average
      let stableWidth = target.width;
      let stableHeight = target.height;
      
      if (this.boxHistory.length >= 5) {
        const recentBoxes = this.boxHistory.slice(-15);
        const avgWidth = recentBoxes.reduce((sum, h) => sum + h.width, 0) / recentBoxes.length;
        const avgHeight = recentBoxes.reduce((sum, h) => sum + h.height, 0) / recentBoxes.length;
        
        // Smooth transitions
        stableWidth = avgWidth * 0.8 + target.width * 0.2;
        stableHeight = avgHeight * 0.8 + target.height * 0.2;
      }
      
      // Calculate frame bounds with stable dimensions
      const halfWidth = stableWidth / 2;
      const halfHeight = stableHeight / 2;
      
      let minX = stableCenterX - halfWidth;
      let maxX = stableCenterX + halfWidth;
      let minY = stableCenterY - halfHeight;
      let maxY = stableCenterY + halfHeight;
      
      // Add padding
      const paddingX = stableWidth * padding;
      const paddingY = stableHeight * padding;
      
      minX -= paddingX;
      minY -= paddingY;
      maxX += paddingX;
      maxY += paddingY;
      
      // Ensure bounds are within frame
      minX = Math.max(0, minX);
      minY = Math.max(0, minY);
      maxX = Math.min(frameWidth, maxX);
      maxY = Math.min(frameHeight, maxY);
      
      const targetWidth = maxX - minX;
      const targetHeight = maxY - minY;
      
      // Calculate scale to fit the output ratio
      const targetRatio = targetWidth / targetHeight;
      let scale: number;
      
      if (targetRatio > outputRatio) {
        // Target is wider than output ratio
        scale = frameWidth / targetWidth;
      } else {
        // Target is taller than output ratio
        scale = frameHeight / targetHeight;
      }
      
      // Ensure we don't zoom in beyond original resolution
      scale = Math.min(scale, 1);
      
      return {
        x: stableCenterX,
        y: stableCenterY,
        scale: scale,
        rotation: 0
      };
    }
    
    // For multiple targets, use original logic
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const target of targets) {
      minX = Math.min(minX, target.x);
      minY = Math.min(minY, target.y);
      maxX = Math.max(maxX, target.x + target.width);
      maxY = Math.max(maxY, target.y + target.height);
    }

    // Add padding
    const paddingX = (maxX - minX) * padding;
    const paddingY = (maxY - minY) * padding;
    
    minX -= paddingX;
    minY -= paddingY;
    maxX += paddingX;
    maxY += paddingY;

    // Ensure bounds are within frame
    minX = Math.max(0, minX);
    minY = Math.max(0, minY);
    maxX = Math.min(frameWidth, maxX);
    maxY = Math.min(frameHeight, maxY);

    const targetWidth = maxX - minX;
    const targetHeight = maxY - minY;
    const targetCenterX = (minX + maxX) / 2;
    const targetCenterY = (minY + maxY) / 2;

    // Calculate scale to fit the output ratio
    const targetRatio = targetWidth / targetHeight;
    let scale: number;

    if (targetRatio > outputRatio) {
      // Target is wider than output ratio
      scale = frameWidth / targetWidth;
    } else {
      // Target is taller than output ratio
      scale = frameHeight / targetHeight;
    }

    // Ensure we don't zoom in beyond original resolution
    scale = Math.min(scale, 1);

    return {
      x: targetCenterX,
      y: targetCenterY,
      scale: scale,
      rotation: 0
    };
  }
  
  reset(): void {
    this.boxHistory = [];
  }
  
  setUseStableCenter(value: boolean): void {
    this.useStableCenter = value;
  }
}