'use client';

import { ReframingConfig, TrackedObject } from '@/types';
import { REFRAMING_PRESETS } from '@/lib/reframing/presets';

interface ReframingControlsProps {
  config: ReframingConfig;
  currentPreset: string;
  trackedObjects: TrackedObject[];
  selectedTrackId: string | null;
  onConfigChange: (updates: Partial<ReframingConfig>) => void;
  onPresetChange: (preset: string) => void;
  onTrackSelect: (trackId: string | null) => void;
  onProcess: () => void;
  isProcessing: boolean;
}

export function ReframingControls({
  config,
  currentPreset,
  trackedObjects,
  selectedTrackId,
  onConfigChange,
  onPresetChange,
  onTrackSelect,
  onProcess,
  isProcessing
}: ReframingControlsProps) {
  return (
    <div className="w-full">
      <h2 className="text-xl font-bold text-white mb-4">Reframing Settings</h2>
      
      {/* Preset Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-200 mb-2">Preset</label>
        <select
          value={currentPreset}
          onChange={(e) => onPresetChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-600 rounded-md 
                     bg-gray-700 text-gray-100"
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
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-200 mb-2">Output Ratio</label>
        <div className="grid grid-cols-3 gap-2">
          {['16:9', '9:16', '1:1', '4:3', '3:4'].map(ratio => (
            <button
              key={ratio}
              onClick={() => onConfigChange({ outputRatio: ratio as any })}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors
                ${config.outputRatio === ratio 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              {ratio}
            </button>
          ))}
        </div>
      </div>


      {/* Selected Track Display */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-200 mb-2">Selected Person</label>
        <div className="px-3 py-2 border border-gray-600 rounded-md bg-gray-700 text-gray-100">
          {selectedTrackId && trackedObjects.length > 0 ? (() => {
            const selected = trackedObjects.find(obj => obj.id === selectedTrackId);
            return selected ? `${selected.label} (Track ID: ${selected.id})` : 'No person selected';
          })() : 'No person selected'}
        </div>
        {!selectedTrackId && (
          <p className="mt-1 text-sm text-yellow-400">Please select a person to track before applying reframing</p>
        )}
      </div>

      {/* Smoothness */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-200 mb-2">
          Smoothness: {(config.smoothness * 100).toFixed(0)}%
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={config.smoothness * 100}
          onChange={(e) => onConfigChange({ smoothness: parseFloat(e.target.value) / 100 })}
          className="w-full"
        />
      </div>

      {/* Padding */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-200 mb-2">
          Padding: {(config.padding * 100).toFixed(0)}%
        </label>
        <input
          type="range"
          min="0"
          max="50"
          value={config.padding * 100}
          onChange={(e) => onConfigChange({ padding: parseFloat(e.target.value) / 100 })}
          className="w-full"
        />
      </div>

      {/* Process Button */}
      <button
        onClick={onProcess}
        disabled={isProcessing || !selectedTrackId}
        className="w-full py-3 px-4 bg-green-500 text-white font-medium rounded-md
                   hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed
                   transition-colors"
      >
        {isProcessing ? 'Processing...' : 
         !selectedTrackId ? 'Select a Person First' : 
         'Apply Reframing'}
      </button>
    </div>
  );
}