import { ReframingConfig, AspectRatio } from '@/types';

export const ASPECT_RATIOS: Record<AspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  'custom': 1
};

export const REFRAMING_PRESETS: Record<string, ReframingConfig> = {
  'instagram-reel': {
    outputRatio: '9:16',
    trackingMode: 'single',
    smoothness: 0.85,
    padding: 0.15,
    targetSelection: 'manual'
  },
  'youtube-short': {
    outputRatio: '9:16',
    trackingMode: 'single',
    smoothness: 0.8,
    padding: 0.2,
    targetSelection: 'manual'
  },
  'instagram-post': {
    outputRatio: '1:1',
    trackingMode: 'single',
    smoothness: 0.9,
    padding: 0.1,
    targetSelection: 'manual'
  },
  'tiktok': {
    outputRatio: '9:16',
    trackingMode: 'single',
    smoothness: 0.75,
    padding: 0.15,
    targetSelection: 'manual'
  },
  'landscape-to-portrait': {
    outputRatio: '9:16',
    trackingMode: 'auto',
    smoothness: 0.8,
    padding: 0.2,
    targetSelection: 'manual'
  },
  'portrait-to-landscape': {
    outputRatio: '16:9',
    trackingMode: 'auto',
    smoothness: 0.85,
    padding: 0.25,
    targetSelection: 'manual'
  },
  'zoom-meeting': {
    outputRatio: '16:9',
    trackingMode: 'single',
    smoothness: 0.95,
    padding: 0.3,
    targetSelection: 'manual'
  },
  'presentation': {
    outputRatio: '16:9',
    trackingMode: 'single',
    smoothness: 0.98,
    padding: 0.4,
    targetSelection: 'manual'
  }
};

export function getOutputDimensions(
  inputWidth: number,
  inputHeight: number,
  outputRatio: AspectRatio
): { width: number; height: number } {
  const ratio = ASPECT_RATIOS[outputRatio];
  const inputRatio = inputWidth / inputHeight;
  
  let width: number;
  let height: number;
  
  if (inputRatio > ratio) {
    // Input is wider than output ratio
    height = inputHeight;
    width = height * ratio;
  } else {
    // Input is taller than output ratio
    width = inputWidth;
    height = width / ratio;
  }
  
  // H.264 requires even dimensions
  return {
    width: Math.round(width / 2) * 2,
    height: Math.round(height / 2) * 2
  };
}