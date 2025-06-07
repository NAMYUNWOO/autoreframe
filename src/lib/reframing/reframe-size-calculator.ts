import { BoundingBox } from '@/types';

export interface ReframeDimensions {
  width: number;
  height: number;
  scale: number;
}

/**
 * Calculate appropriate reframe box dimensions based on target size
 */
export class ReframeSizeCalculator {
  /**
   * Calculate optimal reframe dimensions that:
   * 1. Maintain the desired output aspect ratio
   * 2. Provide appropriate padding around the target
   * 3. Keep a reasonable zoom level
   */
  static calculateOptimalReframeSize(
    targetBox: { width: number; height: number },
    frameWidth: number,
    frameHeight: number,
    outputRatio: number
  ): ReframeDimensions {
    // Define padding multipliers based on target size
    // Smaller targets need more padding, larger targets need less
    const targetArea = targetBox.width * targetBox.height;
    const frameArea = frameWidth * frameHeight;
    const targetRatio = targetArea / frameArea;
    
    // Dynamic padding based on target size
    let paddingMultiplier: number;
    if (targetRatio < 0.02) {
      // Very small target (< 2% of frame)
      paddingMultiplier = 2.5;
    } else if (targetRatio < 0.05) {
      // Small target (2-5% of frame)
      paddingMultiplier = 2.0;
    } else if (targetRatio < 0.1) {
      // Medium target (5-10% of frame)
      paddingMultiplier = 1.7;
    } else if (targetRatio < 0.2) {
      // Large target (10-20% of frame)
      paddingMultiplier = 1.5;
    } else {
      // Very large target (> 20% of frame)
      paddingMultiplier = 1.3;
    }
    
    // Calculate initial reframe dimensions with padding
    const paddedWidth = targetBox.width * paddingMultiplier;
    const paddedHeight = targetBox.height * paddingMultiplier;
    
    // Determine reframe dimensions based on output aspect ratio
    let reframeWidth: number;
    let reframeHeight: number;
    
    const targetAspectRatio = paddedWidth / paddedHeight;
    
    if (targetAspectRatio > outputRatio) {
      // Target is wider than output ratio - fit to width
      reframeWidth = paddedWidth;
      reframeHeight = reframeWidth / outputRatio;
    } else {
      // Target is taller than output ratio - fit to height
      reframeHeight = paddedHeight;
      reframeWidth = reframeHeight * outputRatio;
    }
    
    // Ensure reframe doesn't exceed frame bounds
    const maxScale = Math.min(
      frameWidth / reframeWidth,
      frameHeight / reframeHeight
    );
    
    if (maxScale < 1) {
      // Reframe is too large, scale it down
      reframeWidth *= maxScale;
      reframeHeight *= maxScale;
    }
    
    // Calculate final scale (how much to zoom in)
    const scale = frameWidth / reframeWidth;
    
    // Apply zoom limits
    const MIN_SCALE = 0.5;  // Don't zoom out too much (2x smaller)
    const MAX_SCALE = 3.0;  // Don't zoom in too much (3x larger)
    
    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    
    // Recalculate dimensions with clamped scale
    const finalWidth = frameWidth / clampedScale;
    const finalHeight = frameHeight / clampedScale;
    
    // Ensure output ratio is maintained
    let adjustedWidth = finalWidth;
    let adjustedHeight = finalHeight;
    
    if (finalWidth / finalHeight > outputRatio) {
      // Too wide, adjust width
      adjustedWidth = finalHeight * outputRatio;
    } else {
      // Too tall, adjust height
      adjustedHeight = finalWidth / outputRatio;
    }
    
    console.log(`ReframeSizeCalculator: Target ${targetBox.width}x${targetBox.height} (${(targetRatio * 100).toFixed(1)}% of frame)`);
    console.log(`  Padding multiplier: ${paddingMultiplier}x`);
    console.log(`  Final reframe: ${adjustedWidth.toFixed(0)}x${adjustedHeight.toFixed(0)}, scale: ${clampedScale.toFixed(2)}`);
    
    return {
      width: adjustedWidth,
      height: adjustedHeight,
      scale: clampedScale
    };
  }
  
  /**
   * Calculate scale based on head-specific framing
   * This is optimized for framing people where the head is the focus
   */
  static calculateHeadBasedReframeSize(
    targetBox: { width: number; height: number },
    frameWidth: number,
    frameHeight: number,
    outputRatio: number
  ): ReframeDimensions {
    // For head-based framing, we want to show upper body
    // The head box from detection is usually just the head
    // We want to show more context around it
    
    const headWidth = targetBox.width;
    const headHeight = targetBox.height;
    
    // Calculate desired framing based on output aspect ratio
    let desiredWidth: number;
    let desiredHeight: number;
    
    if (outputRatio > 1) {
      // Landscape output - show more horizontal context
      desiredWidth = headWidth * 4; // 4x head width for upper body width
      desiredHeight = desiredWidth / outputRatio;
    } else if (outputRatio < 1) {
      // Portrait output - show more vertical context (head to upper torso)
      desiredHeight = headHeight * 3.5; // 3.5x head height
      desiredWidth = desiredHeight * outputRatio;
    } else {
      // Square output
      desiredHeight = headHeight * 3;
      desiredWidth = desiredHeight;
    }
    
    // Calculate scale to fit desired dimensions
    const scale = Math.min(
      frameWidth / desiredWidth,
      frameHeight / desiredHeight
    );
    
    // Apply scale limits for head-based framing
    const MIN_SCALE = 0.8;  // Don't zoom out too much
    const MAX_SCALE = 2.0;  // More conservative max zoom for heads
    
    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    
    const reframeWidth = frameWidth / clampedScale;
    const reframeHeight = reframeWidth / outputRatio;
    
    console.log(`Head-based reframe: Head ${headWidth}x${headHeight} -> Reframe ${reframeWidth.toFixed(0)}x${reframeHeight.toFixed(0)}, scale: ${clampedScale.toFixed(2)}`);
    
    return {
      width: reframeWidth,
      height: reframeHeight,
      scale: clampedScale
    };
  }
}