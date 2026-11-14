"""Face detection + expression classification + per-face temporal smoothing."""
import os
import sys

import cv2
import numpy as np
import torch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from train_torch import LABELS, EmotionNet  # noqa: E402

MODEL_PATH = os.path.join(ROOT, "models", "emotion_resnet18.pt")
YUNET_PATH = os.path.join(ROOT, "models", "face_detection_yunet_2023mar.onnx")
FACE_SIZE = 48
# FER-2013 framing: crop side is ~1.25x the detector's face width, eyes sit ~40% down the crop
CROP_SCALE = 1.25
EYE_Y = 0.40


class FaceDetector:
    def __init__(self, score_threshold=0.75):
        self.yunet = None
        if os.path.exists(YUNET_PATH):
            self.yunet = cv2.FaceDetectorYN.create(YUNET_PATH, "", (320, 320), score_threshold, 0.3, 50)
        else:
            self.haar = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    def detect(self, bgr):
        """Returns a list of (x, y, w, h, eyes) where eyes is ((rx, ry), (lx, ly)) or None."""
        h, w = bgr.shape[:2]
        if self.yunet is not None:
            self.yunet.setInputSize((w, h))
            _, faces = self.yunet.detect(bgr)
            if faces is None:
                return []
            return [(f[0], f[1], f[2], f[3], ((f[4], f[5]), (f[6], f[7]))) for f in faces]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        found = self.haar.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(60, 60))
        return [(x, y, fw, fh, None) for (x, y, fw, fh) in found]


def align_crop(gray, face):
    """Rotate so the eyes are level and crop a 48x48 patch framed like FER-2013."""
    x, y, w, h, eyes = face
    side = CROP_SCALE * w
    if eyes is not None:
        (rx, ry), (lx, ly) = eyes
        angle = np.degrees(np.arctan2(ly - ry, lx - rx))
        cx, cy = (rx + lx) / 2, (ry + ly) / 2 + (0.5 - EYE_Y) * side
    else:
        angle, cx, cy = 0.0, x + w / 2, y + h / 2
    m = cv2.getRotationMatrix2D((float(cx), float(cy)), float(angle), FACE_SIZE / side)
    m[0, 2] += FACE_SIZE / 2 - cx
    m[1, 2] += FACE_SIZE / 2 - cy
    return cv2.warpAffine(gray, m, (FACE_SIZE, FACE_SIZE), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)


class EmotionClassifier:
    def __init__(self, path=MODEL_PATH):
        if not os.path.exists(path):
            raise FileNotFoundError(f"{path} not found. Train it first: venv/bin/python train_torch.py")
        self.device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
        ckpt = torch.load(path, map_location="cpu")
        self.model = EmotionNet(ckpt.get("arch", "resnet18"), pretrained=False)
        self.model.load_state_dict(ckpt["state_dict"])
        self.model.to(self.device).eval()
        self.val_acc = ckpt.get("val_acc")

    @torch.no_grad()
    def predict(self, crops):
        """crops: list of 48x48 uint8 grayscale arrays -> (N, 7) probabilities (flip TTA)."""
        if not crops:
            return np.zeros((0, len(LABELS)), dtype=np.float32)
        x = torch.from_numpy(np.stack(crops)).float().div(255.0).unsqueeze(1).to(self.device)
        x = torch.cat([x, torch.flip(x, dims=[3])])
        p = self.model(x).softmax(1)
        n = len(crops)
        return ((p[:n] + p[n:]) / 2).cpu().numpy()


def _iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


class FaceTracker:
    """Keeps a stable id and an exponentially smoothed probability vector per face."""

    def __init__(self, alpha=0.35, max_missed=8):
        self.alpha = alpha
        self.max_missed = max_missed
        self.tracks = {}
        self.next_id = 1

    def update(self, boxes, probs):
        assigned = {}
        free = set(self.tracks)
        # Greedy IoU matching, largest faces first
        for i in sorted(range(len(boxes)), key=lambda i: -boxes[i][2] * boxes[i][3]):
            best, best_iou = None, 0.25
            for tid in free:
                iou = _iou(boxes[i], self.tracks[tid]["box"])
                if iou > best_iou:
                    best, best_iou = tid, iou
            if best is None:
                best = self.next_id
                self.next_id += 1
                self.tracks[best] = {"box": boxes[i], "probs": probs[i], "missed": 0}
            else:
                free.discard(best)
                t = self.tracks[best]
                t["probs"] = self.alpha * probs[i] + (1 - self.alpha) * t["probs"]
                t["box"] = boxes[i]
                t["missed"] = 0
            assigned[i] = best
        for tid in free:
            self.tracks[tid]["missed"] += 1
            if self.tracks[tid]["missed"] > self.max_missed:
                del self.tracks[tid]
        return assigned


class EmotionEngine:
    def __init__(self):
        self.detector = FaceDetector()
        self.classifier = EmotionClassifier()

    def new_tracker(self):
        return FaceTracker()

    def analyze(self, bgr, tracker):
        h, w = bgr.shape[:2]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        faces = [f for f in self.detector.detect(bgr) if f[2] >= 40 and f[3] >= 40]
        raw = self.classifier.predict([align_crop(gray, f) for f in faces])
        boxes = [tuple(float(v) for v in f[:4]) for f in faces]
        assigned = tracker.update(boxes, raw)
        results = []
        for i, (x, y, fw, fh) in enumerate(boxes):
            tid = assigned[i]
            probs = tracker.tracks[tid]["probs"]
            idx = int(np.argmax(probs))
            results.append({
                "id": tid,
                "box": [x / w, y / h, fw / w, fh / h],
                "emotion": LABELS[idx],
                "confidence": float(probs[idx]),
                "probs": {label: round(float(p), 4) for label, p in zip(LABELS, probs)},
            })
        results.sort(key=lambda r: -r["box"][2] * r["box"][3])
        return results
