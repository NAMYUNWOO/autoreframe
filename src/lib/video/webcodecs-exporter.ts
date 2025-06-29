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
    this.totalFrames = Math.floor(metadata.duration * metadata.fps);
    this.encodedChunks = [];
    this.encoderError = null;

    console.log('[WebCodecs Export] Starting export...');
    console.log('[WebCodecs Export] Total frames:', this.totalFrames);
    console.log('[WebCodecs Export] Output format:', options.format || 'mp4');
    
    // Set output format
    // Force MP4 for mobile compatibility
    this.outputFormat = 'mp4';
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
    const codecs = this.outputFormat === 'mp4' 
      ? ['avc1.42001E', 'avc1.4D401E', 'avc1.64001E'] // Try different H.264 profiles
      : ['vp09.00.10.08', 'vp9', 'vp8']; // Try VP9 first, then VP8
    
    for (const codec of codecs) {
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
      throw e;
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
        // Don't throw here as it will close the encoder
        // Store the error to handle it later
        this.encoderError = error;
      }
    });

    // Configure codec based on what's available
    let codec: string;
    
    // Try to find a working codec
    const mp4Codecs = ['avc1.42001E', 'avc1.4D401E', 'avc1.64001E'];
    const webmCodecs = ['vp09.00.10.08', 'vp9', 'vp8'];
    const codecs = this.outputFormat === 'mp4' ? mp4Codecs : webmCodecs;
    
    let selectedCodec: string | null = null;
    for (const testCodec of codecs) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec: testCodec,
          width,
          height,
          bitrate,
          framerate: fps
        });
        
        if (support.supported) {
          selectedCodec = testCodec;
          break;
        }
      } catch (e) {
        // Continue to next codec
      }
    }
    
    if (!selectedCodec) {
      // Fallback to VP8 if nothing else works
      selectedCodec = 'vp8';
      this.outputFormat = 'webm';
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
    config.hardwareAcceleration = 'prefer-software'; // More stable on mobile

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
    
    // Try OffscreenCanvas first, fallback to regular canvas
    try {
      canvas = new OffscreenCanvas(outputWidth, outputHeight);
      ctx = canvas.getContext('2d', {
        alpha: false,
        desynchronized: true
      });
    } catch (e) {
      console.log('[WebCodecs Export] OffscreenCanvas not available, using regular canvas');
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

    // Process each frame
    for (let frameNumber = 0; frameNumber < this.totalFrames; frameNumber++) {
      const timestamp = (frameNumber / metadata.fps) * 1000000; // microseconds
      
      // Seek to frame
      await this.seekToFrame(exportVideo, frameNumber / metadata.fps);
      
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
      if (transform) {
        this.applyTransform(
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
        } catch (e) {
          console.error('[WebCodecs Export] Error drawing video frame:', e);
          // Draw black frame as fallback
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, outputWidth, outputHeight);
        }
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
        
        // Always use ImageBitmap approach for better compatibility
        try {
          const bitmap = await createImageBitmap(canvas as any);
          frame = new VideoFrame(bitmap, {
            timestamp,
            duration: Math.floor(1000000 / metadata.fps)
          });
          bitmap.close();
        } catch (e) {
          console.error('[WebCodecs Export] ImageBitmap approach failed:', e);
          // Last resort: create from buffer
          const imageData = ctx.getImageData(0, 0, outputWidth, outputHeight);
          const buffer = new ArrayBuffer(imageData.data.byteLength);
          const view = new Uint8Array(buffer);
          view.set(imageData.data);
          
          frame = new VideoFrame(view, {
            format: 'RGBA',
            timestamp,
            codedWidth: outputWidth,
            codedHeight: outputHeight,
            visibleRect: { x: 0, y: 0, width: outputWidth, height: outputHeight }
          });
        }

        // Check for encoder errors first
        if (this.encoderError) {
          throw new Error(`Encoder error occurred: ${this.encoderError.message || this.encoderError}`);
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
            throw encodeError;
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

      this.processedFrames++;
      
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
      
      const onSeeked = () => {
        cleanup();
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
  }
}