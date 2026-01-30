import cv2
import numpy as np
from model_registry import ensure_models, get_model_path


class IdentityMatcher:
    """
    Identity matching using SFace ONNX embeddings + cosine similarity.
    Fallback to simple histogram-based features if ONNX fails.
    """
    def __init__(self, model_name="face_recognition_sface_2021dec.onnx"):
        ensure_models(download_missing=True)
        self.model_path = get_model_path(model_name)
        self.net = None
        self.use_fallback = False
        
        try:
            self.net = cv2.dnn.readNetFromONNX(self.model_path)
            print(f"✓ SFace model loaded successfully")
        except Exception as e:
            print(f"⚠ ONNX model failed to load, using histogram fallback: {e}")
            self.use_fallback = True

    @staticmethod
    def _preprocess(face_bgr: np.ndarray) -> np.ndarray:
        # SFace expects 112x112 RGB normalized to [-1, 1]
        face = cv2.resize(face_bgr, (112, 112))
        blob = cv2.dnn.blobFromImage(
            face,
            scalefactor=1.0 / 128.0,
            size=(112, 112),
            mean=(127.5, 127.5, 127.5),
            swapRB=True,
            crop=False,
        )
        return blob

    def extract_embedding(self, frame_bgr: np.ndarray, face_box) -> np.ndarray | None:
        x1, y1, x2, y2 = face_box
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(frame_bgr.shape[1], x2), min(frame_bgr.shape[0], y2)
        face = frame_bgr[y1:y2, x1:x2]
        if face.size == 0:
            return None
            
        if self.use_fallback:
            return self._extract_histogram_features(face)
        
        blob = self._preprocess(face)
        self.net.setInput(blob)
        emb = self.net.forward()
        emb = emb.flatten().astype(np.float32)
        # L2 normalize
        norm = np.linalg.norm(emb)
        if norm > 0:
            emb = emb / norm
        return emb
    
    def _extract_histogram_features(self, face_bgr: np.ndarray) -> np.ndarray:
        """
        Fallback: Extract simple color + HOG features for identity matching
        """
        # Resize to standard size
        face = cv2.resize(face_bgr, (64, 64))
        
        # Extract color histogram features (HSV)
        hsv = cv2.cvtColor(face, cv2.COLOR_BGR2HSV)
        hist_h = cv2.calcHist([hsv], [0], None, [32], [0, 180])
        hist_s = cv2.calcHist([hsv], [1], None, [32], [0, 256])
        hist_v = cv2.calcHist([hsv], [2], None, [32], [0, 256])
        
        # Concatenate and normalize
        features = np.concatenate([hist_h.flatten(), hist_s.flatten(), hist_v.flatten()])
        features = features.astype(np.float32)
        norm = np.linalg.norm(features)
        if norm > 0:
            features = features / norm
        
        return features

    @staticmethod
    def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        if a is None or b is None:
            return 0.0
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))

    def match(self, embedding_a: np.ndarray, embedding_b: np.ndarray, threshold: float = 0.5) -> dict:
        score = self.cosine_similarity(embedding_a, embedding_b)
        return {
            "match": score >= threshold,
            "score": score,
            "threshold": threshold,
        }
