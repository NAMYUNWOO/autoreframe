import { VideoMetadata, Detection, ProcessingStatus } from '@/types';
import { VideoRotationDetector } from './rotation-detector';

export class VideoProcessor {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private metadata: VideoMetadata | null = null;
  private onProgress?: (status: ProcessingStatus) => void;
  private videoRotation: number = 0;

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
      
      this.video.onloadedmetadata = async () => {
        // Detect video rotation
        this.videoRotation = await VideoRotationDetector.detectRotation(this.video);
        console.log('Detected video rotation:', this.videoRotation);
        
        // Get corrected dimensions
        const correctedDims = VideoRotationDetector.getCorrectedDimensions(
          this.video.videoWidth,
          this.video.videoHeight,
          this.videoRotation
        );
        
        this.metadata = {
          duration: this.video.duration,
          width: correctedDims.width,
          height: correctedDims.height,
          fps: 30, // Default, will be calculated more accurately
          rotation: this.videoRotation
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
    // Try to get FPS from video metadata if available
    const videoTrack = (this.video as any).captureStream?.()?.getVideoTracks()[0];
    if (videoTrack) {
      const settings = videoTrack.getSettings();
      if (settings.frameRate) {
        return Math.round(settings.frameRate);
      }
    }
    
    // Fallback to manual detection
    const testDuration = Math.min(1, this.video.duration);
    const startTime = 0;
    let frameCount = 0;
    let lastTime = -1;
    
    return new Promise((resolve) => {
      let startRealTime = 0;
      
      const countFrames = () => {
        const currentTime = this.video.currentTime;
        
        if (!startRealTime) {
          startRealTime = performance.now();
        }
        
        if (currentTime < startTime + testDuration && this.video.playbackRate > 0) {
          if (currentTime > lastTime) {
            frameCount++;
            lastTime = currentTime;
          }
          requestAnimationFrame(countFrames);
        } else {
          this.video.pause();
          const realDuration = (performance.now() - startRealTime) / 1000;
          const estimatedFps = Math.round(frameCount / realDuration);
          
          // Common frame rates
          const commonFps = [24, 25, 30, 50, 60];
          const closest = commonFps.reduce((prev, curr) => 
            Math.abs(curr - estimatedFps) < Math.abs(prev - estimatedFps) ? curr : prev
          );
          
          console.log(`Detected FPS: ${estimatedFps}, using: ${closest}`);
          resolve(closest);
        }
      };
      
      this.video.currentTime = startTime;
      this.video.play().then(() => {
        countFrames();
      }).catch(() => {
        // If play fails, default to 30 fps
        resolve(30);
      });
    });
  }

  async extractFrame(time: number): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      this.video.currentTime = time;
      
      this.video.onseeked = () => {
        try {
          // Clear canvas
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          
          // Apply rotation if needed
          this.ctx.save();
          
          if (this.videoRotation !== 0) {
            VideoRotationDetector.applyRotation(
              this.ctx, 
              this.videoRotation, 
              this.canvas.width, 
              this.canvas.height
            );
          }
          
          // Draw the video frame
          if (this.videoRotation === 90 || this.videoRotation === 270) {
            // For 90/270 rotation, swap the dimensions when drawing
            this.ctx.drawImage(this.video, 0, 0, this.video.videoHeight, this.video.videoWidth);
          } else {
            this.ctx.drawImage(this.video, 0, 0, this.video.videoWidth, this.video.videoHeight);
          }
          
          this.ctx.restore();
          
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
        const isDetectionFrame = frameNumber % 10 === 0; // Match the sample interval
        this.onProgress({
          stage: 'analyzing',
          progress: (frameNumber / totalFrames) * 100,
          message: isDetectionFrame 
            ? `Detecting heads in frame ${frameNumber + 1} of ${totalFrames}`
            : `Processing frame ${frameNumber + 1} of ${totalFrames}`
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