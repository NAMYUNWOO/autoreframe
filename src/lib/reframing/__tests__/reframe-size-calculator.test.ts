import { ReframeSizeCalculator } from '../reframe-size-calculator';

describe('ReframeSizeCalculator', () => {
  const frameWidth = 1920;
  const frameHeight = 1080;

  describe('calculateOptimalReframeSize', () => {
    it('should maintain consistent dimensions for same target size', () => {
      const targetBox = { width: 200, height: 400 };
      const outputRatio = 16 / 9;

      const result1 = ReframeSizeCalculator.calculateOptimalReframeSize(
        targetBox,
        frameWidth,
        frameHeight,
        outputRatio
      );

      const result2 = ReframeSizeCalculator.calculateOptimalReframeSize(
        targetBox,
        frameWidth,
        frameHeight,
        outputRatio
      );

      expect(result1.width).toBe(result2.width);
      expect(result1.height).toBe(result2.height);
      expect(result1.scale).toBe(result2.scale);
    });

    it('should maintain output aspect ratio', () => {
      const targetBox = { width: 200, height: 400 };
      const outputRatio = 16 / 9;

      const result = ReframeSizeCalculator.calculateOptimalReframeSize(
        targetBox,
        frameWidth,
        frameHeight,
        outputRatio
      );

      const calculatedRatio = result.width / result.height;
      expect(Math.abs(calculatedRatio - outputRatio)).toBeLessThan(0.01);
    });

    it('should apply appropriate padding for small targets', () => {
      const smallTarget = { width: 50, height: 100 };
      const outputRatio = 16 / 9;

      const result = ReframeSizeCalculator.calculateOptimalReframeSize(
        smallTarget,
        frameWidth,
        frameHeight,
        outputRatio
      );

      // Small targets should have more padding (2.5x multiplier)
      expect(result.scale).toBeLessThan(2.0);
    });

    it('should apply less padding for large targets', () => {
      const largeTarget = { width: 600, height: 800 };
      const outputRatio = 16 / 9;

      const result = ReframeSizeCalculator.calculateOptimalReframeSize(
        largeTarget,
        frameWidth,
        frameHeight,
        outputRatio
      );

      // Large targets should have less padding
      expect(result.scale).toBeGreaterThan(0.8);
    });
  });

  describe('calculateHeadBasedReframeSize', () => {
    it('should provide appropriate framing for portrait output', () => {
      const headBox = { width: 150, height: 200 };
      const outputRatio = 9 / 16; // Portrait

      const result = ReframeSizeCalculator.calculateHeadBasedReframeSize(
        headBox,
        frameWidth,
        frameHeight,
        outputRatio
      );

      // Should show head + upper torso (about 3.5x head height)
      expect(result.height).toBeGreaterThan(headBox.height * 3);
      expect(result.height).toBeLessThan(headBox.height * 4);
    });

    it('should provide appropriate framing for landscape output', () => {
      const headBox = { width: 150, height: 200 };
      const outputRatio = 16 / 9; // Landscape

      const result = ReframeSizeCalculator.calculateHeadBasedReframeSize(
        headBox,
        frameWidth,
        frameHeight,
        outputRatio
      );

      // Should show more horizontal context
      expect(result.width).toBeGreaterThan(headBox.width * 3);
    });

    it('should maintain output aspect ratio', () => {
      const headBox = { width: 150, height: 200 };
      const outputRatio = 1; // Square

      const result = ReframeSizeCalculator.calculateHeadBasedReframeSize(
        headBox,
        frameWidth,
        frameHeight,
        outputRatio
      );

      expect(Math.abs(result.width - result.height)).toBeLessThan(0.01);
    });
  });
});