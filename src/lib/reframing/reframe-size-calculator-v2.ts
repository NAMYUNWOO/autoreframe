import { BoundingBox } from '@/types';

export interface ReframeDimensions {
  width: number;
  height: number;
  scale: number;
}

export interface ReframingSettings {
  outputRatio: string; // '16:9', '9:16', '1:1', '4:3', '3:4'
  padding: number; // 0.0 to 0.5
  smoothness: number; // 0.0 to 1.0
  reframeBoxSize?: number; // 0.5 to 1.5 (multiplier for box size)
  reframeBoxOffset?: { x: number; y: number }; // Offset from center
}

/**
 * Enhanced reframe size calculator that considers input video resolution
 */
export class ReframeSizeCalculatorV2 {
  /**
   * Calculate optimal reframe dimensions considering:
   * 1. Input video resolution and aspect ratio
   * 2. Target object size relative to frame
   * 3. Output aspect ratio requirement
   * 4. Reframing settings (padding, etc.)
   */
  static calculateOptimalReframeSize(
    targetBox: { width: number; height: number },
    frameWidth: number,
    frameHeight: number,
    outputRatio: number,
    settings?: Partial<ReframingSettings>
  ): ReframeDimensions {
    // Parse settings
    // Convert padding from 0-1 range to multiplier (e.g., 0.3 -> 1.3)
    // Increase the base padding for better framing
    const basePadding = 1 + (settings?.padding || 0.3) * 2; // Double the padding effect
    
    // Calculate input frame aspect ratio
    const inputAspectRatio = frameWidth / frameHeight;
    
    // Calculate target size relative to frame
    const targetArea = targetBox.width * targetBox.height;
    const frameArea = frameWidth * frameHeight;
    const targetSizeRatio = targetArea / frameArea;
    
    // Adaptive padding based on target size AND output ratio
    let paddingMultiplier = basePadding;
    
    // For portrait output (9:16), we need different padding strategy
    if (outputRatio < 1) {
      // Portrait output - need more vertical space
      if (targetSizeRatio < 0.02) {
        paddingMultiplier = basePadding * 3.0; // Much more padding for tiny targets
      } else if (targetSizeRatio < 0.05) {
        paddingMultiplier = basePadding * 2.5;
      } else if (targetSizeRatio < 0.1) {
        paddingMultiplier = basePadding * 2.0;
      } else if (targetSizeRatio < 0.2) {
        paddingMultiplier = basePadding * 1.5;
      } else {
        paddingMultiplier = basePadding * 1.2;
      }
    } else if (outputRatio > 1.5) {
      // Landscape output (16:9)
      if (targetSizeRatio < 0.02) {
        paddingMultiplier = basePadding * 2.5;
      } else if (targetSizeRatio < 0.05) {
        paddingMultiplier = basePadding * 2.0;
      } else if (targetSizeRatio < 0.1) {
        paddingMultiplier = basePadding * 1.7;
      } else if (targetSizeRatio < 0.2) {
        paddingMultiplier = basePadding * 1.4;
      } else {
        paddingMultiplier = basePadding * 1.2;
      }
    } else {
      // Square or 4:3
      if (targetSizeRatio < 0.02) {
        paddingMultiplier = basePadding * 2.2;
      } else if (targetSizeRatio < 0.05) {
        paddingMultiplier = basePadding * 1.8;
      } else if (targetSizeRatio < 0.1) {
        paddingMultiplier = basePadding * 1.5;
      } else {
        paddingMultiplier = basePadding * 1.3;
      }
    }
    
    // Calculate padded target dimensions
    const paddedTargetWidth = targetBox.width * paddingMultiplier;
    const paddedTargetHeight = targetBox.height * paddingMultiplier;
    
    // Calculate reframe dimensions to maintain output aspect ratio
    let reframeWidth: number;
    let reframeHeight: number;
    
    // Strategy based on input vs output aspect ratio
    if (inputAspectRatio > 1 && outputRatio < 1) {
      // Landscape input to portrait output
      // Prioritize height to capture vertical content
      reframeHeight = Math.min(paddedTargetHeight * 1.5, frameHeight * 0.8);
      reframeWidth = reframeHeight * outputRatio;
      
      // Ensure we don't crop too much width
      if (reframeWidth < paddedTargetWidth) {
        reframeWidth = paddedTargetWidth;
        reframeHeight = reframeWidth / outputRatio;
      }
    } else if (inputAspectRatio < 1 && outputRatio > 1) {
      // Portrait input to landscape output
      // Prioritize width
      reframeWidth = Math.min(paddedTargetWidth * 1.5, frameWidth * 0.8);
      reframeHeight = reframeWidth / outputRatio;
      
      // Ensure we don't crop too much height
      if (reframeHeight < paddedTargetHeight) {
        reframeHeight = paddedTargetHeight;
        reframeWidth = reframeHeight * outputRatio;
      }
    } else {
      // Same orientation or square
      const targetAspectRatio = paddedTargetWidth / paddedTargetHeight;
      
      if (targetAspectRatio > outputRatio) {
        // Target is wider than output ratio
        reframeWidth = paddedTargetWidth;
        reframeHeight = reframeWidth / outputRatio;
      } else {
        // Target is taller than output ratio
        reframeHeight = paddedTargetHeight;
        reframeWidth = reframeHeight * outputRatio;
      }
    }
    
    // Ensure reframe fits within frame bounds
    const maxWidthScale = frameWidth / reframeWidth;
    const maxHeightScale = frameHeight / reframeHeight;
    const maxScale = Math.min(maxWidthScale, maxHeightScale);
    
    if (maxScale < 1) {
      // Reframe exceeds bounds, scale it down
      reframeWidth *= maxScale * 0.95; // 5% safety margin
      reframeHeight *= maxScale * 0.95;
    }
    
    // Calculate final scale
    const scale = frameWidth / reframeWidth;
    
    // Ensure minimum reframe size (at least 60% of frame dimension for better visibility)
    // This prevents excessive zoom-in
    const minReframeWidthRatio = 0.6;
    const minReframeHeightRatio = 0.6;
    const minReframeWidth = frameWidth * minReframeWidthRatio;
    const minReframeHeight = frameHeight * minReframeHeightRatio;
    
    // If calculated reframe is too small, adjust it
    if (reframeWidth < minReframeWidth || reframeHeight < minReframeHeight) {
      if (reframeWidth < minReframeWidth) {
        reframeWidth = minReframeWidth;
        reframeHeight = reframeWidth / outputRatio;
      }
      if (reframeHeight < minReframeHeight) {
        reframeHeight = minReframeHeight;
        reframeWidth = reframeHeight * outputRatio;
      }
    }
    
    // Apply zoom limits based on output ratio
    // Note: Higher scale = more zoom in (smaller view area)
    // Reduce max zoom to prevent extremely small reframe boxes
    let minZoomScale: number, maxZoomScale: number;
    
    if (outputRatio < 1) {
      // Portrait output - typically needs less extreme zoom
      minZoomScale = 0.3;  // Can zoom out to see 3.3x area
      maxZoomScale = 1.2;  // Max 1.2x zoom (shows 83% of frame width) - reduced from 2.0
    } else if (outputRatio > 1.5) {
      // Landscape output
      minZoomScale = 0.3;
      maxZoomScale = 1.0;  // Max 1.0x zoom (shows 100% of frame width) - reduced from 1.5
    } else {
      // Square or 4:3
      minZoomScale = 0.4;
      maxZoomScale = 1.1;  // Max 1.1x zoom (shows 91% of frame width) - reduced from 1.8
    }
    
    const clampedScale = Math.max(minZoomScale, Math.min(maxZoomScale, scale));
    
    // Final dimensions with clamped scale
    const finalWidth = frameWidth / clampedScale;
    const finalHeight = frameHeight / clampedScale;
    
    // Ensure exact output ratio
    let adjustedWidth: number;
    let adjustedHeight: number;
    
    const currentRatio = finalWidth / finalHeight;
    
    if (Math.abs(currentRatio - outputRatio) > 0.01) {
      // Need adjustment
      if (currentRatio > outputRatio) {
        // Too wide
        adjustedHeight = finalHeight;
        adjustedWidth = adjustedHeight * outputRatio;
      } else {
        // Too tall
        adjustedWidth = finalWidth;
        adjustedHeight = adjustedWidth / outputRatio;
      }
      
      // Verify it still fits
      if (adjustedWidth > frameWidth || adjustedHeight > frameHeight) {
        // Recalculate with the other dimension
        if (currentRatio > outputRatio) {
          adjustedWidth = Math.min(finalWidth, frameWidth);
          adjustedHeight = adjustedWidth / outputRatio;
        } else {
          adjustedHeight = Math.min(finalHeight, frameHeight);
          adjustedWidth = adjustedHeight * outputRatio;
        }
      }
    } else {
      adjustedWidth = finalWidth;
      adjustedHeight = finalHeight;
    }
    
    // Apply user-defined box size adjustment if provided
    if (settings?.reframeBoxSize) {
      adjustedWidth *= settings.reframeBoxSize;
      adjustedHeight *= settings.reframeBoxSize;
      
      // Ensure it still fits within frame bounds
      const sizeScale = Math.min(
        frameWidth / adjustedWidth,
        frameHeight / adjustedHeight
      );
      
      if (sizeScale < 1) {
        adjustedWidth *= sizeScale;
        adjustedHeight *= sizeScale;
      }
    }
    
    // Recalculate scale based on final dimensions
    const finalScale = frameWidth / adjustedWidth;
    
    
    return {
      width: adjustedWidth,
      height: adjustedHeight,
      scale: finalScale
    };
  }
  
  /**
   * Calculate reframe size for head-based framing with input resolution awareness
   */
  static calculateHeadBasedReframeSize(
    targetBox: { width: number; height: number },
    frameWidth: number,
    frameHeight: number,
    outputRatio: number,
    settings?: Partial<ReframingSettings>
  ): ReframeDimensions {
    const inputAspectRatio = frameWidth / frameHeight;
    
    // Head dimensions
    const headWidth = targetBox.width;
    const headHeight = targetBox.height;
    
    // Calculate desired framing based on output aspect ratio
    let desiredWidth: number;
    let desiredHeight: number;
    
    if (outputRatio < 1) {
      // Portrait output (9:16)
      // Show head to waist approximately
      desiredHeight = headHeight * 4.0; // More vertical space
      desiredWidth = desiredHeight * outputRatio;
      
      // If input is landscape, ensure we don't zoom in too much
      if (inputAspectRatio > 1.5) {
        const maxHeight = frameHeight * 0.7;
        if (desiredHeight > maxHeight) {
          desiredHeight = maxHeight;
          desiredWidth = desiredHeight * outputRatio;
        }
      }
    } else if (outputRatio > 1.5) {
      // Landscape output (16:9)
      // Show wider context
      desiredWidth = headWidth * 5.0;
      desiredHeight = desiredWidth / outputRatio;
      
      // If input is portrait, ensure we don't zoom in too much
      if (inputAspectRatio < 0.75) {
        const maxWidth = frameWidth * 0.7;
        if (desiredWidth > maxWidth) {
          desiredWidth = maxWidth;
          desiredHeight = desiredWidth / outputRatio;
        }
      }
    } else {
      // Square or 4:3 output
      desiredHeight = headHeight * 3.5;
      desiredWidth = desiredHeight * outputRatio;
    }
    
    // Calculate scale
    const scale = Math.min(
      frameWidth / desiredWidth,
      frameHeight / desiredHeight
    );
    
    // Apply scale limits
    const MIN_SCALE = 0.7;
    const MAX_SCALE = 2.5;
    
    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    
    const reframeWidth = frameWidth / clampedScale;
    const reframeHeight = reframeWidth / outputRatio;
    
    // Verify it fits
    if (reframeHeight > frameHeight) {
      const adjustedHeight = frameHeight * 0.95;
      const adjustedWidth = adjustedHeight * outputRatio;
      const adjustedScale = frameWidth / adjustedWidth;
      
      return {
        width: adjustedWidth,
        height: adjustedHeight,
        scale: adjustedScale
      };
    }
    
    return {
      width: reframeWidth,
      height: reframeHeight,
      scale: clampedScale
    };
  }
}