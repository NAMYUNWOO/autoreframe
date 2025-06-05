'use client';

import { TrackedObject } from '@/types';

interface DetectionOverlayProps {
  trackedObjects: TrackedObject[];
  selectedTrackId: string | null;
  showDetections: boolean;
  showReframing: boolean;
  onToggleDetections: () => void;
  onToggleReframing: () => void;
  confidenceThreshold: number;
  onConfidenceChange: (threshold: number) => void;
}

export function DetectionOverlay({
  trackedObjects,
  selectedTrackId,
  showDetections,
  showReframing,
  onToggleDetections,
  onToggleReframing,
  confidenceThreshold,
  onConfidenceChange
}: DetectionOverlayProps) {
  return (
    <div className="w-full max-w-md mx-auto p-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
      <h3 className="text-lg font-semibold mb-4">Detection Settings</h3>
      
      {/* Toggle Overlays */}
      <div className="space-y-3 mb-4">
        <label className="flex items-center justify-between">
          <span className="text-sm font-medium">Show Detections</span>
          <input
            type="checkbox"
            checked={showDetections}
            onChange={onToggleDetections}
            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
          />
        </label>
        
        <label className="flex items-center justify-between">
          <span className="text-sm font-medium">Show Reframing</span>
          <input
            type="checkbox"
            checked={showReframing}
            onChange={onToggleReframing}
            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
          />
        </label>
      </div>

      {/* Confidence Threshold */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">
          Confidence Threshold: {(confidenceThreshold * 100).toFixed(0)}%
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={confidenceThreshold * 100}
          onChange={(e) => onConfidenceChange(parseFloat(e.target.value) / 100)}
          className="w-full"
        />
      </div>

      {/* Tracked Objects Summary */}
      {trackedObjects.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold mb-2">Tracked Objects</h4>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {trackedObjects.map(obj => {
              const frameCount = obj.lastFrame - obj.firstFrame + 1;
              const isSelected = obj.id === selectedTrackId;
              
              return (
                <div
                  key={obj.id}
                  className={`p-2 rounded text-sm ${
                    isSelected 
                      ? 'bg-blue-100 dark:bg-blue-900 border border-blue-500' 
                      : 'bg-gray-100 dark:bg-gray-700'
                  }`}
                >
                  <div className="font-medium">{obj.label}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Track {obj.id.split('_')[1]} • {frameCount} frames
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}