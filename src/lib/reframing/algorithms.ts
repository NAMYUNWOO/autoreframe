import { BoundingBox, FrameTransform, TrackedObject } from '@/types';

export class SmoothingAlgorithm {
  private history: FrameTransform[] = [];
  private smoothingFactor: number;
  private maxHistorySize: number = 60; // Increased for ByteTrack
  private lastValidTransform: FrameTransform | null = null;
  private velocityHistory: { vx: number; vy: number; vs: number }[] = [];
  private maxVelocity: number = 10; // Much lower for ByteTrack stability
  private maxAcceleration: number = 2; // Much lower for ByteTrack stability
  private useAggressiveSmoothing: boolean = false;
  private medianFilterSize: number = 5; // For outlier rejection

  constructor(smoothingFactor: number = 0.8, useAggressiveSmoothing: boolean = false) {
    this.smoothingFactor = smoothingFactor;
    this.useAggressiveSmoothing = useAggressiveSmoothing;
    
    if (useAggressiveSmoothing) {
      this.maxHistorySize = 90; // Even more history for ByteTrack
      this.maxVelocity = 5; // Very conservative movement
      this.maxAcceleration = 1; // Very smooth acceleration
      this.medianFilterSize = 7; // Stronger outlier rejection
    }
  }

  smooth(currentTransform: FrameTransform): FrameTransform {
    // If we don't have a valid transform (no detection), use prediction
    if (currentTransform.x === 0 && currentTransform.y === 0) {
      if (this.lastValidTransform && this.velocityHistory.length > 0) {
        const lastVel = this.velocityHistory[this.velocityHistory.length - 1];
        currentTransform = {
          x: this.lastValidTransform.x + lastVel.vx,
          y: this.lastValidTransform.y + lastVel.vy,
          scale: this.lastValidTransform.scale + lastVel.vs,
          rotation: 0
        };
      } else if (this.lastValidTransform) {
        currentTransform = { ...this.lastValidTransform };
      }
    } else {
      this.lastValidTransform = { ...currentTransform };
    }

    // Apply velocity constraints
    if (this.history.length > 0) {
      const prevTransform = this.history[this.history.length - 1];
      const dx = currentTransform.x - prevTransform.x;
      const dy = currentTransform.y - prevTransform.y;
      const ds = currentTransform.scale - prevTransform.scale;
      
      // Calculate velocity
      const velocity = Math.sqrt(dx * dx + dy * dy);
      
      // If velocity exceeds max, constrain it
      if (velocity > this.maxVelocity) {
        const scale = this.maxVelocity / velocity;
        currentTransform.x = prevTransform.x + dx * scale;
        currentTransform.y = prevTransform.y + dy * scale;
      }
      
      // Apply acceleration constraints
      if (this.velocityHistory.length > 0) {
        const lastVel = this.velocityHistory[this.velocityHistory.length - 1];
        const dvx = dx - lastVel.vx;
        const dvy = dy - lastVel.vy;
        const acceleration = Math.sqrt(dvx * dvx + dvy * dvy);
        
        if (acceleration > this.maxAcceleration) {
          const scale = this.maxAcceleration / acceleration;
          const newVx = lastVel.vx + dvx * scale;
          const newVy = lastVel.vy + dvy * scale;
          currentTransform.x = prevTransform.x + newVx;
          currentTransform.y = prevTransform.y + newVy;
        }
      }
      
      // Update velocity history
      this.velocityHistory.push({ vx: dx, vy: dy, vs: ds });
      if (this.velocityHistory.length > 10) {
        this.velocityHistory.shift();
      }
    }

    this.history.push(currentTransform);
    
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    if (this.history.length === 1) {
      return currentTransform;
    }

    // Apply median filter first to remove outliers (for ByteTrack)
    if (this.useAggressiveSmoothing && this.history.length >= this.medianFilterSize) {
      const recentHistory = this.history.slice(-this.medianFilterSize);
      
      // Get median values
      const xValues = recentHistory.map(t => t.x).sort((a, b) => a - b);
      const yValues = recentHistory.map(t => t.y).sort((a, b) => a - b);
      const scaleValues = recentHistory.map(t => t.scale).sort((a, b) => a - b);
      
      const medianIdx = Math.floor(this.medianFilterSize / 2);
      const medianX = xValues[medianIdx];
      const medianY = yValues[medianIdx];
      const medianScale = scaleValues[medianIdx];
      
      // Check if current transform is an outlier
      const xDiff = Math.abs(currentTransform.x - medianX);
      const yDiff = Math.abs(currentTransform.y - medianY);
      const scaleDiff = Math.abs(currentTransform.scale - medianScale);
      
      // If outlier, use median instead
      if (xDiff > 50 || yDiff > 50 || scaleDiff > 0.2) {
        currentTransform = {
          x: medianX,
          y: medianY,
          scale: medianScale,
          rotation: 0
        };
      }
    }
    
    // Apply Kalman-filter-like smoothing
    const windowSize = this.useAggressiveSmoothing ? Math.min(60, this.history.length) : Math.min(20, this.history.length);
    
    if (this.useAggressiveSmoothing) {
      // Use Gaussian weighted average for ByteTrack
      let smoothedX = 0, smoothedY = 0, smoothedScale = 0;
      let totalWeight = 0;
      
      const sigma = windowSize / 3; // Standard deviation for Gaussian
      
      for (let i = 0; i < windowSize; i++) {
        const idx = this.history.length - windowSize + i;
        const transform = this.history[idx];
        
        // Gaussian weight
        const distance = windowSize - i - 1;
        const weight = Math.exp(-(distance * distance) / (2 * sigma * sigma));
        
        smoothedX += transform.x * weight;
        smoothedY += transform.y * weight;
        smoothedScale += transform.scale * weight;
        totalWeight += weight;
      }
      
      smoothedX /= totalWeight;
      smoothedY /= totalWeight;
      smoothedScale /= totalWeight;
      
      return {
        x: smoothedX,
        y: smoothedY,
        scale: smoothedScale,
        rotation: 0
      };
    } else {
      // Original smoothing for non-ByteTrack
      let smoothedX = 0, smoothedY = 0, smoothedScale = 0;
      let totalWeight = 0;
      
      for (let i = 0; i < windowSize; i++) {
        const idx = this.history.length - windowSize + i;
        const transform = this.history[idx];
        
        const smoothingStrength = 0.15;
        const recencyWeight = Math.exp(-((windowSize - i - 1) * smoothingStrength));
        const weight = recencyWeight;
        
        smoothedX += transform.x * weight;
        smoothedY += transform.y * weight;
        smoothedScale += transform.scale * weight;
        totalWeight += weight;
      }
      
      smoothedX /= totalWeight;
      smoothedY /= totalWeight;
      smoothedScale /= totalWeight;
      
      return {
        x: smoothedX,
        y: smoothedY,
        scale: smoothedScale,
        rotation: 0
      };
    }
  }

  reset(): void {
    this.history = [];
    this.lastValidTransform = null;
    this.velocityHistory = [];
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