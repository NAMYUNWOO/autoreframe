import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { ExportOptions, FrameTransform, VideoMetadata, ReframingConfig } from '@/types';
import { getOutputDimensions } from '../reframing/presets';
import { ReframeSizeCalculatorV2 } from '../reframing/reframe-size-calculator-v2';

export class FFmpegDirectExporter {
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

    const { width: outputWidth, height: outputHeight } = getOutputDimensions(
      metadata.width,
      metadata.height,
      outputRatio as any
    );

    // Write original video to FFmpeg
    const videoBlob = await fetch(videoElement.src).then(r => r.blob());
    const videoData = await fetchFile(videoBlob);
    await this.ffmpeg.writeFile('input.mp4', videoData);

    // Generate filter script for cropping/scaling
    const filterScript = this.generateFilterScript(
      transforms,
      metadata,
      outputWidth,
      outputHeight,
      reframingConfig,
      initialTargetBox
    );

    await this.ffmpeg.writeFile('filter.txt', new TextEncoder().encode(filterScript));

    // Set up progress monitoring
    this.ffmpeg.on('progress', ({ progress }) => {
      if (onProgress && typeof progress === 'number' && progress >= 0 && progress <= 1) {
        onProgress(progress * 100);
      }
    });

    const outputFile = options.format === 'mov' ? 'output.mov' : 'output.mp4';
    const mimeType = options.format === 'mov' ? 'video/quicktime' : 'video/mp4';

    // Use FFmpeg with frame-accurate filter
    const ffmpegArgs = [
      '-i', 'input.mp4',
      '-filter_complex_script', 'filter.txt',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '15',
      '-pix_fmt', 'yuv420p',
      '-b:v', `${options.bitrate || 12000000}`,
      '-c:a', 'copy',
      '-y',
      outputFile
    ];

    if (options.format === 'mov') {
      ffmpegArgs.splice(-1, 0, '-movflags', '+faststart');
    }

    await this.ffmpeg.exec(ffmpegArgs);

    const data = await this.ffmpeg.readFile(outputFile);
    
    // Clean up
    await this.ffmpeg.deleteFile('input.mp4');
    await this.ffmpeg.deleteFile('filter.txt');
    await this.ffmpeg.deleteFile(outputFile);

    return new Blob([data], { type: mimeType });
  }

  private generateFilterScript(
    transforms: Map<number, FrameTransform>,
    metadata: VideoMetadata,
    outputWidth: number,
    outputHeight: number,
    reframingConfig?: ReframingConfig,
    initialTargetBox?: { width: number; height: number }
  ): string {
    const fps = metadata.fps;
    const filters: string[] = [];

    // Create a crop filter for each frame
    for (let frame = 0; frame < Math.floor(metadata.duration * fps); frame++) {
      const transform = transforms.get(frame);
      if (!transform) continue;

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
        cropW = Math.round(calculatedDimensions.width);
        cropH = Math.round(calculatedDimensions.height);
      } else {
        cropW = Math.round(metadata.width / transform.scale);
        cropH = Math.round(metadata.height / transform.scale);
      }

      const cropX = Math.round(Math.max(0, Math.min(metadata.width - cropW, transform.x - cropW / 2)));
      const cropY = Math.round(Math.max(0, Math.min(metadata.height - cropH, transform.y - cropH / 2)));

      const startTime = frame / fps;
      const endTime = (frame + 1) / fps;

      filters.push(
        `[0:v]trim=start=${startTime}:end=${endTime},setpts=PTS-STARTPTS,` +
        `crop=${cropW}:${cropH}:${cropX}:${cropY},` +
        `scale=${outputWidth}:${outputHeight}:flags=lanczos[v${frame}]`
      );
    }

    // Concatenate all frame segments
    const concatInputs = filters.map((_, i) => `[v${i}]`).join('');
    filters.push(`${concatInputs}concat=n=${filters.length}:v=1:a=0[out]`);

    return filters.join(';\n');
  }
}