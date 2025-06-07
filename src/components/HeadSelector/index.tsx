'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Detection, BoundingBox, ReframingConfig } from '@/types';
import { REFRAMING_PRESETS } from '@/lib/reframing/presets';

interface HeadSelectorProps {
  videoElement: HTMLVideoElement | null;
  onSelectHead: (box: BoundingBox) => void;
  onConfirm: (reframingConfig?: ReframingConfig) => void;
  confidenceThreshold?: number;
  showDetections?: boolean;
  onToggleDetections?: () => void;
  onConfidenceChange?: (value: number) => void;
}

export function HeadSelector({ 
  videoElement, 
  onSelectHead, 
  onConfirm, 
  confidenceThreshold = 0.3,
  showDetections = true,
  onToggleDetections,
  onConfidenceChange
}: HeadSelectorProps) {
  const [detections, setDetections] = useState<BoundingBox[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'target' | 'reframe'>('target');
  
  // Reframing settings state
  const [reframingConfig, setReframingConfig] = useState<ReframingConfig>({
    outputRatio: '16:9',
    padding: 0.3,
    smoothness: 0.7
  });
  const [currentPreset, setCurrentPreset] = useState<string>('smooth-follow');
  const [reframeBoxSize, setReframeBoxSize] = useState(1.0); // 1.0 = default size, 0.5 = smaller, 1.5 = larger
  const [reframeBoxOffset, setReframeBoxOffset] = useState({ x: 0, y: 0 }); // Offset from center
  const [isDraggingReframeBox, setIsDraggingReframeBox] = useState(false);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });

  // Apply preset
  const handlePresetChange = (preset: string) => {
    setCurrentPreset(preset);
    const presetConfig = REFRAMING_PRESETS[preset];
    if (presetConfig) {
      setReframingConfig({
        ...reframingConfig,
        ...presetConfig,
        outputRatio: reframingConfig.outputRatio // Preserve output ratio
      });
    }
  };

  // Update reframing config
  const updateReframingConfig = (updates: Partial<ReframingConfig>) => {
    setReframingConfig(prev => ({ ...prev, ...updates }));
  };

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

    // Import and run detection
    try {
      console.log('Importing PersonYOLODetector...');
      const { PersonYOLODetector } = await import('@/lib/detection/person-yolo');
      const detector = new PersonYOLODetector();
      
      console.log('Initializing detector...');
      await detector.initialize();
      
      // Set a lower threshold for initial detection to ensure we catch all persons
      detector.setConfidenceThreshold(0.3);
      
      console.log('Running detection on first frame...');
      const personDetections = await detector.detect(canvas);
      console.log('Raw detections found:', personDetections.length);
      
      // Always use ByteTracker for consistency
      console.log('Applying ByteTracker...');
      const { ByteTracker } = await import('@/lib/detection/bytetrack-proper/byte-tracker');
      const byteTracker = new ByteTracker({
        trackThresh: confidenceThreshold,
        trackBuffer: 30,
        matchThresh: 0.8,
        minBoxArea: 100,
        lowThresh: Math.max(0.1, confidenceThreshold * 0.5)
      });
      console.log('HeadSelector: ByteTracker using threshold', confidenceThreshold);
      
      // Process first frame with ByteTracker
      const finalDetections = byteTracker.update(personDetections);
      console.log('ByteTracker detections:', finalDetections.length);
        
        // Try to detect heads for each person
        const useHeadDetection = false; // Disable head detection - model not reliable
        
        if (useHeadDetection) {
          try {
            console.log('Initializing head detector...');
            const { HeadDetector } = await import('@/lib/detection/head-detector');
            const headDetector = new HeadDetector();
            await headDetector.initialize();
            
            console.log('Detecting heads in tracked persons...');
            for (const detection of finalDetections) {
              const headResult = await headDetector.detectHeadInBox(
                canvas,
                detection,
                0.05 // 5% padding
              );
              
              if (headResult) {
                // Add head center to detection
                detection.headCenterX = headResult.x + headResult.width / 2;
                detection.headCenterY = headResult.y + headResult.height / 2;
                console.log(`Head detected for track ${detection.trackId}:`);
                console.log(`  Person box: (${detection.x}, ${detection.y}, ${detection.width}, ${detection.height})`);
                console.log(`  Head box: (${headResult.x}, ${headResult.y}, ${headResult.width}, ${headResult.height})`);
                console.log(`  Head center: (${detection.headCenterX}, ${detection.headCenterY})`);
                
                // Verify head is within person box
                if (detection.headCenterX < detection.x || 
                    detection.headCenterX > detection.x + detection.width ||
                    detection.headCenterY < detection.y || 
                    detection.headCenterY > detection.y + detection.height) {
                  console.warn(`WARNING: Head center is outside person box!`);
                }
              } else {
                // Smart head position estimation based on box aspect ratio
                const aspectRatio = detection.width / detection.height;
                
                if (aspectRatio > 1.5) {
                  // Wide box - person likely horizontal (like figure skating)
                  // For figure skating, head is typically at the left side when horizontal
                  detection.headCenterX = detection.x + detection.width * 0.15; // Head at left end
                  detection.headCenterY = detection.y + detection.height * 0.5;
                  console.log(`Head estimated for horizontal pose (figure skating), track ${detection.trackId} at (${detection.headCenterX}, ${detection.headCenterY})`);
                } else {
                  // Normal standing pose
                  detection.headCenterX = detection.x + detection.width / 2;
                  detection.headCenterY = detection.y + detection.height * 0.25;
                  console.log(`Head estimated for track ${detection.trackId} at (${detection.headCenterX}, ${detection.headCenterY})`);
                }
              }
            }
            
            headDetector.dispose();
          } catch (headError) {
            console.warn('Head detection failed, using estimates:', headError);
            // Use estimated head positions
            for (const detection of finalDetections) {
              const aspectRatio = detection.width / detection.height;
              if (aspectRatio > 1.5) {
                detection.headCenterX = detection.x + detection.width * 0.15;
                detection.headCenterY = detection.y + detection.height * 0.5;
              } else {
                detection.headCenterX = detection.x + detection.width / 2;
                detection.headCenterY = detection.y + detection.height * 0.25;
              }
            }
          }
        } else {
          // Use estimated head positions when head detection is disabled
          console.log('Using estimated head positions (head detection disabled)');
          for (const detection of finalDetections) {
            const aspectRatio = detection.width / detection.height;
            if (aspectRatio > 1.5) {
              detection.headCenterX = detection.x + detection.width * 0.15;
              detection.headCenterY = detection.y + detection.height * 0.5;
              console.log(`Head estimated for horizontal pose, track ${detection.trackId} at (${detection.headCenterX}, ${detection.headCenterY})`);
            } else {
              detection.headCenterX = detection.x + detection.width / 2;
              detection.headCenterY = detection.y + detection.height * 0.25;
              console.log(`Head estimated for track ${detection.trackId} at (${detection.headCenterX}, ${detection.headCenterY})`);
            }
          }
        }
      
      setDetections(finalDetections);
      detector.dispose();

      // Draw detections
      if (finalDetections.length > 0) {
        drawDetections(overlayCtx, finalDetections, null);
      } else {
        console.warn('No persons detected in the first frame');
      }
    } catch (error) {
      console.error('Failed to detect persons:', error);
      if (error instanceof Error) {
        alert(`Failed to detect persons: ${error.message}`);
      } else {
        alert('Failed to detect persons in the first frame. Please try a different video or ensure there are visible people in the first frame.');
      }
    } finally {
      setIsDetecting(false);
    }
  }, [videoElement, onSelectHead, confidenceThreshold]);

  // Draw detection boxes with reframe preview
  const drawDetections = useCallback((ctx: CanvasRenderingContext2D, detections: BoundingBox[], reframeBox?: { x: number; y: number; width: number; height: number } | null) => {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    // Draw reframe box only in reframe tab
    if (activeTab === 'reframe' && reframeBox && selectedIndex !== null) {
      // Draw reframe box with draggable appearance
      ctx.strokeStyle = isDraggingReframeBox ? '#00ffff' : '#ffff00';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 5]);
      ctx.strokeRect(reframeBox.x, reframeBox.y, reframeBox.width, reframeBox.height);
      ctx.setLineDash([]);
      
      // Draw drag handle corners
      const cornerSize = 10;
      ctx.fillStyle = isDraggingReframeBox ? '#00ffff' : '#ffff00';
      // Top-left
      ctx.fillRect(reframeBox.x - cornerSize/2, reframeBox.y - cornerSize/2, cornerSize, cornerSize);
      // Top-right
      ctx.fillRect(reframeBox.x + reframeBox.width - cornerSize/2, reframeBox.y - cornerSize/2, cornerSize, cornerSize);
      // Bottom-left
      ctx.fillRect(reframeBox.x - cornerSize/2, reframeBox.y + reframeBox.height - cornerSize/2, cornerSize, cornerSize);
      // Bottom-right
      ctx.fillRect(reframeBox.x + reframeBox.width - cornerSize/2, reframeBox.y + reframeBox.height - cornerSize/2, cornerSize, cornerSize);
      
      // Draw center crosshair
      const centerX = reframeBox.x + reframeBox.width / 2;
      const centerY = reframeBox.y + reframeBox.height / 2;
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 1;
      const crossSize = 20;
      ctx.beginPath();
      ctx.moveTo(centerX - crossSize, centerY);
      ctx.lineTo(centerX + crossSize, centerY);
      ctx.moveTo(centerX, centerY - crossSize);
      ctx.lineTo(centerX, centerY + crossSize);
      ctx.stroke();
    }
    
    // Only draw detections if showDetections is true
    if (showDetections) {
      detections.forEach((detection, index) => {
        const isSelected = index === selectedIndex;
        
        // Draw bounding box
        ctx.strokeStyle = isSelected ? '#00ff00' : '#ff0000';
        ctx.lineWidth = isSelected ? 4 : 2;
        ctx.strokeRect(detection.x, detection.y, detection.width, detection.height);
        
        // Draw label
        ctx.fillStyle = isSelected ? '#00ff00' : '#ff0000';
        ctx.font = 'bold 16px Arial';
        const trackIdLabel = detection.trackId ? `ID-${detection.trackId}: ` : '';
        const label = `${trackIdLabel}person ${(detection.confidence * 100).toFixed(0)}%`;
        const textMetrics = ctx.measureText(label);
        
        ctx.fillRect(
          detection.x,
          detection.y - 20,
          textMetrics.width + 8,
          20
        );
        
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, detection.x + 4, detection.y - 4);
        
        // Draw head center if available
        if (detection.headCenterX && detection.headCenterY) {
          ctx.fillStyle = isSelected ? '#00ff00' : '#ff0000';
          ctx.beginPath();
          ctx.arc(detection.headCenterX, detection.headCenterY, 5, 0, 2 * Math.PI);
          ctx.fill();
          
          // Draw crosshair
          ctx.strokeStyle = isSelected ? '#00ff00' : '#ff0000';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(detection.headCenterX - 10, detection.headCenterY);
          ctx.lineTo(detection.headCenterX + 10, detection.headCenterY);
          ctx.moveTo(detection.headCenterX, detection.headCenterY - 10);
          ctx.lineTo(detection.headCenterX, detection.headCenterY + 10);
          ctx.stroke();
        }
      });
    }
  }, [selectedIndex, activeTab, isDraggingReframeBox, showDetections]);

  // Calculate reframe box preview
  const calculateReframeBox = useCallback(() => {
    if (selectedIndex === null || !detections[selectedIndex] || !canvasRef.current) return null;
    
    const selectedBox = detections[selectedIndex];
    const frameWidth = canvasRef.current.width;
    const frameHeight = canvasRef.current.height;
    
    // Get output aspect ratio
    const outputAspectRatio = reframingConfig.outputRatio === '16:9' ? 16/9 : 
                             reframingConfig.outputRatio === '9:16' ? 9/16 : 
                             reframingConfig.outputRatio === '1:1' ? 1 : 
                             reframingConfig.outputRatio === '4:3' ? 4/3 : 3/4;
    
    // Calculate reframe dimensions using the same calculator as the engine
    const { ReframeSizeCalculatorV2 } = require('@/lib/reframing/reframe-size-calculator-v2');
    const reframeDimensions = ReframeSizeCalculatorV2.calculateOptimalReframeSize(
      selectedBox,
      frameWidth,
      frameHeight,
      outputAspectRatio,
      reframingConfig
    );
    
    // Apply size adjustment
    const adjustedWidth = reframeDimensions.width * reframeBoxSize;
    const adjustedHeight = reframeDimensions.height * reframeBoxSize;
    
    // Calculate base position centered on the person (or their head if available)
    const targetCenterX = selectedBox.headCenterX || (selectedBox.x + selectedBox.width / 2);
    const targetCenterY = selectedBox.headCenterY || (selectedBox.y + selectedBox.height / 2);
    
    // Apply offset to position the target within the reframe box
    const boxCenterX = targetCenterX - reframeBoxOffset.x;
    const boxCenterY = targetCenterY - reframeBoxOffset.y;
    
    // Calculate top-left corner
    const x = boxCenterX - adjustedWidth / 2;
    const y = boxCenterY - adjustedHeight / 2;
    
    // Ensure box stays within frame bounds
    const clampedX = Math.max(0, Math.min(frameWidth - adjustedWidth, x));
    const clampedY = Math.max(0, Math.min(frameHeight - adjustedHeight, y));
    
    return {
      x: clampedX,
      y: clampedY,
      width: adjustedWidth,
      height: adjustedHeight
    };
  }, [selectedIndex, detections, reframingConfig, reframeBoxSize, reframeBoxOffset]);

  // Update overlay when settings change
  useEffect(() => {
    if (!overlayCanvasRef.current || detections.length === 0) return;
    
    const ctx = overlayCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const reframeBox = calculateReframeBox();
    drawDetections(ctx, detections, reframeBox);
  }, [detections, drawDetections, calculateReframeBox, activeTab, reframeBoxSize, reframeBoxOffset]);

  // Handle canvas mouse down
  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!overlayCanvasRef.current) return;

    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * overlayCanvasRef.current.width;
    const y = (event.clientY - rect.top) / rect.height * overlayCanvasRef.current.height;

    if (activeTab === 'target') {
      // In target tab, select a person
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
            drawDetections(ctx, detections, null);
          }
          break;
        }
      }
    } else if (activeTab === 'reframe' && selectedIndex !== null) {
      // In reframe tab, check if clicking on reframe box to drag it
      const reframeBox = calculateReframeBox();
      if (reframeBox && 
          x >= reframeBox.x && 
          x <= reframeBox.x + reframeBox.width &&
          y >= reframeBox.y && 
          y <= reframeBox.y + reframeBox.height) {
        setIsDraggingReframeBox(true);
        setDragStartPos({ x, y });
      }
    }
  };

  // Handle mouse move for dragging
  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingReframeBox || !overlayCanvasRef.current || selectedIndex === null) return;

    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * overlayCanvasRef.current.width;
    const y = (event.clientY - rect.top) / rect.height * overlayCanvasRef.current.height;

    // Calculate the movement delta
    const deltaX = x - dragStartPos.x;
    const deltaY = y - dragStartPos.y;

    // Update the reframe box offset
    // Note: We invert the delta because moving the box right means the target moves left within it
    setReframeBoxOffset(prev => ({
      x: prev.x - deltaX,
      y: prev.y - deltaY
    }));

    setDragStartPos({ x, y });
  };

  // Handle mouse up
  const handleCanvasMouseUp = () => {
    setIsDraggingReframeBox(false);
  };

  // Auto-detect on mount
  useEffect(() => {
    if (videoElement) {
      detectFirstFrame();
    }
  }, [videoElement, detectFirstFrame]);

  const handleConfirm = () => {
    if (selectedIndex !== null) {
      // Include the box size and offset in the config
      const enhancedConfig = {
        ...reframingConfig,
        // Store these as custom properties
        reframeBoxSize,
        reframeBoxOffset
      };
      onConfirm(enhancedConfig);
    }
  };

  return (
    <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
      <h3 className="text-lg font-semibold text-white mb-4">Select Target Person & Configure Reframing</h3>
      
      {/* Tab Navigation */}
      <div className="flex border-b border-white/20 mb-4">
        <button
          onClick={() => setActiveTab('target')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'target' 
              ? 'text-white border-b-2 border-blue-500' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Target Selection
        </button>
        <button
          onClick={() => selectedIndex !== null && setActiveTab('reframe')}
          disabled={selectedIndex === null}
          className={`px-4 py-2 text-sm font-medium transition-colors ml-4 ${
            activeTab === 'reframe' 
              ? 'text-white border-b-2 border-blue-500' 
              : selectedIndex === null
                ? 'text-gray-600 cursor-not-allowed'
                : 'text-gray-400 hover:text-white'
          }`}
        >
          Reframe Settings
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'target' && (
        <>
          <div className="mb-4 text-sm text-gray-300">
            <p>Click on a person to select them for tracking.</p>
            <p>Selected person will be highlighted with a green border.</p>
          </div>
          
          {/* Detection Settings */}
          <div className="mb-4 p-4 bg-black/20 rounded-lg border border-white/5">
            <h4 className="text-md font-semibold text-white mb-3">Detection Settings</h4>
            
            {/* Show/Hide Detections */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-300">Show Detections</span>
              <button
                onClick={onToggleDetections}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  showDetections ? 'bg-blue-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    showDetections ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            
            {/* Confidence Threshold */}
            {onConfidenceChange && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Confidence Threshold: {(confidenceThreshold * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={confidenceThreshold * 100}
                  onChange={(e) => onConfidenceChange(parseFloat(e.target.value) / 100)}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <div className="text-xs text-gray-400 mt-1">
                  Lower values detect more objects but may include false positives
                </div>
              </div>
            )}
          </div>
        </>
      )}
      
      {activeTab === 'reframe' && (
        <div className="mb-4 text-sm text-gray-300">
          <p>Adjust reframe settings and drag the yellow box to position the target.</p>
        </div>
      )}

      <div 
        className="relative mb-4 bg-black rounded-lg overflow-hidden flex items-center justify-center"
        style={{ 
          maxHeight: 'calc(100vh - 600px)',
          aspectRatio: videoElement ? `${videoElement.videoWidth}/${videoElement.videoHeight}` : '16/9'
        }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: 'contain' }}
        />
        <canvas
          ref={overlayCanvasRef}
          className={`absolute inset-0 w-full h-full ${
            activeTab === 'target' ? 'cursor-pointer' : 
            activeTab === 'reframe' && selectedIndex !== null ? 'cursor-move' : 'cursor-default'
          }`}
          style={{ objectFit: 'contain' }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        />
        
        {isDetecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
            <div className="text-white flex items-center space-x-2">
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Detecting persons...</span>
            </div>
          </div>
        )}
      </div>

      {detections.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-300">
            Found {detections.length} person{detections.length > 1 ? 's' : ''}.
            {selectedIndex !== null && ` Person ${selectedIndex + 1} selected.`}
          </p>
        </div>
      )}

      {/* Reframing Settings - Show in reframe tab */}
      {activeTab === 'reframe' && selectedIndex !== null && (
        <div className="space-y-4 p-4 bg-black/20 rounded-lg border border-white/5">
          {/* Preset Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1">Preset</label>
            <select
              value={currentPreset}
              onChange={(e) => handlePresetChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-600 rounded-md bg-gray-700 text-gray-100 text-sm"
            >
              {Object.keys(REFRAMING_PRESETS).map(preset => (
                <option key={preset} value={preset}>
                  {preset.split('-').map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1)
                  ).join(' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Output Ratio */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1">Output Ratio</label>
            <div className="grid grid-cols-3 gap-2">
              {['16:9', '9:16', '1:1', '4:3', '3:4'].map(ratio => (
                <button
                  key={ratio}
                  onClick={() => updateReframingConfig({ outputRatio: ratio as any })}
                  className={`px-2 py-1 rounded-md text-sm font-medium transition-colors
                    ${reframingConfig.outputRatio === ratio 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          {/* Smoothness */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1">
              Smoothness: {(reframingConfig.smoothness * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={reframingConfig.smoothness * 100}
              onChange={(e) => updateReframingConfig({ smoothness: parseFloat(e.target.value) / 100 })}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Reframe Box Size */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1">
              Reframe Box Size: {(reframeBoxSize * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min="50"
              max="150"
              value={reframeBoxSize * 100}
              onChange={(e) => setReframeBoxSize(parseFloat(e.target.value) / 100)}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          <div className="text-xs text-gray-400 pt-2">
            <p>• Smoothness: Higher = smoother camera movement</p>
            <p>• Box Size: Adjust the zoom level (100% = default)</p>
            <p>• Drag the yellow box to reposition the target within the frame</p>
          </div>
        </div>
      )}

      <button
        onClick={handleConfirm}
        disabled={selectedIndex === null || activeTab !== 'reframe'}
        className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium rounded-lg
                   hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-all transform hover:scale-[1.02] mt-4"
      >
        {selectedIndex === null ? 'Select a Person First' : 
         activeTab !== 'reframe' ? 'Configure Reframe Settings First' :
         'Confirm Selection & Start Detection'}
      </button>
    </div>
  );
}