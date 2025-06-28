import { VideoMetadata, ProcessingStatus } from '@/types';
import { VideoRotationDetector } from './rotation-detector';

interface FrameTask {
  frameNumber: number;
  timestamp: number;
  promise?: Promise<ImageData>;
}

export class ParallelVideoProcessor {
  private video: HTMLVideoElement;
  private canvasPool: Array<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; inUse: boolean }> = [];
  private metadata: VideoMetadata | null = null;
  private onProgress?: (status: ProcessingStatus) => void;
  private videoRotation: number = 0;
  private maxConcurrency: number;
  private frameQueue: FrameTask[] = [];
  private activeExtractions = 0;

  constructor(maxConcurrency: number = 4) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.maxConcurrency = maxConcurrency;
    
    // Create canvas pool for concurrent operations
    for (let i = 0; i < maxConcurrency; i++) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      this.canvasPool.push({ canvas, ctx, inUse: false });
    }
  }

  async loadVideo(file: File): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      this.video.src = url;
      
      this.video.onloadedmetadata = async () => {
        // Detect video rotation
        this.videoRotation = await VideoRotationDetector.detectRotation(this.video);
        
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
        
        // Set canvas dimensions for all canvases in pool
        this.canvasPool.forEach(({ canvas }) => {
          canvas.width = this.metadata!.width;
          canvas.height = this.metadata!.height;
        });
        
        // Estimate FPS
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
    
    // Default to 30 fps for simplicity in parallel processing
    return 30;
  }

  private getAvailableCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; inUse: boolean } | null {
    for (const canvasObj of this.canvasPool) {
      if (!canvasObj.inUse) {
        canvasObj.inUse = true;
        return canvasObj;
      }
    }
    return null;
  }

  private releaseCanvas(canvasObj: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; inUse: boolean }): void {
    canvasObj.inUse = false;
  }

  private async extractFrameWithCanvas(
    time: number, 
    canvasObj: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; inUse: boolean }
  ): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      // Create a temporary video element for this extraction
      const tempVideo = document.createElement('video');
      tempVideo.src = this.video.src;
      tempVideo.muted = true;
      tempVideo.playsInline = true;
      
      tempVideo.onloadedmetadata = () => {
        tempVideo.currentTime = time;
      };
      
      tempVideo.onseeked = () => {
        try {
          const { canvas, ctx } = canvasObj;
          
          // Clear canvas
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          // Apply rotation if needed
          ctx.save();
          
          if (this.videoRotation !== 0) {
            VideoRotationDetector.applyRotation(
              ctx, 
              this.videoRotation, 
              canvas.width, 
              canvas.height
            );
          }
          
          // Draw the video frame
          if (this.videoRotation === 90 || this.videoRotation === 270) {
            ctx.drawImage(tempVideo, 0, 0, tempVideo.videoHeight, tempVideo.videoWidth);
          } else {
            ctx.drawImage(tempVideo, 0, 0, tempVideo.videoWidth, tempVideo.videoHeight);
          }
          
          ctx.restore();
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          // Clean up temp video
          tempVideo.remove();
          
          resolve(imageData);
        } catch (error) {
          tempVideo.remove();
          reject(error);
        }
      };
      
      tempVideo.onerror = () => {
        tempVideo.remove();
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
    
    // Create frame tasks for all frames
    const frameTasks: FrameTask[] = [];
    for (let frameNumber = 0; frameNumber < totalFrames; frameNumber++) {
      frameTasks.push({
        frameNumber,
        timestamp: frameNumber * frameInterval
      });
    }
    
    // Process frames in batches
    const results = new Map<number, ImageData>();
    let processedCount = 0;
    
    // Start parallel extraction
    const extractionPromises: Promise<void>[] = [];
    
    for (let i = 0; i < Math.min(this.maxConcurrency, frameTasks.length); i++) {
      extractionPromises.push(this.processFrameBatch(frameTasks, results, totalFrames));
    }
    
    await Promise.all(extractionPromises);
    
    // Process frames in order
    for (let frameNumber = 0; frameNumber < totalFrames; frameNumber++) {
      const imageData = results.get(frameNumber);
      if (imageData) {
        await onFrame(imageData, frameNumber, frameTasks[frameNumber].timestamp);
        processedCount++;
        
        if (this.onProgress) {
          const isDetectionFrame = frameNumber % 5 === 0;
          this.onProgress({
            stage: 'analyzing',
            progress: (processedCount / totalFrames) * 100,
            message: isDetectionFrame 
              ? `Detecting heads in frame ${frameNumber + 1} of ${totalFrames}`
              : `Processing frame ${frameNumber + 1} of ${totalFrames}`
          });
        }
      }
    }
    
    if (this.onProgress) {
      this.onProgress({
        stage: 'analyzing',
        progress: 100,
        message: `Completed processing ${totalFrames} frames`
      });
    }
  }

  private async processFrameBatch(
    frameTasks: FrameTask[],
    results: Map<number, ImageData>,
    totalFrames: number
  ): Promise<void> {
    while (frameTasks.length > 0) {
      const canvasObj = this.getAvailableCanvas();
      if (!canvasObj) {
        // Wait a bit if no canvas available
        await new Promise(resolve => setTimeout(resolve, 10));
        continue;
      }
      
      const task = frameTasks.shift();
      if (!task) {
        this.releaseCanvas(canvasObj);
        break;
      }
      
      try {
        const imageData = await this.extractFrameWithCanvas(task.timestamp, canvasObj);
        results.set(task.frameNumber, imageData);
      } catch (error) {
        console.error(`Error extracting frame ${task.frameNumber}:`, error);
      } finally {
        this.releaseCanvas(canvasObj);
      }
    }
  }

  getVideoElement(): HTMLVideoElement {
    return this.video;
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
    this.canvasPool = [];
  }
}