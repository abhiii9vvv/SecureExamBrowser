import sys
import json
import base64
from pathlib import Path
import numpy as np
import cv2
import os
import warnings

# Suppress warnings and redirect prints to stderr to keep stdout clean for JSON
warnings.filterwarnings('ignore')
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

# Add src directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent))

from face_detection import FaceDetector
from liveness_detection import LivenessDetector
from identity_match import IdentityMatcher


REFERENCE_PATH = Path(__file__).resolve().parent.parent / "models" / "reference_embedding.npy"


def load_reference_embedding():
    if REFERENCE_PATH.exists():
        return np.load(str(REFERENCE_PATH))
    return None


def save_reference_embedding(embedding: np.ndarray):
    REFERENCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.save(str(REFERENCE_PATH), embedding)


def decode_image(data_url: str):
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    image_bytes = base64.b64decode(data_url)
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    return img


def main():
    # Redirect print statements to stderr to keep stdout clean for JSON
    import sys
    
    try:
        face_detector = FaceDetector()
        print("Face detector initialized", file=sys.stderr)
    except Exception as e:
        print(f"Face detector init failed: {e}", file=sys.stderr)
        face_detector = None
    
    liveness = LivenessDetector()
    matcher = IdentityMatcher()
    reference_embedding = load_reference_embedding()
    has_reference = reference_embedding is not None

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get("id")
            image_data = req.get("image")
            enroll = bool(req.get("enroll"))

            frame = decode_image(image_data)
            
            # Face detection with fallback
            detections = {"face_count": 0, "faces": []}
            if face_detector:
                try:
                    detections = face_detector.detect_faces(frame)
                except Exception as detect_err:
                    import traceback
                    error_msg = f"Detection failed: {str(detect_err)}\n{traceback.format_exc()}"
                    print(json.dumps({"id": req_id, "error": error_msg}), flush=True)
                    continue
            
            face_boxes = [f["bbox"] for f in detections.get("faces", [])]
            liveness_result = liveness.detect(frame, face_boxes if face_boxes else None)

            # DEMO MODE: Skip actual identity matching for now
            identity_result = None
            if face_boxes:
                # Auto-enroll on first face
                if not has_reference:
                    save_reference_embedding(np.array([1.0] * 256))  # Dummy embedding
                    has_reference = True
                # Always return match=true in demo mode
                identity_result = {"match": True, "score": 0.95, "threshold": 0.5}

            response = {
                "id": req_id,
                "face_count": detections.get("face_count", 0),
                "faces": detections.get("faces", []),
                "liveness": liveness_result,
                "identity_match": identity_result,
                "has_reference": has_reference,
            }
            print(json.dumps(response), flush=True)
        except Exception as exc:
            err_resp = {"id": req.get("id") if isinstance(req, dict) else None, "error": str(exc)}
            print(json.dumps(err_resp), flush=True)


if __name__ == "__main__":
    main()
