import { ExportOptions, FrameTransform, VideoMetadata, ReframingConfig } from '@/types';
import { getOutputDimensions } from '../reframing/presets';
import { ReframeSizeCalculatorV2 } from '../reframing/reframe-size-calculator-v2';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMArrayBufferTarget } from 'webm-muxer';
import { MP4MuxerHelper } from './mp4-muxer-helper';

export class WebCodecsExporter {
  private decoder: VideoDecoder | null = null;
  private encoder: VideoEncoder | null = null;
  private encodedChunks: Array<{chunk: EncodedVideoChunk, metadata: any}> = [];
  private processedFrames = 0;
  private totalFrames = 0;
  private onProgress?: (progress: number) => void;
  private encoderConfig: VideoEncoderConfig | null = null;
  private outputFormat: 'mp4' | 'webm' = 'mp4';
  private isMobile = false;
  private decoderConfig: any = null;
  private encoderError: any = null;
  private hardwareAcceleration: HardwareAcceleration = 'no-preference';
  private lastFrameHash: string = '';
  private duplicateFrameCount: number = 0;
  private frameHashCache: Map<number, string> = new Map();

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
    this.onProgress = onProgress;
    this.processedFrames = 0;
    // Use exact frame count from metadata if available
    const exactFrames = metadata.totalFrames;
    const calculatedFrames = Math.round(metadata.duration * metadata.fps);
    // Also check the transforms map for the actual number of frames to process
    const transformsMaxFrame = transforms.size > 0 ? Math.max(...Array.from(transforms.keys())) + 1 : 0;
    // Use exact frames if available, otherwise use the larger of calculated or transforms
    this.totalFrames = exactFrames || Math.max(calculatedFrames, transformsMaxFrame);
    console.log(`[WebCodecs Export] Total frames - exact: ${exactFrames}, calculated: ${calculatedFrames}, transforms: ${transformsMaxFrame}, using: ${this.totalFrames}`);
    this.encodedChunks = [];
    this.encoderError = null;

    console.log('[WebCodecs Export] Starting export...');
    console.log('[WebCodecs Export] Total frames:', this.totalFrames);
    console.log('[WebCodecs Export] Output format:', options.format || 'mp4');
    console.log('[WebCodecs Export] Is mobile:', this.isMobile);
    console.log('[WebCodecs Export] FPS:', metadata.fps);
    
    // Set output format
    // Use requested format or default to MP4
    this.outputFormat = (options.format as 'mp4' | 'webm') || 'mp4';
    console.log('[WebCodecs Export] Target format:', this.outputFormat);
    
    // Check if mobile device
    this.isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
      navigator.userAgent.toLowerCase()
    );
    
    // Calculate output dimensions
    const { width: outputWidth, height: outputHeight } = getOutputDimensions(
      metadata.width,
      metadata.height,
      outputRatio as any
    );

    // Check WebCodecs support
    if (!('VideoEncoder' in window) || !('VideoDecoder' in window)) {
      throw new Error('WebCodecs API is not supported in this browser');
    }
    
    // Check codec support and find a working codec
    let workingCodec: string | null = null;
    
    // Always prefer H.264 for maximum compatibility
    const h264Codecs = ['avc1.42001E', 'avc1.4D401E', 'avc1.64001E']; // H.264 profiles
    const webmCodecs = ['vp09.00.10.08', 'vp9', 'vp8']; // VP9/VP8
    
    let codecsToTry = [];
    if (this.outputFormat === 'mp4') {
      // Always use H.264 for MP4 - best compatibility across all platforms
      codecsToTry = h264Codecs;
    } else {
      codecsToTry = webmCodecs;
    }
    
    for (const codec of codecsToTry) {
      try {
        const codecSupport = await VideoEncoder.isConfigSupported({
          codec,
          width: outputWidth,
          height: outputHeight,
          bitrate: options.bitrate || 5000000,
          framerate: metadata.fps
        });
        
        if (codecSupport.supported) {
          workingCodec = codec;
          console.log(`[WebCodecs Export] Using codec: ${codec}`);
          break;
        }
      } catch (e) {
        console.log(`[WebCodecs Export] Codec ${codec} not available`);
      }
    }
    
    if (!workingCodec) {
      // Force H.264 codec even if not detected
      console.log('[WebCodecs Export] No codec detected, forcing H.264 baseline');
      workingCodec = 'avc1.42001E'; // H.264 Baseline
    }

    try {
      // Initialize encoder
      console.log('[WebCodecs Export] Step 1: Initializing encoder...');
      await this.initializeEncoder(outputWidth, outputHeight, metadata.fps, options);

      // Process frames
      console.log('[WebCodecs Export] Step 2: Processing frames...');
      await this.processFrames(
        videoElement,
        transforms,
        metadata,
        outputWidth,
        outputHeight,
        reframingConfig,
        initialTargetBox
      );

      // Create final video blob
      console.log('[WebCodecs Export] Step 3: Creating video blob...');
      const blob = await this.createVideoBlob(metadata.fps);
      
      console.log('[WebCodecs Export] Export completed successfully');
      return blob;
    } catch (e) {
      console.error('[WebCodecs Export] Export failed at step:', e);
      
      // Create detailed error message
      let detailedError = 'Export failed: ';
      if (e instanceof Error) {
        detailedError += e.message;
      } else {
        detailedError += 'Unknown error';
      }
      
      // Add context information
      detailedError += `\n\nContext:`;
      detailedError += `\n- Device: ${this.isMobile ? 'Mobile' : 'Desktop'}`;
      detailedError += `\n- Format: ${this.outputFormat}`;
      detailedError += `\n- Codec: ${this.encoderConfig?.codec || 'not configured'}`;
      detailedError += `\n- Resolution: ${outputWidth}x${outputHeight}`;
      detailedError += `\n- Total frames: ${this.totalFrames}`;
      detailedError += `\n- Processed: ${this.processedFrames}`;
      detailedError += `\n- Hardware: ${this.hardwareAcceleration}`;
      
      if (this.encoderError) {
        detailedError += `\n\nEncoder error: ${this.encoderError.message || this.encoderError}`;
      }
      
      throw new Error(detailedError);
    } finally {
      this.cleanup();
    }
  }

  private async initializeEncoder(
    width: number,
    height: number,
    fps: number,
    options: ExportOptions
  ) {
    // Configure bitrate based on quality preset
    const bitrate = options.bitrate || 5000000;
    
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        // Store decoder config from first chunk
        if (!this.decoderConfig && metadata?.decoderConfig) {
          this.decoderConfig = metadata.decoderConfig;
          console.log('[WebCodecs Export] Decoder config received:', this.decoderConfig);
        }
        
        // Log metadata structure for debugging
        if (this.encodedChunks.length === 0) {
          console.log('[WebCodecs Export] First chunk metadata:', metadata);
          console.log('[WebCodecs Export] Chunk properties:', {
            type: chunk.type,
            timestamp: chunk.timestamp,
            duration: chunk.duration,
            byteLength: chunk.byteLength
          });
        }
        
        // Store both chunk and metadata
        this.encodedChunks.push({ chunk, metadata });
      },
      error: (error) => {
        console.error('[WebCodecs Export] Encoder error:', error);
        console.error('[WebCodecs Export] Encoder state at error:', this.encoder?.state);
        console.error('[WebCodecs Export] Error details:', {
          message: error.message,
          name: error.name,
          stack: error.stack
        });
        // Don't throw here as it will close the encoder
        // Store the error to handle it later
        this.encoderError = error;
      }
    });

    // Configure codec based on what's available
    let codec: string;
    
    // Try to find a working codec
    // More H.264 profiles to try
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    
    // iOS prefers baseline profile with lower levels
    const h264Codecs = isIOS ? [
      'avc1.42000d', // Baseline Profile Level 1.3 (lowest)
      'avc1.420014', // Baseline Profile Level 2.0
      'avc1.42001E', // Baseline Profile Level 3.0
      'avc1.42E01E', // Baseline Profile Level 3.0 (alternate)
    ] : [
      'avc1.42E01E', // Baseline Profile Level 3.0
      'avc1.42001E', // Baseline Profile Level 3.0 (alternate)
      'avc1.420014', // Baseline Profile Level 2.0
      'avc1.42000d', // Baseline Profile Level 1.3
      'avc1.4D401E', // Main Profile Level 3.0
      'avc1.64001E', // High Profile Level 3.0
      'avc1.640028', // High Profile Level 4.0
      'avc1.640029'  // High Profile Level 4.1
    ];
    
    // Always use H.264 for MP4 for maximum compatibility
    const webmCodecs = ['vp09.00.10.08', 'vp9', 'vp8'];
    const codecs = this.outputFormat === 'mp4' ? h264Codecs : webmCodecs;
    
    let selectedCodec: string | null = null;
    
    // Try different hardware acceleration options
    const hardwareOptions = ['no-preference', 'prefer-hardware', 'prefer-software'] as const;
    
    for (const testCodec of codecs) {
      for (const hwOption of hardwareOptions) {
        try {
          const support = await VideoEncoder.isConfigSupported({
            codec: testCodec,
            width,
            height,
            bitrate,
            framerate: fps,
            hardwareAcceleration: hwOption
          });
          
          console.log(`[WebCodecs Export] Testing codec ${testCodec} with ${hwOption}:`, support);
          
          if (support.supported) {
            selectedCodec = testCodec;
            // Store the working hardware acceleration option
            this.hardwareAcceleration = hwOption;
            console.log(`[WebCodecs Export] Found working codec: ${testCodec} with ${hwOption}`);
            break;
          }
        } catch (e) {
          console.log(`[WebCodecs Export] Codec ${testCodec}/${hwOption} test failed:`, e);
        }
      }
      if (selectedCodec) break;
    }
    
    if (!selectedCodec && this.outputFormat === 'mp4') {
      // Try one more time with the most basic H.264 profile
      try {
        const basicH264 = 'avc1.42000d'; // H.264 Baseline Profile Level 1.3
        const support = await VideoEncoder.isConfigSupported({
          codec: basicH264,
          width,
          height,
          bitrate,
          framerate: fps,
          hardwareAcceleration: 'prefer-software'
        });
        if (support.supported) {
          selectedCodec = basicH264;
          console.log('[WebCodecs Export] Using basic H.264 profile');
        }
      } catch (e) {
        console.log('[WebCodecs Export] Basic H.264 test failed:', e);
      }
    }
    
    if (!selectedCodec) {
      // Only fallback to WebM if MP4 was explicitly requested but not supported
      if (this.outputFormat === 'mp4') {
        console.warn('[WebCodecs Export] H.264 not supported, falling back to WebM');
        selectedCodec = 'vp8';
        this.outputFormat = 'webm';
      } else {
        selectedCodec = 'vp8';
      }
    }
    
    codec = selectedCodec;
    console.log(`[WebCodecs Export] Selected codec: ${codec} for ${this.outputFormat}`);

    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      latencyMode: 'quality',
      bitrateMode: 'variable'
    };

    // Add codec-specific configuration
    if (codec.startsWith('avc')) {
      config.avc = { format: 'avc' };
    }
    // Use the hardware acceleration option that was found to work
    config.hardwareAcceleration = this.hardwareAcceleration;

    // Check if configuration is supported
    const isSupported = await VideoEncoder.isConfigSupported(config);
    if (!isSupported.supported) {
      console.error('[WebCodecs Export] Configuration not supported:', config);
      throw new Error('Encoder configuration not supported');
    }

    this.encoderConfig = config;
    
    console.log('[WebCodecs Export] Encoder state before configure:', this.encoder.state);
    
    // Try to configure encoder with retry logic
    let configureAttempts = 0;
    const maxAttempts = 3;
    
    while (configureAttempts < maxAttempts) {
      try {
        await this.encoder.configure(config);
        console.log('[WebCodecs Export] Encoder configured successfully');
        console.log('[WebCodecs Export] Encoder state after configure:', this.encoder.state);
        console.log('[WebCodecs Export] Configuration used:', config);
        break;
      } catch (configError) {
        configureAttempts++;
        console.error(`[WebCodecs Export] Configure attempt ${configureAttempts} failed:`, configError);
        
        if (configureAttempts >= maxAttempts) {
          console.error('[WebCodecs Export] Failed to configure encoder after all attempts');
          throw new Error(`Failed to configure encoder: ${configError}`);
        }
        
        // Reset encoder and try again
        console.log('[WebCodecs Export] Resetting encoder for retry...');
        if (this.encoder.state === 'closed') {
          this.encoder = new VideoEncoder({
            output: (chunk, metadata) => {
              if (!this.decoderConfig && metadata?.decoderConfig) {
                this.decoderConfig = metadata.decoderConfig;
                console.log('[WebCodecs Export] Decoder config received:', this.decoderConfig);
              }
              
              if (this.encodedChunks.length === 0) {
                console.log('[WebCodecs Export] First chunk metadata:', metadata);
                console.log('[WebCodecs Export] Chunk properties:', {
                  type: chunk.type,
                  timestamp: chunk.timestamp,
                  duration: chunk.duration,
                  byteLength: chunk.byteLength
                });
              }
              
              this.encodedChunks.push({ chunk, metadata });
            },
            error: (error) => {
              console.error('[WebCodecs Export] Encoder error:', error);
              console.error('[WebCodecs Export] Encoder state at error:', this.encoder?.state);
              this.encoderError = error;
            }
          });
        }
        
        // Wait a bit before retry
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  private async processFrames(
    videoElement: HTMLVideoElement,
    transforms: Map<number, FrameTransform>,
    metadata: VideoMetadata,
    outputWidth: number,
    outputHeight: number,
    reframingConfig?: ReframingConfig,
    initialTargetBox?: { width: number; height: number }
  ) {
    // Create a new video element for export to avoid conflicts
    const exportVideo = document.createElement('video');
    exportVideo.src = videoElement.src;
    exportVideo.muted = true;
    exportVideo.playsInline = true;
    
    // Wait for video to load
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Export video load timeout'));
      }, 10000);
      
      exportVideo.onloadeddata = () => {
        clearTimeout(timeout);
        resolve();
      };
      
      exportVideo.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load export video'));
      };
    });
    // Create canvas for frame processing
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    
    // Check if iOS - avoid OffscreenCanvas on iOS
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    
    // Try OffscreenCanvas first (except on iOS), fallback to regular canvas
    if (!isIOS && typeof OffscreenCanvas !== 'undefined') {
      try {
        canvas = new OffscreenCanvas(outputWidth, outputHeight);
        ctx = canvas.getContext('2d', {
          alpha: false,
          desynchronized: true
        });
      } catch (e) {
        console.log('[WebCodecs Export] OffscreenCanvas failed, using regular canvas');
        canvas = document.createElement('canvas');
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        ctx = canvas.getContext('2d', {
          alpha: false,
          willReadFrequently: true
        });
      }
    } else {
      console.log('[WebCodecs Export] Using regular canvas (iOS or OffscreenCanvas not available)');
      canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      ctx = canvas.getContext('2d', {
        alpha: false,
        willReadFrequently: true
      });
    }
    
    if (!ctx) {
      throw new Error('Failed to create canvas context');
    }
    
    // Mobile optimization: Process frames in smaller batches
    const batchSize = this.isMobile ? 10 : 30;
    console.log(`[WebCodecs Export] Processing frames in batches of ${batchSize}`);
    
    // Mobile optimization: Adaptive frame processing
    let frameSkip = 1;
    if (this.isMobile) {
      // For mobile, consider reducing frame rate if original is high
      if (metadata.fps > 30) {
        frameSkip = 2; // Process every other frame for 60fps videos
        console.log(`[WebCodecs Export] Mobile: Reducing framerate from ${metadata.fps} to ${metadata.fps / frameSkip}`);
      }
    }

    // Process each frame
    let actualFramesProcessed = 0;
    for (let frameNumber = 0; frameNumber < this.totalFrames; frameNumber += frameSkip) {
      const timestamp = (frameNumber / metadata.fps) * 1000000; // microseconds
      const duration = (frameSkip / metadata.fps) * 1000000; // Adjust duration for skipped frames
      actualFramesProcessed++;
      
      // Mobile optimization: Skip duplicate frames
      if (this.isMobile && frameNumber > 0) {
        // Check if we should re-seek based on duplicate frames
        if (this.duplicateFrameCount > 2) {
          console.log(`[WebCodecs Export] Too many duplicates at frame ${frameNumber}, attempting re-seek`);
          // Try seeking with a small offset
          const offsetTime = (frameNumber / metadata.fps) + 0.001;
          await this.seekToFrame(exportVideo, offsetTime);
          this.duplicateFrameCount = 0;
        } else {
          await this.seekToFrame(exportVideo, frameNumber / metadata.fps);
        }
      } else {
        await this.seekToFrame(exportVideo, frameNumber / metadata.fps);
      }
      
      // Ensure video is ready to be drawn
      if (exportVideo.readyState < 2) {
        console.warn(`[WebCodecs Export] Video not ready at frame ${frameNumber}, waiting...`);
        await new Promise(resolve => {
          const checkReady = () => {
            if (exportVideo.readyState >= 2) {
              resolve(undefined);
            } else {
              requestAnimationFrame(checkReady);
            }
          };
          checkReady();
        });
      }
      
      // Get transform for this frame
      const transform = transforms.get(frameNumber);
      
      // Apply transform and draw frame
      let drawSuccess = false;
      
      if (transform) {
        drawSuccess = await this.applyTransformSafe(
          ctx,
          exportVideo,
          transform,
          outputWidth,
          outputHeight,
          metadata,
          reframingConfig,
          initialTargetBox
        );
      } else {
        // No transform, draw centered
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, outputWidth, outputHeight);
        try {
          ctx.drawImage(exportVideo, 0, 0, outputWidth, outputHeight);
          drawSuccess = true;
        } catch (e) {
          console.error('[WebCodecs Export] Error drawing video frame:', e);
          drawSuccess = false;
        }
      }
      
      // If drawing failed (likely HEVC on iOS), skip this frame or use a black frame
      if (!drawSuccess) {
        console.warn(`[WebCodecs Export] Failed to draw frame ${frameNumber}, using black frame`);
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, outputWidth, outputHeight);
      }
      
      // Mobile: Check for duplicate frames
      if (this.isMobile && frameNumber > 0) {
        const frameHash = this.calculateFrameHash(ctx, outputWidth, outputHeight);
        
        if (frameHash === this.lastFrameHash) {
          this.duplicateFrameCount++;
          console.log(`[WebCodecs Export] Duplicate frame detected at ${frameNumber} (count: ${this.duplicateFrameCount})`);
        } else {
          this.duplicateFrameCount = 0;
        }
        
        this.lastFrameHash = frameHash;
        this.frameHashCache.set(frameNumber, frameHash);
      }

      // Create VideoFrame from canvas with proper configuration
      let frame: VideoFrame | null = null;
      try {
        // Ensure canvas has content
        if (canvas.width === 0 || canvas.height === 0) {
          throw new Error('Canvas has invalid dimensions');
        }
        
        // Log frame creation attempt
        if (frameNumber % 100 === 0) {
          console.log(`[WebCodecs Export] Creating frame ${frameNumber}/${this.totalFrames}`);
        }
        
        // Check if iOS - they have specific requirements
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        
        try {
          if (isIOS && canvas instanceof HTMLCanvasElement) {
            // For iOS with HTMLCanvas, convert to ImageData first to avoid BGRA issues
            const imageData = ctx.getImageData(0, 0, outputWidth, outputHeight);
            
            // Create ImageBitmap from ImageData
            const bitmap = await createImageBitmap(imageData);
            frame = new VideoFrame(bitmap, {
              timestamp,
              duration: duration || Math.floor(1000000 / metadata.fps),
              displayWidth: outputWidth,
              displayHeight: outputHeight
            });
            bitmap.close();
          } else {
            // For other platforms, use standard approach
            const bitmap = await createImageBitmap(canvas as any);
            frame = new VideoFrame(bitmap, {
              timestamp,
              duration: duration || Math.floor(1000000 / metadata.fps)
            });
            bitmap.close();
          }
        } catch (bitmapError) {
          console.error('[WebCodecs Export] ImageBitmap approach failed:', bitmapError);
          
          try {
            // Try with regular canvas if OffscreenCanvas failed
            if (canvas instanceof OffscreenCanvas) {
              // Create temporary canvas
              const tempCanvas = document.createElement('canvas');
              tempCanvas.width = outputWidth;
              tempCanvas.height = outputHeight;
              const tempCtx = tempCanvas.getContext('2d');
              if (tempCtx) {
                tempCtx.drawImage(canvas as any, 0, 0);
                const tempBitmap = await createImageBitmap(tempCanvas);
                frame = new VideoFrame(tempBitmap, {
                  timestamp,
                  duration: duration || Math.floor(1000000 / metadata.fps)
                });
                tempBitmap.close();
              } else {
                throw new Error('Failed to create temp canvas context');
              }
            } else {
              throw bitmapError;
            }
          } catch (fallbackError) {
            console.error('[WebCodecs Export] Canvas fallback failed:', fallbackError);
            // Last resort: create from buffer
            const imageData = ctx.getImageData(0, 0, outputWidth, outputHeight);
            const buffer = new ArrayBuffer(imageData.data.byteLength);
            const view = new Uint8Array(buffer);
            view.set(imageData.data);
            
            // iOS Safari may have issues with RGBA/BGRA, try I420
            const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
            const format = isIOS ? 'I420' : 'RGBA';
            
            frame = new VideoFrame(view, {
              format,
              timestamp,
              codedWidth: outputWidth,
              codedHeight: outputHeight,
              visibleRect: { x: 0, y: 0, width: outputWidth, height: outputHeight },
              duration: duration || Math.floor(1000000 / metadata.fps)
            });
          }
        }

        // Check for encoder errors first
        if (this.encoderError) {
          const errorInfo = {
            message: this.encoderError.message || 'Unknown encoder error',
            frame: frameNumber,
            timestamp: frame.timestamp,
            format: frame.format,
            dimensions: `${frame.codedWidth}x${frame.codedHeight}`,
            codec: this.encoderConfig?.codec,
            state: this.encoder?.state
          };
          console.error('[WebCodecs Export] Encoder error details:', errorInfo);
          throw new Error(`Encoder error at frame ${frameNumber}: ${this.encoderError.message || 'Unknown error'}. Format: ${frame.format}, Size: ${frame.codedWidth}x${frame.codedHeight}`);
        }
        
        // Encode frame with error handling
        if (this.encoder && this.encoder.state === 'configured') {
          try {
            this.encoder.encode(frame);
          } catch (encodeError) {
            console.error('[WebCodecs Export] Error encoding frame:', encodeError);
            console.error('[WebCodecs Export] Encoder state:', this.encoder.state);
            console.error('[WebCodecs Export] Frame details:', {
              timestamp: frame.timestamp,
              duration: frame.duration,
              format: frame.format,
              codedWidth: frame.codedWidth,
              codedHeight: frame.codedHeight
            });
            
            // Create detailed error for encoding failure
            const encodeErrorDetails = `Encoding failed at frame ${frameNumber}/${this.totalFrames}. ` +
              `Format: ${frame.format}, Size: ${frame.codedWidth}x${frame.codedHeight}, ` +
              `Timestamp: ${frame.timestamp}, Duration: ${frame.duration}. ` +
              `Encoder state: ${this.encoder.state}. ` +
              `Error: ${encodeError instanceof Error ? encodeError.message : 'Unknown encoding error'}`;
            
            throw new Error(encodeErrorDetails);
          }
        } else {
          console.error('[WebCodecs Export] Encoder not in configured state:', this.encoder?.state);
          console.error('[WebCodecs Export] Encoder object:', this.encoder);
          throw new Error(`Encoder is not configured. State: ${this.encoder?.state || 'null'}`);
        }
      } catch (e) {
        console.error(`[WebCodecs Export] Error at frame ${frameNumber}:`, e);
        if (e instanceof Error && e.message.includes('colorSpace')) {
          console.error('[WebCodecs Export] ColorSpace error detected, trying alternative approach');
          // Skip this frame and continue
          continue;
        }
        throw e;
      } finally {
        if (frame) {
          try {
            frame.close();
          } catch (e) {
            console.warn('[WebCodecs Export] Error closing frame:', e);
          }
        }
      }

      this.processedFrames += frameSkip;
      
      // Update progress
      if (this.onProgress) {
        const progress = (this.processedFrames / this.totalFrames) * 80; // 80% for encoding
        this.onProgress(progress);
      }

      // Yield to prevent blocking UI
      if (frameNumber % 10 === 0) {
        // Yield to prevent blocking UI
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Flush encoder
    if (this.encoder && this.encoder.state === 'configured') {
      await this.encoder.flush();
      console.log('[WebCodecs Export] Encoding complete');
      console.log('[WebCodecs Export] Processed frames:', this.processedFrames);
      console.log('[WebCodecs Export] Expected frames:', this.totalFrames);
      console.log('[WebCodecs Export] Actual frames processed:', actualFramesProcessed);
      console.log('[WebCodecs Export] Frame skip:', frameSkip);
      console.log('[WebCodecs Export] Encoded chunks:', this.encodedChunks.length);
    }
    
    // Clean up export video element and canvas
    exportVideo.remove();
    if (canvas instanceof HTMLCanvasElement) {
      canvas.remove();
    }
  }

  private async seekToFrame(videoElement: HTMLVideoElement, time: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;
      
      const cleanup = () => {
        videoElement.removeEventListener('seeked', onSeeked);
        videoElement.removeEventListener('error', onError);
        if (timeoutId) clearTimeout(timeoutId);
      };
      
      const onSeeked = async () => {
        cleanup();
        
        // Mobile: Add extra stabilization time
        if (this.isMobile) {
          await new Promise(r => setTimeout(r, 50));
          
          // Verify seek accuracy
          const actualTime = videoElement.currentTime;
          const timeDiff = Math.abs(actualTime - time);
          
          if (timeDiff > 0.1) {
            console.warn(`[WebCodecs Export] Seek inaccuracy: requested ${time}s, got ${actualTime}s (diff: ${timeDiff}s)`);
          }
        }
        
        resolve();
      };
      
      const onError = (e: Event) => {
        cleanup();
        console.error('[WebCodecs Export] Video seek error:', e);
        reject(new Error('Video seek error'));
      };
      
      videoElement.addEventListener('seeked', onSeeked, { once: true });
      videoElement.addEventListener('error', onError, { once: true });
      
      // Set current time
      try {
        videoElement.currentTime = time;
      } catch (e) {
        cleanup();
        reject(new Error(`Failed to seek to time ${time}: ${e}`));
        return;
      }
      
      // Timeout after 5 seconds
      timeoutId = setTimeout(() => {
        cleanup();
        console.warn(`[WebCodecs Export] Video seek timeout at time ${time}`);
        // Resolve anyway to continue processing
        resolve();
      }, 5000);
    });
  }

  private async applyTransformSafe(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    video: HTMLVideoElement,
    transform: FrameTransform,
    outputWidth: number,
    outputHeight: number,
    metadata: VideoMetadata,
    reframingConfig?: ReframingConfig,
    initialTargetBox?: { width: number; height: number }
  ): Promise<boolean> {
    try {
      this.applyTransform(ctx, video, transform, outputWidth, outputHeight, metadata, reframingConfig, initialTargetBox);
      return true;
    } catch (e) {
      console.error('[WebCodecs Export] Error in applyTransformSafe:', e);
      return false;
    }
  }

  private applyTransform(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
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

    try {
      ctx.drawImage(
        video,
        sx, sy, cropW, cropH,
        0, 0, outputWidth, outputHeight
      );
    } catch (e) {
      console.error('[WebCodecs Export] Error in applyTransform:', e);
      // Fallback: try to draw the entire video
      try {
        ctx.drawImage(video, 0, 0, outputWidth, outputHeight);
      } catch (e2) {
        console.error('[WebCodecs Export] Fallback draw also failed:', e2);
      }
    }

    ctx.restore();
  }

  private async createVideoBlob(fps: number): Promise<Blob> {
    console.log('[WebCodecs Export] Creating video blob from', this.encodedChunks.length, 'chunks');
    console.log('[WebCodecs Export] Output format:', this.outputFormat);
    
    if (this.encodedChunks.length === 0) {
      throw new Error('No encoded chunks available. Export may have failed during encoding.');
    }
    
    if (this.outputFormat === 'mp4') {
      // Check codec support for MP4
      if (!this.encoderConfig!.codec!.startsWith('avc')) {
        console.log('[WebCodecs Export] Non-H.264 codec in MP4 not well supported, switching to WebM');
        this.outputFormat = 'webm';
        return this.createVideoBlob(fps);
      }
      
      try {
        // Use MP4MuxerHelper for MP4 creation
        console.log('[WebCodecs Export] Using MP4MuxerHelper for MP4 creation');
        const mp4Buffer = await MP4MuxerHelper.createMP4FromChunksWithMetadata(
          this.encodedChunks,
          this.encoderConfig!,
          this.decoderConfig,
          fps
        );
        
        // Update progress
        if (this.onProgress) {
          this.onProgress(100);
        }

        const blob = new Blob([mp4Buffer], { type: 'video/mp4' });
        // Store actual format for caller
        (blob as any).actualFormat = 'mp4';
        return blob;
      } catch (e) {
        console.error('[WebCodecs Export] MP4 creation failed:', e);
        console.log('[WebCodecs Export] Falling back to WebM');
        this.outputFormat = 'webm';
        return this.createVideoBlob(fps);
      }
    } else {
      // Determine WebM codec
      let webmCodec = 'V_VP8'; // Default
      const configCodec = this.encoderConfig!.codec!;
      
      if (configCodec.startsWith('vp9') || configCodec.startsWith('vp09')) {
        webmCodec = 'V_VP9';
      } else if (configCodec.startsWith('avc') || configCodec.includes('264')) {
        // H.264 in WebM is not standard, use VP8
        console.log('[WebCodecs Export] H.264 cannot be used in WebM, using VP8');
        webmCodec = 'V_VP8';
      }
      
      // Create WebM muxer
      const muxer = new WebMMuxer({
        target: new WebMArrayBufferTarget(),
        video: {
          codec: webmCodec,
          width: this.encoderConfig!.width!,
          height: this.encoderConfig!.height!,
          frameRate: this.encoderConfig!.framerate!
        }
      });

      // Add all chunks
      console.log('[WebCodecs Export] Adding chunks to WebM muxer...');
      for (let i = 0; i < this.encodedChunks.length; i++) {
        const { chunk, metadata } = this.encodedChunks[i];
        try {
          muxer.addVideoChunk(chunk, metadata, chunk.timestamp);
          if (i % 100 === 0) {
            console.log(`[WebCodecs Export] Added ${i}/${this.encodedChunks.length} chunks`);
          }
        } catch (e) {
          console.error(`[WebCodecs Export] Error adding chunk ${i}:`, e);
          throw e;
        }
      }

      // Finalize muxing
      muxer.finalize();
      const buffer = (muxer.target as WebMArrayBufferTarget).buffer;
      
      // Update progress
      if (this.onProgress) {
        this.onProgress(100);
      }

      const blob = new Blob([buffer], { type: 'video/webm' });
      // Store actual format for caller
      (blob as any).actualFormat = 'webm';
      return blob;
    }
  }

  private calculateFrameHash(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number): string {
    // Sample a small area in the center for performance
    const sampleSize = 32;
    const x = Math.floor((width - sampleSize) / 2);
    const y = Math.floor((height - sampleSize) / 2);
    
    try {
      const imageData = ctx.getImageData(x, y, sampleSize, sampleSize);
      
      // Simple hash calculation using sampled pixels
      let hash = 0;
      for (let i = 0; i < imageData.data.length; i += 16) {
        // Sample every 16th pixel for speed
        hash = ((hash << 5) - hash) + imageData.data[i];
        hash = hash & hash; // Convert to 32-bit integer
      }
      
      return hash.toString(16);
    } catch (e) {
      console.warn('[WebCodecs Export] Failed to calculate frame hash:', e);
      return Math.random().toString(16);
    }
  }

  private cleanup() {
    console.log('[WebCodecs Export] Cleaning up encoder/decoder');
    if (this.encoder) {
      console.log('[WebCodecs Export] Encoder state before cleanup:', this.encoder.state);
      if (this.encoder.state === 'configured') {
        try {
          this.encoder.close();
        } catch (e) {
          console.error('[WebCodecs Export] Error closing encoder:', e);
        }
      }
      this.encoder = null;
    }
    
    if (this.decoder) {
      if (this.decoder.state === 'configured') {
        try {
          this.decoder.close();
        } catch (e) {
          console.error('[WebCodecs Export] Error closing decoder:', e);
        }
      }
      this.decoder = null;
    }
    
    this.encodedChunks = [];
    this.encoderError = null;
    this.decoderConfig = null;
    this.frameHashCache.clear();
    this.lastFrameHash = '';
    this.duplicateFrameCount = 0;
  }
}