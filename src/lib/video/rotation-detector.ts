export class VideoRotationDetector {
  /**
   * Detect video rotation by analyzing frame dimensions and metadata
   * Returns rotation angle in degrees (0, 90, 180, 270)
   */
  static async detectRotation(video: HTMLVideoElement): Promise<number> {
    // Check if video dimensions suggest rotation
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    
    // Try to get rotation from video track settings
    try {
      const stream = (video as any).captureStream();
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        // Some browsers may provide rotation info
        if ('rotation' in settings) {
          return (settings as any).rotation || 0;
        }
      }
    } catch (e) {
      // console.log('Could not access video track settings');
    }

    // Try to detect rotation from video metadata using experimental API
    try {
      // Check if the video element has rotation info in its videoTracks
      const videoTracks = (video as any).videoTracks;
      if (videoTracks && videoTracks.length > 0) {
        const track = videoTracks[0];
        if (track.rotation !== undefined) {
          // console.log('Found rotation in video track:', track.rotation);
          return track.rotation;
        }
      }
    } catch (e) {
      // Experimental API might not be available
    }

    // Common smartphone video detection heuristic
    // console.log(`Video dimensions: ${videoWidth}x${videoHeight}`);
    
    // Most smartphone videos in portrait mode need rotation
    if (videoHeight > videoWidth) {
      const aspectRatio = videoWidth / videoHeight;
      
      // Common portrait smartphone ratios that indicate rotation needed:
      // 9:16 (0.5625), 3:4 (0.75), 9:18 (0.5), 9:19.5 (0.46)
      if (aspectRatio < 0.8) {
        // console.log('Detected portrait video that likely needs rotation');
        // Don't rotate by default - let user see if detection is working first
        return 0; // Change to 90 if you want auto-rotation
      }
    }

    return 0;
  }

  /**
   * Apply rotation transform to canvas context
   */
  static applyRotation(
    ctx: CanvasRenderingContext2D, 
    rotation: number, 
    canvasWidth: number, 
    canvasHeight: number
  ): void {
    if (rotation === 0) return;

    ctx.translate(canvasWidth / 2, canvasHeight / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    
    // Adjust translation based on rotation
    if (rotation === 90) {
      ctx.translate(-canvasHeight / 2, -canvasWidth / 2);
    } else if (rotation === 180) {
      ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
    } else if (rotation === 270) {
      ctx.translate(-canvasHeight / 2, -canvasWidth / 2);
    }
  }

  /**
   * Get corrected dimensions after rotation
   */
  static getCorrectedDimensions(
    width: number, 
    height: number, 
    rotation: number
  ): { width: number; height: number } {
    if (rotation === 90 || rotation === 270) {
      return { width: height, height: width };
    }
    return { width, height };
  }
}