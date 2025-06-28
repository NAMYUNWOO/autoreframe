import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
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
      console.log('Loading FFmpeg from local files...');
      await this.ffmpeg.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      });
      console.log('FFmpeg loaded successfully from local files');
    } catch (error) {
      console.error('Failed to load FFmpeg from local files:', error);
      throw new Error('Failed to load FFmpeg. Please ensure ffmpeg-core.js and ffmpeg-core.wasm are in the public/ffmpeg directory.');
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

    // Extract frames as images with parallel processing
    const totalFrames = Math.floor(metadata.duration * metadata.fps);
    
    // Check if mobile device
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
      navigator.userAgent.toLowerCase()
    );
    
    // Determine batch size based on device capabilities
    let batchSize: number;
    if (isMobile) {
      batchSize = 1; // Process frames sequentially on mobile
      console.log(`Mobile device detected: Processing ${totalFrames} frames sequentially`);
    } else {
      batchSize = navigator.hardwareConcurrency ? Math.min(navigator.hardwareConcurrency, 8) : 4;
      console.log(`Extracting ${totalFrames} frames at ${metadata.fps} fps with batch size ${batchSize}`);
    }
    
    const jpegQuality = options.quality === 15 ? 0.96 : 0.93; // Slightly reduced for performance
    
    // Process frames in batches
    if (isMobile) {
      // Mobile: Sequential processing with single video element
      for (let frame = 0; frame < totalFrames; frame++) {
        await this.processFrameMobile(
          frame,
          totalFrames,
          exportVideo, // Reuse the same video element
          transforms,
          width,
          height,
          metadata,
          options,
          reframingConfig,
          initialTargetBox,
          jpegQuality
        );
        
        // Update progress
        if (onProgress) {
          const progress = ((frame + 1) / totalFrames) * 80; // 80% for frame extraction
          onProgress(progress);
        }
      }
    } else {
      // Desktop: Parallel processing with multiple video elements
      for (let batchStart = 0; batchStart < totalFrames; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, totalFrames);
        const batchPromises: Promise<void>[] = [];
        
        // Process each frame in the batch
        for (let frame = batchStart; frame < batchEnd; frame++) {
          batchPromises.push(
            this.processFrame(
              frame,
              totalFrames,
              exportVideo,
              transforms,
              width,
              height,
              metadata,
              options,
              reframingConfig,
              initialTargetBox,
              jpegQuality
            )
          );
        }
        
        // Wait for all frames in batch to complete
        await Promise.all(batchPromises);
        
        // Update progress
        if (onProgress) {
          const progress = (batchEnd / totalFrames) * 80; // 80% for frame extraction
          onProgress(progress);
        }
      }
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
      '-preset', isBestQuality ? 'medium' : 'fast',  // Balanced speed/quality
      '-crf', `${options.quality || 23}`,
      '-pix_fmt', 'yuv420p',
      '-profile:v', isBestQuality ? 'high' : 'main',
      '-level', '4.1',
      '-threads', '0'  // Use all available threads
    );
    
    // Add rate control
    ffmpegArgs.push(
      '-maxrate', `${options.bitrate || 5000000}`,
      '-bufsize', `${(options.bitrate || 5000000) * 2}`
    );
    
    // Additional optimization for all presets
    ffmpegArgs.push(
      '-tune', 'fastdecode',  // Optimize for faster decoding
      '-movflags', '+faststart'  // Place moov atom at beginning
    );
    
    if (isBestQuality) {
      ffmpegArgs.push(
        '-x264-params', 'aq-mode=3:aq-strength=0.8:ref=3:bframes=2',
        '-g', `${metadata.fps * 2}`
      );
    } else {
      ffmpegArgs.push(
        '-x264-params', 'ref=2:bframes=1',  // Fewer reference frames for speed
        '-g', `${metadata.fps * 3}`  // Larger GOP for better compression
      );
    }

    ffmpegArgs.push(
      '-c:a', 'copy', // Copy audio without re-encoding
      '-shortest', // Match duration to shortest stream
      outputFile
    );

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

  private async processFrame(
    frame: number,
    totalFrames: number,
    exportVideo: HTMLVideoElement,
    transforms: Map<number, FrameTransform>,
    width: number,
    height: number,
    metadata: VideoMetadata,
    options: ExportOptions,
    reframingConfig?: ReframingConfig,
    initialTargetBox?: { width: number; height: number },
    jpegQuality: number = 0.95
  ): Promise<void> {
    // Create a dedicated canvas for this frame
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = width;
    frameCanvas.height = height;
    const frameCtx = frameCanvas.getContext('2d', { alpha: false })!;
    
    // Create a dedicated video element for parallel processing
    const frameVideo = document.createElement('video');
    frameVideo.src = exportVideo.src;
    frameVideo.muted = true;
    
    try {
      // Wait for video to load
      await new Promise<void>((resolve) => {
        frameVideo.onloadeddata = () => resolve();
      });
      
      const time = frame / metadata.fps;
      frameVideo.currentTime = time;
      
      // Wait for seek to complete and process frame
      await new Promise<void>((resolve) => {
        frameVideo.onseeked = async () => {
          const transform = transforms.get(frame);
          if (!transform) {
            frameCtx.fillStyle = 'black';
            frameCtx.fillRect(0, 0, width, height);
          } else {
            this.applyTransform(
              frameCtx,
              frameVideo,
              transform,
              width,
              height,
              metadata,
              reframingConfig,
              initialTargetBox
            );
          }
          
          // Convert canvas to JPEG
          const blob = await new Promise<Blob>((blobResolve, reject) => {
            frameCanvas.toBlob((blob) => {
              if (blob) {
                blobResolve(blob);
              } else {
                reject(new Error('Failed to create blob from canvas'));
              }
            }, 'image/jpeg', jpegQuality);
          });
          
          const imageData = await fetchFile(blob);
          const filename = `frame_${String(frame).padStart(5, '0')}.jpg`;
          await this.ffmpeg.writeFile(filename, imageData);
          
          resolve();
        };
      });
    } finally {
      // Clean up resources
      frameVideo.remove();
      frameCanvas.remove();
    }
  }

  private async processFrameMobile(
    frame: number,
    totalFrames: number,
    exportVideo: HTMLVideoElement,
    transforms: Map<number, FrameTransform>,
    width: number,
    height: number,
    metadata: VideoMetadata,
    options: ExportOptions,
    reframingConfig?: ReframingConfig,
    initialTargetBox?: { width: number; height: number },
    jpegQuality: number = 0.95
  ): Promise<void> {
    // Create a dedicated canvas for this frame
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = width;
    frameCanvas.height = height;
    const frameCtx = frameCanvas.getContext('2d', { alpha: false })!;
    
    try {
      const time = frame / metadata.fps;
      
      // Reuse the existing video element - no need to create new one
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.warn(`Seek timeout for frame ${frame}`);
          resolve(); // Continue even if seek fails
        }, 5000);
        
        const onSeeked = () => {
          clearTimeout(timeout);
          resolve();
        };
        
        exportVideo.addEventListener('seeked', onSeeked, { once: true });
        exportVideo.currentTime = time;
      });
      
      // Draw the frame
      const transform = transforms.get(frame);
      if (!transform) {
        frameCtx.fillStyle = 'black';
        frameCtx.fillRect(0, 0, width, height);
      } else {
        this.applyTransform(
          frameCtx,
          exportVideo,
          transform,
          width,
          height,
          metadata,
          reframingConfig,
          initialTargetBox
        );
      }
      
      // Convert canvas to JPEG
      const blob = await new Promise<Blob>((resolve, reject) => {
        frameCanvas.toBlob((blob) => {
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
      
    } finally {
      // Clean up only the canvas, not the video
      frameCanvas.remove();
    }
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