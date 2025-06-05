import { VideoMetadata, Detection, ProcessingStatus } from '@/types';

export class VideoProcessor {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private metadata: VideoMetadata | null = null;
  private onProgress?: (status: ProcessingStatus) => void;

  constructor() {
    this.video = document.createElement('video');
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    
    this.video.muted = true;
    this.video.playsInline = true;
  }

  async loadVideo(file: File): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      this.video.src = url;
      
      this.video.onloadedmetadata = () => {
        this.metadata = {
          duration: this.video.duration,
          width: this.video.videoWidth,
          height: this.video.videoHeight,
          fps: 30 // Default, will be calculated more accurately
        };
        
        this.canvas.width = this.metadata.width;
        this.canvas.height = this.metadata.height;
        
        // Estimate FPS by seeking to multiple points
        this.estimateFPS().then(fps => {
          this.metadata!.fps = fps;
          resolve(this.metadata!);
        });
      };
      
      this.video.onerror = () => {
        reject(new Error('Failed to load video'));
      };
    });
  }

  private async estimateFPS(): Promise<number> {
    const testDuration = Math.min(1, this.video.duration);
    const startTime = 0;
    let frameCount = 0;
    let lastTime = 0;
    
    return new Promise((resolve) => {
      const countFrames = () => {
        if (this.video.currentTime < startTime + testDuration) {
          if (this.video.currentTime !== lastTime) {
            frameCount++;
            lastTime = this.video.currentTime;
          }
          requestAnimationFrame(countFrames);
        } else {
          const fps = Math.round(frameCount / testDuration);
          resolve(fps || 30);
        }
      };
      
      this.video.currentTime = startTime;
      this.video.play().then(() => {
        countFrames();
      });
    });
  }

  async extractFrame(time: number): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      this.video.currentTime = time;
      
      this.video.onseeked = () => {
        try {
          this.ctx.drawImage(this.video, 0, 0);
          const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
          resolve(imageData);
        } catch (error) {
          reject(error);
        }
      };
      
      this.video.onerror = () => {
        reject(new Error('Failed to seek video'));
      };
    });
  }

  async processFrames(
    onFrame: (imageData: ImageData, frameNumber: number, timestamp: number) => Promise<void>,
    onProgress?: (status: ProcessingStatus) => void
  ): Promise<void> {
    if (!this.metadata) {
      throw new Error('Video not loaded');
    }
    
    this.onProgress = onProgress;
    const frameInterval = 1 / this.metadata.fps;
    const totalFrames = Math.floor(this.metadata.duration * this.metadata.fps);
    
    for (let frameNumber = 0; frameNumber < totalFrames; frameNumber++) {
      const timestamp = frameNumber * frameInterval;
      
      if (this.onProgress) {
        this.onProgress({
          stage: 'analyzing',
          progress: (frameNumber / totalFrames) * 100,
          message: `Processing frame ${frameNumber + 1} of ${totalFrames}`
        });
      }
      
      try {
        const imageData = await this.extractFrame(timestamp);
        await onFrame(imageData, frameNumber, timestamp);
      } catch (error) {
        console.error(`Error processing frame ${frameNumber}:`, error);
      }
    }
  }

  getVideoElement(): HTMLVideoElement {
    return this.video;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getMetadata(): VideoMetadata | null {
    return this.metadata;
  }

  dispose(): void {
    if (this.video.src) {
      URL.revokeObjectURL(this.video.src);
    }
    this.video.src = '';
    this.metadata = null;
  }
}