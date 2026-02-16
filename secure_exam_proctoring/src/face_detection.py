from ultralytics import YOLO
import cv2
import os
from pathlib import Path
from model_registry import ensure_models, get_model_path

class FaceDetector:
    def __init__(self, model_path="models/yolov8n-face.pt", confidence=0.5):
        """
        Initialize YOLOv8 face detection model
        
        Args:
            model_path: Path to the YOLOv8 face model
            confidence: Confidence threshold for detections
        """
        self.confidence = confidence
        
        # Ensure models are available (downloads missing optional models)
        ensure_models(download_missing=True)

        # Resolve model path
        if model_path == "models/yolov8n-face.pt":
            model_path = get_model_path("yolov8n-face.pt")
        elif not os.path.isabs(model_path):
            model_path = os.path.join(os.path.dirname(__file__), "..", model_path)
        
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model not found at {model_path}")
        
        # Suppress ALL output from YOLO loading
        import sys
        import io
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        sys.stdout = io.StringIO()
        sys.stderr = io.StringIO()
        
        try:
            self.model = YOLO(model_path, verbose=False)
        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr
        
        # Log to stderr only (safe for JSON communication)
        print(f"✓ YOLOv8 Face model loaded", file=sys.stderr)
    
    def detect_faces(self, frame):
        """
        Detect faces in a frame
        
        Args:
            frame: Input video frame (OpenCV format)
            
        Returns:
            dict: Detection results with face count, boxes, and status
        """
        results = self.model(frame, conf=self.confidence, verbose=False)
        faces = []
        
        for r in results:
            if r.boxes is None or len(r.boxes) == 0:
                continue
            for box in r.boxes:
                xyxy = box.xyxy[0].cpu().numpy()
                x1, y1, x2, y2 = map(int, xyxy)
                confidence = float(box.conf[0].cpu().numpy())
                faces.append({
                    'bbox': (x1, y1, x2, y2),
                    'confidence': confidence
                })
        
        face_count = len(faces)
        
        # Determine proctoring status
        if face_count == 0:
            status = "⚠ NO FACE DETECTED"
            color = (0, 0, 255)  # Red
        elif face_count > 1:
            status = "⚠ MULTIPLE FACES DETECTED"
            color = (0, 0, 255)  # Red
        else:
            status = "✓ VALID FACE"
            color = (0, 255, 0)  # Green
        
        return {
            'face_count': face_count,
            'faces': faces,
            'status': status,
            'color': color
        }
    
    def draw_detections(self, frame, detection_result):
        """
        Draw face detection boxes and status on frame
        
        Args:
            frame: Input video frame
            detection_result: Detection results from detect_faces()
            
        Returns:
            frame: Annotated frame
        """
        # Draw bounding boxes
        for face in detection_result['faces']:
            x1, y1, x2, y2 = face['bbox']
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            confidence_text = f"{face['confidence']:.2f}"
            cv2.putText(frame, confidence_text, (x1, y1 - 5),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 1)
        
        # Draw status
        cv2.putText(frame, detection_result['status'], (20, 40),
                   cv2.FONT_HERSHEY_SIMPLEX, 1, detection_result['color'], 2)
        
        # Draw face count
        count_text = f"Faces: {detection_result['face_count']}"
        cv2.putText(frame, count_text, (20, 80),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        
        return frame


def main():
    """Run real-time face detection"""
    try:
        detector = FaceDetector(confidence=0.5)
        cap = cv2.VideoCapture(0)
        
        if not cap.isOpened():
            print("Error: Could not open camera")
            return
        
        print("Starting face detection... (Press ESC to exit)")
        
        while True:
            ret, frame = cap.read()
            if not ret:
                print("Error: Failed to read frame")
                break
            
            # Detect faces
            detections = detector.detect_faces(frame)
            
            # Draw detections
            frame = detector.draw_detections(frame, detections)
            
            # Display
            cv2.imshow("Secure Exam Proctoring - Face Detection", frame)
            
            # Exit on ESC
            if cv2.waitKey(1) & 0xFF == 27:
                break
        
        cap.release()
        cv2.destroyAllWindows()
        print("✓ Face detection closed")
        
    except Exception as e:
        print(f"Error: {e}")
        raise


if __name__ == "__main__":
    main()
