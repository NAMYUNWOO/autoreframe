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
    targetSelection: 'largest'
  },
  'youtube-short': {
    outputRatio: '9:16',
    trackingMode: 'single',
    smoothness: 0.8,
    padding: 0.2,
    targetSelection: 'centered'
  },
  'instagram-post': {
    outputRatio: '1:1',
    trackingMode: 'single',
    smoothness: 0.9,
    padding: 0.1,
    targetSelection: 'centered'
  },
  'tiktok': {
    outputRatio: '9:16',
    trackingMode: 'single',
    smoothness: 0.75,
    padding: 0.15,
    targetSelection: 'largest'
  },
  'landscape-to-portrait': {
    outputRatio: '9:16',
    trackingMode: 'auto',
    smoothness: 0.8,
    padding: 0.2,
    targetSelection: 'most-confident'
  },
  'portrait-to-landscape': {
    outputRatio: '16:9',
    trackingMode: 'auto',
    smoothness: 0.85,
    padding: 0.25,
    targetSelection: 'centered'
  },
  'zoom-meeting': {
    outputRatio: '16:9',
    trackingMode: 'single',
    smoothness: 0.95,
    padding: 0.3,
    targetSelection: 'largest'
  },
  'presentation': {
    outputRatio: '16:9',
    trackingMode: 'single',
    smoothness: 0.98,
    padding: 0.4,
    targetSelection: 'centered'
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
  
  return {
    width: Math.round(width),
    height: Math.round(height)
  };
}