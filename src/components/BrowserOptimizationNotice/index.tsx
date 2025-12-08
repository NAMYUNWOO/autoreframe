import React from 'react';
import { AlertCircle, Chrome } from 'lucide-react';
import { DeviceDetector } from '@/lib/utils/device';

interface BrowserOptimizationNoticeProps {
  dictionary?: {
    title: string;
    description: string;
    recommendation: string;
  };
}

export const BrowserOptimizationNotice: React.FC<BrowserOptimizationNoticeProps> = ({ dictionary }) => {
  const [dismissed, setDismissed] = React.useState(false);
  
  // Default English text
  const defaultText = {
    title: "Browser Optimization Notice",
    description: "This application is optimized for desktop Chrome browser for the best performance.",
    recommendation: "For optimal video processing experience, we recommend using Google Chrome on desktop."
  };
  
  const text = dictionary || defaultText;
  
  // Check if user is on Chrome desktop
  const device = DeviceDetector.getInstance();
  const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent);
  const isOptimalBrowser = isChrome && device.isDesktop;
  
  if (dismissed || isOptimalBrowser) {
    return null;
  }
  
  return (
    <div className="relative bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2 text-yellow-600 hover:text-yellow-700"
        aria-label="Dismiss notice"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-yellow-800">
            {text.title}
          </h3>
          <p className="mt-1 text-sm text-yellow-700">
            {text.description}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Chrome className="h-5 w-5 text-yellow-600" />
            <p className="text-sm font-medium text-yellow-800">
              {text.recommendation}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};