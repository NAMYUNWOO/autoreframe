'use client';

import { useState, useEffect, useRef } from 'react';
import { VideoMetadata } from '@/types';

interface VideoTrimmerProps {
  videoElement: HTMLVideoElement | null;
  metadata: VideoMetadata | null;
  onTrimChange: (start: number, end: number) => void;
}

export function VideoTrimmer({ videoElement, metadata, onTrimChange }: VideoTrimmerProps) {
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (metadata) {
      setEndTime(metadata.duration);
      onTrimChange(0, metadata.duration);
    }
  }, [metadata, onTrimChange]);

  useEffect(() => {
    if (videoElement) {
      const updateTime = () => {
        setCurrentTime(videoElement.currentTime);
      };

      videoElement.addEventListener('timeupdate', updateTime);
      videoElement.addEventListener('play', () => setIsPlaying(true));
      videoElement.addEventListener('pause', () => setIsPlaying(false));
      videoElement.addEventListener('ended', () => setIsPlaying(false));

      return () => {
        videoElement.removeEventListener('timeupdate', updateTime);
        videoElement.removeEventListener('play', () => setIsPlaying(true));
        videoElement.removeEventListener('pause', () => setIsPlaying(false));
        videoElement.removeEventListener('ended', () => setIsPlaying(false));
      };
    }
  }, [videoElement]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStartChange = (value: number) => {
    const newStart = Math.min(value, endTime - 1);
    setStartTime(newStart);
    if (videoElement) {
      videoElement.currentTime = newStart;
    }
    onTrimChange(newStart, endTime);
  };

  const handleEndChange = (value: number) => {
    const newEnd = Math.max(value, startTime + 1);
    setEndTime(newEnd);
    onTrimChange(startTime, newEnd);
  };

  const playPreview = () => {
    if (!videoElement || !metadata) return;

    if (isPlaying) {
      videoElement.pause();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    } else {
      videoElement.currentTime = startTime;
      videoElement.play();
      
      // Stop at end time
      intervalRef.current = setInterval(() => {
        if (videoElement.currentTime >= endTime) {
          videoElement.pause();
          videoElement.currentTime = startTime;
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
          }
        }
      }, 100);
    }
  };

  if (!metadata) return null;

  const trimDuration = endTime - startTime;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Trim Video</h3>
      
      {/* Timeline */}
      <div className="relative bg-gray-700 rounded-lg p-4">
        <div className="relative h-12 bg-gray-800 rounded">
          {/* Current time indicator */}
          <div 
            className="absolute top-0 bottom-0 w-0.5 bg-blue-500 z-20"
            style={{ left: `${(currentTime / metadata.duration) * 100}%` }}
          />
          
          {/* Trim range */}
          <div 
            className="absolute top-0 bottom-0 bg-blue-500/20 border-2 border-blue-500"
            style={{ 
              left: `${(startTime / metadata.duration) * 100}%`,
              width: `${((endTime - startTime) / metadata.duration) * 100}%`
            }}
          />
        </div>
      </div>

      {/* Start Time */}
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-2">
          Start Time: {formatTime(startTime)}
        </label>
        <input
          type="range"
          min="0"
          max={metadata.duration}
          step="0.1"
          value={startTime}
          onChange={(e) => handleStartChange(parseFloat(e.target.value))}
          className="w-full"
        />
      </div>

      {/* End Time */}
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-2">
          End Time: {formatTime(endTime)}
        </label>
        <input
          type="range"
          min="0"
          max={metadata.duration}
          step="0.1"
          value={endTime}
          onChange={(e) => handleEndChange(parseFloat(e.target.value))}
          className="w-full"
        />
      </div>

      {/* Info */}
      <div className="text-sm text-gray-400">
        Duration: {formatTime(trimDuration)} / {formatTime(metadata.duration)}
      </div>

      {/* Preview Button */}
      <button
        onClick={playPreview}
        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors"
      >
        {isPlaying ? 'Stop Preview' : 'Preview Trim'}
      </button>
    </div>
  );
}