import { ExportOptions, FrameTransform, VideoMetadata } from '@/types';
import { getOutputDimensions } from '../reframing/presets';

export class PreciseVideoExporter {
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
      willReadFrequently: false 
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

    // Create a new video element for export
    const exportVideo = document.createElement('video');
    exportVideo.src = this.sourceVideo.src;
    exportVideo.muted = true;
    exportVideo.preload = 'auto';
    
    // Wait for video to be ready
    await new Promise<void>((resolve) => {
      exportVideo.onloadeddata = () => {
        resolve();
      };
    });

    return new Promise((resolve, reject) => {
      try {
        // Set up MediaRecorder with exact frame rate
        const stream = this.outputCanvas.captureStream(metadata.fps);
        const videoTrack = stream.getVideoTracks()[0];
        
        // Configure track settings
        if (videoTrack && 'applyConstraints' in videoTrack) {
          videoTrack.applyConstraints({
            frameRate: { exact: metadata.fps },
            width: { exact: width },
            height: { exact: height }
          }).catch(console.warn);
        }
        
        // Check supported mime types
        let mimeType = 'video/webm';
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
          mimeType = 'video/webm;codecs=vp8,opus';
        } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
          mimeType = 'video/webm;codecs=vp8';
        } else if (MediaRecorder.isTypeSupported('video/webm')) {
          mimeType = 'video/webm';
        }
        
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

        // Start recording
        this.recorder.start(100); // Capture data every 100ms

        // Process frames sequentially with precise timing
        this.processFramesSequential(
          exportVideo,
          transforms,
          metadata,
          width,
          height,
          onProgress
        ).then(() => {
          // Wait a bit to ensure all frames are captured
          setTimeout(() => {
            if (this.recorder && this.recorder.state === 'recording') {
              this.recorder.stop();
            }
          }, 500);
        }).catch(reject);

      } catch (error) {
        reject(error);
      }
    });
  }

  private async processFramesSequential(
    video: HTMLVideoElement,
    transforms: Map<number, FrameTransform>,
    metadata: VideoMetadata,
    outputWidth: number,
    outputHeight: number,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const frameInterval = 1 / metadata.fps;
    const totalFrames = Math.floor(metadata.duration * metadata.fps);
    const frameTime = 1000 / metadata.fps; // ms per frame

    // Process each frame sequentially
    for (let frameNumber = 0; frameNumber < totalFrames; frameNumber++) {
      const timestamp = frameNumber * frameInterval;
      const transform = transforms.get(frameNumber) || {
        x: metadata.width / 2,
        y: metadata.height / 2,
        scale: 1,
        rotation: 0
      };

      // Seek to exact frame time
      await this.seekToTime(video, timestamp);
      
      // Render the frame
      this.renderFrame(video, transform, outputWidth, outputHeight);

      // Update progress
      if (onProgress) {
        onProgress((frameNumber / totalFrames) * 100);
      }

      // Control frame rate by waiting
      await this.waitForNextFrame(frameTime);
    }
  }

  private async seekToTime(video: HTMLVideoElement, time: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        resolve();
      };
      
      const onError = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        reject(new Error('Failed to seek video'));
      };

      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);
      
      // Set time with high precision
      video.currentTime = Math.round(time * 1000) / 1000;
    });
  }

  private renderFrame(
    video: HTMLVideoElement,
    transform: FrameTransform,
    outputWidth: number,
    outputHeight: number
  ): void {
    // Clear canvas
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, outputWidth, outputHeight);

    // Apply transform
    this.ctx.save();
    
    // Center the transform
    this.ctx.translate(outputWidth / 2, outputHeight / 2);
    
    // Apply rotation if needed
    if (transform.rotation) {
      this.ctx.rotate(transform.rotation);
    }

    // Calculate source area
    const sourceWidth = outputWidth / transform.scale;
    const sourceHeight = outputHeight / transform.scale;
    
    // Clamp source coordinates to video bounds
    const sx = Math.max(0, Math.min(video.videoWidth - sourceWidth, transform.x - sourceWidth / 2));
    const sy = Math.max(0, Math.min(video.videoHeight - sourceHeight, transform.y - sourceHeight / 2));
    
    // Adjust source dimensions if they exceed video bounds
    const actualSourceWidth = Math.min(sourceWidth, video.videoWidth - sx);
    const actualSourceHeight = Math.min(sourceHeight, video.videoHeight - sy);

    // Draw video frame
    this.ctx.drawImage(
      video,
      sx, sy, actualSourceWidth, actualSourceHeight,
      -outputWidth / 2, -outputHeight / 2, outputWidth, outputHeight
    );

    this.ctx.restore();
  }

  private async waitForNextFrame(targetFrameTime: number): Promise<void> {
    // Use requestAnimationFrame for smoother frame timing
    return new Promise(resolve => {
      const startTime = performance.now();
      const waitFrame = () => {
        const elapsed = performance.now() - startTime;
        if (elapsed >= targetFrameTime) {
          resolve();
        } else {
          requestAnimationFrame(waitFrame);
        }
      };
      requestAnimationFrame(waitFrame);
    });
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
  }
}