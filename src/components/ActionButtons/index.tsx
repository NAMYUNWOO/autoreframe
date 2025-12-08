'use client';

import { useState } from 'react';
import { Dictionary } from '@/i18n/dictionaries';

interface QualityPreset {
  name: string;
  crf: number;
  bitrate: number;
}

const QUALITY_PRESETS: Record<string, QualityPreset> = {
  good: { name: 'good', crf: 28, bitrate: 2_000_000 },
  better: { name: 'better', crf: 23, bitrate: 5_000_000 },
  best: { name: 'best', crf: 15, bitrate: 20_000_000 },
};

interface ActionButtonsProps {
  videoBlob: Blob | null;
  onSave: (quality: QualityPreset) => Promise<void>;
  onShare: () => Promise<void>;
  onSelectAnother: () => void;
  dict: Dictionary;
  isSaving?: boolean;
}

export default function ActionButtons({
  videoBlob,
  onSave,
  onShare,
  onSelectAnother,
  dict,
  isSaving = false,
}: ActionButtonsProps) {
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const canShare = typeof navigator !== 'undefined' && !!navigator.share;

  const handleSaveClick = () => {
    setShowQualityModal(true);
  };

  const handleQualitySelect = async (quality: QualityPreset) => {
    setShowQualityModal(false);
    await onSave(quality);
  };

  const handleShareClick = async () => {
    if (!canShare || !videoBlob) return;

    setIsSharing(true);
    try {
      await onShare();
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 safe-area-bottom z-40">
        <div className="max-w-2xl mx-auto flex flex-col gap-3">
          <div className="flex gap-3">
            <button
              onClick={handleSaveClick}
              disabled={isSaving || !videoBlob}
              className="flex-[2] flex items-center justify-center gap-2 px-6 py-4 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors duration-200 shadow-lg"
            >
              {isSaving ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>{dict.result.processing}</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                    />
                  </svg>
                  <span>{dict.result.save}</span>
                </>
              )}
            </button>

            {canShare && (
              <button
                onClick={handleShareClick}
                disabled={isSharing || !videoBlob}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-4 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors duration-200 shadow-lg"
              >
                {isSharing ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                      />
                    </svg>
                    <span className="hidden sm:inline">{dict.result.share}</span>
                  </>
                )}
              </button>
            )}
          </div>

          <button
            onClick={onSelectAnother}
            className="w-full px-6 py-3 text-gray-700 bg-gray-100 rounded-lg font-medium hover:bg-gray-200 transition-colors duration-200"
          >
            {dict.result.selectAnother}
          </button>
        </div>
      </div>

      {showQualityModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setShowQualityModal(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full p-6 animate-scale-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-gray-800 mb-4">{dict.result.selectQuality}</h3>

            <div className="space-y-3">
              <button
                onClick={() => handleQualitySelect(QUALITY_PRESETS.good)}
                className="w-full p-4 text-left border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors duration-200"
              >
                <div className="font-semibold text-gray-800">{dict.result.qualityGood}</div>
                <div className="text-sm text-gray-600 mt-1">~2 MB/min, CRF 28</div>
              </button>

              <button
                onClick={() => handleQualitySelect(QUALITY_PRESETS.better)}
                className="w-full p-4 text-left border-2 border-blue-500 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors duration-200"
              >
                <div className="flex items-center gap-2">
                  <div className="font-semibold text-gray-800">{dict.result.qualityBetter}</div>
                  <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded-full">
                    {dict.result.qualityBetter.split(' ')[1]}
                  </span>
                </div>
                <div className="text-sm text-gray-600 mt-1">~5 MB/min, CRF 23</div>
              </button>

              <button
                onClick={() => handleQualitySelect(QUALITY_PRESETS.best)}
                className="w-full p-4 text-left border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors duration-200"
              >
                <div className="font-semibold text-gray-800">{dict.result.qualityBest}</div>
                <div className="text-sm text-gray-600 mt-1">~20 MB/min, CRF 15</div>
              </button>
            </div>

            <button
              onClick={() => setShowQualityModal(false)}
              className="w-full mt-4 px-6 py-3 text-gray-700 bg-gray-100 rounded-lg font-medium hover:bg-gray-200 transition-colors duration-200"
            >
              {dict.personPreview.cancel}
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .safe-area-bottom {
          padding-bottom: max(1rem, env(safe-area-inset-bottom));
        }
      `}</style>
    </>
  );
}
