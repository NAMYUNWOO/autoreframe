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
      // console.log('[FFmpeg]', message);
    });

    try {
      await this.ffmpeg.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      });
    } catch (error) {
      // console.warn('Failed to load FFmpeg from local files, falling back to CDN');
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
    
    let inputFile: string;

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

    // First, write the original video to FFmpeg for audio extraction
    // console.log('Fetching video from:', videoElement.src);
    const videoBlob = await fetch(videoElement.src).then(r => r.blob());
    // console.log('Video blob size:', videoBlob.size, 'type:', videoBlob.type);
    const videoData = await fetchFile(videoBlob);
    // console.log('Video data size:', videoData.byteLength);
    
    // Use appropriate extension based on MIME type
    const inputExt = videoBlob.type.includes('mp4') ? 'mp4' : 
                     videoBlob.type.includes('webm') ? 'webm' : 
                     videoBlob.type.includes('quicktime') ? 'mov' : 'mp4';
    inputFile = `original.${inputExt}`;
    
    await this.ffmpeg.writeFile(inputFile, videoData);
    // console.log('Wrote input file:', inputFile);

    // Extract frames as images
    const totalFrames = Math.floor(metadata.duration * metadata.fps);
    // console.log(`Extracting ${totalFrames} frames at ${metadata.fps} fps`);
    
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
          // Use higher quality for best preset
          const jpegQuality = options.quality === 15 ? 0.98 : 0.95;
          
          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Failed to create blob from canvas'));
              }
            }, 'image/jpeg', jpegQuality);
          });
          
          const imageData = await fetchFile(blob);
          const filename = `frame_${String(frame).padStart(5, '0')}.jpg`;
          await this.ffmpeg.writeFile(filename, imageData);
          
          // if (frame === 0) {
          //   console.log(`First frame saved: ${filename}, size: ${imageData.byteLength}`);
          // }

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

    const format = options.format || 'mp4';
    const outputFile = format === 'mov' ? 'output.mov' : 'output.mp4';
    const mimeType = format === 'mov' ? 'video/quicktime' : 'video/mp4';

    // Log export options for debugging
    console.log('FFmpegSequenceExporter Options:', {
      format: format,
      crf: options.quality || 23,
      bitrate: options.bitrate || 5000000,
      fps: metadata.fps
    });

    // Create video from image sequence with audio from original
    const isLossless = options.quality === 0;
    
    const ffmpegArgs = [
      '-framerate', `${metadata.fps}`,
      '-i', 'frame_%05d.jpg',
      '-i', inputFile,
      '-map', '0:v',  // Use video from image sequence
      '-map', '1:a?', // Use audio from original (if exists)
    ];

    // Optimize encoding based on quality level
    const isBestQuality = options.quality === 15;
    
    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', isBestQuality ? 'slow' : 'medium',  // Use slow preset for best quality
      '-crf', `${options.quality || 23}`,
      '-pix_fmt', 'yuv420p',
      '-profile:v', isBestQuality ? 'high' : 'main',
      '-level', '4.1'
    );
    
    // Add rate control
    ffmpegArgs.push(
      '-maxrate', `${options.bitrate || 5000000}`,
      '-bufsize', `${(options.bitrate || 5000000) * 2}`
    );
    
    // Additional quality optimization for best preset
    if (isBestQuality) {
      ffmpegArgs.push(
        '-x264-params', 'aq-mode=3:aq-strength=0.8',  // Adaptive quantization for better quality
        '-g', `${metadata.fps * 2}`  // GOP size for better seeking
      );
    }

    ffmpegArgs.push(
      '-c:a', 'copy', // Copy audio without re-encoding
      '-shortest', // Match duration to shortest stream
      outputFile
    );

    if (format === 'mov') {
      ffmpegArgs.splice(-1, 0, '-movflags', '+faststart');
    } else {
      ffmpegArgs.splice(-1, 0, '-movflags', 'faststart');
    }

    console.log('FFmpeg command:', ffmpegArgs.join(' '));
    
    try {
      await this.ffmpeg.exec(ffmpegArgs);
    } catch (error) {
      // console.error('FFmpeg execution failed:', error);
      throw error;
    }

    // console.log('Reading output file:', outputFile);
    const data = await this.ffmpeg.readFile(outputFile);
    // console.log('Output file size:', data.byteLength);
    
    // Clean up
    for (let frame = 0; frame < totalFrames; frame++) {
      const filename = `frame_${String(frame).padStart(5, '0')}.jpg`;
      await this.ffmpeg.deleteFile(filename);
    }
    await this.ffmpeg.deleteFile(inputFile);
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