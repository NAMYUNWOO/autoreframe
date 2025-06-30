/**
 * Detection Configuration
 * Centralized configuration for all detection-related parameters
 */

export const detectionConfig = {
  // Frame sampling interval (1 = every frame, 5 = every 5th frame)
  sampleInterval: 5,
  
  // Tracker selection: 'bytetrack' or 'botsort'
  tracker: 'bytetrack' as 'bytetrack' | 'botsort',
  
  // ByteTracker parameters
  byteTracker: {
    // High confidence threshold for detection
    trackThresh: 0.3,
    
    // Track buffer size (frames to keep lost tracks)
    trackBuffer: 60,  // Increased for 5-frame sampling
    
    // Matching threshold for track association
    // Lower value = more strict matching
    matchThresh: 0.7,  // Increased for more lenient matching
    
    // Minimum bounding box area
    minBoxArea: 100,
    
    // Low confidence threshold for second round matching
    lowThresh: 0.1,
    
    // Second round matching threshold
    secondMatchThresh: 0.85,  // More lenient for 5-frame sampling
    
    // Unconfirmed track matching threshold
    unconfirmedMatchThresh: 0.7,
    
    // Maximum frames to keep lost tracks
    maxTimeLost: 30,  // Reduced to prevent long-term wrong associations  // Increased for 5-frame sampling
    
    // Weight for center distance in matching (0-1)
    // Higher value = more weight on center distance vs IoU
    centerDistanceWeight: 0.5  // Increased to rely more on center distance
  },
  
  // BoT-SORT parameters
  botSort: {
    // High confidence threshold for detection
    trackThresh: 0.3,
    
    // Track buffer size (frames to keep lost tracks)
    trackBuffer: 100,  // Increased for occlusion handling
    
    // Matching threshold for track association (lower = more strict)
    matchThresh: 0.4,  // Balanced for occlusion vs wrong associations
    
    // Minimum bounding box area
    minBoxArea: 100,
    
    // Low confidence threshold for second round matching
    lowThresh: 0.1,
    
    // Second round matching threshold
    secondMatchThresh: 0.6,  // More strict for multi-person scenarios
    
    // Unconfirmed track matching threshold
    unconfirmedMatchThresh: 0.5,  // More strict matching
    
    // Maximum frames to keep lost tracks
    maxTimeLost: 30,  // Reduced to prevent long-term wrong associations
    
    // BoT-SORT specific parameters
    cmcMethod: 'sparse' as 'sparse' | 'orb' | 'ecc' | 'file' | 'none',
    useCMC: false,  // Disable camera motion compensation for testing
    useAppearance: false,  // Disable appearance features for performance
    appearanceThresh: 0.5,
    proximityThresh: 2.0,  // Reduced gate threshold for spatial proximity
    fusionAlpha: 0.7  // Weight for IoU (0.7) vs appearance (0.3)
  },
  
  // YOLO model parameters
  yolo: {
    // Model confidence threshold
    confidenceThreshold: 0.3,
    
    // NMS IoU threshold (lower = more aggressive duplicate removal)
    iouThreshold: 0.45,
    
    // Maximum detections per frame
    maxDetections: 100
  }
};

// Type definitions for type safety
export interface DetectionConfig {
  sampleInterval: number;
  tracker: 'bytetrack' | 'botsort';
  byteTracker: ByteTrackerConfig;
  botSort: BotSortConfig;
  yolo: YoloConfig;
}

export interface ByteTrackerConfig {
  trackThresh: number;
  trackBuffer: number;
  matchThresh: number;
  minBoxArea: number;
  lowThresh: number;
  secondMatchThresh: number;
  unconfirmedMatchThresh: number;
  maxTimeLost: number;
  centerDistanceWeight: number;
}

export interface BotSortConfig {
  trackThresh: number;
  trackBuffer: number;
  matchThresh: number;
  minBoxArea: number;
  lowThresh: number;
  secondMatchThresh: number;
  unconfirmedMatchThresh: number;
  maxTimeLost: number;
  cmcMethod: 'sparse' | 'orb' | 'ecc' | 'file' | 'none';
  useCMC: boolean;
  useAppearance: boolean;
  appearanceThresh: number;
  proximityThresh: number;
  fusionAlpha: number;
}

export interface YoloConfig {
  confidenceThreshold: number;
  iouThreshold: number;
  maxDetections: number;
}