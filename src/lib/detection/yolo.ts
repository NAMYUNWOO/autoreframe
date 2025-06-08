import * as tf from '@tensorflow/tfjs';
import { BoundingBox } from '@/types';

const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake',
  'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop',
  'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
];

export class YOLODetector {
  private model: tf.GraphModel | null = null;
  private modelPath: string;
  private inputSize: number = 640;
  private confidenceThreshold: number = 0.45;
  private iouThreshold: number = 0.5;
  private maxDetections: number = 100;

  constructor(modelPath: string = '/yolov8n_web_model/model.json') {
    this.modelPath = modelPath;
  }

  async initialize(): Promise<void> {
    try {
      await tf.ready();
      await tf.setBackend('webgl');
      this.model = await tf.loadGraphModel(this.modelPath);
      
      // Warm up the model
      const dummyInput = tf.zeros([1, this.inputSize, this.inputSize, 3]);
      const output = this.model.predict(dummyInput) as tf.Tensor;
      await output.array();
      output.dispose();
      dummyInput.dispose();
    } catch (error) {
      // console.error('Failed to initialize YOLO model:', error);
      throw error;
    }
  }

  async detect(imageData: ImageData | HTMLVideoElement | HTMLCanvasElement): Promise<BoundingBox[]> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }

    const input = await this.preprocessImage(imageData);
    const predictions = await this.model.predict(input) as tf.Tensor;
    const boxes = await this.postprocess(predictions, imageData);
    
    input.dispose();
    predictions.dispose();
    
    return boxes;
  }

  private async preprocessImage(imageData: ImageData | HTMLVideoElement | HTMLCanvasElement): Promise<tf.Tensor4D> {
    let tensor: tf.Tensor3D;
    
    if (imageData instanceof ImageData) {
      tensor = tf.browser.fromPixels(imageData);
    } else {
      tensor = tf.browser.fromPixels(imageData);
    }
    
    // Resize to model input size
    const resized = tf.image.resizeBilinear(tensor, [this.inputSize, this.inputSize]);
    
    // Normalize to [0, 1]
    const normalized = resized.div(255.0);
    
    // Add batch dimension
    const batched = normalized.expandDims(0);
    
    tensor.dispose();
    resized.dispose();
    normalized.dispose();
    
    return batched as tf.Tensor4D;
  }

  private async postprocess(predictions: tf.Tensor, originalImage: ImageData | HTMLVideoElement | HTMLCanvasElement): Promise<BoundingBox[]> {
    const [height, width] = originalImage instanceof ImageData 
      ? [originalImage.height, originalImage.width]
      : [originalImage.height, originalImage.width];

    // YOLOv8 output shape: [1, 84, 8400]
    const transposed = tf.transpose(predictions, [0, 2, 1]);
    const [boxes, scores, classes] = await this.extractBoxesScoresClasses(transposed);
    
    // Apply NMS
    const nmsResults = await this.nonMaxSuppression(boxes, scores, classes);
    
    // Scale boxes to original image size
    const scaledBoxes = this.scaleBoxes(nmsResults, width, height);
    
    transposed.dispose();
    
    return scaledBoxes;
  }

  private async extractBoxesScoresClasses(predictions: tf.Tensor): Promise<[number[][], number[], number[]]> {
    const data = await predictions.array() as number[][][];
    const boxes: number[][] = [];
    const scores: number[] = [];
    const classes: number[] = [];
    
    for (let i = 0; i < data[0].length; i++) {
      const detection = data[0][i];
      const cx = detection[0];
      const cy = detection[1];
      const w = detection[2];
      const h = detection[3];
      
      const classScores = detection.slice(4);
      const maxScore = Math.max(...classScores);
      const classId = classScores.indexOf(maxScore);
      
      // Only detect person (class 0 in COCO dataset)
      if (classId === 0 && maxScore > this.confidenceThreshold) {
        // Convert from center format to corner format
        const x1 = (cx - w / 2) / this.inputSize;
        const y1 = (cy - h / 2) / this.inputSize;
        const x2 = (cx + w / 2) / this.inputSize;
        const y2 = (cy + h / 2) / this.inputSize;
        
        boxes.push([x1, y1, x2, y2]);
        scores.push(maxScore);
        classes.push(classId);
      }
    }
    
    return [boxes, scores, classes];
  }

  private async nonMaxSuppression(boxes: number[][], scores: number[], classes: number[]): Promise<BoundingBox[]> {
    if (boxes.length === 0) return [];
    
    const results: BoundingBox[] = [];
    
    // Convert to tensors
    const boxesTensor = tf.tensor2d(boxes);
    const scoresTensor = tf.tensor1d(scores);
    
    const indices = tf.image.nonMaxSuppression(
      boxesTensor,
      scoresTensor,
      this.maxDetections,
      this.iouThreshold,
      this.confidenceThreshold
    );
    
    const selectedIndices = await indices.array() as number[];
    
    for (const idx of selectedIndices) {
      const [x1, y1, x2, y2] = boxes[idx];
      results.push({
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
        confidence: scores[idx],
        class: COCO_CLASSES[classes[idx]],
        classId: classes[idx]
      });
    }
    
    // Clean up tensors
    boxesTensor.dispose();
    scoresTensor.dispose();
    indices.dispose();
    
    return results;
  }

  private scaleBoxes(boxes: BoundingBox[], imageWidth: number, imageHeight: number): BoundingBox[] {
    return boxes.map(box => ({
      ...box,
      x: box.x * imageWidth,
      y: box.y * imageHeight,
      width: box.width * imageWidth,
      height: box.height * imageHeight
    }));
  }

  setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = threshold;
  }

  setIouThreshold(threshold: number): void {
    this.iouThreshold = threshold;
  }

  dispose(): void {
    if (this.model) {
      this.model.dispose();
    }
  }
}