import * as tf from '@tensorflow/tfjs';
import { BoundingBox } from '@/types';

export class PersonYOLODetector {
  private model: tf.GraphModel | null = null;
  private modelPath: string = '/yolov8n_web_model/model.json';
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
      // console.log('Loading YOLOv8n model from:', this.modelPath);
      this.model = await tf.loadGraphModel(this.modelPath);
      // console.log('YOLOv8n person detection model initialized successfully');
      
      // Test the model with a dummy input to ensure it's working
      const testInput = tf.zeros([1, this.inputSize, this.inputSize, 3]);
      const testOutput = await this.model.predict(testInput) as tf.Tensor;
      // console.log('Model test output shape:', testOutput.shape);
      testInput.dispose();
      testOutput.dispose();
    } catch (error) {
      // console.error('Failed to initialize YOLOv8n model:', error);
      throw error;
    }
  }

  async detect(imageData: ImageData | HTMLVideoElement | HTMLCanvasElement, frameNumber?: number): Promise<BoundingBox[]> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }

    const input = await this.preprocessImage(imageData);
    const predictions = await this.model.predict(input) as tf.Tensor;
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
    
    const isFrame213 = frameNumber === 213;
    if (isFrame213) {
      // console.log('Frame 213: YOLOv8 predictions shape:', predictions.shape);
    }
    
    // YOLOv8 outputs can be in different formats
    // Common formats: [1, 84, 8400] or [1, 8400, 84]
    let data: Float32Array;
    let numBoxes: number;
    let stride: number;
    let isTransposed = false;
    
    if (predictions.shape[1] === 84 && predictions.shape[2] === 8400) {
      // Format: [1, 84, 8400] - need to transpose
      if (isFrame213) {
        // console.log('Frame 213: Transposing YOLOv8 output from [1, 84, 8400] to [1, 8400, 84]');
      }
      const transposed = predictions.transpose([0, 2, 1]);
      data = await transposed.data() as Float32Array;
      transposed.dispose();
      numBoxes = 8400;
      stride = 84;
      isTransposed = true;
    } else {
      // Format: [1, 8400, 84] or similar
      data = await predictions.data() as Float32Array;
      numBoxes = predictions.shape[1] as number;
      stride = predictions.shape[2] as number;
    }
    
    if (isFrame213) {
      // console.log(`Frame 213: Processing ${numBoxes} boxes with stride ${stride}`);
    }
    
    const boxes: BoundingBox[] = [];
    let debugMaxScore = 0;
    let debugScoreCount = 0;
    
    // Process each detection
    for (let i = 0; i < numBoxes; i++) {
      const offset = i * stride;
      
      // YOLOv8 format: first 4 values are bbox (cx, cy, w, h), then 80 class scores
      const cx = data[offset];
      const cy = data[offset + 1];
      const w = data[offset + 2];
      const h = data[offset + 3];
      
      // Find best class
      let maxScore = 0;
      let maxClassIdx = -1;
      
      for (let c = 0; c < 80; c++) {
        const score = data[offset + 4 + c];
        if (score > maxScore) {
          maxScore = score;
          maxClassIdx = c;
        }
      }
      
      // Track max score for debugging
      if (maxScore > debugMaxScore) {
        debugMaxScore = maxScore;
      }
      if (maxScore > 0.01) {
        debugScoreCount++;
      }
      
      // Only keep person detections (class 0) with confidence
      // Debug: Log ALL person detections regardless of threshold
      if (maxClassIdx === 0 && isFrame213) {
        // console.log(`Frame 213 - Person detection: score=${maxScore.toFixed(3)}, threshold=${this.confidenceThreshold}, passes=${maxScore > this.confidenceThreshold}`);
      }
      
      // Check if score seems to be in percentage form (0-100) rather than decimal (0-1)
      // YOLOv8 should output scores in 0-1 range, but let's verify
      if (maxClassIdx === 0 && maxScore > this.confidenceThreshold) {
        // YOLOv8 coordinates are already in pixel space (640x640)
        // Need to scale to original image size
        const scaleX = width / this.inputSize;
        const scaleY = height / this.inputSize;
        
        const x1 = (cx - w / 2) * scaleX;
        const y1 = (cy - h / 2) * scaleY;
        const boxWidth = w * scaleX;
        const boxHeight = h * scaleY;
        
        boxes.push({
          x: Math.max(0, x1),
          y: Math.max(0, y1),
          width: Math.min(boxWidth, width - x1),
          height: Math.min(boxHeight, height - y1),
          confidence: maxScore,
          class: 'person',
          classId: 0
        });
      }
    }
    
    if (isFrame213) {
      // console.log(`Frame 213: Found ${boxes.length} person detections before NMS`);
      // console.log(`Frame 213: Max score seen: ${debugMaxScore.toFixed(3)}, boxes with score > 0.01: ${debugScoreCount}`);
      // console.log(`Frame 213: Current confidence threshold: ${this.confidenceThreshold}`);
    }
    
    // Apply NMS
    const nmsBoxes = this.nonMaxSuppression(boxes);
    if (isFrame213) {
      // console.log(`Frame 213: ${nmsBoxes.length} person detections after NMS`);
    }
    
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