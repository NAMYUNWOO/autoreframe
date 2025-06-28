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
    console.log('[Export] Starting export process...');
    console.log('[Export] Options:', options);
    console.log('[Export] Video metadata:', metadata);
    console.log('[Export] Transforms count:', transforms.size);
    
    await this.load();
    console.log('[Export] FFmpeg loaded, calculating dimensions...');

    const { width, height } = getOutputDimensions(
      metadata.width,
      metadata.height,
      outputRatio as any
    );
    console.log(`[Export] Output dimensions: ${width}x${height}`);
    
    let inputFile: string;

    // Create canvas for frame extraction
    console.log('[Export] Creating canvas...');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { 
      alpha: false,
      willReadFrequently: true 
    })!;
    console.log('[Export] Canvas created');

    // Create video element for frame extraction
    console.log('[Export] Creating export video element...');
    
    // On mobile, pause the main video to release resources
    const isMobileCheck = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
      navigator.userAgent.toLowerCase()
    );
    
    if (isMobileCheck) {
      console.log('[Export] Mobile detected: Pausing main video to release resources...');
      videoElement.pause();
      // Small delay to ensure resources are released
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const exportVideo = document.createElement('video');
    exportVideo.src = videoElement.src;
    exportVideo.muted = true;
    exportVideo.playsInline = true; // Important for mobile
    exportVideo.preload = 'auto';
    
    console.log('[Export] Waiting for video to load...');
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('[Export] Video load timeout after 15 seconds');
        console.log('[Export] Attempting recovery...');
        
        // Try to recover by using the existing video element directly
        if (videoElement.readyState >= 3) {
          console.log('[Export] Using existing video element instead');
          resolve();
        } else {
          reject(new Error('Video load timeout'));
        }
      }, 15000); // Increased timeout for mobile
      
      exportVideo.onloadeddata = () => {
        clearTimeout(timeout);
        console.log('[Export] Video loaded successfully');
        resolve();
      };
      
      exportVideo.onerror = (e) => {
        clearTimeout(timeout);
        console.error('[Export] Video load error:', e);
        reject(new Error('Video load error'));
      };
      
      // Try to force load on mobile
      if (isMobileCheck) {
        exportVideo.load();
      }
    });

    // First, write the original video to FFmpeg for audio extraction
    console.log('[Export] Fetching video blob from:', videoElement.src);
    const fetchStartTime = Date.now();
    const videoBlob = await fetch(videoElement.src).then(r => {
      console.log(`[Export] Fetch completed in ${Date.now() - fetchStartTime}ms`);
      return r.blob();
    });
    console.log(`[Export] Video blob size: ${videoBlob.size} bytes, type: ${videoBlob.type}`);
    
    console.log('[Export] Converting blob to FFmpeg data...');
    const videoData = await fetchFile(videoBlob);
    console.log(`[Export] Video data size: ${videoData.byteLength} bytes`);
    
    // Use appropriate extension based on MIME type
    const inputExt = videoBlob.type.includes('mp4') ? 'mp4' : 
                     videoBlob.type.includes('webm') ? 'webm' : 
                     videoBlob.type.includes('quicktime') ? 'mov' : 'mp4';
    inputFile = `original.${inputExt}`;
    
    console.log(`[Export] Writing input file to FFmpeg: ${inputFile}`);
    await this.ffmpeg.writeFile(inputFile, videoData);
    console.log('[Export] Input file written successfully');

    // Extract frames as images with parallel processing
    const totalFrames = Math.floor(metadata.duration * metadata.fps);
    console.log(`[Export] Total frames to process: ${totalFrames}`);
    
    // Check if mobile device
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
      navigator.userAgent.toLowerCase()
    );
    
    console.log(`[Export] Device type: ${isMobile ? 'Mobile' : 'Desktop'}`);
    console.log(`[Export] User Agent: ${navigator.userAgent}`);
    console.log(`[Export] Starting frame extraction...`);
    
    // Determine batch size based on device capabilities
    let batchSize: number;
    if (isMobile) {
      batchSize = 1; // Process frames sequentially on mobile
      console.log(`[Export] Mobile device detected: Processing ${totalFrames} frames sequentially`);
    } else {
      batchSize = navigator.hardwareConcurrency ? Math.min(navigator.hardwareConcurrency, 8) : 4;
      console.log(`[Export] Extracting ${totalFrames} frames at ${metadata.fps} fps with batch size ${batchSize}`);
    }
    
    const jpegQuality = options.quality === 15 ? 0.96 : 0.93; // Slightly reduced for performance
    
    // Process frames in batches
    if (isMobile) {
      // Mobile: Sequential processing with single video element
      console.log(`[Mobile Export] Starting sequential processing for ${totalFrames} frames`);
      console.log(`[Mobile Export] Video metadata:`, {
        duration: metadata.duration,
        fps: metadata.fps,
        width: metadata.width,
        height: metadata.height
      });
      
      // On mobile, use the original video element if export video failed to load
      const videoToUse = exportVideo.readyState >= 3 ? exportVideo : videoElement;
      console.log(`[Mobile Export] Using ${videoToUse === videoElement ? 'original' : 'export'} video element (readyState: ${videoToUse.readyState})`);
      
      let lastProgressTime = Date.now();
      let framesProcessedInLastSecond = 0;
      const startTime = Date.now();
      
      for (let frame = 0; frame < totalFrames; frame++) {
        const frameStartTime = Date.now();
        
        try {
          console.log(`[Mobile Export] Processing frame ${frame}/${totalFrames - 1}`);
          
          await this.processFrameMobile(
            frame,
            totalFrames,
            videoToUse, // Use the working video element
            transforms,
            width,
            height,
            metadata,
            options,
            reframingConfig,
            initialTargetBox,
            jpegQuality
          );
          
          const frameEndTime = Date.now();
          const frameProcessTime = frameEndTime - frameStartTime;
          console.log(`[Mobile Export] Frame ${frame} processed in ${frameProcessTime}ms`);
          
          // Update progress
          if (onProgress) {
            const progress = ((frame + 1) / totalFrames) * 80; // 80% for frame extraction
            console.log(`[Mobile Export] Progress update: ${progress.toFixed(1)}%`);
            onProgress(progress);
          }
          
          // Track performance
          framesProcessedInLastSecond++;
          const currentTime = Date.now();
          if (currentTime - lastProgressTime > 1000) {
            const totalElapsed = (currentTime - startTime) / 1000;
            const fps = framesProcessedInLastSecond;
            const remainingFrames = totalFrames - frame - 1;
            const eta = remainingFrames / fps;
            console.log(`[Mobile Export] Performance: ${fps} fps, Total elapsed: ${totalElapsed.toFixed(1)}s, ETA: ${eta.toFixed(1)}s`);
            lastProgressTime = currentTime;
            framesProcessedInLastSecond = 0;
          }
          
          // Log every 10 frames
          if (frame > 0 && frame % 10 === 0) {
            console.log(`[Mobile Export] Progress: ${frame}/${totalFrames} frames completed (${((frame / totalFrames) * 100).toFixed(1)}%)`);
          }
        } catch (error) {
          console.error(`[Mobile Export] Failed at frame ${frame}:`, error);
          throw error;
        }
      }
      
      console.log(`[Mobile Export] All frames processed successfully`);
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
    let lastEncodingLog = Date.now();
    this.ffmpeg.on('progress', ({ progress }) => {
      const currentTime = Date.now();
      if (currentTime - lastEncodingLog > 1000 || progress === 1) {
        console.log(`[Export] FFmpeg encoding progress: ${(progress * 100).toFixed(1)}%`);
        lastEncodingLog = currentTime;
      }
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

    console.log('[Export] FFmpeg command:', ffmpegArgs.join(' '));
    console.log('[Export] Starting FFmpeg encoding...');
    
    try {
      const encodeStartTime = Date.now();
      await this.ffmpeg.exec(ffmpegArgs);
      console.log(`[Export] FFmpeg encoding completed in ${Date.now() - encodeStartTime}ms`);
    } catch (error) {
      console.error('[Export] FFmpeg execution failed:', error);
      throw error;
    }

    // console.log('Reading output file:', outputFile);
    const data = await this.ffmpeg.readFile(outputFile);
    // console.log('Output file size:', data.byteLength);
    
    // Clean up
    console.log('[Export] Starting cleanup...');
    const cleanupStartTime = Date.now();
    
    for (let frame = 0; frame < totalFrames; frame++) {
      const filename = `frame_${String(frame).padStart(5, '0')}.jpg`;
      await this.ffmpeg.deleteFile(filename);
      
      if (frame % 50 === 0) {
        console.log(`[Export] Cleaned up ${frame + 1}/${totalFrames} frame files`);
      }
    }
    
    console.log('[Export] Deleting input file...');
    await this.ffmpeg.deleteFile(inputFile);
    
    console.log('[Export] Deleting output file...');
    await this.ffmpeg.deleteFile(outputFile);
    
    const cleanupTime = Date.now() - cleanupStartTime;
    console.log(`[Export] Cleanup completed in ${cleanupTime}ms`);

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
    console.log(`[Mobile Frame ${frame}] Starting processing`);
    
    // Create a dedicated canvas for this frame
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = width;
    frameCanvas.height = height;
    const frameCtx = frameCanvas.getContext('2d', { alpha: false })!;
    
    try {
      const time = frame / metadata.fps;
      console.log(`[Mobile Frame ${frame}] Target time: ${time.toFixed(3)}s`);
      
      // Check video state before seeking
      console.log(`[Mobile Frame ${frame}] Video state before seek:`, {
        currentTime: exportVideo.currentTime,
        readyState: exportVideo.readyState,
        paused: exportVideo.paused,
        ended: exportVideo.ended,
        src: exportVideo.src.substring(0, 50) + '...'
      });
      
      // Reuse the existing video element - no need to create new one
      await new Promise<void>((resolve, reject) => {
        const seekStartTime = Date.now();
        const timeout = setTimeout(() => {
          const elapsed = Date.now() - seekStartTime;
          console.warn(`[Mobile Frame ${frame}] Seek timeout after ${elapsed}ms`);
          console.log(`[Mobile Frame ${frame}] Video state at timeout:`, {
            currentTime: exportVideo.currentTime,
            readyState: exportVideo.readyState
          });
          resolve(); // Continue even if seek fails
        }, 5000);
        
        const onSeeked = () => {
          clearTimeout(timeout);
          const elapsed = Date.now() - seekStartTime;
          console.log(`[Mobile Frame ${frame}] Seek completed in ${elapsed}ms`);
          resolve();
        };
        
        const onError = (e: Event) => {
          clearTimeout(timeout);
          console.error(`[Mobile Frame ${frame}] Video error:`, e);
          resolve(); // Continue anyway
        };
        
        exportVideo.addEventListener('seeked', onSeeked, { once: true });
        exportVideo.addEventListener('error', onError, { once: true });
        exportVideo.currentTime = time;
      });
      
      // Draw the frame
      console.log(`[Mobile Frame ${frame}] Drawing frame to canvas`);
      const transform = transforms.get(frame);
      if (!transform) {
        console.log(`[Mobile Frame ${frame}] No transform found, filling with black`);
        frameCtx.fillStyle = 'black';
        frameCtx.fillRect(0, 0, width, height);
      } else {
        console.log(`[Mobile Frame ${frame}] Applying transform:`, {
          x: transform.x,
          y: transform.y,
          scale: transform.scale
        });
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
      console.log(`[Mobile Frame ${frame}] Converting canvas to JPEG`);
      const blobStartTime = Date.now();
      const blob = await new Promise<Blob>((resolve, reject) => {
        frameCanvas.toBlob((blob) => {
          if (blob) {
            const elapsed = Date.now() - blobStartTime;
            console.log(`[Mobile Frame ${frame}] Canvas to blob completed in ${elapsed}ms, size: ${blob.size} bytes`);
            resolve(blob);
          } else {
            console.error(`[Mobile Frame ${frame}] Failed to create blob from canvas`);
            reject(new Error('Failed to create blob from canvas'));
          }
        }, 'image/jpeg', jpegQuality);
      });
      
      console.log(`[Mobile Frame ${frame}] Converting blob to FFmpeg data`);
      const imageData = await fetchFile(blob);
      const filename = `frame_${String(frame).padStart(5, '0')}.jpg`;
      
      console.log(`[Mobile Frame ${frame}] Writing to FFmpeg: ${filename} (${imageData.byteLength} bytes)`);
      const writeStartTime = Date.now();
      await this.ffmpeg.writeFile(filename, imageData);
      console.log(`[Mobile Frame ${frame}] FFmpeg write completed in ${Date.now() - writeStartTime}ms`);
      
    } catch (error) {
      console.error(`[Mobile Frame ${frame}] Error in processFrameMobile:`, error);
      throw error;
    } finally {
      // Clean up only the canvas, not the video
      console.log(`[Mobile Frame ${frame}] Cleaning up canvas`);
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