import { BoundingBox, FrameTransform, TrackedObject } from '@/types';

export class SmoothingAlgorithm {
  private history: FrameTransform[] = [];
  private smoothingFactor: number;
  private maxHistorySize: number = 30;

  constructor(smoothingFactor: number = 0.8) {
    this.smoothingFactor = smoothingFactor;
  }

  smooth(currentTransform: FrameTransform): FrameTransform {
    this.history.push(currentTransform);
    
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    if (this.history.length === 1) {
      return currentTransform;
    }

    // Exponential moving average
    const smoothed: FrameTransform = { ...currentTransform };
    const alpha = 1 - this.smoothingFactor;
    
    for (let i = this.history.length - 2; i >= 0; i--) {
      const weight = Math.pow(alpha, this.history.length - 1 - i);
      smoothed.x += (this.history[i].x - smoothed.x) * weight;
      smoothed.y += (this.history[i].y - smoothed.y) * weight;
      smoothed.scale += (this.history[i].scale - smoothed.scale) * weight;
    }

    return smoothed;
  }

  reset(): void {
    this.history = [];
  }
}

export class TargetSelector {
  selectTarget(
    detections: BoundingBox[],
    strategy: 'largest' | 'centered' | 'most-confident',
    frameWidth: number,
    frameHeight: number
  ): BoundingBox | null {
    if (detections.length === 0) return null;

    switch (strategy) {
      case 'largest':
        return this.selectLargest(detections);
      
      case 'centered':
        return this.selectMostCentered(detections, frameWidth, frameHeight);
      
      case 'most-confident':
        return this.selectMostConfident(detections);
      
      default:
        return detections[0];
    }
  }

  private selectLargest(detections: BoundingBox[]): BoundingBox {
    return detections.reduce((largest, current) => {
      const currentArea = current.width * current.height;
      const largestArea = largest.width * largest.height;
      return currentArea > largestArea ? current : largest;
    });
  }

  private selectMostCentered(detections: BoundingBox[], frameWidth: number, frameHeight: number): BoundingBox {
    const centerX = frameWidth / 2;
    const centerY = frameHeight / 2;

    return detections.reduce((closest, current) => {
      const currentCenterX = current.x + current.width / 2;
      const currentCenterY = current.y + current.height / 2;
      const currentDist = Math.sqrt(
        Math.pow(currentCenterX - centerX, 2) + 
        Math.pow(currentCenterY - centerY, 2)
      );

      const closestCenterX = closest.x + closest.width / 2;
      const closestCenterY = closest.y + closest.height / 2;
      const closestDist = Math.sqrt(
        Math.pow(closestCenterX - centerX, 2) + 
        Math.pow(closestCenterY - centerY, 2)
      );

      return currentDist < closestDist ? current : closest;
    });
  }

  private selectMostConfident(detections: BoundingBox[]): BoundingBox {
    return detections.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );
  }
}

export class FrameCalculator {
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

    // Calculate bounding box that includes all targets
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
}