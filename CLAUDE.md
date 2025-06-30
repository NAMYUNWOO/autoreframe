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
3. **Detection**: YOLOv12n processes all frames (`src/lib/detection/`)
4. **Tracking**: ByteTrack algorithm tracks selected person (`src/lib/detection/bytetrack-interpolator.ts`)
5. **Reframing**: Compute smooth camera movements (`src/lib/reframing/`)
6. **Trajectory Editing**: Manual keyframe adjustments (`src/components/TrajectoryEditor/`)
7. **Export**: WebCodecs API processes final video (`src/lib/video/webcodecs-exporter.ts`)

### Key Components
- **Hooks**: Core logic in `useVideoProcessor`, `useObjectDetection`, `useReframing`
- **Detection**: YOLOv12n model (`public/yolov12n_web_model/`) detects 80 COCO classes
- **Tracking**: ByteTrack provides consistent object IDs across frames
- **Reframing**: Bezier curve interpolation for smooth camera movements
- **Export**: WebCodecs API handles video encoding with multiple format options

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
- `src/config/detection.ts`: Detection and tracking parameters
- `src/config/detection-adaptive.ts`: FPS-based adaptive settings
- `src/lib/reframing/presets.ts`: Reframing presets (social, cinematic, etc.)

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
- ByteTracker is an online algorithm (no future frame lookahead)
- Person detection only (no pose/keypoint data from YOLOv12n)
- Mobile Safari HEVC limitations require transcoding
- WebGL backend required for acceptable performance