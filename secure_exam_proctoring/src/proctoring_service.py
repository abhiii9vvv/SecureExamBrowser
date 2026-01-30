"""
Proctoring Service - Integrates face detection with exam session
"""
import cv2
import threading
import json
from datetime import datetime
from face_detection import FaceDetector
from liveness_detection import LivenessDetector
from identity_match import IdentityMatcher


class ProctoringService:
    def __init__(self, model_path="models/yolov8n-face.pt", reference_embedding=None):
        """
        Initialize the proctoring service
        
        Args:
            model_path: Path to YOLOv8 face detection model
        """
        self.detector = FaceDetector(model_path=model_path)
        self.is_running = False
        self.current_status = None
        self.violations = []
        self.frame_count = 0
        self.violation_threshold = 5  # Number of frames before flagging violation
        self.no_face_frames = 0
        self.multiple_face_frames = 0
        self.liveness = LivenessDetector()
        self.identity_matcher = IdentityMatcher()
        self.reference_embedding = reference_embedding
        self.not_live_frames = 0
    
    def start_proctoring(self, exam_id):
        """
        Start proctoring session
        
        Args:
            exam_id: ID of the exam being proctored
        """
        self.is_running = True
        self.violations = []
        self.exam_id = exam_id
        print(f"✓ Proctoring started for exam {exam_id}")
    
    def stop_proctoring(self):
        """Stop proctoring session and return report"""
        self.is_running = False
        report = {
            'exam_id': self.exam_id,
            'total_frames': self.frame_count,
            'violations': self.violations,
            'timestamp': datetime.now().isoformat()
        }
        print(f"✓ Proctoring stopped. Violations: {len(self.violations)}")
        return report
    
    def process_frame(self, frame):
        """
        Process a single frame for face detection and violations
        
        Args:
            frame: Video frame
            
        Returns:
            dict: Frame data with detections and status
        """
        if not self.is_running:
            return None
        
        self.frame_count += 1
        
        # Detect faces
        detections = self.detector.detect_faces(frame)
        face_count = detections['face_count']

        # Liveness check
        face_boxes = [f['bbox'] for f in detections['faces']]
        liveness = self.liveness.detect(frame, face_boxes if face_boxes else None)

        # Identity match (optional if reference embedding exists)
        identity_result = None
        if self.reference_embedding is not None and face_boxes:
            current_emb = self.identity_matcher.extract_embedding(frame, face_boxes[0])
            if current_emb is not None:
                identity_result = self.identity_matcher.match(self.reference_embedding, current_emb)
        
        # Track violations
        if face_count == 0:
            self.no_face_frames += 1
            if self.no_face_frames >= self.violation_threshold:
                self.violations.append({
                    'type': 'NO_FACE_DETECTED',
                    'frame': self.frame_count,
                    'timestamp': datetime.now().isoformat()
                })
                self.no_face_frames = 0
        else:
            self.no_face_frames = 0
        
        if face_count > 1:
            self.multiple_face_frames += 1
            if self.multiple_face_frames >= self.violation_threshold:
                self.violations.append({
                    'type': 'MULTIPLE_FACES',
                    'frame': self.frame_count,
                    'timestamp': datetime.now().isoformat()
                })
                self.multiple_face_frames = 0
        else:
            self.multiple_face_frames = 0

        # Track liveness failures
        if face_count == 1 and not liveness['is_live']:
            self.not_live_frames += 1
            if self.not_live_frames >= self.violation_threshold:
                self.violations.append({
                    'type': 'LIVENESS_FAILED',
                    'frame': self.frame_count,
                    'timestamp': datetime.now().isoformat(),
                    'details': {
                        'motion_score': liveness['motion_score'],
                        'eyes_detected': liveness['eyes_detected']
                    }
                })
                self.not_live_frames = 0
        else:
            self.not_live_frames = 0
        
        self.current_status = detections['status']
        
        return {
            'frame_number': self.frame_count,
            'face_count': face_count,
            'status': detections['status'],
            'violation_count': len(self.violations),
            'liveness': liveness,
            'identity_match': identity_result
        }
    
    def get_status(self):
        """Get current proctoring status"""
        return {
            'is_running': self.is_running,
            'current_status': self.current_status,
            'frame_count': self.frame_count,
            'violation_count': len(self.violations),
            'violations': self.violations
        }
    
    def export_report(self, filepath):
        """Export violation report to JSON"""
        report = {
            'exam_id': self.exam_id,
            'total_frames': self.frame_count,
            'violations': self.violations,
            'timestamp': datetime.now().isoformat()
        }
        with open(filepath, 'w') as f:
            json.dump(report, f, indent=2)
        print(f"✓ Report exported to {filepath}")


# Example usage with camera
def run_live_proctoring(exam_id):
    """
    Run live proctoring with video feed
    
    Args:
        exam_id: ID of the exam
    """
    service = ProctoringService()
    service.start_proctoring(exam_id)
    
    cap = cv2.VideoCapture(0)
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Process frame
            frame_data = service.process_frame(frame)
            
            # Draw detections
            detections = service.detector.detect_faces(frame)
            frame = service.detector.draw_detections(frame, detections)
            
            # Add violation info
            status = service.get_status()
            violation_text = f"Violations: {status['violation_count']}"
            cv2.putText(frame, violation_text, (20, 120),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 0), 2)

            # Add liveness info
            live_text = f"Liveness: {frame_data['liveness']['is_live']} | Motion: {frame_data['liveness']['motion_score']:.1f}"
            cv2.putText(frame, live_text, (20, 150),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            
            cv2.imshow("Exam Proctoring", frame)
            
            if cv2.waitKey(1) & 0xFF == 27:
                break
        
        # Export report
        report = service.stop_proctoring()
        print(json.dumps(report, indent=2))
        
    finally:
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    run_live_proctoring("EXAM_001")
