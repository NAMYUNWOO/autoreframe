# AutoReframer

AutoReframer is a powerful browser-based video reframing application that automatically tracks and reframes videos to focus on selected subjects. All processing happens client-side using cutting-edge web technologies.

## 🚀 Key Technologies

### Core Framework
- **Next.js 15** - React framework with App Router for optimal performance
- **React 18** - UI library with hooks and functional components
- **TypeScript** - Type-safe development with strict mode enabled
- **multi lang** - global
### AI & Computer Vision
- **TensorFlow.js** - Browser-based machine learning for object detection
- **YOLOv12n** - State-of-the-art object detection model (80 COCO classes)
- **ByteTrack** - Advanced multi-object tracking algorithm with Kalman filtering
- **WebGL Backend** - GPU acceleration for real-time AI inference

### Video Processing
- **WebCodecs API** - Hardware-accelerated video encoding/decoding
- **requestVideoFrameCallback** - Frame-accurate video seeking and synchronization
- **Canvas API** - Real-time video frame manipulation and rendering
- **MP4 Muxing** - Custom MP4 container creation with webm-muxer

### Styling & UI
- **Tailwind CSS** - Utility-first CSS framework
- **Framer Motion** - Smooth animations and transitions
- **Radix UI** - Accessible component primitives
- **Lucide Icons** - Modern icon system

### State Management
- **React Hooks** - Custom hooks for complex state logic
- **Context API** - Global state management for app-wide settings

## 🎯 Technical Highlights

### Frame-Accurate Video Processing
- Implements `requestVideoFrameCallback` API for precise frame synchronization
- Frame center time calculation `(frameNumber + 0.5) / fps` for accurate seeking
- Zero frame duplication during export process

### Real-Time Object Tracking
- ByteTrack algorithm provides consistent object IDs across frames
- Two-stage matching: high confidence first, then low confidence
- Kalman filter for motion prediction and track recovery

### Smooth Camera Motion
- Bezier curve interpolation for natural camera movements
- Multiple smoothing algorithms (exponential, bezier)
- Configurable smoothness parameters

### Performance Optimizations
- Progressive frame processing for memory efficiency
- Batch processing with periodic garbage collection
- Adaptive frame rate based on device capabilities
- Frame duplicate detection to skip redundant processing

### Browser Compatibility
- WebCodecs API support detection with fallbacks
- Mobile-optimized memory management
- HEVC/H.265 transcoding for Safari compatibility
- Cross-platform codec selection (H.264, VP8, VP9)

## 📊 Data Flow

### 1. Video Upload & Initialization
```
User uploads video → VideoUploader component
    ↓
Create video blob URL → Extract metadata (fps, duration, dimensions)
    ↓
Initialize video element → Prepare for processing
```

### 2. Object Detection Pipeline
```
Video frames extraction (every 5th frame by default)
    ↓
Canvas API draws video frame → Convert to tensor
    ↓
TensorFlow.js YOLO model → Detect objects (80 classes)
    ↓
Filter by confidence (>0.3) → Apply NMS (IoU 0.45)
    ↓
Store detections: Map<frameNumber, Detection[]>
```

### 3. Object Tracking Flow
```
Raw detections from YOLO
    ↓
ByteTrack algorithm initialization
    ↓
For each frame:
    1. Predict track positions (Kalman filter)
    2. Match high confidence detections → existing tracks
    3. Match remaining detections → unmatched tracks
    4. Create new tracks for unmatched detections
    5. Update track states (active/lost/removed)
    ↓
Output: Consistent track IDs across frames
```

### 4. Head Selection & Target Tracking
```
User clicks on person's head → HeadSelector component
    ↓
Find nearest detection → Extract track ID
    ↓
Filter all detections by selected track ID
    ↓
Interpolate missing frames → Fill gaps between detections
    ↓
Create smooth target trajectory
```

### 5. Reframing Calculation
```
Target positions + Output aspect ratio
    ↓
For each frame:
    1. Calculate optimal crop dimensions
    2. Apply padding rules (minPadding, maxPadding)
    3. Ensure target stays in frame
    4. Handle edge cases (target lost, boundaries)
    ↓
Generate raw frame transforms: Map<frameNumber, FrameTransform>
```

### 6. Trajectory Smoothing
```
Raw frame transforms
    ↓
Apply smoothing algorithm:
    - Bezier curve interpolation
    - Exponential smoothing
    - Custom smoothness parameter (0-1)
    ↓
Manual adjustments (TrajectoryEditor)
    ↓
Final smooth transforms
```

### 7. Video Export Pipeline
```
Final transforms + Original video
    ↓
WebCodecs initialization:
    1. Detect supported codecs (H.264/VP8/VP9)
    2. Configure encoder with optimal settings
    ↓
For each frame:
    1. Seek to frame time using requestVideoFrameCallback
    2. Apply transform to canvas
    3. Create VideoFrame from canvas
    4. Encode frame with WebCodecs
    5. Collect encoded chunks
    ↓
Mux encoded chunks → MP4/WebM container
    ↓
Generate final video blob → Download
```

### 8. Memory Management Flow
```
Desktop:
    - Process all frames sequentially
    - Keep all data in memory

Mobile:
    - Batch processing (10 frames)
    - Periodic garbage collection
    - Frame deduplication
    - Progressive loading
```

## 🏗️ Architecture

```
src/
├── components/          # React components
│   ├── VideoUploader/   # File upload handling
│   ├── HeadSelector/    # Interactive subject selection
│   ├── TrajectoryEditor/# Manual keyframe adjustments
│   └── ExportPanel/     # Export configuration
├── hooks/               # Custom React hooks
│   ├── useVideoProcessor.ts
│   ├── useObjectDetection.ts
│   └── useReframing.ts
├── lib/                 # Core processing logic
│   ├── detection/       # YOLO + ByteTrack implementation
│   ├── reframing/       # Camera motion algorithms
│   └── video/           # WebCodecs export pipeline
└── config/              # App configuration
    ├── detection.ts     # Detection parameters
    └── detection-adaptive.ts # FPS-based settings
```

## 🔧 Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Run linting
npm run lint
```

## 📱 Mobile Considerations

- Progressive frame processing to manage memory constraints
- Batch processing with 10-frame chunks
- Automatic garbage collection between batches
- Frame skip detection for improved efficiency
- iOS-specific optimizations for Safari WebKit

## 🎨 Export Features

- Multiple aspect ratios: 16:9, 9:16, 1:1, 4:5, 21:9
- Configurable video quality and bitrate
- Format support: MP4 (H.264), WebM (VP8/VP9)
- Real-time export progress tracking
- Frame-accurate rendering without duplicates

## 🔬 Advanced Features

- **Adaptive Detection**: FPS-based parameter adjustment
- **Interpolation**: Fills gaps between detected frames
- **Track Recovery**: Handles temporary object occlusion
- **Presets**: Social, cinematic, and custom reframing modes
- **Manual Override**: Frame-by-frame trajectory editing

## 🌐 Browser Requirements

- Modern browser with WebCodecs API support
- WebGL-enabled for TensorFlow.js acceleration
- Recommended: Chrome 94+, Edge 94+, Safari 16.4+
- Mobile: iOS 16.4+, Android Chrome 94+

## 📄 License

This project is proprietary software. All rights reserved.