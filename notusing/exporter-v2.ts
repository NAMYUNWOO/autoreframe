import { ExportOptions, FrameTransform, VideoMetadata } from '@/types';
import { getOutputDimensions } from '../reframing/presets';

export class VideoExporterV2 {
  private sourceVideo: HTMLVideoElement;
  private outputCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(sourceVideo: HTMLVideoElement) {
    this.sourceVideo = sourceVideo;
    this.outputCanvas = document.createElement('canvas');
    this.ctx = this.outputCanvas.getContext('2d', { 
      alpha: false,
      desynchronized: true 
    })!;
  }

  async export(
    transforms: Map<number, FrameTransform>,
    metadata: VideoMetadata,
    outputRatio: string,
    options: ExportOptions,
    onProgress?: (progress: number) => void
  ): Promise<Blob> {
    const { width, height } = getOutputDimensions(
      metadata.width,
      metadata.height,
      outputRatio as any
    );
    
    this.outputCanvas.width = width;
    this.outputCanvas.height = height;

    // Create a new video element for export to avoid interference
    const exportVideo = document.createElement('video');
    exportVideo.src = this.sourceVideo.src;
    exportVideo.muted = true;
    exportVideo.playbackRate = 1.0;
    
    // Wait for video to be ready
    await new Promise<void>((resolve) => {
      exportVideo.onloadedmetadata = () => {
        exportVideo.currentTime = 0;
        resolve();
      };
    });

    return new Promise((resolve, reject) => {
      try {
        // Set up MediaRecorder with exact FPS
        const stream = this.outputCanvas.captureStream(metadata.fps);
        const mimeType = options.format === 'webm' 
          ? 'video/webm;codecs=vp9' 
          : 'video/webm'; // Use webm for better compatibility
        
        this.recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: options.bitrate || 8000000
        });

        this.chunks = [];
        this.recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            this.chunks.push(e.data);
          }
        };

        this.recorder.onstop = () => {
          const blob = new Blob(this.chunks, { type: mimeType });
          resolve(blob);
        };

        this.recorder.start();

        // Use real-time playback for accurate frame timing
        this.processFramesRealtime(
          exportVideo,
          transforms,
          metadata,
          width,
          height,
          onProgress
        ).then(() => {
          setTimeout(() => {
            this.recorder!.stop();
          }, 100); // Small delay to ensure last frame is captured
        }).catch(reject);

      } catch (error) {
        reject(error);
      }
    });
  }

  private async processFramesRealtime(
    video: HTMLVideoElement,
    transforms: Map<number, FrameTransform>,
    metadata: VideoMetadata,
    outputWidth: number,
    outputHeight: number,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const frameInterval = 1000 / metadata.fps; // milliseconds per frame
    const totalFrames = Math.floor(metadata.duration * metadata.fps);
    let frameNumber = 0;
    let lastFrameTime = performance.now();

    return new Promise((resolve, reject) => {
      const processFrame = () => {
        if (frameNumber >= totalFrames || video.ended) {
          resolve();
          return;
        }

        const currentTime = performance.now();
        const elapsed = currentTime - lastFrameTime;

        // Only process frame if enough time has passed
        if (elapsed >= frameInterval) {
          const transform = transforms.get(frameNumber) || {
            x: metadata.width / 2,
            y: metadata.height / 2,
            scale: 1,
            rotation: 0
          };

          this.renderFrameImmediate(video, transform, outputWidth, outputHeight);

          if (onProgress) {
            onProgress((frameNumber / totalFrames) * 100);
          }

          frameNumber++;
          lastFrameTime = currentTime - (elapsed % frameInterval); // Adjust for timing drift
        }

        requestAnimationFrame(processFrame);
      };

      // Start video playback
      video.play().then(() => {
        processFrame();
      }).catch(reject);
    });
  }

  private renderFrameImmediate(
    video: HTMLVideoElement,
    transform: FrameTransform,
    outputWidth: number,
    outputHeight: number
  ): void {
    // Clear canvas with black background
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, outputWidth, outputHeight);

    // Save context state
    this.ctx.save();
    
    // Center the transform
    this.ctx.translate(outputWidth / 2, outputHeight / 2);
    
    // Apply rotation if needed
    if (transform.rotation) {
      this.ctx.rotate(transform.rotation);
    }

    // Calculate crop area maintaining aspect ratio
    const sourceWidth = outputWidth / transform.scale;
    const sourceHeight = outputHeight / transform.scale;
    
    // Source position (centered on transform point)
    const sx = Math.max(0, Math.min(video.videoWidth - sourceWidth, transform.x - sourceWidth / 2));
    const sy = Math.max(0, Math.min(video.videoHeight - sourceHeight, transform.y - sourceHeight / 2));

    // Ensure we don't go beyond video bounds
    const actualSourceWidth = Math.min(sourceWidth, video.videoWidth - sx);
    const actualSourceHeight = Math.min(sourceHeight, video.videoHeight - sy);

    // Calculate destination size to maintain aspect ratio
    const destWidth = actualSourceWidth * transform.scale;
    const destHeight = actualSourceHeight * transform.scale;

    // Draw the video frame
    try {
      this.ctx.drawImage(
        video,
        sx, sy, actualSourceWidth, actualSourceHeight,
        -destWidth / 2, -destHeight / 2, destWidth, destHeight
      );
    } catch (error) {
      console.error('Error drawing frame:', error);
    }

    this.ctx.restore();
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
  }
}