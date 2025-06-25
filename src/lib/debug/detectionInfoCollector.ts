import { VideoMetadata, Detection } from '@/types';
import { PersonYOLODetector } from '@/lib/detection/person-yolo';
import { ByteTrackInterpolator } from '@/lib/detection/bytetrack-interpolator';
import JSZip from 'jszip';
import { detectionConfig } from '@/config/detection';

// Types for detection info
interface DetectionInfo {
  frameNumber: number;
  timestamp: number;
  detections: {
    id: string;
    confidence: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
}

export async function collectDetectionInfo(
  processFrames: (callback: (frame: ImageData, frameNumber: number, timestamp: number) => Promise<void>) => Promise<void>,
  metadata: VideoMetadata,
  confidenceThreshold: number
): Promise<void> {
  // Initialize detector and tracker
  const detector = new PersonYOLODetector();
  detector.setConfidenceThreshold(confidenceThreshold);
  await detector.initialize();
  
  const tracker = new ByteTrackInterpolator({
    trackThresh: detectionConfig.byteTracker.trackThresh,
    trackBuffer: detectionConfig.byteTracker.trackBuffer,
    matchThresh: detectionConfig.byteTracker.matchThresh,
    minBoxArea: detectionConfig.byteTracker.minBoxArea,
    lowThresh: detectionConfig.byteTracker.lowThresh
  });
  
  // Reset tracker to ensure fresh start
  tracker.reset();
  
  // Collect detection info
  const detectionInfoList: DetectionInfo[] = [];
  const frameImages: { frameNumber: number; canvas: HTMLCanvasElement }[] = [];
  
  console.log('Starting detection info collection...');
  
  // Sample interval from config
  const sampleInterval = detectionConfig.sampleInterval;
  const totalFrames = Math.floor(metadata.fps * metadata.duration);
  
  // Process video frames
  await processFrames(async (frame: ImageData, frameNumber: number, timestamp: number) => {
    // Only process sample frames (first, last, and every 5 frames)
    const isFirstFrame = frameNumber === 0;
    const isLastFrame = frameNumber === totalFrames - 1;
    const isSampleFrame = frameNumber % sampleInterval === 0;
    
    try {
      let trackedBoxes: BoundingBox[];
      
      if (isFirstFrame || isLastFrame || isSampleFrame) {
        // Run detection on sample frames
        const boxes = await detector.detect(frame, frameNumber);
        
        // Track objects using processFrame
        const detection = tracker.processFrame(boxes, frameNumber, timestamp);
        trackedBoxes = detection.boxes;
        
        console.log(`Frame ${frameNumber}: YOLO detected ${boxes.length} persons, ByteTracker tracked ${trackedBoxes.length} persons`);
        
        // Log details if detection drops to 0
        if (boxes.length > 0 && trackedBoxes.length === 0) {
          console.warn(`Frame ${frameNumber}: Detection found ${boxes.length} persons but ByteTracker lost all tracks!`);
          boxes.forEach((box, i) => {
            console.log(`  YOLO box ${i}: confidence=${box.confidence.toFixed(3)}`);
          });
          
          // Debug ByteTracker state
          const byteTracker = (tracker as any).byteTracker;
          if (byteTracker) {
            console.log(`  ByteTracker frameId: ${byteTracker.frameId}`);
            console.log(`  ByteTracker params:`, byteTracker.params);
          }
        }
      } else {
        // For non-sample frames, get interpolated results
        const allDetections = tracker.getAllDetections(metadata.fps);
        const interpolatedDetection = allDetections.find(d => d.frameNumber === frameNumber);
        
        if (interpolatedDetection) {
          trackedBoxes = interpolatedDetection.boxes;
        } else {
          return; // No interpolated data for this frame
        }
      }
      
      // Create canvas for visualization
      const canvas = document.createElement('canvas');
      canvas.width = frame.width;
      canvas.height = frame.height;
      const ctx = canvas.getContext('2d')!;
      
      // Draw the frame
      ctx.putImageData(frame, 0, 0);
      
      // Collect detection info
      const detectionInfo: DetectionInfo = {
        frameNumber,
        timestamp,
        detections: trackedBoxes.map(box => ({
          id: box.trackId || 'unknown',
          confidence: box.confidence,
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height)
        }))
      };
      detectionInfoList.push(detectionInfo);
      
      // Draw detection boxes on canvas
      trackedBoxes.forEach(box => {
        // Generate color based on track ID
        const trackNum = parseInt(box.trackId || '0');
        const hue = (trackNum * 137.508) % 360; // Golden angle for distinct colors
        const color = `hsl(${hue}, 70%, 50%)`;
        
        // Draw bounding box
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        
        // Draw label background
        const label = `ID:${box.trackId} ${(box.confidence * 100).toFixed(0)}%`;
        ctx.font = 'bold 16px Arial';
        const textMetrics = ctx.measureText(label);
        const padding = 6;
        
        ctx.fillStyle = color;
        ctx.fillRect(
          box.x,
          box.y - 28,
          textMetrics.width + padding * 2,
          24
        );
        
        // Draw label text
        ctx.fillStyle = 'white';
        ctx.fillText(label, box.x + padding, box.y - 8);
      });
      
      // Store frame image only for sample frames to keep file size reasonable
      if (isFirstFrame || isLastFrame || isSampleFrame) {
        frameImages.push({ frameNumber, canvas });
      }
    } catch (error) {
      console.error(`Error processing frame ${frameNumber}:`, error);
    }
  });
  
  console.log('Creating detection info text file...');
  
  // Generate text file content
  let textContent = 'Detection Information Report\n';
  textContent += '===========================\n\n';
  textContent += `Video: ${metadata.width}x${metadata.height}, ${metadata.fps}fps, ${metadata.duration}s\n`;
  textContent += `Total Frames in Video: ${totalFrames}\n`;
  textContent += `Sample Interval: Every ${sampleInterval} frames (+ first and last frame)\n`;
  textContent += `Frames Analyzed: ${detectionInfoList.length}\n`;
  textContent += `Confidence Threshold: ${(confidenceThreshold * 100).toFixed(0)}%\n\n`;
  
  detectionInfoList.forEach(info => {
    textContent += `Frame ${info.frameNumber} (${info.timestamp.toFixed(3)}s):\n`;
    if (info.detections.length === 0) {
      textContent += '  No detections\n';
    } else {
      info.detections.forEach(det => {
        textContent += `  Person ID: ${det.id}\n`;
        textContent += `    Confidence: ${(det.confidence * 100).toFixed(1)}%\n`;
        textContent += `    Position: (${det.x}, ${det.y})\n`;
        textContent += `    Size: ${det.width}x${det.height}\n`;
      });
    }
    textContent += '\n';
  });
  
  console.log('Creating ZIP file...');
  
  // Create ZIP file
  const zip = new JSZip();
  
  // Add text file
  zip.file('detection_info.txt', textContent);
  
  // Add images
  const imagesFolder = zip.folder('frames');
  for (const { frameNumber, canvas } of frameImages) {
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob!), 'image/png');
    });
    imagesFolder!.file(`frame_${frameNumber.toString().padStart(5, '0')}.png`, blob);
  }
  
  // Generate and download ZIP
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'detection_info.zip';
  a.click();
  URL.revokeObjectURL(url);
  
  console.log('Detection info export completed!');
  
  // Clean up
  detector.dispose();
}