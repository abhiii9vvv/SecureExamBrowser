# YOLOv8 Face Detection Integration Guide

## Overview
This project integrates YOLOv8 (nano face detection model) for real-time proctoring during exams. The system can detect:
- ✓ Single face presence
- ⚠ No face detected (alert)
- ⚠ Multiple faces detected (violation)

## Project Structure

```
secure_exam_proctoring/
├── models/
│   └── yolov8n-face.pt          # YOLOv8 nano face detection model
├── src/
│   ├── face_detection.py        # Core YOLOv8 implementation
│   ├── proctoring_service.py    # Proctoring logic & violation tracking
│   └── python_bridge.js         # Node.js subprocess integration
└── requirements.txt
```

## Installation

### 1. Install Python Dependencies

```bash
# Navigate to project root
cd "e:\PROJECT\Secure Exam Browser"

# Install from requirements
pip install -r secure_exam_proctoring/requirements.txt
```

Required packages:
- `ultralytics` - YOLOv8 framework
- `opencv-python` - Video processing
- Python 3.8+

### 2. Verify Model Download

The YOLOv8 nano face model is included at:
- `secure_exam_proctoring/models/yolov8n-face.pt`

If missing, it will auto-download on first run.

## Usage

### Option 1: Direct Python (Testing)

```bash
cd secure_exam_proctoring/src

# Run real-time face detection
python face_detection.py
```

### Option 2: Proctoring Service

```python
from proctoring_service import ProctoringService

# Initialize
service = ProctoringService()
service.start_proctoring("EXAM_001")

# Process frames
while True:
    ret, frame = cap.read()
    frame_data = service.process_frame(frame)
    
    # Get status
    status = service.get_status()
    print(status['violation_count'])

# Get report
report = service.stop_proctoring()
```

### Option 3: Node.js Integration (Electron App)

```javascript
const PythonFaceDetectionBridge = require('./secure_exam_proctoring/src/python_bridge');

const detector = new PythonFaceDetectionBridge();

// Start detection
detector.startDetection('EXAM_001');

// Listen to events
detector.on('message', (msg) => console.log(msg));
detector.on('error', (err) => console.error(err));
detector.on('exit', () => console.log('Detection stopped'));

// Stop detection
detector.stopDetection();
```

## Features

### FaceDetector Class
- Loads YOLOv8 nano face model
- Detects faces with confidence scores
- Returns bounding boxes and detection status
- Draws annotations on frames

### ProctoringService Class
- Tracks violations (no face, multiple faces)
- Configurable violation threshold (frames)
- Generates violation reports
- Exports data to JSON

### Violation Types
- `NO_FACE_DETECTED` - Student face not visible for 5+ consecutive frames
- `MULTIPLE_FACES` - Multiple faces detected for 5+ consecutive frames

## Configuration

### Adjust Confidence Threshold
```python
detector = FaceDetector(confidence=0.6)  # Range: 0.0 - 1.0
```

### Adjust Violation Threshold
```python
service.violation_threshold = 10  # Frames before violation triggered
```

## Performance Notes

- **Model**: YOLOv8-nano (smallest, fastest)
- **FPS**: ~30 FPS on CPU, 60+ FPS on GPU
- **Latency**: ~30-50ms per frame
- **Memory**: ~200MB RAM

### GPU Acceleration (Optional)

```bash
# Install CUDA support
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Then YOLOv8 will auto-detect CUDA
```

## Integration with Exam UI

Add face detection to exam.html:

```html
<div id="face-detection-widget">
    <video id="proctoring-feed" autoplay></video>
    <div id="detection-status">Initializing...</div>
</div>
```

Connect in exam.js:

```javascript
const detector = new PythonFaceDetectionBridge();

// Start when exam begins
function startExam() {
    detector.startDetection(examId);
    detector.on('message', updateUI);
}

// Stop when exam ends
function submitExam() {
    detector.stopDetection();
}
```

## Troubleshooting

### Issue: Model not found
```
FileNotFoundError: Model not found at models/yolov8n-face.pt
```
**Solution**: Ensure model file exists or let ultralytics auto-download
```python
from ultralytics import YOLO
model = YOLO("yolov8n-face.pt")  # Auto-downloads if missing
```

### Issue: Camera permission denied
**Solution**: Grant camera permissions in Windows Settings

### Issue: Low FPS / High latency
**Solution**: 
- Reduce frame resolution
- Use GPU acceleration
- Increase confidence threshold

### Issue: False positives
**Solution**: Adjust confidence threshold
```python
detector = FaceDetector(confidence=0.7)  # Higher = stricter
```

## Next Steps

1. ✓ Install dependencies
2. Test face detection with `python face_detection.py`
3. Integrate ProctoringService with your exam workflow
4. Connect Python bridge to Electron UI
5. Monitor and tune violation thresholds

## References

- [YOLOv8 Documentation](https://docs.ultralytics.com/)
- [OpenCV Documentation](https://docs.opencv.org/)
- [Face Detection Guide](https://docs.ultralytics.com/tasks/detect/#pretrained-models)
