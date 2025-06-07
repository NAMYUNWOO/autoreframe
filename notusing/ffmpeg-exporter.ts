import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { FrameTransform, VideoMetadata, ExportOptions } from '@/types';
import { getOutputDimensions } from '../reframing/presets';

export class FFmpegExporter {
  private ffmpeg: FFmpeg | null = null;
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;

    this.ffmpeg = new FFmpeg();
    
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
    
    await this.ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    
    this.loaded = true;
    console.log('FFmpeg loaded for export');
  }

  async export(
    videoBlob: Blob,
    transforms: Map<number, FrameTransform>,
    metadata: VideoMetadata,
    outputRatio: string,
    options: ExportOptions,
    onProgress?: (progress: number) => void
  ): Promise<Blob> {
    await this.load();
    if (!this.ffmpeg) throw new Error('FFmpeg not loaded');

    // Set up progress handler
    if (onProgress) {
      this.ffmpeg.on('progress', ({ progress }) => {
        onProgress(progress * 100);
      });
    }

    const { width: outputWidth, height: outputHeight } = getOutputDimensions(
      metadata.width,
      metadata.height,
      outputRatio as any
    );

    console.log('FFmpeg export starting:', {
      inputSize: `${metadata.width}x${metadata.height}`,
      outputSize: `${outputWidth}x${outputHeight}`,
      fps: metadata.fps,
      duration: metadata.duration,
      transforms: transforms.size
    });

    try {
      // Write input video
      console.log('Writing input video to FFmpeg...');
      const inputData = await fetchFile(videoBlob);
      console.log('Input video size:', inputData.byteLength / 1024 / 1024, 'MB');
      
      try {
        await this.ffmpeg.writeFile('input.webm', inputData);
        console.log('Input file written successfully');
      } catch (error) {
        console.error('Failed to write input file:', error);
        // Try with smaller chunk
        throw new Error('Video file too large for FFmpeg.wasm. Please try a smaller video.');
      }

      // Use a simpler approach - get average transform
      const avgTransform = this.getAverageTransform(transforms, metadata);
      
      // Calculate crop parameters
      const cropW = Math.round(outputWidth / avgTransform.scale);
      const cropH = Math.round(outputHeight / avgTransform.scale);
      const cropX = Math.max(0, Math.round(avgTransform.x - cropW / 2));
      const cropY = Math.max(0, Math.round(avgTransform.y - cropH / 2));
      
      // Ensure crop doesn't exceed video bounds
      const safeCropW = Math.min(cropW, metadata.width - cropX);
      const safeCropH = Math.min(cropH, metadata.height - cropY);

      // Build FFmpeg command with simple filter
      const outputFormat = options.format === 'mp4' ? 'mp4' : 'webm';
      const outputCodec = options.format === 'mp4' ? 'libx264' : 'libvpx';
      
      const ffmpegArgs = [
        '-i', 'input.webm',
        '-vf', `crop=${safeCropW}:${safeCropH}:${cropX}:${cropY},scale=${outputWidth}:${outputHeight}`,
        '-c:v', outputCodec,
        '-b:v', `${Math.round((options.bitrate || 2000000) / 1000)}k`,
        '-c:a', 'copy',
        '-y',
        `output.${outputFormat}`
      ];

      if (options.format === 'mp4') {
        ffmpegArgs.splice(-1, 0, '-preset', 'medium');
      }

      console.log('Running FFmpeg with args:', ffmpegArgs);
      await this.ffmpeg.exec(ffmpegArgs);

      // Read output
      const data = await this.ffmpeg.readFile(`output.${outputFormat}`);
      const outputBlob = new Blob([data], { type: `video/${outputFormat}` });

      // Cleanup
      await this.ffmpeg.deleteFile('input.webm');
      await this.ffmpeg.deleteFile(`output.${outputFormat}`);

      console.log('FFmpeg export complete');
      return outputBlob;

    } catch (error) {
      console.error('FFmpeg export error:', error);
      throw error;
    }
  }

  private getAverageTransform(
    transforms: Map<number, FrameTransform>,
    metadata: VideoMetadata
  ): FrameTransform {
    if (transforms.size === 0) {
      return {
        x: metadata.width / 2,
        y: metadata.height / 2,
        scale: 1,
        rotation: 0
      };
    }

    let sumX = 0;
    let sumY = 0;
    let sumScale = 0;
    let count = 0;

    // Sample transforms evenly throughout the video
    const sampleInterval = Math.max(1, Math.floor(transforms.size / 100));
    
    for (const [frameNum, transform] of transforms) {
      if (frameNum % sampleInterval === 0) {
        sumX += transform.x;
        sumY += transform.y;
        sumScale += transform.scale;
        count++;
      }
    }

    return {
      x: sumX / count,
      y: sumY / count,
      scale: sumScale / count,
      rotation: 0
    };
  }

  dispose(): void {
    this.ffmpeg = null;
    this.loaded = false;
  }
}