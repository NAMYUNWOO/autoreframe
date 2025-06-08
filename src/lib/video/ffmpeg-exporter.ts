import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { ExportOptions, FrameTransform, VideoMetadata, ReframingConfig } from '@/types';
import { getOutputDimensions } from '../reframing/presets';
import { ReframeSizeCalculatorV2 } from '../reframing/reframe-size-calculator-v2';

export class FFmpegExporter {
  private ffmpeg: FFmpeg;
  private loaded = false;

  constructor() {
    this.ffmpeg = new FFmpeg();
  }

  async load() {
    if (this.loaded) return;

    // Use local files for faster loading
    const baseURL = '/ffmpeg';
    this.ffmpeg.on('log', ({ message }) => {
      // console.log('[FFmpeg]', message);
    });

    try {
      // Try loading from local files first
      await this.ffmpeg.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      });
    } catch (error) {
      // console.warn('Failed to load FFmpeg from local files, falling back to CDN');
      // Fallback to CDN if local files fail
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

    // Create canvas for frame processing
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false })!;

    // Create a custom progress handler
    const webmProgress = (progress: number) => {
      if (onProgress) {
        onProgress(progress * 0.8); // WebM creation is 80% of the work
      }
    };

    // First, use WebM export to create intermediate video
    const webmBlob = await this.exportToWebM(
      videoElement,
      transforms,
      metadata,
      width,
      height,
      ctx,
      canvas,
      options,
      webmProgress,
      reframingConfig,
      initialTargetBox
    );

    // Update progress for conversion phase
    if (onProgress) {
      onProgress(80);
    }

    // Convert WebM to target format using FFmpeg
    const webmData = await fetchFile(webmBlob);
    await this.ffmpeg.writeFile('input.webm', webmData);

    // First, probe the WebM file to check its properties
    try {
      await this.ffmpeg.exec(['-i', 'input.webm', '-f', 'null', '-']);
    } catch (e) {
      // This will fail but logs info about the input file
    }

    const outputFile = options.format === 'mov' ? 'output.mov' : 'output.mp4';
    const mimeType = options.format === 'mov' ? 'video/quicktime' : 'video/mp4';

    // Set up FFmpeg progress monitoring
    this.ffmpeg.on('progress', ({ progress }) => {
      if (onProgress && typeof progress === 'number' && progress >= 0 && progress <= 1) {
        // FFmpeg progress is the remaining 20%
        onProgress(80 + (progress * 20));
      }
    });

    // Log info for debugging
    // console.log(`Converting WebM to ${options.format}, Target FPS: ${metadata.fps}, Duration: ${metadata.duration}s`);
    
    // FFmpeg command with explicit duration and frame rate handling
    const ffmpegArgs = [
      '-i', 'input.webm',
      '-t', `${metadata.duration}`, // Explicitly set duration
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '15',
      '-pix_fmt', 'yuv420p',
      '-b:v', `${options.bitrate || 12000000}`,
      '-r', `${metadata.fps}`, // Force output frame rate
      '-vsync', '1' // Duplicate/drop frames as needed to achieve constant frame rate
    ];

    if (options.format === 'mov') {
      ffmpegArgs.push('-movflags', '+faststart');
    } else {
      ffmpegArgs.push('-movflags', 'faststart');
    }

    ffmpegArgs.push(outputFile);
    
    await this.ffmpeg.exec(ffmpegArgs);

    const data = await this.ffmpeg.readFile(outputFile);
    
    // Clean up
    await this.ffmpeg.deleteFile('input.webm');
    await this.ffmpeg.deleteFile(outputFile);

    return new Blob([data], { type: mimeType });
  }

  private async exportToWebM(
    videoElement: HTMLVideoElement,
    transforms: Map<number, FrameTransform>,
    metadata: VideoMetadata,
    width: number,
    height: number,
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    options: ExportOptions,
    onProgress?: (progress: number) => void,
    reframingConfig?: ReframingConfig,
    initialTargetBox?: { width: number; height: number }
  ): Promise<Blob> {
    // Create a new video element for export
    const exportVideo = document.createElement('video');
    exportVideo.src = videoElement.src;
    exportVideo.muted = true;
    
    await new Promise<void>((resolve) => {
      exportVideo.onloadeddata = () => resolve();
    });

    // Calculate exact frame timing
    const fps = metadata.fps;
    const frameInterval = 1000 / fps; // milliseconds per frame
    
    // Set up MediaRecorder with specific frame rate
    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8',
      videoBitsPerSecond: options.bitrate || 12000000
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const recordingPromise = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    // Start recording with a small delay to ensure first frame is captured
    recorder.start(10); // collect data every 10ms

    // Process each frame
    const totalFrames = Math.floor(metadata.duration * fps);
    let currentFrame = 0;
    let startTime = performance.now();

    const processFrame = async () => {
      if (currentFrame >= totalFrames) {
        // Ensure we've recorded for the full duration
        const expectedDuration = metadata.duration * 1000;
        const actualDuration = performance.now() - startTime;
        if (actualDuration < expectedDuration) {
          await new Promise(resolve => setTimeout(resolve, expectedDuration - actualDuration));
        }
        recorder.stop();
        return;
      }

      const time = currentFrame / fps;
      exportVideo.currentTime = time;

      await new Promise<void>((resolve) => {
        exportVideo.onseeked = () => {
          const transform = transforms.get(currentFrame);
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
          resolve();
        };
      });

      if (onProgress) {
        onProgress((currentFrame / totalFrames) * 100);
      }

      currentFrame++;
      
      // Calculate next frame time
      const nextFrameTime = startTime + (currentFrame * frameInterval);
      const now = performance.now();
      const delay = Math.max(0, nextFrameTime - now);
      
      setTimeout(() => processFrame(), delay);
    };

    await processFrame();
    await recordingPromise;

    return new Blob(chunks, { type: 'video/webm' });
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

    // Calculate crop dimensions
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