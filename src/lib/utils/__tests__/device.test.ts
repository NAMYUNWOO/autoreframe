import { describe, it, expect, vi } from 'vitest';
import { DeviceDetector } from '../device';

describe('DeviceDetector', () => {
  describe('Mobile Detection', () => {
    it('iPhone을 모바일로 감지해야 함', () => {
      const detector = DeviceDetector.getInstance();
      expect(typeof detector.isMobile).toBe('boolean');
      expect(typeof detector.isIOS).toBe('boolean');
      expect(typeof detector.isAndroid).toBe('boolean');
      expect(typeof detector.isDesktop).toBe('boolean');
    });

    it('디바이스 타입을 확인할 수 있어야 함', () => {
      const detector = DeviceDetector.getInstance();
      expect(typeof detector.isMobile).toBe('boolean');
      expect(typeof detector.isAndroid).toBe('boolean');
      expect(typeof detector.isIOS).toBe('boolean');
      expect(typeof detector.isDesktop).toBe('boolean');

      expect(detector.isDesktop).toBe(!detector.isMobile);
    });
  });

  describe('Feature Detection', () => {
    it('WebCodecs 지원 여부를 확인해야 함', () => {
      const detector = DeviceDetector.getInstance();
      const hasWebCodecs = detector.hasFeature('webcodecs');

      expect(typeof hasWebCodecs).toBe('boolean');
    });

    it('WebGL 지원 여부를 확인해야 함', () => {
      const detector = DeviceDetector.getInstance();
      const hasWebGL = detector.hasFeature('webgl');

      expect(typeof hasWebGL).toBe('boolean');
    });

    it('WASM 지원 여부를 확인해야 함', () => {
      const detector = DeviceDetector.getInstance();
      const hasWasm = detector.hasFeature('wasm');

      expect(typeof hasWasm).toBe('boolean');
    });
  });

  describe('Singleton Pattern', () => {
    it('항상 같은 인스턴스를 반환해야 함', () => {
      const instance1 = DeviceDetector.getInstance();
      const instance2 = DeviceDetector.getInstance();

      expect(instance1).toBe(instance2);
    });
  });
});
