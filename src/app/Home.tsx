'use client';

import { useState, useCallback } from 'react';
import { useVideoProcessor } from '@/hooks/useVideoProcessor';
import { useObjectDetection } from '@/hooks/useObjectDetection';
import { useReframing } from '@/hooks/useReframing';
import { VideoUploader } from '@/components/VideoUploader';
import { VideoPlayer } from '@/components/VideoPlayer';
import { ReframingControls } from '@/components/ReframingControls';
import { DetectionOverlay } from '@/components/DetectionOverlay';
import { ExportPanel } from '@/components/ExportPanel';
import { ProcessingStatus } from '@/components/ProcessingStatus';
import { HeadSelector } from '@/components/HeadSelector';
import { TrajectoryEditor } from '@/components/TrajectoryEditor';
import { ExportOptions, BoundingBox, FrameTransform } from '@/types';

export default function Home() {
  const [currentStep, setCurrentStep] = useState<'upload' | 'process' | 'export'>('upload');
  const [showDetections, setShowDetections] = useState(true);
  const [showReframing, setShowReframing] = useState(true);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.2);
  const [detectionComplete, setDetectionComplete] = useState(false);
  const [showHeadSelector, setShowHeadSelector] = useState(false);
  const [showTrajectoryEditor, setShowTrajectoryEditor] = useState(false);

  const {
    videoFile,
    metadata,
    status: videoStatus,
    loadVideo,
    processFrames,
    getVideoElement,
    reset: resetVideo
  } = useVideoProcessor();

  const {
    isModelLoaded,
    isProcessing: isDetecting,
    detections,
    trackedObjects,
    selectedTrackId,
    targetDetection,
    processVideo,
    selectTrack,
    getSelectedTrack,
    setConfidenceThreshold: updateConfidenceThreshold,
    setTargetHead,
    reset: resetDetection
  } = useObjectDetection();

  const {
    config,
    currentPreset,
    transforms,
    isProcessing: isReframingProcessing,
    isExporting,
    exportProgress,
    processReframing,
    updateConfig,
    applyPreset,
    exportVideo,
    getFrameTransform,
    updateTransform,
    cancelExport,
    reset: resetReframing
  } = useReframing();


  const handleVideoLoad = useCallback(async (file: File) => {
    resetVideo();
    resetDetection();
    resetReframing();
    setDetectionComplete(false);
    setShowHeadSelector(false);
    
    try {
      const metadata = await loadVideo(file);
      setCurrentStep('process');
      setShowHeadSelector(true); // Show head selector after video loads
      return metadata;
    } catch (error) {
      console.error('Error loading video:', error);
      throw error;
    }
  }, [loadVideo, resetVideo, resetDetection, resetReframing]);

  const handleDetection = useCallback(async () => {
    if (!metadata) return;
    
    try {
      await processVideo(processFrames, metadata);
      setDetectionComplete(true);
    } catch (error) {
      console.error('Error during detection:', error);
    }
  }, [processVideo, processFrames, metadata]);

  const handleReframing = useCallback(async () => {
    if (!metadata || !detections.length) return;
    
    // If we have a target detection, ensure manual selection mode
    if (targetDetection) {
      updateConfig({ targetSelection: 'manual' });
    }
    
    const selectedTrack = getSelectedTrack();
    await processReframing(detections, selectedTrack, metadata);
    setShowTrajectoryEditor(true);
  }, [metadata, detections, getSelectedTrack, processReframing, targetDetection, updateConfig]);

  const handleTrajectoryConfirm = useCallback(() => {
    setShowTrajectoryEditor(false);
    setCurrentStep('export');
  }, []);

  const handleExport = useCallback(async (options: ExportOptions) => {
    const videoElement = getVideoElement();
    if (!videoElement || !metadata) return;
    
    console.log('Starting export with options:', options);
    console.log('Video metadata:', metadata);
    console.log('Transforms available:', transforms.size);
    
    try {
      let blob = await exportVideo(videoElement, metadata, options);
      
      console.log('Export completed, blob size:', blob.size);
      
      // Download the file
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const extension = options.format === 'mp4' ? 'mp4' : 'webm';
      a.download = `reframed_${videoFile?.name || 'video'}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert(`Failed to export video: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [getVideoElement, metadata, exportVideo, videoFile, transforms]);

  const handleConfidenceChange = useCallback((threshold: number) => {
    setConfidenceThreshold(threshold);
    updateConfidenceThreshold(threshold);
  }, [updateConfidenceThreshold]);

  const handleHeadSelect = useCallback((box: BoundingBox) => {
    // Create a Detection object with the selected box
    const detection = {
      frameNumber: 0,
      timestamp: 0,
      boxes: [box]
    };
    setTargetHead(detection);
  }, [setTargetHead]);

  const handleHeadSelectorConfirm = useCallback(() => {
    setShowHeadSelector(false);
    handleDetection();
  }, [handleDetection]);


  const handleReset = useCallback(() => {
    resetVideo();
    resetDetection();
    resetReframing();
    setCurrentStep('upload');
    setDetectionComplete(false);
    setShowHeadSelector(false);
    setShowTrajectoryEditor(false);
  }, [resetVideo, resetDetection, resetReframing]);


  // Get current frame transform for video player
  const currentTransform = metadata && getVideoElement() 
    ? getFrameTransform(Math.floor(getVideoElement()!.currentTime * metadata.fps))
    : undefined;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800">
      {/* Header */}
      <header className="bg-black/30 backdrop-blur-sm border-b border-white/10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">AutoReframer</h1>
                <p className="text-sm text-gray-400">AI-powered person detection & reframing</p>
              </div>
            </div>
            
            {currentStep !== 'upload' && (
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
              >
                New Video
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Progress Steps */}
      {currentStep !== 'upload' && (
        <div className="bg-black/20 backdrop-blur-sm border-b border-white/10">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-center space-x-8">
              <div className={`flex items-center space-x-2 ${currentStep === 'process' ? 'text-blue-400' : 'text-gray-500'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep === 'process' ? 'bg-blue-500' : 'bg-gray-700'}`}>
                  <span className="text-white text-sm font-bold">1</span>
                </div>
                <span className="text-sm font-medium">Process</span>
              </div>
              
              <div className="w-16 h-0.5 bg-gray-700" />
              
              <div className={`flex items-center space-x-2 ${currentStep === 'export' ? 'text-blue-400' : 'text-gray-500'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep === 'export' ? 'bg-blue-500' : 'bg-gray-700'}`}>
                  <span className="text-white text-sm font-bold">2</span>
                </div>
                <span className="text-sm font-medium">Export</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {currentStep === 'upload' && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-white mb-4">
                Upload Your Video
              </h2>
              <p className="text-gray-400">
                Automatically detect and track persons to create perfectly framed videos
              </p>
            </div>
            
            <VideoUploader 
              onVideoLoad={handleVideoLoad}
              isDisabled={!isModelLoaded}
            />
            
            {!isModelLoaded && (
              <div className="mt-4 text-center">
                <div className="inline-flex items-center space-x-2 text-yellow-400">
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Loading person detection model...</span>
                </div>
              </div>
            )}
          </div>
        )}

        {currentStep === 'process' && metadata && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Video Preview */}
            <div className="lg:col-span-2">
              <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
                <VideoPlayer
                  videoElement={getVideoElement()}
                  metadata={metadata}
                  detections={detections}
                  currentTransform={currentTransform}
                  showDetections={showDetections}
                  showReframing={showReframing && detectionComplete}
                  outputRatio={config.outputRatio}
                />
              </div>
            </div>

            {/* Controls */}
            <div className="space-y-4">
              {/* Head Selector */}
              {showHeadSelector && (
                <HeadSelector
                  videoElement={getVideoElement()}
                  onSelectHead={handleHeadSelect}
                  onConfirm={handleHeadSelectorConfirm}
                />
              )}

              {/* Object Detection */}
              {!detectionComplete && !showHeadSelector && (
                <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
                  <h3 className="text-lg font-semibold text-white mb-4">Person Detection</h3>
                  <button
                    onClick={handleDetection}
                    disabled={isDetecting || !isModelLoaded}
                    className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium rounded-lg
                               hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed
                               transition-all transform hover:scale-[1.02]"
                  >
                    {isDetecting ? (
                      <span className="flex items-center justify-center space-x-2">
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Detecting Persons...</span>
                      </span>
                    ) : 'Start Person Detection'}
                  </button>
                </div>
              )}

              {/* Detection Settings */}
              <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
                <DetectionOverlay
                  trackedObjects={trackedObjects}
                  selectedTrackId={selectedTrackId}
                  showDetections={showDetections}
                  showReframing={showReframing}
                  onToggleDetections={() => setShowDetections(!showDetections)}
                  onToggleReframing={() => setShowReframing(!showReframing)}
                  confidenceThreshold={confidenceThreshold}
                  onConfidenceChange={handleConfidenceChange}
                />
                {targetDetection && (
                  <div className="mt-4 text-sm text-blue-400">
                    <span className="flex items-center space-x-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Tracking selected person</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Reframing Controls */}
              {detectionComplete && !showTrajectoryEditor && (
                <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
                  <ReframingControls
                    config={config}
                    currentPreset={currentPreset}
                    trackedObjects={trackedObjects}
                    selectedTrackId={selectedTrackId}
                    onConfigChange={updateConfig}
                    onPresetChange={applyPreset}
                    onTrackSelect={selectTrack}
                    onProcess={handleReframing}
                    isProcessing={isReframingProcessing}
                  />
                </div>
              )}

              {/* Trajectory Editor */}
              {showTrajectoryEditor && metadata && (
                <TrajectoryEditor
                  videoElement={getVideoElement()}
                  transforms={transforms}
                  metadata={metadata}
                  outputRatio={config.outputRatio}
                  onUpdateTransform={updateTransform}
                  onConfirm={handleTrajectoryConfirm}
                />
              )}
            </div>
          </div>
        )}

        {currentStep === 'export' && metadata && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
              <VideoPlayer
                videoElement={getVideoElement()}
                metadata={metadata}
                detections={detections}
                currentTransform={currentTransform}
                showDetections={false}
                showReframing={true}
                outputRatio={config.outputRatio}
              />
            </div>
            
            <div className="mt-6">
              {/* Export Panel */}
              <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10">
                <ExportPanel
                  onExport={handleExport}
                  isExporting={isExporting}
                  exportProgress={exportProgress}
                  onCancel={cancelExport}
                />
                {isExporting && (
                  <div className="mt-4 text-sm text-gray-400">
                    <p>Processing video with FFmpeg...</p>
                    <p>This may take a few moments depending on video length.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Processing Status */}
      <ProcessingStatus status={videoStatus} />
    </div>
  );
}