import os
from pathlib import Path
from urllib.request import urlretrieve


MODELS = {
    "yolov8n-face.pt": {
        "description": "YOLOv8 Nano Face Detector",
        "url": None,  # Bundled locally in the repo
    },
    "face_detection_yunet_2023mar.onnx": {
        "description": "OpenCV YuNet Face Detector (ONNX)",
        "url": "https://raw.githubusercontent.com/opencv/opencv_zoo/master/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    },
    "face_recognition_sface_2021dec.onnx": {
        "description": "OpenCV SFace Face Recognition (ONNX)",
        "url": "https://raw.githubusercontent.com/opencv/opencv_zoo/master/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    },
}


def get_models_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "models"


def list_models():
    return {
        name: {
            "description": meta.get("description"),
            "exists": (get_models_dir() / name).exists(),
            "url": meta.get("url"),
        }
        for name, meta in MODELS.items()
    }


def ensure_models(download_missing: bool = True):
    models_dir = get_models_dir()
    models_dir.mkdir(parents=True, exist_ok=True)

    for name, meta in MODELS.items():
        model_path = models_dir / name
        if model_path.exists():
            continue

        url = meta.get("url")
        if not url:
            continue

        if download_missing:
            print(f"Downloading model: {name}")
            urlretrieve(url, model_path)
            print(f"✓ Saved: {model_path}")


def get_model_path(name: str) -> str:
    model_path = get_models_dir() / name
    return str(model_path)
