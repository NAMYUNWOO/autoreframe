import { ExportOptions, FrameTransform, VideoMetadata } from '@/types';
import { getOutputDimensions } from '../reframing/presets';

export class SimpleExporter {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
  }

  async export(
    videoElement: HTMLVideoElement,
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

    this.canvas.width = width;
    this.canvas.height = height;

    // Create a new video element for export
    const exportVideo = document.createElement('video');
    exportVideo.src = videoElement.src;
    exportVideo.muted = true;
    
    await new Promise<void>((resolve) => {
      exportVideo.onloadeddata = () => resolve();
    });

    // Set up MediaRecorder
    const stream = this.canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8',
      videoBitsPerSecond: options.bitrate || 2000000
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        resolve(blob);
      };

      recorder.onerror = reject;

      // Start recording
      recorder.start();

      // Play video and render frames
      let frameCount = 0;
      const totalFrames = Math.ceil(metadata.duration * metadata.fps);
      
      const renderFrame = () => {
        if (exportVideo.paused || exportVideo.ended) {
          console.log('Video ended, stopping recorder. Frames processed:', frameCount);
          // Ensure we've processed all frames
          if (onProgress) {
            onProgress(100);
          }
          setTimeout(() => {
            recorder.stop();
          }, 500);
          return;
        }

        const currentFrame = Math.floor(exportVideo.currentTime * metadata.fps);
        const transform = transforms.get(currentFrame) || {
          x: metadata.width / 2,
          y: metadata.height / 2,
          scale: 1,
          rotation: 0
        };

        // Clear canvas
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, width, height);

        // Calculate crop area
        const cropW = width / transform.scale;
        const cropH = height / transform.scale;
        const sx = Math.max(0, Math.min(metadata.width - cropW, transform.x - cropW / 2));
        const sy = Math.max(0, Math.min(metadata.height - cropH, transform.y - cropH / 2));

        // Draw video frame
        try {
          this.ctx.drawImage(
            exportVideo,
            sx, sy, cropW, cropH,
            0, 0, width, height
          );
        } catch (error) {
          console.error('Error drawing frame:', error);
        }

        frameCount++;
        if (onProgress) {
          const progress = Math.min(99, (frameCount / totalFrames) * 100);
          onProgress(progress);
        }

        requestAnimationFrame(renderFrame);
      };

      exportVideo.play().then(() => {
        renderFrame();
      }).catch(reject);
    });
  }
}