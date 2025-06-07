# Moved Files Summary

This folder contains files that are no longer used in the current implementation of AutoReframer.

## Components
- **VideoTrimmer**: Video trimming component (not implemented in current version)

## Detection Algorithms
- **bytetrack/**: Old ByteTrack implementation (replaced with bytetrack-proper)
- **bytetrack-continuous.ts**: Continuous ByteTrack implementation (not used)
- **bytetrack-v2/**: ByteTrack v2 implementation (not used)
- **face-yolo.ts**: Face detection using YOLO (head detection disabled)
- **person-head-tracker.ts**: Combined person and head tracker (functionality split)
- **interpolator.ts**: Old interpolation logic (replaced)
- **tracker.ts**: Old object tracker implementation

## Video Export
- **exporter-precise.ts**: Precise frame-by-frame exporter (not used)
- **exporter-v2.ts**: Version 2 exporter (not used)
- **ffmpeg-exporter.ts**: FFmpeg-based exporter (SimpleExporter used instead)
- **ffmpeg-stub.js**: FFmpeg stub file

## Reframing Algorithms
- **multi-point-stabilizer.ts**: Multi-point stabilization (disabled)
- **trajectory-smoother.ts**: Old trajectory smoothing (replaced with Bezier smoothing)

## Models
- **bytetrack_s.onnx**: ByteTrack ONNX model (35MB, not used)
- **old/**: Old face detection models (yolov8n-face.onnx, yolov11n-face.onnx)

## External Libraries
- **ByteTrack/**: Complete ByteTrack repository (external dependency)

## Test/Debug Files
- **conf88.png**, **headfail.png**, **headfail2.png**: Debug screenshots
- **frame299.png**, **frame300.png**: Test frame images
- **path/**: Test path folder

## Notes
- Current implementation uses `bytetrack-proper` for tracking
- BezierTrajectorySmoother is used for smooth reframing
- SimpleExporter handles video export (WebM format only)
- Head detection is disabled due to model reliability issues