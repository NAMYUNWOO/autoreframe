export class DeviceDetector {
  private static instance: DeviceDetector;
  private _isMobile: boolean;
  private _isIOS: boolean;
  private _isAndroid: boolean;
  private _userAgent: string;

  private constructor() {
    this._userAgent = this.getUserAgent();
    this._isMobile = this.detectMobile();
    this._isIOS = this.detectIOS();
    this._isAndroid = this.detectAndroid();
  }

  static getInstance(): DeviceDetector {
    if (!DeviceDetector.instance) {
      DeviceDetector.instance = new DeviceDetector();
    }
    return DeviceDetector.instance;
  }

  private getUserAgent(): string {
    if (typeof window === 'undefined') return '';
    return (
      navigator.userAgent ||
      navigator.vendor ||
      (window as any).opera ||
      ''
    ).toLowerCase();
  }

  private detectMobile(): boolean {
    return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
      this._userAgent
    );
  }

  private detectIOS(): boolean {
    return /iphone|ipad|ipod/i.test(this._userAgent);
  }

  private detectAndroid(): boolean {
    return /android/i.test(this._userAgent);
  }

  get isMobile(): boolean {
    return this._isMobile;
  }

  get isIOS(): boolean {
    return this._isIOS;
  }

  get isAndroid(): boolean {
    return this._isAndroid;
  }

  get isDesktop(): boolean {
    return !this._isMobile;
  }

  get userAgent(): string {
    return this._userAgent;
  }

  hasFeature(feature: 'webcodecs' | 'webgl' | 'wasm'): boolean {
    if (typeof window === 'undefined') return false;

    switch (feature) {
      case 'webcodecs':
        return 'VideoEncoder' in window && 'VideoDecoder' in window;
      case 'webgl':
        try {
          const canvas = document.createElement('canvas');
          return !!(
            canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
          );
        } catch {
          return false;
        }
      case 'wasm':
        return typeof WebAssembly === 'object';
      default:
        return false;
    }
  }
}
