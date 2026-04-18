import base64
import json
import os
import sys
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

state: Dict[str, Any] = {
    'detector': None,
    'recognizer': None,
    'cascade': None,
    'reference_embedding': None,
    'last_gray_small': None,
    'last_landmarks': None,
    'model_info': {
        'detector': False,
        'recognizer': False,
        'cascade': False,
    }
}


def write_message(message: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message) + '\n')
    sys.stdout.flush()


def decode_data_url(data_url: str):
    if not data_url or ',' not in data_url:
        raise ValueError('Invalid frame payload')
    encoded = data_url.split(',', 1)[1]
    raw = base64.b64decode(encoded)
    arr = np.frombuffer(raw, np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError('Unable to decode image frame')
    return image


def init_models(payload: Dict[str, Any]) -> Dict[str, Any]:
    detector_path = payload.get('detectorPath')
    recognizer_path = payload.get('recognizerPath')
    cascade_path = payload.get('fallbackCascadePath')

    state['detector'] = None
    state['recognizer'] = None
    state['cascade'] = None
    state['model_info'] = {'detector': False, 'recognizer': False, 'cascade': False}

    if detector_path and os.path.exists(detector_path):
        state['detector'] = cv2.FaceDetectorYN_create(detector_path, '', (320, 320), 0.6, 0.3, 5000)
        state['model_info']['detector'] = True

    if recognizer_path and os.path.exists(recognizer_path):
        state['recognizer'] = cv2.FaceRecognizerSF_create(recognizer_path, '')
        state['model_info']['recognizer'] = True

    if cascade_path and os.path.exists(cascade_path):
        cascade = cv2.CascadeClassifier(cascade_path)
        if not cascade.empty():
            state['cascade'] = cascade
            state['model_info']['cascade'] = True

    return state['model_info']


def detect_faces(image) -> List[Dict[str, Any]]:
    faces: List[Dict[str, Any]] = []
    height, width = image.shape[:2]

    if state['detector'] is not None:
        state['detector'].setInputSize((width, height))
        _, detected = state['detector'].detect(image)
        if detected is not None:
            for row in detected:
                x, y, w, h = row[:4]
                score = float(row[14]) if len(row) > 14 else 0.0
                landmarks = row[4:14].reshape((5, 2)).tolist() if len(row) >= 14 else []
                faces.append({
                    'bbox': [int(x), int(y), int(x + w), int(y + h)],
                    'confidence': score,
                    'landmarks': landmarks,
                    'raw': row.astype(np.float32)
                })

    if not faces and state['cascade'] is not None:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        detected = state['cascade'].detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(64, 64))
        for (x, y, w, h) in detected:
            faces.append({
                'bbox': [int(x), int(y), int(x + w), int(y + h)],
                'confidence': 0.55,
                'landmarks': [],
                'raw': None
            })

    return faces


def compute_embedding(image, face: Dict[str, Any]) -> Optional[np.ndarray]:
    if state['recognizer'] is None or face.get('raw') is None:
        return None
    aligned = state['recognizer'].alignCrop(image, face['raw'])
    feature = state['recognizer'].feature(aligned)
    return np.asarray(feature, dtype=np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    numerator = float(np.dot(a.flatten(), b.flatten()))
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 0.0
    return numerator / denom


def compute_liveness(image, face: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (64, 64))

    motion_score = 0.0
    if state['last_gray_small'] is not None:
        diff = cv2.absdiff(state['last_gray_small'], small)
        motion_score = float(np.mean(diff) / 255.0)
    state['last_gray_small'] = small

    landmark_shift = 0.0
    current_landmarks = np.array(face['landmarks'], dtype=np.float32) if face and face.get('landmarks') else None
    if current_landmarks is not None and state['last_landmarks'] is not None and face is not None:
        face_box = face['bbox']
        span = max(face_box[2] - face_box[0], face_box[3] - face_box[1], 1)
        landmark_shift = float(np.mean(np.linalg.norm(current_landmarks - state['last_landmarks'], axis=1)) / span)
    state['last_landmarks'] = current_landmarks if current_landmarks is not None else state['last_landmarks']

    is_live = motion_score > 0.012 or landmark_shift > 0.01
    return {
        'is_live': is_live,
        'motion_score': round(motion_score, 4),
        'landmark_shift': round(landmark_shift, 4),
        'eyes_detected': 2 if current_landmarks is not None else 0
    }


def enroll_identity(payload: Dict[str, Any]) -> Dict[str, Any]:
    image = decode_data_url(payload.get('image', ''))
    faces = detect_faces(image)
    if len(faces) != 1:
        raise ValueError('A single face is required to enroll identity')

    embedding = compute_embedding(image, faces[0])
    if embedding is None:
        raise ValueError('Face recognizer model is not available')

    state['reference_embedding'] = embedding
    state['last_landmarks'] = np.array(faces[0]['landmarks'], dtype=np.float32) if faces[0].get('landmarks') else None
    return {
        'enrolled': True,
        'faceCount': 1,
        'modelInfo': state['model_info']
    }


def verify_frame(payload: Dict[str, Any]) -> Dict[str, Any]:
    image = decode_data_url(payload.get('image', ''))
    faces = detect_faces(image)
    primary = faces[0] if len(faces) == 1 else None
    liveness = compute_liveness(image, primary)

    identity_match = {'match': False, 'score': 0.0}
    if primary is not None and state['reference_embedding'] is not None:
        embedding = compute_embedding(image, primary)
        if embedding is not None:
            score = cosine_similarity(state['reference_embedding'], embedding)
            identity_match = {
                'match': score >= 0.45,
                'score': round(score, 4)
            }

    return {
        'face_count': len(faces),
        'faces': [
            {
                'bbox': face['bbox'],
                'confidence': round(float(face['confidence']), 4)
            }
            for face in faces
        ],
        'liveness': liveness,
        'has_reference': state['reference_embedding'] is not None,
        'identity_match': identity_match,
        'model_family': 'opencv-yunet-sface' if state['model_info']['detector'] and state['model_info']['recognizer'] else 'opencv-fallback',
        'model_info': state['model_info']
    }


def dispatch(action: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if action == 'ping':
        return {'ok': True}
    if action == 'init_models':
        return init_models(payload)
    if action == 'enroll_identity':
        return enroll_identity(payload)
    if action == 'verify_frame':
        return verify_frame(payload)
    raise ValueError(f'Unsupported action: {action}')


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        message = json.loads(line)
        request_id = message.get('id')
        try:
            data = dispatch(message.get('action'), message.get('payload', {}))
            write_message({'id': request_id, 'success': True, 'data': data})
        except Exception as exc:
            write_message({'id': request_id, 'success': False, 'error': str(exc)})


if __name__ == '__main__':
    main()
