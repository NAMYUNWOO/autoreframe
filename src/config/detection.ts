/**
 * Detection Configuration
 * Centralized configuration for all detection-related parameters
 */

export const detectionConfig = {
  // Frame sampling interval (1 = every frame, 5 = every 5th frame)
  sampleInterval: 5,
  
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
    secondMatchThresh: 0.6,  // Increased for more lenient matching
    
    // Unconfirmed track matching threshold
    unconfirmedMatchThresh: 0.7,
    
    // Maximum frames to keep lost tracks
    maxTimeLost: 60,  // Increased for 5-frame sampling
    
    // Weight for center distance in matching (0-1)
    // Higher value = more weight on center distance vs IoU
    centerDistanceWeight: 0.5  // Increased to rely more on center distance
  },
  
  // YOLO model parameters
  yolo: {
    // Model confidence threshold
    confidenceThreshold: 0.3,
    
    // NMS IoU threshold
    iouThreshold: 0.45,
    
    // Maximum detections per frame
    maxDetections: 100
  }
};

// Type definitions for type safety
export interface DetectionConfig {
  sampleInterval: number;
  byteTracker: ByteTrackerConfig;
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

export interface YoloConfig {
  confidenceThreshold: number;
  iouThreshold: number;
  maxDetections: number;
}