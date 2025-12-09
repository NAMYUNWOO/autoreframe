'use client';

import { useState, useCallback, useEffect } from 'react';
import { useVideoProcessor } from '@/hooks/useVideoProcessor';
import { useObjectDetection } from '@/hooks/useObjectDetection';
import { useReframing } from '@/hooks/useReframing';
import { VideoUploader } from '@/components/VideoUploader';
import PersonGallery from '@/components/PersonGallery';
import ResultPlayer from '@/components/ResultPlayer';
import ActionButtons from '@/components/ActionButtons';
import { BrowserOptimizationNotice } from '@/components/BrowserOptimizationNotice';
import { ServiceShowcase } from '@/components/ServiceShowcase';
import { Detection } from '@/types';
import { Dictionary } from '@/i18n/dictionaries';

type ProcessingStep = 'upload' | 'select' | 'processing' | 'result';

interface HomeSimplifiedProps {
  dictionary: Dictionary;
  browserNotice: Dictionary['browserNotice'];
}

export default function HomeSimplified({ dictionary, browserNotice }: HomeSimplifiedProps) {
  const [currentStep, setCurrentStep] = useState<ProcessingStep>('upload');
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [resultVideoBlob, setResultVideoBlob] = useState<Blob | null>(null);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  const {
    videoFile,
    metadata,
    loadVideo,
    processFrames,
    getVideoElement,
    reset: resetVideo,
  } = useVideoProcessor();

  const {
    isModelLoaded,
    modelLoadingProgress,
    isProcessing: isDetecting,
    detections,
    processVideo,
    selectByteTrackId,
    getSelectedTrack,
    reset: resetDetection,
  } = useObjectDetection();

  const {
    processReframing,
    exportVideo,
    isExporting,
    exportProgress,
    reset: resetReframing,
  } = useReframing();

  const handleVideoLoad = useCallback(async (file: File) => {
    resetVideo();
    resetDetection();
    resetReframing();
    setCurrentStep('upload');
    setResultVideoBlob(null);
    setVideoElement(null);
    if (resultVideoUrl) {
      URL.revokeObjectURL(resultVideoUrl);
      setResultVideoUrl(null);
    }

    try {
      const metadata = await loadVideo(file);

      const video = getVideoElement();
      console.log('[HomeSimplified] Video loaded, element:', video);
      setVideoElement(video);

      setCurrentStep('select');
      return metadata;
    } catch (error) {
      if (error instanceof Error) {
        alert(`Failed to load video: ${error.message}`);
      } else {
        alert('Failed to load video. Please try a different file.');
      }
      throw error;
    }
  }, [loadVideo, resetVideo, resetDetection, resetReframing, resultVideoUrl, getVideoElement]);

  const handlePersonSelect = useCallback(async (trackId: string, detection: Detection) => {
    if (!metadata || !videoElement) return;

    setCurrentStep('processing');

    // Helper function to calculate IoU (Intersection over Union)
    const calculateIoU = (box1: { x: number; y: number; width: number; height: number }, box2: { x: number; y: number; width: number; height: number }) => {
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
    };

    try {
      setProcessingStatus(dictionary.autoProcessing.detectingVideo);

      // Store the original selected box from PersonGallery for matching
      const selectedBox = detection.boxes[0];
      console.log('[handlePersonSelect] Selected box from PersonGallery:', selectedBox);

      console.log('[handlePersonSelect] Starting full video detection...');
      const allDetections = await processVideo(processFrames, metadata, 5);
      console.log('[handlePersonSelect] Full video detection complete, detections:', allDetections.length);

      setProcessingStatus(dictionary.autoProcessing.calculatingReframe);

      // Find the matching track by comparing bounding box positions in early frames
      // PersonGallery and full detection use different ByteTrackers, so track IDs won't match
      // Instead, find the track whose first-frame detection best matches the selected box

      let matchedTrackId: string | null = null;
      let bestIoU = 0;

      // Look at first few frames to find the best matching track
      const earlyFrameDetections = allDetections.filter(d => d.frameNumber <= 10);

      for (const frameDetection of earlyFrameDetections) {
        for (const box of frameDetection.boxes) {
          if (!box.trackId) continue;

          const iou = calculateIoU(selectedBox, box);
          if (iou > bestIoU) {
            bestIoU = iou;
            matchedTrackId = box.trackId;
          }
        }
      }

      console.log('[handlePersonSelect] Best matching track:', matchedTrackId, 'with IoU:', bestIoU);

      if (!matchedTrackId || bestIoU < 0.3) {
        throw new Error('Could not find matching person in full video detection');
      }

      // Now use the matched track ID from full detection
      const trackDetections = allDetections.filter(d =>
        d.boxes.some(box => box.trackId === matchedTrackId)
      );

      if (trackDetections.length === 0) {
        throw new Error(`No detections found for matched track ID: ${matchedTrackId}`);
      }

      const positions = new Map();
      trackDetections.forEach(d => {
        const box = d.boxes.find(b => b.trackId === matchedTrackId);
        if (box) {
          positions.set(d.frameNumber, box);
        }
      });

      const trackToUse = {
        id: matchedTrackId,
        firstFrame: trackDetections[0].frameNumber,
        lastFrame: trackDetections[trackDetections.length - 1].frameNumber,
        positions,
        label: 'person',
        selected: true,
      };

      console.log('[handlePersonSelect] Created track from matched detections:', trackToUse.id, 'positions count:', positions.size);

      const initialTargetBox = {
        width: detection.boxes[0].width,
        height: detection.boxes[0].height,
      };

      console.log('[handlePersonSelect] Starting reframing with', allDetections.length, 'detections');
      const frameTransforms = await processReframing(allDetections, trackToUse, metadata, initialTargetBox);
      console.log('[handlePersonSelect] Reframing complete');

      setProcessingStatus(dictionary.autoProcessing.preparingPreview);

      console.log('[handlePersonSelect] Starting export...');
      const blob = await exportVideo(videoElement, metadata, {
        quality: 23,
        codec: 'h264',
        format: 'mp4',
        bitrate: 5_000_000,
      }, frameTransforms);
      console.log('[handlePersonSelect] Export complete, blob size:', blob.size);

      setResultVideoBlob(blob);
      const url = URL.createObjectURL(blob);
      setResultVideoUrl(url);

      setCurrentStep('result');
    } catch (error) {
      console.error('Error during auto-processing:', error);
      console.error('Full error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        type: error instanceof Error ? error.constructor.name : typeof error
      });

      let errorMessage = 'Failed to process video';
      if (error instanceof Error) {
        errorMessage += `: ${error.message}`;

        // Show more context if it's an export error
        if (error.message.includes('Export failed')) {
          errorMessage = error.message; // Already has detailed context
        }
      }

      alert(errorMessage);
      setCurrentStep('select');
    }
  }, [metadata, videoElement, processVideo, processFrames, selectByteTrackId, getSelectedTrack, processReframing, exportVideo, dictionary]);

  const handleSave = useCallback(async (quality: { crf: number; bitrate: number }) => {
    if (!resultVideoBlob || !videoFile) return;

    setIsSaving(true);

    try {
      if (quality.crf !== 23) {
        const videoElement = getVideoElement();
        if (!videoElement || !metadata) {
          throw new Error('Video element or metadata not available');
        }

        const newBlob = await exportVideo(videoElement, metadata, {
          quality: quality.crf,
          codec: 'h264',
          format: 'mp4',
          bitrate: quality.bitrate,
        });

        const url = URL.createObjectURL(newBlob);
        const a = document.createElement('a');
        a.href = url;
        const baseFilename = videoFile.name.replace(/\.[^/.]+$/, '');
        a.download = `reframed_${baseFilename}.mp4`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const url = URL.createObjectURL(resultVideoBlob);
        const a = document.createElement('a');
        a.href = url;
        const baseFilename = videoFile.name.replace(/\.[^/.]+$/, '');
        a.download = `reframed_${baseFilename}.mp4`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save video. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [resultVideoBlob, videoFile, getVideoElement, metadata, exportVideo]);

  const handleShare = useCallback(async () => {
    if (!resultVideoBlob || !videoFile) return;

    try {
      const file = new File([resultVideoBlob], `reframed_${videoFile.name}`, {
        type: 'video/mp4',
      });

      if (navigator.share) {
        await navigator.share({
          files: [file],
          title: 'Reframed Video',
          text: 'Check out my reframed video!',
        });
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Share failed:', error);
      }
    }
  }, [resultVideoBlob, videoFile]);

  const handleSelectAnother = useCallback(() => {
    setCurrentStep('select');
    setResultVideoBlob(null);
    if (resultVideoUrl) {
      URL.revokeObjectURL(resultVideoUrl);
      setResultVideoUrl(null);
    }
  }, [resultVideoUrl]);

  const handleReset = useCallback(() => {
    resetVideo();
    resetDetection();
    resetReframing();
    setCurrentStep('upload');
    setResultVideoBlob(null);
    if (resultVideoUrl) {
      URL.revokeObjectURL(resultVideoUrl);
      setResultVideoUrl(null);
    }
  }, [resetVideo, resetDetection, resetReframing, resultVideoUrl]);

  useEffect(() => {
    return () => {
      if (resultVideoUrl) {
        URL.revokeObjectURL(resultVideoUrl);
      }
    };
  }, [resultVideoUrl]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800">
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
                <p className="text-sm text-gray-400">AI-powered person tracking</p>
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

      <main className="container mx-auto px-4 py-8">
        {currentStep === 'upload' && (
          <div className="max-w-2xl mx-auto">
            <BrowserOptimizationNotice dictionary={browserNotice} />
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-white mb-4">
                {dictionary.home.title}
              </h1>
              <p className="text-gray-400">
                {dictionary.home.subtitle}
              </p>
            </div>

            <VideoUploader
              onVideoLoad={handleVideoLoad}
              isDisabled={!isModelLoaded}
            />

            {!isModelLoaded && (
              <div className="mt-6">
                <div className="bg-black/30 backdrop-blur-sm rounded-xl p-6 border border-white/10 max-w-md mx-auto">
                  <div className="text-center mb-4">
                    <div className="inline-flex items-center space-x-2 text-blue-400 mb-2">
                      <svg className="animate-pulse h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span className="font-semibold">{dictionary.home.aiEngineLoading}</span>
                    </div>
                    <p className="text-sm text-gray-400">{dictionary.home.pleaseWait}</p>
                  </div>

                  <div className="space-y-2">
                    <div className="w-full bg-gray-700/50 rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-purple-600 h-full rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${modelLoadingProgress}%` }}
                      >
                        <div className="h-full w-full opacity-30 bg-gradient-to-r from-transparent via-white to-transparent animate-pulse"></div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-gray-500">
                        {dictionary.home.firstVisitDownload}
                      </p>
                      <span className="text-xs text-blue-400 font-mono">{modelLoadingProgress}%</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <ServiceShowcase className="mt-16" />
          </div>
        )}

        {currentStep === 'select' && (
          <PersonGallery
            videoElement={videoElement}
            onPersonSelect={handlePersonSelect}
            dict={dictionary}
          />
        )}

        {currentStep === 'processing' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-black/30 backdrop-blur-sm rounded-xl p-12 border border-white/10 text-center">
              <div className="w-20 h-20 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
              <h2 className="text-2xl font-bold text-white mb-2">{processingStatus}</h2>
              <p className="text-gray-400">{dictionary.autoProcessing.almostDone}</p>
              {isDetecting && (
                <div className="mt-4 text-sm text-gray-500">
                  Analyzing {metadata?.totalFrames} frames...
                </div>
              )}
              {isExporting && (
                <div className="mt-4">
                  <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${exportProgress}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">{exportProgress}%</p>
                </div>
              )}
            </div>
          </div>
        )}

        {currentStep === 'result' && resultVideoUrl && (
          <div className="max-w-2xl mx-auto pb-32">
            <ResultPlayer videoUrl={resultVideoUrl} autoPlay={true} />

            <ActionButtons
              videoBlob={resultVideoBlob}
              onSave={handleSave}
              onShare={handleShare}
              onSelectAnother={handleSelectAnother}
              dict={dictionary}
              isSaving={isSaving}
            />
          </div>
        )}
      </main>
    </div>
  );
}
