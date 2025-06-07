// Stub for FFmpeg to prevent build errors
export const FFmpeg = class {
  constructor() {
    console.warn('FFmpeg stub loaded - actual FFmpeg will be loaded dynamically');
  }
};

export const fetchFile = () => {
  console.warn('fetchFile stub called');
};

export const toBlobURL = () => {
  console.warn('toBlobURL stub called');
};