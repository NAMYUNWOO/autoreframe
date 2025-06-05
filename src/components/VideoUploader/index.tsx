'use client';

import { useCallback } from 'react';
import { VideoMetadata } from '@/types';

interface VideoUploaderProps {
  onVideoLoad: (file: File) => Promise<VideoMetadata>;
  isDisabled?: boolean;
}

export function VideoUploader({ onVideoLoad, isDisabled = false }: VideoUploaderProps) {
  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      alert('Please select a video file');
      return;
    }

    try {
      await onVideoLoad(file);
    } catch (error) {
      console.error('Failed to load video:', error);
      alert('Failed to load video. Please try another file.');
    }
  }, [onVideoLoad]);

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      alert('Please drop a video file');
      return;
    }

    try {
      await onVideoLoad(file);
    } catch (error) {
      console.error('Failed to load video:', error);
      alert('Failed to load video. Please try another file.');
    }
  }, [onVideoLoad]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return (
    <div
      className="w-full"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <label className={`
        relative flex flex-col items-center justify-center 
        w-full h-80 border-2 border-dashed rounded-2xl 
        cursor-pointer bg-black/30 backdrop-blur-sm
        hover:bg-black/40 border-white/20 hover:border-white/40
        transition-all duration-200
        ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}>
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <div className="w-20 h-20 mb-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p className="mb-2 text-lg text-white font-medium">
            Drop your video here or click to browse
          </p>
          <p className="text-sm text-gray-400">
            MP4, MOV, AVI, or WebM • Max 500MB
          </p>
        </div>
        <input
          type="file"
          accept="video/*"
          onChange={handleFileChange}
          disabled={isDisabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </label>
    </div>
  );
}