import { VideoMetadata, Detection, ProcessingStatus } from '@/types';
import { VideoRotationDetector } from './rotation-detector';
// MediaInfo types
type ReadChunkFunc = (chunkSize: number, offset: number) => Promise<Uint8Array>;

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
    try {
      // First, extract metadata using MediaInfo.js
      console.log('[VideoProcessor] Extracting metadata with MediaInfo.js...');
      const mediaInfo = await this.extractMediaInfo(file);
      
      // Then load the video for playback
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        this.video.src = url;
        
        this.video.onloadedmetadata = async () => {
          // Detect video rotation
          this.videoRotation = await VideoRotationDetector.detectRotation(this.video);
          console.log('[VideoProcessor] Detected video rotation:', this.videoRotation);
          
          // Get corrected dimensions
          const correctedDims = VideoRotationDetector.getCorrectedDimensions(
            this.video.videoWidth,
            this.video.videoHeight,
            this.videoRotation
          );
          
          // Use MediaInfo data if available, fallback to estimation
          const fps = mediaInfo.fps || await this.estimateFPS();
          const totalFrames = mediaInfo.totalFrames || Math.round(this.video.duration * fps);
          
          this.metadata = {
            duration: this.video.duration,
            width: correctedDims.width,
            height: correctedDims.height,
            fps: fps,
            rotation: this.videoRotation,
            totalFrames: totalFrames
          };
          
          console.log('[VideoProcessor] Video metadata:', {
            duration: this.metadata.duration,
            fps: this.metadata.fps,
            totalFrames: this.metadata.totalFrames,
            resolution: `${this.metadata.width}x${this.metadata.height}`
          });
          
          this.canvas.width = this.metadata.width;
          this.canvas.height = this.metadata.height;
          
          resolve(this.metadata);
        };
        
        this.video.onerror = () => {
          reject(new Error('Failed to load video'));
        };
      });
    } catch (error) {
      console.error('[VideoProcessor] Error loading video:', error);
      throw error;
    }
  }

  private async extractMediaInfo(file: File): Promise<{ fps: number | null; totalFrames: number | null }> {
    let mediaInfo: any = null;
    
    try {
      // Only run on client side
      if (typeof window === 'undefined') {
        console.log('[VideoProcessor] Skipping MediaInfo on server side');
        return { fps: null, totalFrames: null };
      }
      
      // Dynamic import MediaInfo.js
      const MediaInfoFactory = (await import('mediainfo.js')).default;
      
      // Initialize MediaInfo with locateFile to use the file from public folder
      mediaInfo = await MediaInfoFactory({
        format: 'object',
        locateFile: () => '/MediaInfoModule.wasm'
      });
      
      // Create read function for MediaInfo
      const readChunk: ReadChunkFunc = (chunkSize, offset) => 
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) {
              resolve(new Uint8Array(event.target.result as ArrayBuffer));
            } else {
              reject(new Error('Failed to read chunk'));
            }
          };
          reader.onerror = reject;
          reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
        });
      
      const result = await mediaInfo.analyzeData(() => file.size, readChunk);
      
      console.log('[VideoProcessor] MediaInfo full result:', JSON.stringify(result, null, 2));
      console.log('[VideoProcessor] File analyzed:', file.name, 'Size:', file.size);
      
      // Find video track
      const videoTrack = result.media?.track?.find((t: any) => t['@type'] === 'Video');
      
      if (videoTrack) {
        const fps = parseFloat(videoTrack.FrameRate || '0');
        const frameCount = parseInt(videoTrack.FrameCount || '0');
        
        console.log('[VideoProcessor] MediaInfo extracted:', {
          fps: fps || null,
          frameCount: frameCount || null,
          duration: videoTrack.Duration,
          codec: videoTrack.Format
        });
        
        return {
          fps: fps > 0 ? fps : null,
          totalFrames: frameCount > 0 ? frameCount : null
        };
      }
      
      console.log('[VideoProcessor] No video track found in MediaInfo');
      return { fps: null, totalFrames: null };
      
    } catch (error) {
      console.error('[VideoProcessor] MediaInfo extraction failed:', error);
      // Return null values to fallback to estimation
      return { fps: null, totalFrames: null };
    } finally {
      // Always close MediaInfo instance when done
      if (mediaInfo && typeof mediaInfo.close === 'function') {
        mediaInfo.close();
      }
    }
  }

  private async estimateFPS(): Promise<number> {
    // Try to get FPS from video metadata if available
    const videoTrack = (this.video as any).captureStream?.()?.getVideoTracks()[0];
    if (videoTrack) {
      const settings = videoTrack.getSettings();
      if (settings.frameRate) {
        console.log(`[VideoProcessor] Got FPS from video track: ${settings.frameRate}`);
        return settings.frameRate;
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
          const estimatedFps = frameCount / realDuration;
          
          // Common frame rates - include more precise values
          const commonFps = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
          const closest = commonFps.reduce((prev, curr) => 
            Math.abs(curr - estimatedFps) < Math.abs(prev - estimatedFps) ? curr : prev
          );
          
          console.log(`[VideoProcessor] Detected FPS: ${estimatedFps}, using: ${closest}`);
          
          // If the estimated FPS is very close to the raw value, use the raw value
          if (Math.abs(estimatedFps - closest) > 2) {
            console.log(`[VideoProcessor] Using raw FPS value: ${estimatedFps}`);
            resolve(estimatedFps);
          } else {
            resolve(closest);
          }
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
    // Use exact frame count from MediaInfo if available
    const totalFrames = this.metadata.totalFrames || Math.floor(this.metadata.duration * this.metadata.fps + 0.5);
    
    for (let frameNumber = 0; frameNumber < totalFrames; frameNumber++) {
      const timestamp = frameNumber * frameInterval;
      
      if (this.onProgress) {
        const isDetectionFrame = frameNumber % 10 === 0; // Match the sample interval
        this.onProgress({
          stage: 'analyzing',
          progress: ((frameNumber + 1) / totalFrames) * 100,
          message: isDetectionFrame 
            ? `Detecting heads in frame ${frameNumber + 1} of ${totalFrames}`
            : `Processing frame ${frameNumber + 1} of ${totalFrames}`
        });
      }
      
      try {
        const imageData = await this.extractFrame(timestamp);
        await onFrame(imageData, frameNumber, timestamp);
      } catch (error) {
        // console.error(`Error processing frame ${frameNumber}:`, error);
      }
    }
    
    // Ensure progress reaches 100% when complete
    if (this.onProgress) {
      this.onProgress({
        stage: 'analyzing',
        progress: 100,
        message: `Completed processing ${totalFrames} frames`
      });
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