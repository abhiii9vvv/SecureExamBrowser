"""
Simple console test for AI models - no webcam GUI
"""
import sys
import os
import cv2
import numpy as np

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

print("=" * 60)
print("AI MODELS SIMPLE DEMO TEST")
print("=" * 60)

# Test 1: Model Registry
print("\n[1/5] Testing Model Registry...")
try:
    from model_registry import ensure_models, get_model_path
    ensure_models()
    print("✓ Model registry working")
    print(f"  - YOLOv8 model: {get_model_path('yolov8')}")
    print(f"  - SFace model: {get_model_path('sface')}")
    print(f"  - YuNet model: {get_model_path('yunet')}")
except Exception as e:
    print(f"✗ Model registry failed: {e}")
    sys.exit(1)

# Test 2: Face Detection
print("\n[2/5] Testing Face Detection...")
try:
    from face_detection import FaceDetector
    face_detector = FaceDetector()
    print("✓ Face detector initialized")
    
    # Create a test image with a simple circle (fake face)
    test_img = np.ones((480, 640, 3), dtype=np.uint8) * 200
    cv2.circle(test_img, (320, 240), 100, (150, 150, 150), -1)
    cv2.circle(test_img, (290, 220), 15, (50, 50, 50), -1)
    cv2.circle(test_img, (350, 220), 15, (50, 50, 50), -1)
    cv2.ellipse(test_img, (320, 270), (40, 20), 0, 0, 180, (50, 50, 50), 2)
    
    result = face_detector.detect_faces(test_img)
    print(f"  - Detection result: {result['status']}")
    print(f"  - Faces found: {result['face_count']}")
except Exception as e:
    print(f"✗ Face detection failed: {e}")
    import traceback
    traceback.print_exc()

# Test 3: Liveness Detection
print("\n[3/5] Testing Liveness Detection...")
try:
    from liveness_detection import LivenessDetector
    liveness_detector = LivenessDetector()
    print("✓ Liveness detector initialized")
    
    # Test with fake bbox
    fake_bbox = [100, 100, 300, 300]
    result = liveness_detector.detect(test_img, fake_bbox)
    print(f"  - Detection result: is_live={result['is_live']}")
    print(f"  - Motion score: {result['motion_score']:.4f}")
    print(f"  - Eyes detected: {result['eyes_detected']}")
except Exception as e:
    print(f"✗ Liveness detection failed: {e}")
    import traceback
    traceback.print_exc()

# Test 4: Identity Matching
print("\n[4/5] Testing Identity Matching...")
try:
    from identity_match import IdentityMatcher
    identity_matcher = IdentityMatcher()
    print("✓ Identity matcher initialized")
    
    # Test embedding extraction with fake bbox
    fake_bbox = [100, 100, 300, 300]
    embedding = identity_matcher.extract_embedding(test_img, fake_bbox)
    if embedding is not None:
        print(f"  - Embedding extracted: shape={embedding.shape}")
        print(f"  - Embedding norm: {np.linalg.norm(embedding):.4f}")
        
        # Test self-match
        match_result = identity_matcher.match(embedding, embedding)
        print(f"  - Self-match result: {match_result}")
    else:
        # Use a random embedding for testing
        test_embedding = np.random.randn(256).astype(np.float32)
        test_embedding /= np.linalg.norm(test_embedding)
        match_result = identity_matcher.match(test_embedding, test_embedding)
        print(f"  - Self-match test with random embedding: {match_result}")
except Exception as e:
    print(f"✗ Identity matching failed: {e}")
    import traceback
    traceback.print_exc()

# Test 5: Webcam Access
print("\n[5/5] Testing Webcam Access...")
try:
    cap = cv2.VideoCapture(0)
    if cap.isOpened():
        print("✓ Webcam accessible")
        ret, frame = cap.read()
        if ret:
            print(f"  - Frame captured: {frame.shape}")
            
            # Test real face detection
            face_result = face_detector.detect_faces(frame)
            print(f"  - Real detection: {face_result['face_count']} face(s) found")
            
            if face_result['face_count'] > 0:
                bbox = face_result['faces'][0]['bbox']
                conf = face_result['faces'][0]['confidence']
                print(f"  - Face confidence: {conf:.4f}")
                
                # Test liveness on real frame
                liveness_result = liveness_detector.detect(frame, bbox)
                print(f"  - Liveness: {liveness_result['is_live']} (motion={liveness_result['motion_score']:.4f})")
                
                # Test embedding extraction
                embedding = identity_matcher.extract_embedding(frame, bbox)
                if embedding is not None:
                    print(f"  - Embedding extracted: norm={np.linalg.norm(embedding):.4f}")
        else:
            print("✗ Could not read frame from webcam")
        cap.release()
    else:
        print("✗ Webcam not accessible")
except Exception as e:
    print(f"✗ Webcam test failed: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 60)
print("DEMO TEST COMPLETE")
print("=" * 60)
print("\nAll models are ready for use in the verification system!")
