import * as tf from '@tensorflow/tfjs';
import * as ort from 'onnxruntime-web';
import { BoundingBox } from '@/types';

interface HeadDetection {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export class HeadDetector {
  private session: ort.InferenceSession | null = null;
  private modelPath = '/head_model_640.onnx';
  private inputSize = 640;
  private confidenceThreshold = 0.05; // Very low threshold to detect more heads
  
  async initialize(): Promise<void> {
    try {
      // console.log('Initializing head detection model...');
      
      // Check if model file exists by trying to fetch it
      try {
        const response = await fetch(this.modelPath);
        if (!response.ok) {
          throw new Error(`Model file not found: ${this.modelPath} (${response.status})`);
        }
      } catch (fetchError) {
        // console.error('Failed to fetch model file:', fetchError);
        throw new Error(`Cannot access model file at ${this.modelPath}`);
      }
      
      // Create ONNX Runtime session with fallback providers
      this.session = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ['wasm'], // Use only WASM to avoid WebGL issues
        graphOptimizationLevel: 'all'
      });
      
      // console.log('Head detection model loaded successfully');
      // console.log('Input names:', this.session.inputNames);
      // console.log('Output names:', this.session.outputNames);
      
      // Log basic info for debugging
      // console.log('Model inputs:', this.session.inputNames.length, 'outputs:', this.session.outputNames.length);
    } catch (error) {
      // console.error('Failed to load head detection model:', error);
      throw error;
    }
  }
  
  /**
   * Detect heads within a person bounding box
   */
  async detectHeadInBox(
    imageData: ImageData | HTMLCanvasElement,
    personBox: BoundingBox,
    padding: number = 0.1
  ): Promise<HeadDetection | null> {
    if (!this.session) {
      throw new Error('Head detector not initialized');
    }
    
    try {
      // Add padding to person box
      const padX = personBox.width * padding;
      const padY = personBox.height * padding;
      
      const cropX = Math.max(0, personBox.x - padX);
      const cropY = Math.max(0, personBox.y - padY);
      const cropWidth = personBox.width + 2 * padX;
      const cropHeight = personBox.height + 2 * padY;
      
      // console.log(`Detecting head in person box: (${personBox.x}, ${personBox.y}, ${personBox.width}, ${personBox.height})`);
      // console.log(`Cropped region: (${cropX}, ${cropY}, ${cropWidth}, ${cropHeight})`);
      
      // Create canvas for cropping
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropWidth;
      cropCanvas.height = cropHeight;
      const cropCtx = cropCanvas.getContext('2d')!;
      
      // Draw cropped region
      if (imageData instanceof ImageData) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageData.width;
        tempCanvas.height = imageData.height;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.putImageData(imageData, 0, 0);
        cropCtx.drawImage(tempCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      } else {
        cropCtx.drawImage(imageData, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      }
      
      // Resize to model input size
      const resizeCanvas = document.createElement('canvas');
      resizeCanvas.width = this.inputSize;
      resizeCanvas.height = this.inputSize;
      const resizeCtx = resizeCanvas.getContext('2d')!;
      resizeCtx.drawImage(cropCanvas, 0, 0, this.inputSize, this.inputSize);
      
      // Get image data and preprocess
      const imgData = resizeCtx.getImageData(0, 0, this.inputSize, this.inputSize);
      const input = this.preprocessImage(imgData);
      
      // Run inference
      const feeds: Record<string, ort.Tensor> = {};
      
      // Check input names and provide required inputs
      // console.log('Model input names:', this.session.inputNames);
      
      // Main image input
      feeds[this.session.inputNames[0]] = new ort.Tensor('float32', input, [1, 3, this.inputSize, this.inputSize]);
      
      // If model requires orig_target_sizes (common in detection models)
      if (this.session.inputNames.includes('orig_target_sizes')) {
        // Original image size before resizing (round to integers)
        feeds['orig_target_sizes'] = new ort.Tensor('int64', 
          BigInt64Array.from([BigInt(Math.round(cropHeight)), BigInt(Math.round(cropWidth))]), 
          [1, 2]
        );
      }
      
      const output = await this.session.run(feeds);
      // console.log('Model output names:', this.session.outputNames);
      // console.log('Output shapes:', Object.entries(output).map(([k, v]) => `${k}: [${v.dims}]`));
      // console.log('Output keys:', Object.keys(output));
      
      // Based on RT-DETRv2, outputs might be boxes and scores
      let boxes: ort.Tensor;
      let scores: ort.Tensor | undefined;
      
      // Check for various output name patterns
      const outputNames = this.session.outputNames;
      
      // Common patterns for DETR models
      if (outputNames.some(name => name.includes('boxes')) && outputNames.some(name => name.includes('scores'))) {
        const boxName = outputNames.find(name => name.includes('boxes'))!;
        const scoreName = outputNames.find(name => name.includes('scores'))!;
        boxes = output[boxName];
        scores = output[scoreName];
      } else if (outputNames.length >= 2) {
        // Assume first output is boxes, second is scores
        boxes = output[outputNames[0]];
        scores = output[outputNames[1]];
      } else {
        // Single output might contain both
        boxes = output[outputNames[0]];
        scores = undefined;
      }
      
      // console.log('Boxes shape:', boxes.dims);
      // console.log('Scores shape:', scores?.dims || 'N/A');
      
      // Log first few box values to understand format
      const boxData = boxes.data as Float32Array;
      // console.log('First box raw values:', Array.from(boxData).slice(0, 4));
      // console.log('Second box raw values:', Array.from(boxData).slice(4, 8));
      // console.log('Box data length:', boxData.length);
      // console.log('Score data available:', scores !== undefined);
      
      // Parse detections
      const heads = this.parseDetectionsFromBoxesScores(boxes, scores, cropWidth / this.inputSize, cropHeight / this.inputSize);
      
      // console.log(`Total heads detected: ${heads.length}`);
      heads.forEach((head, idx) => {
        // console.log(`Head ${idx}: confidence=${head.confidence.toFixed(3)}, bbox=(${head.x.toFixed(1)}, ${head.y.toFixed(1)}, ${head.width.toFixed(1)}, ${head.height.toFixed(1)})`);
      });
      
      if (heads.length > 0) {
        // Get the most confident head detection
        const bestHead = heads.reduce((best, current) => 
          current.confidence > best.confidence ? current : best
        );
        
        // Convert coordinates back to original image space
        const result = {
          x: cropX + bestHead.x,
          y: cropY + bestHead.y,
          width: bestHead.width,
          height: bestHead.height,
          confidence: bestHead.confidence
        };
        
        // console.log(`Best head in crop space: (${bestHead.x}, ${bestHead.y}, ${bestHead.width}, ${bestHead.height})`);
        // console.log(`Converted to image space: (${result.x}, ${result.y}, ${result.width}, ${result.height})`);
        
        // Verify head is in reasonable position (top 40% of person box for standing, varies for other poses)
        const headCenterY = result.y + result.height / 2;
        const personCenterY = personBox.y + personBox.height / 2;
        const relativeY = (headCenterY - personBox.y) / personBox.height;
        
        // console.log(`Head position check: relativeY=${relativeY.toFixed(2)} (0=top, 1=bottom of person box)`);
        
        return result;
      }
      
      // console.log('No heads detected by model');
      return null;
    } catch (error) {
      // console.error('Head detection failed:', error);
      return null;
    }
  }
  
  /**
   * Detect all heads in the full image
   */
  async detectHeads(imageData: ImageData | HTMLCanvasElement): Promise<HeadDetection[]> {
    if (!this.session) {
      throw new Error('Head detector not initialized');
    }
    
    try {
      // Create canvas for resizing
      const canvas = document.createElement('canvas');
      canvas.width = this.inputSize;
      canvas.height = this.inputSize;
      const ctx = canvas.getContext('2d')!;
      
      // Draw and resize image
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
      
      // Get image data and preprocess
      const imgData = ctx.getImageData(0, 0, this.inputSize, this.inputSize);
      const input = this.preprocessImage(imgData);
      
      // Get original dimensions
      const origWidth = imageData instanceof ImageData ? imageData.width : imageData.width;
      const origHeight = imageData instanceof ImageData ? imageData.height : imageData.height;
      
      // Run inference
      const feeds: Record<string, ort.Tensor> = {};
      
      // Main image input
      feeds[this.session.inputNames[0]] = new ort.Tensor('float32', input, [1, 3, this.inputSize, this.inputSize]);
      
      // If model requires orig_target_sizes
      if (this.session.inputNames.includes('orig_target_sizes')) {
        feeds['orig_target_sizes'] = new ort.Tensor('int64', 
          BigInt64Array.from([BigInt(Math.round(origHeight)), BigInt(Math.round(origWidth))]), 
          [1, 2]
        );
      }
      
      const output = await this.session.run(feeds);
      
      // Get boxes and scores tensors
      let boxes: ort.Tensor;
      let scores: ort.Tensor | undefined;
      
      if (this.session.outputNames.includes('boxes') && this.session.outputNames.includes('scores')) {
        boxes = output['boxes'];
        scores = output['scores'];
      } else {
        boxes = output[this.session.outputNames[0]];
        scores = this.session.outputNames.length > 1 ? output[this.session.outputNames[1]] : undefined;
      }
      
      // Calculate scale factors
      const scaleX = origWidth / this.inputSize;
      const scaleY = origHeight / this.inputSize;
      
      // Parse detections
      return this.parseDetectionsFromBoxesScores(boxes, scores, scaleX, scaleY);
    } catch (error) {
      // console.error('Head detection failed:', error);
      return [];
    }
  }
  
  private preprocessImage(imageData: ImageData): Float32Array {
    const { data, width, height } = imageData;
    const input = new Float32Array(3 * width * height);
    
    // Convert to RGB and normalize
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      // Normalize to [0, 1] and apply ImageNet normalization
      input[i] = (data[idx] / 255.0 - 0.485) / 0.229; // R
      input[width * height + i] = (data[idx + 1] / 255.0 - 0.456) / 0.224; // G
      input[2 * width * height + i] = (data[idx + 2] / 255.0 - 0.406) / 0.225; // B
    }
    
    return input;
  }
  
  private parseDetectionsFromBoxesScores(boxes: ort.Tensor, scores: ort.Tensor | undefined, scaleX: number, scaleY: number): HeadDetection[] {
    const boxData = boxes.data as Float32Array;
    const scoreData = scores?.data as Float32Array;
    const detections: HeadDetection[] = [];
    
    // console.log('Parsing detections - boxes dims:', boxes.dims, 'scores dims:', scores?.dims);
    
    // RT-DETRv2 output format: boxes shape is typically [batch, num_queries, 4]
    // where 4 values are [cx, cy, w, h] in normalized coordinates
    const numBoxes = boxes.dims[1] || (boxData.length / 4);
    // console.log(`Number of boxes to process: ${numBoxes}`);
    
    // Log first few boxes to understand format
    for (let i = 0; i < Math.min(5, numBoxes); i++) {
      const boxIdx = i * 4;
      // console.log(`Box ${i} raw data: [${boxData[boxIdx]}, ${boxData[boxIdx+1]}, ${boxData[boxIdx+2]}, ${boxData[boxIdx+3]}]`);
    }
    
    for (let i = 0; i < numBoxes; i++) {
      const boxIdx = i * 4;
      
      // Get confidence score
      let confidence = 1.0;
      if (scoreData) {
        // Scores might be [batch, num_queries] or [batch, num_queries, num_classes]
        if (scores!.dims.length === 3) {
          // Multi-class, take max score
          const numClasses = scores!.dims[2];
          let maxScore = 0;
          let maxClass = -1;
          for (let c = 0; c < numClasses; c++) {
            const score = scoreData[i * numClasses + c];
            if (score > maxScore) {
              maxScore = score;
              maxClass = c;
            }
          }
          confidence = maxScore;
          if (i < 5) {} // console.log(`Box ${i}: max score=${maxScore.toFixed(3)} for class=${maxClass}`);
        } else {
          confidence = scoreData[i];
        }
      }
      
      if (confidence > this.confidenceThreshold) {
        // Get raw values for debugging
        const rawCx = boxData[boxIdx];
        const rawCy = boxData[boxIdx + 1];
        const rawW = boxData[boxIdx + 2];
        const rawH = boxData[boxIdx + 3];
        
        // console.log(`Head detection ${i}: raw values cx=${rawCx.toFixed(3)}, cy=${rawCy.toFixed(3)}, w=${rawW.toFixed(3)}, h=${rawH.toFixed(3)}, conf=${confidence.toFixed(3)}`);
        
        // Check if coordinates are already in pixel space or normalized [0, 1]
        let cx, cy, w, h;
        
        // Check if this might be YOLO format (x1, y1, x2, y2) instead of (cx, cy, w, h)
        if (rawW > rawCx && rawH > rawCy) {
          // This looks like x1, y1, x2, y2 format
          const x1 = rawCx;
          const y1 = rawCy;
          const x2 = rawW;
          const y2 = rawH;
          
          cx = (x1 + x2) / 2;
          cy = (y1 + y2) / 2;
          w = x2 - x1;
          h = y2 - y1;
          
          // console.log(`YOLO format detected (x1,y1,x2,y2): (${x1}, ${y1}, ${x2}, ${y2}) -> cx=${cx}, cy=${cy}, w=${w}, h=${h}`);
          
          // Scale based on whether normalized or pixel coords
          if (x2 <= 1.0) {
            // Normalized
            cx = cx * this.inputSize * scaleX;
            cy = cy * this.inputSize * scaleY;
            w = w * this.inputSize * scaleX;
            h = h * this.inputSize * scaleY;
          } else {
            // Pixel coords
            cx = cx * scaleX;
            cy = cy * scaleY;
            w = w * scaleX;
            h = h * scaleY;
          }
        } else if (rawCx <= 1.0 && rawCy <= 1.0 && rawW <= 1.0 && rawH <= 1.0) {
          // Normalized coordinates [0, 1]
          cx = rawCx * this.inputSize * scaleX;
          cy = rawCy * this.inputSize * scaleY;
          w = rawW * this.inputSize * scaleX;
          h = rawH * this.inputSize * scaleY;
          // console.log(`Normalized coords detected, scaled to: cx=${cx}, cy=${cy}, w=${w}, h=${h}`);
        } else {
          // Already in pixel coordinates for input size
          cx = rawCx * scaleX;
          cy = rawCy * scaleY;
          w = rawW * scaleX;
          h = rawH * scaleY;
          // console.log(`Pixel coords detected, scaled to: cx=${cx}, cy=${cy}, w=${w}, h=${h}`);
        }
        
        detections.push({
          x: cx - w / 2, // Convert from center to top-left
          y: cy - h / 2,
          width: w,
          height: h,
          confidence
        });
      }
    }
    
    return detections;
  }
  
  setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = threshold;
  }
  
  dispose(): void {
    if (this.session) {
      this.session.release();
      this.session = null;
    }
  }
}