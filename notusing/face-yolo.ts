import * as ort from 'onnxruntime-web';
import { BoundingBox } from '@/types';

export class FaceYOLODetector {
  private session: ort.InferenceSession | null = null;
  private modelPath: string;
  private inputSize: number = 640;
  private confidenceThreshold: number = 0.2;
  private iouThreshold: number = 0.5;
  private maxDetections: number = 100;

  constructor(modelPath: string = '/head_model_640.onnx') {
    this.modelPath = modelPath;
  }

  async initialize(): Promise<void> {
    try {
      this.session = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ['webgl', 'wasm'],
        graphOptimizationLevel: 'all'
      });
      console.log('Head detection model initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Face YOLO model:', error);
      throw error;
    }
  }

  async detect(imageData: ImageData | HTMLVideoElement | HTMLCanvasElement): Promise<BoundingBox[]> {
    if (!this.session) {
      throw new Error('Model not initialized');
    }

    const [input, originalSize] = await this.preprocessImage(imageData);
    const results = await this.session.run({ 
      images: input,
      orig_target_sizes: originalSize
    });
    const boxes = await this.postprocess(results, imageData);
    
    return boxes;
  }

  private async preprocessImage(imageData: ImageData | HTMLVideoElement | HTMLCanvasElement): Promise<[ort.Tensor, ort.Tensor]> {
    // Get original dimensions
    const [origWidth, origHeight] = imageData instanceof ImageData 
      ? [imageData.width, imageData.height]
      : [imageData.width, imageData.height];
    
    const canvas = document.createElement('canvas');
    canvas.width = this.inputSize;
    canvas.height = this.inputSize;
    const ctx = canvas.getContext('2d')!;
    
    if (imageData instanceof ImageData) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = imageData.width;
      tempCanvas.height = imageData.height;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.putImageData(imageData, 0, 0);
      ctx.drawImage(tempCanvas, 0, 0, this.inputSize, this.inputSize);
    } else {
      ctx.drawImage(imageData, 0, 0, this.inputSize, this.inputSize);
    }
    
    const imageDataResized = ctx.getImageData(0, 0, this.inputSize, this.inputSize);
    const data = new Float32Array(1 * 3 * this.inputSize * this.inputSize);
    
    // Convert to RGB and normalize
    for (let i = 0; i < imageDataResized.data.length; i += 4) {
      const idx = i / 4;
      const row = Math.floor(idx / this.inputSize);
      const col = idx % this.inputSize;
      
      // R channel
      data[0 * this.inputSize * this.inputSize + row * this.inputSize + col] = imageDataResized.data[i] / 255.0;
      // G channel
      data[1 * this.inputSize * this.inputSize + row * this.inputSize + col] = imageDataResized.data[i + 1] / 255.0;
      // B channel
      data[2 * this.inputSize * this.inputSize + row * this.inputSize + col] = imageDataResized.data[i + 2] / 255.0;
    }
    
    const imageTensor = new ort.Tensor('float32', data, [1, 3, this.inputSize, this.inputSize]);
    const sizeTensor = new ort.Tensor('int64', new BigInt64Array([BigInt(origWidth), BigInt(origHeight)]), [1, 2]);
    
    return [imageTensor, sizeTensor];
  }

  private async postprocess(results: ort.InferenceSession.OnnxValueMapType, originalImage: ImageData | HTMLVideoElement | HTMLCanvasElement): Promise<BoundingBox[]> {
    // Head detection model outputs: labels, boxes, scores
    const outputNames = Object.keys(results);
    let boxesTensor: ort.Tensor;
    let scoresTensor: ort.Tensor;
    
    // The model outputs in order: labels, boxes, scores
    if (outputNames.length >= 3) {
      boxesTensor = results[outputNames[1]] as ort.Tensor;
      scoresTensor = results[outputNames[2]] as ort.Tensor;
    } else {
      throw new Error('Unexpected model output format');
    }
    
    const boxesData = boxesTensor.data as Float32Array;
    const scoresData = scoresTensor.data as Float32Array;
    
    const boxes: BoundingBox[] = [];
    const numDetections = scoresData.length;
    
    // Process each detection
    for (let i = 0; i < numDetections; i++) {
      const score = scoresData[i];
      
      if (score > this.confidenceThreshold) {
        // Boxes are in format [x1, y1, x2, y2]
        const x1 = boxesData[i * 4];
        const y1 = boxesData[i * 4 + 1];
        const x2 = boxesData[i * 4 + 2];
        const y2 = boxesData[i * 4 + 3];
        
        boxes.push({
          x: x1,
          y: y1,
          width: x2 - x1,
          height: y2 - y1,
          confidence: score,
          class: 'head',
          classId: 0
        });
      }
    }
    
    return boxes;
  }

  private nonMaxSuppression(candidates: Array<{box: BoundingBox, score: number}>): Array<{box: BoundingBox, score: number}> {
    // Sort by confidence score
    candidates.sort((a, b) => b.score - a.score);
    
    const selected: Array<{box: BoundingBox, score: number}> = [];
    const used = new Set<number>();
    
    for (let i = 0; i < candidates.length && selected.length < this.maxDetections; i++) {
      if (used.has(i)) continue;
      
      const current = candidates[i];
      selected.push(current);
      used.add(i);
      
      // Check IoU with remaining boxes
      for (let j = i + 1; j < candidates.length; j++) {
        if (used.has(j)) continue;
        
        const iou = this.calculateIoU(current.box, candidates[j].box);
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
    this.confidenceThreshold = threshold;
  }

  setIouThreshold(threshold: number): void {
    this.iouThreshold = threshold;
  }

  dispose(): void {
    // ONNX Runtime sessions don't need explicit disposal in the web version
    this.session = null;
  }
}