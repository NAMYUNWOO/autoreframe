/**
 * Adaptive Detection Configuration
 * Automatically adjusts parameters based on video FPS
 */

import { detectionConfig } from './detection';

interface FPSProfile {
  minFps: number;
  maxFps: number;
  trackBufferSeconds: number;  // Time in seconds
  maxTimeLostSeconds: number;  // Time in seconds
}

// FPS-specific profiles with time-based values
const fpsProfiles: FPSProfile[] = [
  { minFps: 0, maxFps: 25, trackBufferSeconds: 2.5, maxTimeLostSeconds: 2.5 },    // Low FPS videos
  { minFps: 25, maxFps: 35, trackBufferSeconds: 2.0, maxTimeLostSeconds: 2.0 },   // Standard 30 FPS
  { minFps: 35, maxFps: 55, trackBufferSeconds: 2.0, maxTimeLostSeconds: 2.0 },   // High FPS (50 FPS)
  { minFps: 55, maxFps: 999, trackBufferSeconds: 2.0, maxTimeLostSeconds: 2.0 },  // Very high FPS (60+)
];

/**
 * Get adaptive configuration based on video FPS
 * Maintains consistent time-based behavior across different frame rates
 */
export function getAdaptiveConfig(videoFps: number) {
  // Find appropriate profile based on FPS
  const profile = fpsProfiles.find(p => videoFps >= p.minFps && videoFps < p.maxFps) 
    || fpsProfiles[fpsProfiles.length - 1];
  
  // Account for sample interval
  const sampleInterval = detectionConfig.sampleInterval;
  const effectiveFps = videoFps / sampleInterval;
  
  // Convert time-based values to frame-based values
  const trackBuffer = Math.round(profile.trackBufferSeconds * effectiveFps);
  const maxTimeLost = Math.round(profile.maxTimeLostSeconds * effectiveFps);
  
  // Create adaptive config by merging with base config
  return {
    ...detectionConfig,
    byteTracker: {
      ...detectionConfig.byteTracker,
      // Override only the FPS-dependent parameters
      trackBuffer: Math.max(10, trackBuffer), // Minimum 10 frames
      maxTimeLost: Math.max(10, maxTimeLost), // Minimum 10 frames
    }
  };
}

/**
 * Get debug info for adaptive config
 */
export function getAdaptiveConfigDebugInfo(videoFps: number) {
  const config = getAdaptiveConfig(videoFps);
  const effectiveFps = videoFps / config.sampleInterval;
  
  return {
    videoFps,
    sampleInterval: config.sampleInterval,
    effectiveFps,
    trackBufferFrames: config.byteTracker.trackBuffer,
    trackBufferSeconds: config.byteTracker.trackBuffer / effectiveFps,
    maxTimeLostFrames: config.byteTracker.maxTimeLost,
    maxTimeLostSeconds: config.byteTracker.maxTimeLost / effectiveFps,
  };
}