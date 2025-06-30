export interface Point2D {
  x: number;
  y: number;
}

export interface MotionTransform {
  a: number;  // scale * cos(theta)
  b: number;  // scale * sin(theta)
  tx: number; // translation x
  ty: number; // translation y
}

export class CameraMotionCompensation {
  private prevFrame: ImageData | null = null;
  private maxFeatures: number = 100;
  private qualityLevel: number = 0.01;
  private minDistance: number = 10;
  private blockSize: number = 3;
  private winSize: number = 21;
  private maxLevel: number = 3;
  
  /**
   * Apply camera motion compensation
   * @param currentFrame Current frame data
   * @returns Motion transform matrix
   */
  async apply(currentFrame: ImageData): Promise<MotionTransform> {
    if (!this.prevFrame) {
      this.prevFrame = this.copyImageData(currentFrame);
      return { a: 1, b: 0, tx: 0, ty: 0 }; // Identity transform
    }
    
    try {
      // Extract features from previous frame
      const prevFeatures = this.extractFeatures(this.prevFrame);
      
      if (prevFeatures.length < 4) {
        this.prevFrame = this.copyImageData(currentFrame);
        return { a: 1, b: 0, tx: 0, ty: 0 };
      }
      
      // Track features in current frame using optical flow
      const currFeatures = this.trackFeatures(this.prevFrame, currentFrame, prevFeatures);
      
      // Filter good matches
      const { goodPrev, goodCurr } = this.filterMatches(prevFeatures, currFeatures);
      
      if (goodPrev.length < 4) {
        this.prevFrame = this.copyImageData(currentFrame);
        return { a: 1, b: 0, tx: 0, ty: 0 };
      }
      
      // Estimate affine transform
      const transform = this.estimateAffineTransform(goodPrev, goodCurr);
      
      // Update previous frame
      this.prevFrame = this.copyImageData(currentFrame);
      
      return transform;
    } catch (error) {
      console.error('CMC error:', error);
      this.prevFrame = this.copyImageData(currentFrame);
      return { a: 1, b: 0, tx: 0, ty: 0 };
    }
  }
  
  /**
   * Extract corner features from grayscale image
   */
  private extractFeatures(imageData: ImageData): Point2D[] {
    const gray = this.toGrayscale(imageData);
    const corners = this.detectCorners(gray, imageData.width, imageData.height);
    
    // Sort by corner strength and limit count
    corners.sort((a, b) => b.score - a.score);
    
    return corners.slice(0, this.maxFeatures).map(c => ({
      x: c.x,
      y: c.y
    }));
  }
  
  /**
   * Track features using Lucas-Kanade optical flow
   */
  private trackFeatures(
    prevImage: ImageData,
    currImage: ImageData,
    prevFeatures: Point2D[]
  ): (Point2D | null)[] {
    const prevGray = this.toGrayscale(prevImage);
    const currGray = this.toGrayscale(currImage);
    
    return prevFeatures.map(feature => {
      const tracked = this.trackSingleFeature(
        prevGray,
        currGray,
        feature,
        prevImage.width,
        prevImage.height
      );
      
      return tracked;
    });
  }
  
  /**
   * Track a single feature using Lucas-Kanade
   */
  private trackSingleFeature(
    prevGray: Uint8ClampedArray,
    currGray: Uint8ClampedArray,
    feature: Point2D,
    width: number,
    height: number
  ): Point2D | null {
    const halfWin = Math.floor(this.winSize / 2);
    let x = feature.x;
    let y = feature.y;
    
    // Iterative Lucas-Kanade
    for (let level = this.maxLevel; level >= 0; level--) {
      const scale = Math.pow(2, level);
      const scaledX = x / scale;
      const scaledY = y / scale;
      
      // Skip if out of bounds
      if (scaledX < halfWin || scaledX >= width - halfWin ||
          scaledY < halfWin || scaledY >= height - halfWin) {
        return null;
      }
      
      // Compute gradients and optical flow
      let sumIxx = 0, sumIxy = 0, sumIyy = 0;
      let sumIxt = 0, sumIyt = 0;
      
      for (let dy = -halfWin; dy <= halfWin; dy++) {
        for (let dx = -halfWin; dx <= halfWin; dx++) {
          const px = Math.floor(scaledX + dx);
          const py = Math.floor(scaledY + dy);
          
          if (px < 1 || px >= width - 1 || py < 1 || py >= height - 1) continue;
          
          // Compute gradients
          const idx = py * width + px;
          const Ix = (currGray[idx + 1] - currGray[idx - 1]) / 2;
          const Iy = (currGray[idx + width] - currGray[idx - width]) / 2;
          const It = currGray[idx] - prevGray[idx];
          
          sumIxx += Ix * Ix;
          sumIxy += Ix * Iy;
          sumIyy += Iy * Iy;
          sumIxt += Ix * It;
          sumIyt += Iy * It;
        }
      }
      
      // Solve for flow vector
      const det = sumIxx * sumIyy - sumIxy * sumIxy;
      if (Math.abs(det) < 1e-5) return null;
      
      const flowX = (sumIyy * sumIxt - sumIxy * sumIyt) / det;
      const flowY = (sumIxx * sumIyt - sumIxy * sumIxt) / det;
      
      // Update position
      x += flowX * scale;
      y += flowY * scale;
    }
    
    // Check if tracked point is within bounds
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return null;
    }
    
    return { x, y };
  }
  
  /**
   * Filter good matches based on forward-backward error
   */
  private filterMatches(
    prevFeatures: Point2D[],
    currFeatures: (Point2D | null)[]
  ): { goodPrev: Point2D[], goodCurr: Point2D[] } {
    const goodPrev: Point2D[] = [];
    const goodCurr: Point2D[] = [];
    
    for (let i = 0; i < prevFeatures.length; i++) {
      if (currFeatures[i]) {
        // Simple distance check for outlier rejection
        const dist = Math.sqrt(
          Math.pow(currFeatures[i]!.x - prevFeatures[i].x, 2) +
          Math.pow(currFeatures[i]!.y - prevFeatures[i].y, 2)
        );
        
        // Reject if movement is too large (likely outlier)
        if (dist < 50) {
          goodPrev.push(prevFeatures[i]);
          goodCurr.push(currFeatures[i]!);
        }
      }
    }
    
    return { goodPrev, goodCurr };
  }
  
  /**
   * Estimate affine transform using RANSAC
   */
  private estimateAffineTransform(
    srcPoints: Point2D[],
    dstPoints: Point2D[]
  ): MotionTransform {
    if (srcPoints.length < 3) {
      return { a: 1, b: 0, tx: 0, ty: 0 };
    }
    
    // RANSAC parameters
    const iterations = 100;
    const threshold = 3.0;
    let bestTransform = { a: 1, b: 0, tx: 0, ty: 0 };
    let maxInliers = 0;
    
    for (let iter = 0; iter < iterations; iter++) {
      // Randomly select 3 points
      const indices = this.randomSample(srcPoints.length, 3);
      const srcSample = indices.map(i => srcPoints[i]);
      const dstSample = indices.map(i => dstPoints[i]);
      
      // Compute transform from these points
      const transform = this.computeAffineTransform(srcSample, dstSample);
      
      // Count inliers
      let inliers = 0;
      for (let i = 0; i < srcPoints.length; i++) {
        const projected = this.applyTransform(srcPoints[i], transform);
        const error = Math.sqrt(
          Math.pow(projected.x - dstPoints[i].x, 2) +
          Math.pow(projected.y - dstPoints[i].y, 2)
        );
        
        if (error < threshold) {
          inliers++;
        }
      }
      
      if (inliers > maxInliers) {
        maxInliers = inliers;
        bestTransform = transform;
      }
    }
    
    return bestTransform;
  }
  
  /**
   * Compute affine transform from point correspondences
   */
  private computeAffineTransform(
    src: Point2D[],
    dst: Point2D[]
  ): MotionTransform {
    // Solve for affine parameters using least squares
    // [x'] = [a -b tx] [x]
    // [y']   [b  a ty] [y]
    //                  [1]
    
    const n = src.length;
    let sumX = 0, sumY = 0, sumXp = 0, sumYp = 0;
    let sumXX = 0, sumYY = 0, sumXY = 0;
    let sumXXp = 0, sumYYp = 0, sumXYp = 0, sumYXp = 0;
    
    for (let i = 0; i < n; i++) {
      const x = src[i].x;
      const y = src[i].y;
      const xp = dst[i].x;
      const yp = dst[i].y;
      
      sumX += x;
      sumY += y;
      sumXp += xp;
      sumYp += yp;
      sumXX += x * x;
      sumYY += y * y;
      sumXY += x * y;
      sumXXp += x * xp;
      sumYYp += y * yp;
      sumXYp += x * yp;
      sumYXp += y * xp;
    }
    
    const det = n * (sumXX + sumYY) - sumX * sumX - sumY * sumY;
    if (Math.abs(det) < 1e-10) {
      return { a: 1, b: 0, tx: 0, ty: 0 };
    }
    
    const a = (n * (sumXXp + sumYYp) - sumX * sumXp - sumY * sumYp) / det;
    const b = (n * (sumXYp - sumYXp) - sumX * sumYp + sumY * sumXp) / det;
    const tx = (sumXp - a * sumX + b * sumY) / n;
    const ty = (sumYp - b * sumX - a * sumY) / n;
    
    return { a, b, tx, ty };
  }
  
  /**
   * Apply transform to a point
   */
  private applyTransform(point: Point2D, transform: MotionTransform): Point2D {
    return {
      x: transform.a * point.x - transform.b * point.y + transform.tx,
      y: transform.b * point.x + transform.a * point.y + transform.ty
    };
  }
  
  /**
   * Apply inverse transform to a point
   */
  applyInverseTransform(point: Point2D, transform: MotionTransform): Point2D {
    const det = transform.a * transform.a + transform.b * transform.b;
    if (Math.abs(det) < 1e-10) return point;
    
    const x = point.x - transform.tx;
    const y = point.y - transform.ty;
    
    return {
      x: (transform.a * x + transform.b * y) / det,
      y: (-transform.b * x + transform.a * y) / det
    };
  }
  
  /**
   * Convert to grayscale
   */
  private toGrayscale(imageData: ImageData): Uint8ClampedArray {
    const gray = new Uint8ClampedArray(imageData.width * imageData.height);
    const data = imageData.data;
    
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    
    return gray;
  }
  
  /**
   * Simple corner detection using Harris-like response
   */
  private detectCorners(
    gray: Uint8ClampedArray,
    width: number,
    height: number
  ): Array<{ x: number, y: number, score: number }> {
    const corners: Array<{ x: number, y: number, score: number }> = [];
    const blockSize = this.blockSize;
    const halfBlock = Math.floor(blockSize / 2);
    
    for (let y = halfBlock; y < height - halfBlock; y += this.minDistance) {
      for (let x = halfBlock; x < width - halfBlock; x += this.minDistance) {
        let sumIxx = 0, sumIyy = 0, sumIxy = 0;
        
        for (let dy = -halfBlock; dy <= halfBlock; dy++) {
          for (let dx = -halfBlock; dx <= halfBlock; dx++) {
            const idx = (y + dy) * width + (x + dx);
            
            // Compute gradients
            let Ix = 0, Iy = 0;
            if (x + dx > 0 && x + dx < width - 1) {
              Ix = gray[idx + 1] - gray[idx - 1];
            }
            if (y + dy > 0 && y + dy < height - 1) {
              Iy = gray[idx + width] - gray[idx - width];
            }
            
            sumIxx += Ix * Ix;
            sumIyy += Iy * Iy;
            sumIxy += Ix * Iy;
          }
        }
        
        // Harris corner response
        const det = sumIxx * sumIyy - sumIxy * sumIxy;
        const trace = sumIxx + sumIyy;
        const k = 0.04;
        const response = det - k * trace * trace;
        
        if (response > this.qualityLevel * 10000) {
          corners.push({ x, y, score: response });
        }
      }
    }
    
    return corners;
  }
  
  /**
   * Random sample indices
   */
  private randomSample(n: number, k: number): number[] {
    const indices: number[] = [];
    const used = new Set<number>();
    
    while (indices.length < k) {
      const idx = Math.floor(Math.random() * n);
      if (!used.has(idx)) {
        used.add(idx);
        indices.push(idx);
      }
    }
    
    return indices;
  }
  
  /**
   * Copy ImageData
   */
  private copyImageData(imageData: ImageData): ImageData {
    return new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );
  }
  
  /**
   * Reset the motion compensator
   */
  reset(): void {
    this.prevFrame = null;
  }
}