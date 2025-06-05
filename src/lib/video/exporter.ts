import { ExportOptions, FrameTransform, VideoMetadata } from '@/types';
import { getOutputDimensions, ASPECT_RATIOS } from '../reframing/presets';

export class VideoExporter {
  private sourceVideo: HTMLVideoElement;
  private outputCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(sourceVideo: HTMLVideoElement) {
    this.sourceVideo = sourceVideo;
    this.outputCanvas = document.createElement('canvas');
    this.ctx = this.outputCanvas.getContext('2d')!;
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
    await new Promise(resolve => exportVideo.onloadedmetadata = resolve);

    return new Promise((resolve, reject) => {
      try {
        // Set up MediaRecorder
        const stream = this.outputCanvas.captureStream(metadata.fps);
        const mimeType = options.format === 'webm' 
          ? 'video/webm;codecs=vp9' 
          : 'video/mp4';
        
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

        // Process frames
        this.processExportFrames(
          exportVideo,
          transforms,
          metadata,
          width,
          height,
          onProgress
        ).then(() => {
          this.recorder!.stop();
        }).catch(reject);

      } catch (error) {
        reject(error);
      }
    });
  }

  private async processExportFrames(
    video: HTMLVideoElement,
    transforms: Map<number, FrameTransform>,
    metadata: VideoMetadata,
    outputWidth: number,
    outputHeight: number,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const frameInterval = 1 / metadata.fps;
    const totalFrames = Math.floor(metadata.duration * metadata.fps);

    for (let frameNumber = 0; frameNumber < totalFrames; frameNumber++) {
      const timestamp = frameNumber * frameInterval;
      const transform = transforms.get(frameNumber) || {
        x: metadata.width / 2,
        y: metadata.height / 2,
        scale: 1,
        rotation: 0
      };

      await this.renderFrame(video, timestamp, transform, outputWidth, outputHeight);

      if (onProgress) {
        onProgress((frameNumber / totalFrames) * 100);
      }

      // Allow UI to update
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  private async renderFrame(
    video: HTMLVideoElement,
    timestamp: number,
    transform: FrameTransform,
    outputWidth: number,
    outputHeight: number
  ): Promise<void> {
    return new Promise((resolve) => {
      video.currentTime = timestamp;
      video.onseeked = () => {
        // Clear canvas
        this.ctx.fillStyle = 'black';
        this.ctx.fillRect(0, 0, outputWidth, outputHeight);

        // Apply transform
        this.ctx.save();
        
        // Center the transform
        this.ctx.translate(outputWidth / 2, outputHeight / 2);
        
        // Apply rotation if needed
        if (transform.rotation) {
          this.ctx.rotate(transform.rotation);
        }

        // Calculate crop area
        const sourceWidth = outputWidth / transform.scale;
        const sourceHeight = outputHeight / transform.scale;
        
        // Source position (centered on transform point)
        const sx = transform.x - sourceWidth / 2;
        const sy = transform.y - sourceHeight / 2;

        // Draw the transformed video frame
        this.ctx.drawImage(
          video,
          sx, sy, sourceWidth, sourceHeight,
          -outputWidth / 2, -outputHeight / 2, outputWidth, outputHeight
        );

        this.ctx.restore();
        resolve();
      };
    });
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
  }
}