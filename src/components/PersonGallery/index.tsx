'use client';

import { useEffect, useRef, useState } from 'react';
import { BoundingBox, Detection } from '@/types';
import { Dictionary } from '@/i18n/dictionaries';

interface PersonThumbnail {
  trackId: string;
  imageData: string;
  box: BoundingBox;
  confidence: number;
}

interface PersonGalleryProps {
  videoElement: HTMLVideoElement | null;
  onPersonSelect: (trackId: string, detection: Detection) => void;
  dict: Dictionary;
}

export default function PersonGallery({ videoElement, onPersonSelect, dict }: PersonGalleryProps) {
  const [thumbnails, setThumbnails] = useState<PersonThumbnail[]>([]);
  const [isDetecting, setIsDetecting] = useState(true);
  const [selectedThumbnail, setSelectedThumbnail] = useState<PersonThumbnail | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    console.log('[PersonGallery] useEffect triggered', {
      hasVideoElement: !!videoElement,
      hasCanvas: !!canvasRef.current,
      videoReadyState: videoElement?.readyState,
      videoWidth: videoElement?.videoWidth,
      videoHeight: videoElement?.videoHeight,
    });

    if (!videoElement || !canvasRef.current) {
      console.warn('[PersonGallery] Missing videoElement or canvas');
      return;
    }

    const detectPeopleInFirstFrame = async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;

        if (canvas.width === 0 || canvas.height === 0) {
          console.error('Video dimensions are 0');
          setIsDetecting(false);
          return;
        }

        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

        console.log('Starting detection on first frame...');

        const { PersonYOLODetector } = await import('@/lib/detection/person-yolo');
        const { ByteTracker } = await import('@/lib/detection/bytetrack-proper/byte-tracker');

        const detector = PersonYOLODetector.getInstance();
        console.log('Detector instance created, initializing model...');

        await detector.initialize();
        console.log('Detector model initialized');

        const tracker = new ByteTracker({
          trackThresh: 0.3,
          trackBuffer: 30,
          matchThresh: 0.8,
          minBoxArea: 100,
          lowThresh: 0.1,
        });

        console.log('About to call detector.detect()...');
        const detections = await detector.detect(canvas, 0);
        console.log(`Detected ${detections.length} people`);

        const trackedDetections = tracker.update(detections, 0);
        console.log(`Tracked ${trackedDetections.length} people`);

        const thumbnailData: PersonThumbnail[] = [];

        for (const detection of trackedDetections) {
          if (!detection.trackId) continue;

          const padding = 20;
          const x = Math.max(0, detection.x - padding);
          const y = Math.max(0, detection.y - padding);
          const width = Math.min(canvas.width - x, detection.width + padding * 2);
          const height = Math.min(canvas.height - y, detection.height + padding * 2);

          const thumbnailCanvas = document.createElement('canvas');
          const maxSize = 400;
          const scale = Math.min(maxSize / width, maxSize / height, 1);

          thumbnailCanvas.width = width * scale;
          thumbnailCanvas.height = height * scale;

          const thumbnailCtx = thumbnailCanvas.getContext('2d');
          if (!thumbnailCtx) continue;

          thumbnailCtx.drawImage(
            canvas,
            x, y, width, height,
            0, 0, thumbnailCanvas.width, thumbnailCanvas.height
          );

          thumbnailData.push({
            trackId: detection.trackId,
            imageData: thumbnailCanvas.toDataURL('image/jpeg', 0.85),
            box: detection,
            confidence: detection.confidence,
          });
        }

        console.log(`Created ${thumbnailData.length} thumbnails`);
        setThumbnails(thumbnailData);
        setIsDetecting(false);
      } catch (error) {
        console.error('Error detecting people:', error);
        if (error instanceof Error) {
          console.error('Error message:', error.message);
          console.error('Error stack:', error.stack);
        }
        setIsDetecting(false);
        alert(`Failed to detect people: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };

    const startDetection = () => {
      if (videoElement.readyState >= 2) {
        detectPeopleInFirstFrame();
      } else {
        const handleLoadedData = () => {
          detectPeopleInFirstFrame();
        };
        videoElement.addEventListener('loadeddata', handleLoadedData, { once: true });
      }
    };

    videoElement.currentTime = 0;

    const handleSeeked = () => {
      startDetection();
    };

    if (videoElement.currentTime === 0 && videoElement.readyState >= 2) {
      detectPeopleInFirstFrame();
    } else {
      videoElement.addEventListener('seeked', handleSeeked, { once: true });
    }

    return () => {
      videoElement.removeEventListener('seeked', handleSeeked);
    };
  }, [videoElement]);

  const handleThumbnailClick = (thumbnail: PersonThumbnail) => {
    setSelectedThumbnail(thumbnail);
  };

  const handleConfirmSelection = () => {
    if (selectedThumbnail) {
      const detection: Detection = {
        frameNumber: 0,
        timestamp: 0,
        boxes: [selectedThumbnail.box],
      };
      onPersonSelect(selectedThumbnail.trackId, detection);
    }
  };

  const handleCancelSelection = () => {
    setSelectedThumbnail(null);
  };

  return (
    <>
      <canvas ref={canvasRef} className="hidden" />

      {isDetecting && (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-lg font-medium text-gray-700">{dict.personGallery.detectingPeople}</p>
        </div>
      )}

      {!isDetecting && thumbnails.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
          <svg
            className="w-24 h-24 text-gray-300 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <p className="text-lg font-medium text-gray-600">{dict.personGallery.noPeopleFound}</p>
        </div>
      )}

      {!isDetecting && thumbnails.length > 0 && (
        <div className="max-w-6xl mx-auto p-4">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">{dict.personGallery.title}</h2>
            <p className="text-gray-600">{dict.personGallery.subtitle}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {thumbnails.map((thumbnail) => (
              <button
                key={thumbnail.trackId}
                onClick={() => handleThumbnailClick(thumbnail)}
                className="group relative aspect-[3/4] overflow-hidden rounded-lg border-2 border-gray-200 hover:border-blue-500 transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <img
                  src={thumbnail.imageData}
                  alt={`${dict.personGallery.person} ${thumbnail.trackId}`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                    <p className="text-sm font-medium">{dict.personGallery.clickToPreview}</p>
                    <p className="text-xs opacity-80">
                      {Math.round(thumbnail.confidence * 100)}% {dict.personGallery.person}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedThumbnail && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={handleCancelSelection}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full p-6 animate-scale-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="aspect-[3/4] mb-6 overflow-hidden rounded-lg">
              <img
                src={selectedThumbnail.imageData}
                alt={`${dict.personGallery.person} ${selectedThumbnail.trackId}`}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCancelSelection}
                className="flex-1 px-6 py-3 text-gray-700 bg-gray-100 rounded-lg font-medium hover:bg-gray-200 transition-colors duration-200"
              >
                {dict.personPreview.cancel}
              </button>
              <button
                onClick={handleConfirmSelection}
                className="flex-[2] px-6 py-3 text-white bg-blue-500 rounded-lg font-medium hover:bg-blue-600 transition-colors duration-200 shadow-lg shadow-blue-500/30"
              >
                {dict.personPreview.selectThisPerson}
              </button>
            </div>

            {thumbnails.length > 1 && (
              <p className="text-center text-sm text-gray-500 mt-4">
                {dict.personPreview.swipeToNavigate}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
