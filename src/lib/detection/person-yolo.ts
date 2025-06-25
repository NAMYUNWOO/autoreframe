import * as tf from '@tensorflow/tfjs';
import { BoundingBox } from '@/types';

export class PersonYOLODetector {
  private model: tf.GraphModel | null = null;
  private modelPath: string = '/yolov12n_web_model/model.json';
  private inputSize: number = 640;
  private confidenceThreshold: number = 0.3; // 30% default confidence threshold for better detection
  
  constructor() {
    // console.log('PersonYOLODetector constructor: initial threshold', this.confidenceThreshold);
  }
  private iouThreshold: number = 0.45;
  private maxDetections: number = 100;
  
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
    try {
      await tf.ready();
      console.log('Loading YOLOv12n model from:', this.modelPath);
      console.log('TensorFlow.js version:', tf.version.tfjs);
      
      // Try to fetch the model.json first to verify it's accessible
      try {
        const response = await fetch(this.modelPath);
        console.log('Model fetch response status:', response.status);
        if (!response.ok) {
          throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
        }
      } catch (fetchError) {
        console.error('Failed to fetch model.json:', fetchError);
        throw fetchError;
      }
      
      this.model = await tf.loadGraphModel(this.modelPath);
      console.log('YOLOv12n person detection model initialized successfully');
      
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
        console.log('Model test output shape:', testOutput[0].shape);
        testOutput.forEach(t => t.dispose());
      } else {
        console.log('Model test output shape:', testOutput.shape);
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
    if (Array.isArray(result)) {
      predictions = result[0] as tf.Tensor;
      // Dispose other outputs if any
      for (let i = 1; i < result.length; i++) {
        result[i].dispose();
      }
    } else {
      predictions = result as tf.Tensor;
    }
    
    const boxes = await this.postprocess(predictions, imageData, frameNumber);
    
    // Clean up tensors
    input.dispose();
    predictions.dispose();
    
    return boxes;
  }

  private async preprocessImage(imageData: ImageData | HTMLVideoElement | HTMLCanvasElement): Promise<tf.Tensor> {
    let imageTensor: tf.Tensor;
    
    if (imageData instanceof ImageData) {
      imageTensor = tf.browser.fromPixels(imageData);
    } else {
      imageTensor = tf.browser.fromPixels(imageData);
    }
    
    // Resize to model input size
    const resized = tf.image.resizeBilinear(imageTensor as tf.Tensor3D, [this.inputSize, this.inputSize]);
    
    // Normalize to [0, 1]
    const normalized = resized.div(255.0);
    
    // Add batch dimension
    const batched = normalized.expandDims(0);
    
    // Clean up intermediate tensors
    imageTensor.dispose();
    resized.dispose();
    normalized.dispose();
    
    return batched;
  }

  private async postprocess(predictions: tf.Tensor, originalImage: ImageData | HTMLVideoElement | HTMLCanvasElement, frameNumber?: number): Promise<BoundingBox[]> {
    const [height, width] = originalImage instanceof ImageData 
      ? [originalImage.height, originalImage.width]
      : [originalImage.height, originalImage.width];
    
    // This YOLOv12n model outputs [1, 300, 6] with NMS already applied
    // Format: [x1, y1, x2, y2, confidence, class]
    const data = await predictions.arraySync() as number[][][];
    const detections = data[0]; // Remove batch dimension
    
    const boxes: BoundingBox[] = [];
    
    // Process each detection
    for (const bbox of detections) {
      const x1 = bbox[0];
      const y1 = bbox[1];
      const x2 = bbox[2];
      const y2 = bbox[3];
      const score = bbox[4];
      const classId = bbox[5];
      
      // Filter by confidence threshold and only keep person detections (class 0)
      if (score > this.confidenceThreshold && classId === 0) {
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
    
    // NMS is already applied by the model, so we don't need to apply it again
    return boxes;
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