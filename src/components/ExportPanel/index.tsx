'use client';

import { useState } from 'react';
import { ExportOptions } from '@/types';

interface ExportPanelProps {
  onExport: (options: ExportOptions) => Promise<void>;
  isExporting: boolean;
  exportProgress: number;
  onCancel: () => void;
}

export function ExportPanel({
  onExport,
  isExporting,
  exportProgress,
  onCancel,
  useFFmpegFallback = false
}: ExportPanelProps & { useFFmpegFallback?: boolean }) {
  const [options, setOptions] = useState<ExportOptions>({
    format: 'mov',
    quality: 0.9,
    codec: 'h264',
    bitrate: 8000000
  });

  const handleExport = () => {
    onExport(options);
  };

  return (
    <div className="w-full">
      <h2 className="text-xl font-bold text-white mb-4">Export Video</h2>
      
      {!isExporting ? (
        <>
          {/* Format Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-200 mb-2">Format</label>
            <select
              value={options.format}
              onChange={(e) => setOptions({ ...options, format: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-600 rounded-md 
                         bg-gray-700 text-gray-100"
            >
              <option value="mov">MOV (QuickTime)</option>
              <option value="mp4">MP4 (H.264)</option>
              <option value="webm">WebM (VP8)</option>
            </select>
          </div>

          {/* Quality Slider */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-200 mb-2">
              Quality: {(options.quality * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min="50"
              max="100"
              value={options.quality * 100}
              onChange={(e) => setOptions({ ...options, quality: parseFloat(e.target.value) / 100 })}
              className="w-full"
            />
          </div>

          {/* Bitrate */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-200 mb-2">Bitrate</label>
            <select
              value={options.bitrate}
              onChange={(e) => setOptions({ ...options, bitrate: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-600 rounded-md 
                         bg-gray-700 text-gray-100"
            >
              <option value="4000000">4 Mbps (Low)</option>
              <option value="8000000">8 Mbps (Medium)</option>
              <option value="12000000">12 Mbps (High)</option>
              <option value="16000000">16 Mbps (Very High)</option>
            </select>
          </div>

          {/* Export Button */}
          <button
            onClick={handleExport}
            className="w-full py-3 px-4 bg-blue-500 text-white font-medium rounded-md
                       hover:bg-blue-600 transition-colors"
          >
            Export Video
          </button>

          {/* FFmpeg Notice for MOV/MP4 */}
          {(options.format === 'mov' || options.format === 'mp4') && (
            <div className="mt-3 text-xs text-gray-400">
              <p className="flex items-center">
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                High-quality export using FFmpeg (H.264 codec)
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Export Progress */}
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-200">Exporting...</span>
              <span className="text-gray-200">{exportProgress.toFixed(0)}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3">
              <div
                className="bg-blue-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
          </div>

          {/* Cancel Button */}
          <button
            onClick={onCancel}
            className="w-full py-3 px-4 bg-red-500 text-white font-medium rounded-md
                       hover:bg-red-600 transition-colors"
          >
            Cancel Export
          </button>
        </>
      )}
    </div>
  );
}