# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
AutoReframer is a Next.js 15 client-side application for automatic video reframing using AI-powered person detection and tracking. All processing happens in the browser using TensorFlow.js. The app supports 7 languages (English, Korean, Japanese, Chinese, Indonesian, Hindi, Spanish) with automatic locale detection.

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

### Internationalization (i18n)
- **Middleware**: Auto-detects user locale from Accept-Language header (`src/middleware.ts`)
- **Routing**: All routes prefixed with locale (`/[locale]/page.tsx`)
- **Supported Locales**: en, ko, ja, zh, id, hi, es
- **Configuration**: `src/i18n/config.ts` and `src/i18n/dictionaries.ts`
- **Default**: English (en) if locale not detected

### Application Flow
1. **Upload**: User uploads video file (`src/components/VideoUploader/`)
2. **Head Selection**: Select person's head to track (`src/components/HeadSelector/`)
3. **Detection**: YOLOv12n processes all frames (`src/lib/detection/`)
4. **Tracking**: ByteTrack or BoT-SORT algorithm tracks selected person
   - ByteTrack: `src/lib/detection/bytetrack-proper/byte-tracker.ts`
   - BoT-SORT: `src/lib/detection/botsort/bot-sort.ts`
5. **Reframing**: Compute smooth camera movements (`src/lib/reframing/`)
6. **Trajectory Editing**: Manual keyframe adjustments (`src/components/TrajectoryEditor/`)
7. **Export**: WebCodecs API processes final video (`src/lib/video/webcodecs-exporter.ts`)

### Key Components
- **Hooks**: Core logic in `useVideoProcessor`, `useObjectDetection`, `useReframing`
- **Detection**: YOLOv12n model (`public/yolov12n_web_model/`) detects 80 COCO classes
- **Tracking**: Two algorithms available (configurable in `src/config/detection.ts`)
  - **ByteTrack**: Fast, online tracking with Kalman filtering
  - **BoT-SORT**: Advanced tracking with camera motion compensation (optional)
- **Reframing**: Multiple smoothing algorithms
  - Bezier curve interpolation (`src/lib/reframing/bezier-trajectory-smoother.ts`)
  - One Euro Filter (`src/lib/reframing/one-euro-filter.ts`)
  - Exponential smoothing
- **Export**: WebCodecs API handles video encoding with multiple format options

### Technical Decisions
- All processing client-side (no server costs/latency)
- TensorFlow.js WebGL backend for GPU acceleration
- Store all detections in memory for real-time playback
- Support multiple aspect ratios (16:9, 9:16, 1:1, 4:3, 3:4, custom)
- Frame transforms use Bezier curves for smooth motion
- Next.js middleware handles i18n routing and locale detection
- Webpack configured for WASM/ONNX model loading (`next.config.ts`)

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

## Core Data Flow

### Detection Pipeline
1. **Frame Extraction**: Video frames extracted via canvas API
2. **YOLO Detection**: TensorFlow.js runs YOLOv12n model on each frame
   - Confidence threshold: 0.3 (configurable)
   - NMS IoU threshold: 0.45
   - Detects every 5th frame by default
3. **ByteTracker**: Associates detections across frames
   - Uses Kalman filter for motion prediction
   - Two-stage matching: high confidence first, then low confidence
   - Handles track loss and recovery
4. **Interpolation**: Fills gaps between detected frames

### Reframing Algorithm
1. **Target Selection**: Manual selection of person to track
2. **Frame Calculation**: Determines optimal crop for each frame
   - Maintains selected aspect ratio
   - Applies padding around target
   - Handles target loss gracefully
3. **Smoothing**: Multiple algorithms available
   - Exponential smoothing
   - Bezier curve interpolation
   - Configurable smoothness parameter

### Export Pipeline
1. **WebCodecs API**: Primary export method
   - Supports H.264 encoding
   - Handles HEVC input by transcoding
   - Mobile-optimized frame processing
2. **Canvas Rendering**: Applies transforms to each frame
3. **MP4 Muxing**: Creates final video file

## Key Configuration Files
- `src/config/detection.ts`: Detection and tracking parameters for both ByteTrack and BoT-SORT
- `src/config/detection-adaptive.ts`: FPS-based adaptive settings
- `src/lib/reframing/presets.ts`: Reframing presets (Instagram Reel, YouTube Short, TikTok, Instagram Post, Zoom Meeting, Presentation, etc.)
- `src/i18n/config.ts`: Supported locales and locale-specific settings
- `next.config.ts`: Webpack configuration for WASM/ONNX model loading and aliases

## Mobile Considerations
- Progressive frame processing to manage memory
- Batch processing with periodic garbage collection
- Frame duplicate detection for efficiency
- Adaptive frame rate based on device capabilities

## Testing
Tests use Jest/React Testing Library pattern:
```bash
# No test runner configured yet
# Test files located at: src/lib/reframing/__tests__/
```

## Known Technical Constraints
- Both trackers are online algorithms (no future frame lookahead)
- Person detection only (no pose/keypoint data from YOLOv12n)
- Mobile Safari HEVC limitations require transcoding
- WebGL backend required for acceptable performance
- MediaInfo.js externalized on server-side to avoid SSR issues

## Important Implementation Notes
- **No SSR for Video Processing**: Components using TensorFlow.js, WebCodecs, or video APIs must use 'use client' directive
- **WASM Loading**: MediaInfo and ONNX models loaded as assets via webpack configuration
- **i18n Routing**: All pages must be under `[locale]` directory for internationalization
- **H.264 Compatibility**: All output dimensions must be even numbers for H.264 encoding