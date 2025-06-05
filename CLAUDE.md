# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is a Next.js 15 application with TypeScript that provides video object detection capabilities using YOLOv8 through TensorFlow.js. The entire detection process runs client-side in the browser.

## Commands
```bash
# Development
npm run dev        # Start development server with Turbopack on http://localhost:3000

# Production
npm run build      # Create production build
npm run start      # Start production server

# Code Quality
npm run lint       # Run ESLint for code linting
```

## Architecture
The application uses Next.js App Router and consists of:

- **Main Video Player** (`app/page.tsx`): Client-side component handling video upload, playback, and object detection
- **YOLOv8 Model**: Pre-trained model in `public/yolov8n_web_model/` for detecting 80 COCO classes
- **Real-time Processing**: Processes video frames using TensorFlow.js with WebGL backend
- **Visualization**: Canvas overlay renders bounding boxes with class labels and confidence scores

Key technical decisions:
- All processing happens client-side to avoid server costs and latency
- Uses TensorFlow.js WebGL backend for GPU acceleration
- Stores all detection results in memory for frame-by-frame playback
- Supports standard COCO classes (person, car, bicycle, etc.)

## Development Guidelines
This project follows strict TypeScript and React 19 conventions as specified in .cursorrules:
- Use functional components with TypeScript interfaces
- Prefer named exports
- Use declarative JSX with conditional rendering
- Follow early returns pattern for validation
- Use proper async/await with try-catch blocks