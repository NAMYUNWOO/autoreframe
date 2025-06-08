import { useState, useCallback, useRef, useEffect } from 'react';
import { ReframingEngine } from '@/lib/reframing/engine';
import { SimpleExporter } from '@/lib/video/simple-exporter';
import { 
  ReframingConfig, 
  FrameTransform, 
  Detection, 
  TrackedObject,
  VideoMetadata,
  ExportOptions,
  AspectRatio
} from '@/types';
import { REFRAMING_PRESETS } from '@/lib/reframing/presets';

export function useReframing() {
  const [config, setConfig] = useState<ReframingConfig>(REFRAMING_PRESETS['instagram-reel']);
  const [transforms, setTransforms] = useState<Map<number, FrameTransform>>(new Map());
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [currentPreset, setCurrentPreset] = useState('instagram-reel');
  const [storedInitialTargetBox, setStoredInitialTargetBox] = useState<{ width: number; height: number } | undefined>();
  
  const engineRef = useRef<ReframingEngine | null>(null);
  const simpleExporterRef = useRef<SimpleExporter | null>(null);

  // Initialize reframing engine
  useEffect(() => {
    // Engine will be created with ByteTrack flag when processing
  }, []);

  // Update engine when config changes
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateConfig(config);
    }
  }, [config]);

  const processReframing = useCallback(async (
    detections: Detection[],
    selectedTrack: TrackedObject | null,
    metadata: VideoMetadata,
    initialTargetBox?: { width: number; height: number }
  ) => {
    // Store initial target box for export
    setStoredInitialTargetBox(initialTargetBox);
    
    // Create new engine
    engineRef.current = new ReframingEngine(config, initialTargetBox);

    setIsProcessing(true);
    try {
      const frameTransforms = engineRef.current.processAllFrames(
        detections,
        selectedTrack,
        metadata.width,
        metadata.height,
        metadata.fps
      );
      
      setTransforms(frameTransforms);
      return frameTransforms;
    } finally {
      setIsProcessing(false);
    }
  }, [config]);

  const updateConfig = useCallback((updates: Partial<ReframingConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  const applyPreset = useCallback((presetName: string) => {
    const preset = REFRAMING_PRESETS[presetName];
    if (preset) {
      setConfig(preset);
      setCurrentPreset(presetName);
    }
  }, []);

  const exportVideo = useCallback(async (
    videoElement: HTMLVideoElement,
    metadata: VideoMetadata,
    options: ExportOptions = {
      format: 'mp4',
      quality: 0.9,
      codec: 'h264'
    }
  ): Promise<Blob> => {
    if (!transforms.size) {
      throw new Error('No reframing data available');
    }

    setIsExporting(true);
    setExportProgress(0);

    try {
      let blob: Blob;
      
      // Use SimpleExporter
      if (options.format === 'mp4') {
        options.format = 'webm'; // Force WebM
      }
      
      if (!simpleExporterRef.current) {
        simpleExporterRef.current = new SimpleExporter();
      }
      
      blob = await simpleExporterRef.current.export(
        videoElement,
        transforms,
        metadata,
        config.outputRatio,
        options,
        (progress) => setExportProgress(progress),
        config,
        storedInitialTargetBox
      );

      return blob;
    } finally {
      setIsExporting(false);
      setExportProgress(100);
    }
  }, [transforms, config.outputRatio]);

  const getFrameTransform = useCallback((frameNumber: number): FrameTransform | undefined => {
    const transform = transforms.get(frameNumber);
    return transform;
  }, [transforms]);

  const updateTransform = useCallback((frameNumber: number, transform: FrameTransform) => {
    setTransforms(prev => {
      const newMap = new Map(prev);
      newMap.set(frameNumber, transform);
      return newMap;
    });
  }, []);

  const cancelExport = useCallback(() => {
    // Currently not implemented for FrameAccurateExporter
  }, []);

  const reset = useCallback(() => {
    setTransforms(new Map());
    setIsProcessing(false);
    setIsExporting(false);
    setExportProgress(0);
  }, []);

  return {
    config,
    currentPreset,
    transforms,
    isProcessing,
    isExporting,
    exportProgress,
    processReframing,
    updateConfig,
    applyPreset,
    exportVideo,
    getFrameTransform,
    updateTransform,
    cancelExport,
    reset
  };
}