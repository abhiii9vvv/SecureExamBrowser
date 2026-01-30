"""
Demo test script to verify all AI models are working
Tests: Face Detection, Liveness Detection, and Identity Matching
"""
import sys
import os
import cv2
import numpy as np

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from face_detection import FaceDetector
from liveness_detection import LivenessDetector
from identity_match import IdentityMatcher
from model_registry import ensure_models

def test_models():
    print("=" * 60)
    print("AI MODELS DEMO TEST")
    print("=" * 60)
    
    # 1. Ensure all models are downloaded
    print("\n[1/4] Checking model files...")
    try:
        ensure_models()
        print("✓ All models ready")
    except Exception as e:
        print(f"✗ Model download failed: {e}")
        return False
    
    # 2. Initialize detectors
    print("\n[2/4] Initializing detectors...")
    try:
        face_detector = FaceDetector()
        liveness_detector = LivenessDetector()
        identity_matcher = IdentityMatcher()
        print("✓ All detectors initialized")
    except Exception as e:
        print(f"✗ Detector initialization failed: {e}")
        return False
    
    # 3. Test with webcam
    print("\n[3/4] Testing with webcam...")
    print("Opening camera... (Press 'q' to quit, 's' to capture test frame)")
    
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("✗ Could not open webcam")
        return False
    
    test_frame = None
    frame_count = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            print("✗ Could not read frame")
            break
        
        frame_count += 1
        
        # Test face detection
        face_result = face_detector.detect_faces(frame)
        
        # Draw results
        display_frame = frame.copy()
        if face_result['face_count'] > 0:
            for face in face_result['faces']:
                x1, y1, x2, y2 = face['bbox']
                conf = face['confidence']
                cv2.rectangle(display_frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(display_frame, f"Face: {conf:.2f}", (x1, y1-10),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            
            # Test liveness every 10 frames
            if frame_count % 10 == 0:
                liveness_result = liveness_detector.detect(frame, face_result['faces'][0]['bbox'])
                status = "LIVE" if liveness_result['is_live'] else "SPOOF"
                color = (0, 255, 0) if liveness_result['is_live'] else (0, 0, 255)
                cv2.putText(display_frame, f"Liveness: {status}", (10, 30),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
                cv2.putText(display_frame, f"Motion: {liveness_result['motion_score']:.2f}", (10, 60),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                cv2.putText(display_frame, f"Eyes: {liveness_result['eyes_detected']}", (10, 90),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
        
        cv2.putText(display_frame, "Press 'q' to quit, 's' to test identity matching", (10, display_frame.shape[0]-20),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        cv2.imshow('Model Test', display_frame)
        
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord('s'):
            if face_result['face_count'] > 0:
                test_frame = frame.copy()
                print("✓ Test frame captured for identity matching")
                break
    
    cap.release()
    cv2.destroyAllWindows()
    
    # 4. Test identity matching
    print("\n[4/4] Testing identity matching...")
    if test_frame is not None:
        try:
            # Extract embedding from test frame
            face_result = face_detector.detect_faces(test_frame)
            if face_result['face_count'] > 0:
                bbox = face_result['faces'][0]['bbox']
                embedding = identity_matcher.extract_embedding(test_frame, bbox)
                
                if embedding is not None:
                    print(f"✓ Embedding extracted: shape={embedding.shape}, norm={np.linalg.norm(embedding):.4f}")
                    
                    # Test self-match
                    similarity = identity_matcher.match(embedding, embedding)
                    print(f"✓ Self-match similarity: {similarity:.4f} (should be ~1.0)")
                    
                    # Test with random embedding
                    random_embedding = np.random.randn(256).astype(np.float32)
                    random_embedding /= np.linalg.norm(random_embedding)
                    similarity = identity_matcher.match(embedding, random_embedding)
                    print(f"✓ Random-match similarity: {similarity:.4f} (should be low)")
                else:
                    print("✗ Could not extract embedding")
            else:
                print("✗ No face detected in test frame")
        except Exception as e:
            print(f"✗ Identity matching test failed: {e}")
            import traceback
            traceback.print_exc()
    else:
        print("⊘ Identity matching test skipped (no test frame)")
    
    print("\n" + "=" * 60)
    print("DEMO TEST COMPLETE")
    print("=" * 60)
    return True

if __name__ == "__main__":
    try:
        success = test_models()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n✗ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
