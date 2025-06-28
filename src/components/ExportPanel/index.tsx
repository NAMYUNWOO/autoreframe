'use client';

import { useState, useEffect } from 'react';
import { ExportOptions } from '@/types';
import { consoleLogger } from '@/lib/utils/console-logger';

interface ExportPanelProps {
  onExport: (options: ExportOptions) => Promise<void>;
  isExporting: boolean;
  exportProgress: number;
  onCancel: () => void;
}

type QualityPreset = 'good' | 'better' | 'best';

interface QualityOption {
  preset: QualityPreset;
  label: string;
  description: string;
  crf: number;
  maxBitrate: number;
}

const qualityOptions: QualityOption[] = [
  {
    preset: 'good',
    label: 'Good',
    description: 'Smaller file · Quick sharing',
    crf: 28,
    maxBitrate: 2000000
  },
  {
    preset: 'better',
    label: 'Better',
    description: 'Balanced · Most uses',
    crf: 23,
    maxBitrate: 5000000
  },
  {
    preset: 'best',
    label: 'Best',
    description: 'Highest quality · Minimal loss',
    crf: 15,  // Lowered from 18 for better quality
    maxBitrate: 20000000  // Increased to 20 Mbps
  }
];

export function ExportPanel({
  onExport,
  isExporting,
  exportProgress,
  onCancel,
  useFFmpegFallback = false
}: ExportPanelProps & { useFFmpegFallback?: boolean }) {
  const [selectedQuality, setSelectedQuality] = useState<QualityPreset>('good');
  const [exportingQuality, setExportingQuality] = useState<QualityPreset | null>(null);

  const handleExport = () => {
    const selectedOption = qualityOptions.find(opt => opt.preset === selectedQuality)!;
    const options: ExportOptions = {
      format: 'mp4',
      quality: selectedOption.crf,
      codec: 'h264',
      bitrate: selectedOption.maxBitrate
    };
    setExportingQuality(selectedQuality);
    onExport(options);
  };


  // Reset exporting quality when export completes
  useEffect(() => {
    if (!isExporting) {
      setExportingQuality(null);
    }
  }, [isExporting]);

  return (
    <div className="w-full">
      <h2 className="text-xl font-bold text-white mb-4">Export Video</h2>
      
      {!isExporting ? (
        <>
          {/* Quality Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-200 mb-3">Quality</label>
            <div className="space-y-2">
              {qualityOptions.map((option) => (
                <label
                  key={option.preset}
                  className={`block cursor-pointer rounded-lg border-2 p-4 transition-all ${
                    selectedQuality === option.preset
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-gray-600 hover:border-gray-500'
                  }`}
                >
                  <input
                    type="radio"
                    name="quality"
                    value={option.preset}
                    checked={selectedQuality === option.preset}
                    onChange={(e) => setSelectedQuality(e.target.value as QualityPreset)}
                    className="sr-only"
                  />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">{option.label}</p>
                      <p className="text-sm text-gray-400">{option.description}</p>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 ${
                      selectedQuality === option.preset
                        ? 'border-blue-500 bg-blue-500'
                        : 'border-gray-400'
                    }`} />
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Export Button */}
          <button
            onClick={handleExport}
            className="w-full py-3 px-4 bg-blue-500 text-white font-medium rounded-md
                       hover:bg-blue-600 transition-colors"
          >
            Export Video
          </button>

          {/* FFmpeg Notice */}
          <div className="mt-3 text-xs text-gray-400">
            <p className="flex items-center">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              High-quality MP4 export using H.264 codec (compatible with all devices)
            </p>
          </div>
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

          {/* Download Console Logs Button during export */}
          <button
            onClick={() => {
              const timestamp = new Date().toISOString().replace(/:/g, '-').slice(0, -5);
              consoleLogger.downloadLogs(`console-logs-export-${timestamp}.txt`);
            }}
            className="w-full mt-2 py-2 px-4 bg-gray-600 text-white text-sm rounded-md
                       hover:bg-gray-700 transition-colors flex items-center justify-center"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
            Download Console Logs
          </button>
        </>
      )}
    </div>
  );
}