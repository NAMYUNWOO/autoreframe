import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { ExportOptions, FrameTransform, VideoMetadata, ReframingConfig } from '@/types';
import { getOutputDimensions } from '../reframing/presets';
import { ReframeSizeCalculatorV2 } from '../reframing/reframe-size-calculator-v2';

export class FFmpegSequenceExporter {
  private ffmpeg: FFmpeg;
  private loaded = false;

  constructor() {
    this.ffmpeg = new FFmpeg();
  }

  async load() {
    if (this.loaded) return;

    const baseURL = '/ffmpeg';
    this.ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    try {
      await this.ffmpeg.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      });
    } catch (error) {
      console.warn('Failed to load FFmpeg from local files, falling back to CDN');
      const cdnURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
      await this.ffmpeg.load({
        coreURL: await toBlobURL(`${cdnURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${cdnURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
    }

    this.loaded = true;
  }

  async export(
    videoElement: HTMLVideoElement,
    transforms: Map<number, FrameTransform>,
    metadata: VideoMetadata,
    outputRatio: string,
    options: ExportOptions,
    onProgress?: (progress: number) => void,
    reframingConfig?: ReframingConfig,
    initialTargetBox?: { width: number; height: number }
  ): Promise<Blob> {
    await this.load();

    const { width, height } = getOutputDimensions(
      metadata.width,
      metadata.height,
      outputRatio as any
    );

    // Create canvas for frame extraction
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { 
      alpha: false,
      willReadFrequently: true 
    })!;

    // Create video element for frame extraction
    const exportVideo = document.createElement('video');
    exportVideo.src = videoElement.src;
    exportVideo.muted = true;
    
    await new Promise<void>((resolve) => {
      exportVideo.onloadeddata = () => resolve();
    });

    // Extract frames as images
    const totalFrames = Math.floor(metadata.duration * metadata.fps);
    
    for (let frame = 0; frame < totalFrames; frame++) {
      const time = frame / metadata.fps;
      exportVideo.currentTime = time;

      await new Promise<void>((resolve) => {
        exportVideo.onseeked = async () => {
          const transform = transforms.get(frame);
          if (!transform) {
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, width, height);
          } else {
            this.applyTransform(
              ctx,
              exportVideo,
              transform,
              width,
              height,
              metadata,
              reframingConfig,
              initialTargetBox
            );
          }

          // Convert canvas to image and write to FFmpeg
          const blob = await new Promise<Blob>((resolve) => {
            canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.95);
          });
          
          const imageData = await fetchFile(blob);
          const filename = `frame_${String(frame).padStart(5, '0')}.jpg`;
          await this.ffmpeg.writeFile(filename, imageData);

          if (onProgress) {
            onProgress((frame / totalFrames) * 80); // 80% for frame extraction
          }

          resolve();
        };
      });
    }

    // Set up progress monitoring for encoding
    this.ffmpeg.on('progress', ({ progress }) => {
      if (onProgress && typeof progress === 'number' && progress >= 0 && progress <= 1) {
        onProgress(80 + (progress * 20)); // Last 20% for encoding
      }
    });

    const outputFile = options.format === 'mov' ? 'output.mov' : 'output.mp4';
    const mimeType = options.format === 'mov' ? 'video/quicktime' : 'video/mp4';

    // Create video from image sequence
    const ffmpegArgs = [
      '-framerate', `${metadata.fps}`,
      '-i', 'frame_%05d.jpg',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '15',
      '-pix_fmt', 'yuv420p',
      '-b:v', `${options.bitrate || 12000000}`,
      outputFile
    ];

    if (options.format === 'mov') {
      ffmpegArgs.splice(-1, 0, '-movflags', '+faststart');
    }

    await this.ffmpeg.exec(ffmpegArgs);

    const data = await this.ffmpeg.readFile(outputFile);
    
    // Clean up
    for (let frame = 0; frame < totalFrames; frame++) {
      const filename = `frame_${String(frame).padStart(5, '0')}.jpg`;
      await this.ffmpeg.deleteFile(filename);
    }
    await this.ffmpeg.deleteFile(outputFile);

    return new Blob([data], { type: mimeType });
  }

  private applyTransform(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    transform: FrameTransform,
    outputWidth: number,
    outputHeight: number,
    metadata: VideoMetadata,
    reframingConfig?: ReframingConfig,
    initialTargetBox?: { width: number; height: number }
  ) {
    ctx.save();
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, outputWidth, outputHeight);

    let cropW: number, cropH: number;
    
    if (initialTargetBox && reframingConfig) {
      const outputAspectRatio = outputWidth / outputHeight;
      const calculatedDimensions = ReframeSizeCalculatorV2.calculateOptimalReframeSize(
        initialTargetBox,
        metadata.width,
        metadata.height,
        outputAspectRatio,
        reframingConfig
      );
      cropW = calculatedDimensions.width;
      cropH = calculatedDimensions.height;
    } else {
      cropW = metadata.width / transform.scale;
      cropH = metadata.height / transform.scale;
    }

    const sx = Math.max(0, Math.min(metadata.width - cropW, transform.x - cropW / 2));
    const sy = Math.max(0, Math.min(metadata.height - cropH, transform.y - cropH / 2));

    ctx.drawImage(
      video,
      sx, sy, cropW, cropH,
      0, 0, outputWidth, outputHeight
    );

    ctx.restore();
  }
}