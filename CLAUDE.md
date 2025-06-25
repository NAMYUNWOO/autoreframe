# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
AutoReframer is a Next.js 15 client-side application for automatic video reframing using AI-powered person detection and tracking. All processing happens in the browser using TensorFlow.js.

## Commands
```bash
# Development
npm run dev        # Start development server on http://localhost:3000

# Production
npm run build      # Create production build
npm run start      # Start production server

# Code Quality
npm run lint       # Run ESLint for code linting
```

## Architecture

### Application Flow
1. **Upload**: User uploads video file (`src/components/VideoUploader/`)
2. **Head Selection**: Select person's head to track (`src/components/HeadSelector/`)
3. **Detection**: YOLOv8n processes all frames (`src/lib/detection/`)
4. **Tracking**: ByteTrack algorithm tracks selected person (`src/lib/detection/byteTracker.ts`)
5. **Reframing**: Compute smooth camera movements (`src/lib/reframing/`)
6. **Trajectory Editing**: Manual keyframe adjustments (`src/components/TrajectoryEditor/`)
7. **Export**: FFmpeg processes final video (`src/lib/video/ffmpegExporter.ts`)

### Key Components
- **Hooks**: Core logic in `useVideoProcessor`, `useObjectDetection`, `useReframing`
- **Detection**: YOLOv12n model (`public/yolov12n_web_model/`) detects 80 COCO classes
- **Tracking**: ByteTrack provides consistent object IDs across frames
- **Reframing**: Bezier curve interpolation for smooth camera movements
- **Export**: FFmpeg.js handles video encoding with multiple format options

### Technical Decisions
- All processing client-side (no server costs/latency)
- TensorFlow.js WebGL backend for GPU acceleration
- Store all detections in memory for real-time playback
- Support multiple aspect ratios (16:9, 9:16, 1:1, 4:5, 21:9)
- Frame transforms use Bezier curves for smooth motion

## Development Guidelines
Project follows .cursorrules conventions:
- TypeScript with strict mode
- Functional components with interfaces (not types)
- Named exports preferred
- Early returns for validation
- Proper error boundaries with try-catch
- No comments unless explicitly requested
- Descriptive variable names with auxiliary verbs (isLoading, hasError)
- Event handlers prefixed with "handle" (handleClick)