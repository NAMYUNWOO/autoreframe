/**
 * One Euro Filter implementation for smooth camera tracking
 * Based on: "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems"
 * by Géry Casiez, Nicolas Roussel and Daniel Vogel
 */

class LowPassFilter {
  private y: number | null = null;
  private s: number | null = null;
  private alpha: number = 0;
  
  constructor(alpha: number = 0) {
    this.setAlpha(alpha);
  }
  
  setAlpha(alpha: number): void {
    this.alpha = alpha;
  }
  
  filter(value: number, timestamp: number): number {
    if (this.y === null) {
      this.s = value;
      this.y = value;
      return value;
    }
    
    this.s = this.alpha * value + (1 - this.alpha) * this.s!;
    this.y = this.s;
    
    return this.y;
  }
  
  hasLastValue(): boolean {
    return this.y !== null;
  }
  
  lastValue(): number {
    return this.y ?? 0;
  }
  
  reset(): void {
    this.y = null;
    this.s = null;
  }
}

export class OneEuroFilter {
  private freq: number;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private x: LowPassFilter;
  private dx: LowPassFilter;
  private lastTime: number | null = null;
  
  constructor(
    freq: number = 60,      // Sampling frequency (Hz)
    minCutoff: number = 1.0, // Minimum cutoff frequency for slow movements
    beta: number = 0.0,      // Speed coefficient (higher = less lag for fast movements)
    dCutoff: number = 1.0    // Cutoff frequency for derivative
  ) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPassFilter(this.alpha(this.minCutoff));
    this.dx = new LowPassFilter(this.alpha(this.dCutoff));
  }
  
  private alpha(cutoff: number): number {
    const te = 1.0 / this.freq;
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / te);
  }
  
  filter(value: number, timestamp?: number): number {
    // If no timestamp provided, use current time
    if (timestamp === undefined) {
      timestamp = Date.now() / 1000;
    }
    
    // Update frequency based on actual time difference
    if (this.lastTime !== null && timestamp !== this.lastTime) {
      this.freq = 1.0 / (timestamp - this.lastTime);
    }
    this.lastTime = timestamp;
    
    // Estimate derivative
    const dValue = this.x.hasLastValue() 
      ? (value - this.x.lastValue()) * this.freq 
      : 0.0;
    
    const edValue = this.dx.filter(dValue, timestamp);
    
    // Adaptive cutoff frequency based on speed
    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    
    // Filter the value
    this.x.setAlpha(this.alpha(cutoff));
    return this.x.filter(value, timestamp);
  }
  
  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastTime = null;
  }
}

/**
 * 2D One Euro Filter for camera position
 */
export class OneEuroFilter2D {
  private xFilter: OneEuroFilter;
  private yFilter: OneEuroFilter;
  
  constructor(
    freq: number = 60,
    minCutoff: number = 1.0,
    beta: number = 0.0,
    dCutoff: number = 1.0
  ) {
    this.xFilter = new OneEuroFilter(freq, minCutoff, beta, dCutoff);
    this.yFilter = new OneEuroFilter(freq, minCutoff, beta, dCutoff);
  }
  
  filter(x: number, y: number, timestamp?: number): { x: number; y: number } {
    return {
      x: this.xFilter.filter(x, timestamp),
      y: this.yFilter.filter(y, timestamp)
    };
  }
  
  reset(): void {
    this.xFilter.reset();
    this.yFilter.reset();
  }
}

/**
 * One Euro Filter for complete frame transform (position + scale)
 */
export class OneEuroFilterTransform {
  private positionFilter: OneEuroFilter2D;
  private scaleFilter: OneEuroFilter;
  
  constructor(
    freq: number = 60,
    minCutoff: number = 1.0,  // Lower value = more smoothing
    beta: number = 0.007,      // Higher value = less lag for fast movements
    dCutoff: number = 1.0
  ) {
    this.positionFilter = new OneEuroFilter2D(freq, minCutoff, beta, dCutoff);
    this.scaleFilter = new OneEuroFilter(freq, minCutoff, beta, dCutoff);
  }
  
  filter(
    x: number, 
    y: number, 
    scale: number, 
    timestamp?: number
  ): { x: number; y: number; scale: number } {
    const position = this.positionFilter.filter(x, y, timestamp);
    const filteredScale = this.scaleFilter.filter(scale, timestamp);
    
    return {
      x: position.x,
      y: position.y,
      scale: filteredScale
    };
  }
  
  reset(): void {
    this.positionFilter.reset();
    this.scaleFilter.reset();
  }
}