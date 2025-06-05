'use client';

import { ProcessingStatus as Status } from '@/types';

interface ProcessingStatusProps {
  status: Status;
}

export function ProcessingStatus({ status }: ProcessingStatusProps) {
  if (status.stage === 'idle') return null;

  const getStatusColor = () => {
    switch (status.stage) {
      case 'error': return 'bg-red-500';
      case 'complete': return 'bg-green-500';
      default: return 'bg-blue-500';
    }
  };

  const getStatusText = () => {
    switch (status.stage) {
      case 'uploading': return 'Uploading video...';
      case 'analyzing': return 'Analyzing video...';
      case 'reframing': return 'Calculating reframing...';
      case 'exporting': return 'Exporting video...';
      case 'complete': return 'Processing complete!';
      case 'error': return 'Error occurred';
      default: return status.message;
    }
  };

  return (
    <div className="fixed bottom-4 right-4 max-w-md p-4 bg-gray-800 rounded-lg shadow-lg border border-gray-700">
      <div className="flex items-center space-x-3">
        {status.stage !== 'complete' && status.stage !== 'error' && (
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        )}
        
        <div className="flex-1">
          <div className="text-sm font-medium text-white">{getStatusText()}</div>
          {status.message && status.message !== getStatusText() && (
            <div className="text-xs text-gray-400 mt-1">
              {status.message}
            </div>
          )}
          {status.error && (
            <div className="text-xs text-red-400 mt-1">
              {status.error}
            </div>
          )}
        </div>
        
        {status.progress > 0 && status.stage !== 'complete' && (
          <div className="text-sm font-medium text-white">
            {status.progress.toFixed(0)}%
          </div>
        )}
      </div>
      
      {status.progress > 0 && status.stage !== 'complete' && (
        <div className="mt-2 w-full bg-gray-700 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${getStatusColor()}`}
            style={{ width: `${status.progress}%` }}
          />
        </div>
      )}
    </div>
  );
}