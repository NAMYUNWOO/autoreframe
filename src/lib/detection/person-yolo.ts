import * as tf from '@tensorflow/tfjs';
import { BoundingBox } from '@/types';
import { detectionConfig } from '@/config/detection';
import { DeviceDetector } from '../utils/device';

/**
 * YOLOv12n Person Detector
 * 
 * This detector uses a YOLOv8n model (named v12n in the codebase) for person detection.
 * The model outputs pre-processed detections with NMS already applied.
 * 
 * Mobile-specific behavior:
 * - On mobile devices, the model may output confidence values in a separate tensor
 * - The first tensor contains bounding boxes with zero confidence values
 * - The second tensor (shape: [1500]) contains the actual confidence scores
 * - First 300 values of the second tensor map to the 300 detections
 */
export class PersonYOLODetector {
  private static instance: PersonYOLODetector | null = null;
  private model: tf.GraphModel | null = null;
  private modelPath: string = '/yolov12n_web_model/model.json';
  private inputSize: number = 640;
  private confidenceThreshold: number = detectionConfig.yolo.confidenceThreshold;
  private iouThreshold: number = detectionConfig.yolo.iouThreshold;
  private maxDetections: number = detectionConfig.yolo.maxDetections;
  
  constructor() {
    // console.log('PersonYOLODetector constructor: initial threshold', this.confidenceThreshold);
  }
  
  // Singleton pattern for mobile to reuse model
  static getInstance(): PersonYOLODetector {
    if (!PersonYOLODetector.instance) {
      PersonYOLODetector.instance = new PersonYOLODetector();
    }
    return PersonYOLODetector.instance;
  }
  
  // COCO class names - person is class 0
  private classNames: string[] = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
    'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
    'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
    'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
    'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
    'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
    'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
    'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote',
    'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book',
    'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
  ];


  async initialize(): Promise<void> {
    // Skip if already initialized
    if (this.model) {
      // Model already initialized, skipping...
      return;
    }
    
    try {
      // Set up TensorFlow.js backend for mobile compatibility
      const device = DeviceDetector.getInstance();
      // Initializing on mobile: device.isMobile

      if (device.isMobile) {
        // Use same WebGL configuration as PC for consistency
        try {
          await tf.setBackend('webgl');
          // Disable F16 textures to match PC precision
          tf.env().set('WEBGL_FORCE_F16_TEXTURES', false);
          tf.env().set('WEBGL_DELETE_TEXTURE_THRESHOLD', 0);
          tf.env().set('WEBGL_PACK', true);
        } catch (webglError) {
          console.warn('WebGL backend failed on mobile, falling back to CPU:', webglError);
          await tf.setBackend('cpu');
        }
      }
      
      await tf.ready();
      // TensorFlow.js backend initialized
      // TensorFlow.js version checked
      
      // Try to fetch the model.json first to verify it's accessible
      try {
        const response = await fetch(this.modelPath);
        // Model fetch response received
        if (!response.ok) {
          throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
        }
      } catch (fetchError) {
        console.error('Failed to fetch model.json:', fetchError);
        throw fetchError;
      }
      
      this.model = await tf.loadGraphModel(this.modelPath);
      // YOLOv12n person detection model initialized successfully
      
      // Test the model with a dummy input to ensure it's working
      const testInput = tf.zeros([1, this.inputSize, this.inputSize, 3]);
      
      // Temporarily suppress the TensorFlow.js warning
      const originalWarn = console.warn;
      console.warn = (...args: any[]) => {
        if (args[0]?.includes?.('model.execute()')) {
          return;
        }
        originalWarn.apply(console, args);
      };
      
      const testOutput = await this.model.executeAsync(testInput);
      
      // Restore original console.warn
      console.warn = originalWarn;
      
      // Handle both single tensor and array outputs
      if (Array.isArray(testOutput)) {
        // Model test output shape verified
        testOutput.forEach(t => t.dispose());
      } else {
        // Model test output shape verified
        testOutput.dispose();
      }
      testInput.dispose();
    } catch (error) {
      console.error('Failed to initialize YOLOv12n model:', error);
      throw error;
    }
  }

  async detect(imageData: ImageData | HTMLVideoElement | HTMLCanvasElement, frameNumber?: number): Promise<BoundingBox[]> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }

    const input = await this.preprocessImage(imageData);
    
    // Temporarily suppress the TensorFlow.js warning about using execute() instead of executeAsync()
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      if (args[0]?.includes?.('model.execute()')) {
        return; // Suppress this specific warning
      }
      originalWarn.apply(console, args);
    };
    
    const result = await this.model.executeAsync(input);
    
    // Restore original console.warn
    console.warn = originalWarn;
    
    // Handle both single tensor and array outputs (YOLOv12n returns array)
    let predictions: tf.Tensor;
    let confidenceTensor: tf.Tensor | null = null;
    
    if (Array.isArray(result)) {
      predictions = result[0] as tf.Tensor;
      
      // Always keep the second tensor if it exists - might contain confidence scores
      if (result.length > 1) {
        confidenceTensor = result[1] as tf.Tensor;
      }
      
      // Dispose other outputs if any
      for (let i = 2; i < result.length; i++) {
        result[i].dispose();
      }
    } else {
      predictions = result as tf.Tensor;
    }
    
    const boxes = await this.postprocess(predictions, imageData, frameNumber, confidenceTensor);
    
    // Clean up tensors
    input.dispose();
    predictions.dispose();
    if (confidenceTensor) {
      confidenceTensor.dispose();
    }
    
    return boxes;
  }

  private async preprocessImage(imageData: ImageData | HTMLVideoElement | HTMLCanvasElement): Promise<tf.Tensor> {
    return tf.tidy(() => {
      // Use the same preprocessing for both mobile and PC
      const imageTensor = tf.browser.fromPixels(imageData);
      
      // Resize to model input size
      const resized = tf.image.resizeBilinear(imageTensor, [this.inputSize, this.inputSize]);
      
      // Normalize to [0, 1]
      const normalized = resized.div(255.0);
      
      // Add batch dimension
      const batched = normalized.expandDims(0);
      
      
      return batched;
    });
  }

  private async postprocess(predictions: tf.Tensor, originalImage: ImageData | HTMLVideoElement | HTMLCanvasElement, frameNumber?: number, confidenceTensor?: tf.Tensor | null): Promise<BoundingBox[]> {
    const [height, width] = originalImage instanceof ImageData 
      ? [originalImage.height, originalImage.width]
      : [originalImage.height, originalImage.width];
    
    // Try the reference implementation approach using tensor operations
    // Remove batch dimension
    const squeezedPredictions = predictions.squeeze([0]); // Shape: [300, 6]
    
    // Extract confidence scores (index 4)
    const confidences = squeezedPredictions.slice([0, 4], [-1, 1]).squeeze(); // Shape: [300]
    
    // Get the data synchronously for processing
    const predictionsData = squeezedPredictions.arraySync() as number[][];
    let confidenceData = confidences.dataSync() as Float32Array;
      
      // YOLOv12n might output confidence values in a separate tensor
      // Check this regardless of platform for consistency
      if (confidenceTensor) {
        const secondTensorData = confidenceTensor.dataSync() as Float32Array;
        
        // If the main tensor has all zero confidences but second tensor has values, 
        // use the second tensor for confidence scores
        if (Math.max(...confidenceData) === 0 && secondTensorData.some(v => v > 0)) {
          // The second tensor contains confidence scores for the detections
          // Direct mapping: first 300 values correspond to the 300 detections
          if (secondTensorData.length >= 300) {
            confidenceData = secondTensorData.slice(0, 300) as Float32Array;
          }
        }
      }
      
      // Create mask for detections above threshold
      const mask = Array.from(confidenceData).map(c => c > this.confidenceThreshold);
      
      
      const boxes: BoundingBox[] = [];
      let personCount = 0;
      let lowConfCount = 0;
      
      // Process each detection
      for (let i = 0; i < predictionsData.length; i++) {
        const bbox = predictionsData[i];
        const isValid = mask[i];
        const x1 = bbox[0];
        const y1 = bbox[1];
        const x2 = bbox[2];
        const y2 = bbox[3];
        const score = confidenceData[i]; // Use extracted confidence
        const classId = Math.round(bbox[5]);
        
        // Count persons regardless of confidence
        if (classId === 0) {
          personCount++;
          if (score <= this.confidenceThreshold) {
            lowConfCount++;
          }
          
        }
        
        // Filter by confidence threshold and only keep person detections (class 0)
        if (isValid && classId === 0) {
          // Scale coordinates from model input size to original image size
          const scaleX = width / this.inputSize;
          const scaleY = height / this.inputSize;
          
          boxes.push({
            x: Math.max(0, x1 * scaleX),
            y: Math.max(0, y1 * scaleY),
            width: Math.min((x2 - x1) * scaleX, width - x1 * scaleX),
            height: Math.min((y2 - y1) * scaleY, height - y1 * scaleY),
            confidence: score,
            class: 'person',
            classId: 0
          });
        }
      }
      
      
    // Clean up tensors
    squeezedPredictions.dispose();
    confidences.dispose();
    
    // Apply NMS to remove duplicate detections
    // This is crucial to prevent the same person from being detected multiple times
    const nmsBoxes = this.nonMaxSuppression(boxes);
    
    // Log if duplicates were removed
    // if (boxes.length > nmsBoxes.length) {
    //   console.log(`NMS removed ${boxes.length - nmsBoxes.length} duplicate detections`);
    // }
    
    return nmsBoxes;
  }

  private nonMaxSuppression(boxes: BoundingBox[]): BoundingBox[] {
    if (boxes.length === 0) return [];
    
    // Sort by confidence
    boxes.sort((a, b) => b.confidence - a.confidence);
    
    const selected: BoundingBox[] = [];
    const used = new Set<number>();
    
    for (let i = 0; i < boxes.length && selected.length < this.maxDetections; i++) {
      if (used.has(i)) continue;
      
      selected.push(boxes[i]);
      used.add(i);
      
      // Check IoU with remaining boxes
      for (let j = i + 1; j < boxes.length; j++) {
        if (used.has(j)) continue;
        
        const iou = this.calculateIoU(boxes[i], boxes[j]);
        if (iou > this.iouThreshold) {
          used.add(j);
        }
      }
    }
    
    return selected;
  }

  private calculateIoU(box1: BoundingBox, box2: BoundingBox): number {
    const x1 = Math.max(box1.x, box2.x);
    const y1 = Math.max(box1.y, box2.y);
    const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
    const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);
    
    if (x2 < x1 || y2 < y1) return 0;
    
    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = box1.width * box1.height;
    const area2 = box2.width * box2.height;
    const union = area1 + area2 - intersection;
    
    return intersection / union;
  }

  setConfidenceThreshold(threshold: number): void {
    // console.log(`PersonYOLODetector: Setting confidence threshold to ${threshold}`);
    this.confidenceThreshold = threshold;
  }

  setIouThreshold(threshold: number): void {
    this.iouThreshold = threshold;
  }

  dispose(): void {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
  }
}