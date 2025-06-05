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

      {/* Tracking Mode */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-200 mb-2">Tracking Mode</label>
        <div className="grid grid-cols-3 gap-2">
          {(['single', 'multi', 'auto'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => onConfigChange({ trackingMode: mode })}
              className={`px-3 py-2 rounded-md text-sm font-medium capitalize transition-colors
                ${config.trackingMode === mode 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Target Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-200 mb-2">Target Selection</label>
        <select
          value={config.targetSelection}
          onChange={(e) => onConfigChange({ targetSelection: e.target.value as any })}
          className="w-full px-3 py-2 border border-gray-600 rounded-md 
                     bg-gray-700 text-gray-100"
        >
          <option value="largest">Largest Object</option>
          <option value="centered">Most Centered</option>
          <option value="most-confident">Most Confident</option>
          <option value="manual">Manual Selection</option>
        </select>
      </div>

      {/* Manual Track Selection */}
      {config.targetSelection === 'manual' && trackedObjects.length > 0 && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-200 mb-2">Select Track</label>
          <select
            value={selectedTrackId || ''}
            onChange={(e) => onTrackSelect(e.target.value || null)}
            className="w-full px-3 py-2 border border-gray-600 rounded-md 
                       bg-gray-700 text-gray-100"
          >
            <option value="">None</option>
            {trackedObjects.map(obj => (
              <option key={obj.id} value={obj.id}>
                {obj.label} (Track {obj.id.split('_')[1]})
              </option>
            ))}
          </select>
        </div>
      )}

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
        disabled={isProcessing}
        className="w-full py-3 px-4 bg-green-500 text-white font-medium rounded-md
                   hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed
                   transition-colors"
      >
        {isProcessing ? 'Processing...' : 'Apply Reframing'}
      </button>
    </div>
  );
}