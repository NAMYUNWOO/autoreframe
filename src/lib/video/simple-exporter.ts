import { ExportOptions, FrameTransform, VideoMetadata, ReframingConfig } from '@/types';
import { getOutputDimensions } from '../reframing/presets';
import { ReframeSizeCalculatorV2 } from '../reframing/reframe-size-calculator-v2';

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
    onProgress?: (progress: number) => void,
    reframingConfig?: ReframingConfig,
    initialTargetBox?: { width: number; height: number }
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
          // console.log('Video ended, stopping recorder. Frames processed:', frameCount);
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

        // Calculate crop area using the same method as TrajectoryEditor
        let actualCropW: number;
        let actualCropH: number;
        const outputAspectRatio = width / height;
        
        if (initialTargetBox && reframingConfig) {
          // Use the same calculator that was used during reframing
          const calculatedDimensions = ReframeSizeCalculatorV2.calculateOptimalReframeSize(
            initialTargetBox,
            metadata.width,
            metadata.height,
            outputAspectRatio,
            reframingConfig
          );
          actualCropW = calculatedDimensions.width;
          actualCropH = calculatedDimensions.height;
          
          // Log for first few frames to verify consistency
          if (currentFrame <= 5) {
            // console.log(`Export frame ${currentFrame}: Using calculated dimensions ${actualCropW.toFixed(0)}x${actualCropH.toFixed(0)}`);
          }
        } else {
          // Fallback to scale-based calculation
          const cropW = metadata.width / transform.scale;
          const cropH = metadata.height / transform.scale;
          
          // Maintain output aspect ratio
          const cropAspectRatio = cropW / cropH;
          
          actualCropW = cropW;
          actualCropH = cropH;
          
          if (Math.abs(cropAspectRatio - outputAspectRatio) > 0.01) {
            if (cropAspectRatio > outputAspectRatio) {
              actualCropW = actualCropH * outputAspectRatio;
            } else {
              actualCropH = actualCropW / outputAspectRatio;
            }
          }
          
          // console.warn('Export: No initial target box provided, using scale-based calculation');
        }
        
        // Debug log for first few frames
        if (currentFrame <= 5 || (currentFrame >= 299 && currentFrame <= 300)) {
          // console.log(`Export Frame ${currentFrame}:`);
          // console.log(`  Output: ${width}x${height} (aspect: ${outputAspectRatio.toFixed(2)})`);
          // console.log(`  Transform: x=${transform.x}, y=${transform.y}, scale=${transform.scale}`);
          // console.log(`  Crop dimensions: ${actualCropW.toFixed(0)}x${actualCropH.toFixed(0)}`);
          if (initialTargetBox && reframingConfig) {
            // console.log(`  Using ReframeSizeCalculator with initial box: ${initialTargetBox.width}x${initialTargetBox.height}`);
          } else {
            // console.log(`  Using scale-based calculation (fallback)`);
          }
        }
        
        // Calculate source position ensuring crop stays within bounds
        const sx = Math.max(0, Math.min(metadata.width - actualCropW, transform.x - actualCropW / 2));
        const sy = Math.max(0, Math.min(metadata.height - actualCropH, transform.y - actualCropH / 2));

        // Draw video frame
        try {
          this.ctx.drawImage(
            exportVideo,
            sx, sy, actualCropW, actualCropH,
            0, 0, width, height
          );
        } catch (error) {
          // console.error('Error drawing frame:', error);
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