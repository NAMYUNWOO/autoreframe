'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Detection, BoundingBox } from '@/types';

interface HeadSelectorProps {
  videoElement: HTMLVideoElement | null;
  onSelectHead: (box: BoundingBox) => void;
  onConfirm: () => void;
}

export function HeadSelector({ videoElement, onSelectHead, onConfirm }: HeadSelectorProps) {
  const [detections, setDetections] = useState<BoundingBox[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  // Detect heads in first frame
  const detectFirstFrame = useCallback(async () => {
    if (!videoElement || !canvasRef.current || !overlayCanvasRef.current) return;

    setIsDetecting(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const overlayCanvas = overlayCanvasRef.current;
    const overlayCtx = overlayCanvas.getContext('2d');

    if (!ctx || !overlayCtx) return;

    // Ensure video is at first frame
    videoElement.currentTime = 0;
    await new Promise(resolve => {
      videoElement.onseeked = () => resolve(null);
    });

    // Set canvas size
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    overlayCanvas.width = videoElement.videoWidth;
    overlayCanvas.height = videoElement.videoHeight;

    // Draw first frame
    ctx.drawImage(videoElement, 0, 0);
    console.log('Canvas size:', canvas.width, 'x', canvas.height);

    // Import and run YOLO detection
    try {
      console.log('Importing PersonYOLODetector...');
      const { PersonYOLODetector } = await import('@/lib/detection/person-yolo');
      const detector = new PersonYOLODetector();
      
      console.log('Initializing detector...');
      await detector.initialize();
      
      console.log('Running detection on first frame...');
      const personDetections = await detector.detect(canvas);
      console.log('Detections found:', personDetections.length);
      
      setDetections(personDetections);
      detector.dispose();

      // Draw detections
      if (personDetections.length > 0) {
        drawDetections(overlayCtx, personDetections);
      } else {
        console.warn('No persons detected in the first frame');
      }
    } catch (error) {
      console.error('Failed to detect persons:', error);
      alert('Failed to detect persons in the first frame. Please try a different video or ensure there are visible people in the first frame.');
    } finally {
      setIsDetecting(false);
    }
  }, [videoElement]);

  // Draw detection boxes
  const drawDetections = (ctx: CanvasRenderingContext2D, detections: BoundingBox[]) => {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    detections.forEach((detection, index) => {
      const isSelected = index === selectedIndex;
      
      // Draw bounding box
      ctx.strokeStyle = isSelected ? '#00ff00' : '#ff0000';
      ctx.lineWidth = isSelected ? 4 : 2;
      ctx.strokeRect(detection.x, detection.y, detection.width, detection.height);
      
      // Draw label
      ctx.fillStyle = isSelected ? '#00ff00' : '#ff0000';
      ctx.font = 'bold 16px Arial';
      const label = `Person ${index + 1} (${(detection.confidence * 100).toFixed(0)}%)`;
      const textMetrics = ctx.measureText(label);
      
      ctx.fillRect(
        detection.x,
        detection.y - 20,
        textMetrics.width + 8,
        20
      );
      
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, detection.x + 4, detection.y - 4);
    });
  };

  // Handle canvas click
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!overlayCanvasRef.current || detections.length === 0) return;

    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const scaleX = overlayCanvasRef.current.width / rect.width;
    const scaleY = overlayCanvasRef.current.height / rect.height;
    
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    // Find clicked detection
    for (let i = 0; i < detections.length; i++) {
      const det = detections[i];
      if (
        x >= det.x &&
        x <= det.x + det.width &&
        y >= det.y &&
        y <= det.y + det.height
      ) {
        setSelectedIndex(i);
        onSelectHead(det);
        
        // Redraw with selection
        const ctx = overlayCanvasRef.current.getContext('2d');
        if (ctx) {
          drawDetections(ctx, detections);
        }
        break;
      }
    }
  };

  // Auto-detect on mount
  useEffect(() => {
    if (videoElement) {
      detectFirstFrame();
    }
  }, [videoElement, detectFirstFrame]);

  return (
    <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
      <h3 className="text-lg font-semibold text-white mb-4">Select Target Person</h3>
      
      <div className="mb-4 text-sm text-gray-300">
        <p>Click on the person you want to track throughout the video.</p>
        <p>The selected person will be highlighted in green.</p>
      </div>

      <div className="relative mb-4 bg-black rounded-lg overflow-hidden" style={{ maxHeight: '400px' }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ display: 'block', objectFit: 'contain' }}
        />
        <canvas
          ref={overlayCanvasRef}
          className="absolute top-0 left-0 w-full h-full cursor-pointer"
          style={{ objectFit: 'contain' }}
          onClick={handleCanvasClick}
        />
        
        {isDetecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
            <div className="text-white flex items-center space-x-2">
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Detecting heads...</span>
            </div>
          </div>
        )}
      </div>

      {detections.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-300">
            Found {detections.length} person{detections.length > 1 ? 's' : ''} in the first frame.
            {selectedIndex !== null && ` Person ${selectedIndex + 1} selected.`}
          </p>
        </div>
      )}

      <button
        onClick={onConfirm}
        disabled={selectedIndex === null}
        className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium rounded-lg
                   hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-all transform hover:scale-[1.02]"
      >
        Confirm Selection & Start Detection
      </button>
    </div>
  );
}