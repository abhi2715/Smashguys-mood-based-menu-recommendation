"""One-off: convert models/emotion_*.pt (PyTorch) to models/emotion_*.onnx so the deployed app doesn't need torch.

Usage (needs torch + onnx locally, not on the server):  venv/bin/python tools/export_onnx.py
"""
import glob
import os
import sys

import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.model import EmotionNet  # noqa: E402

MODELS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
for path in sorted(glob.glob(os.path.join(MODELS, "emotion_*.pt"))):
    ckpt = torch.load(path, map_location="cpu")
    model = EmotionNet(ckpt.get("arch", "resnet18"))
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    out = path[:-3] + ".onnx"
    torch.onnx.export(model, torch.zeros(2, 1, 48, 48), out, input_names=["x"], output_names=["logits"],
                      dynamic_axes={"x": {0: "n"}, "logits": {0: "n"}}, opset_version=17, dynamo=False)
    print("wrote", out, "val_acc", ckpt.get("val_acc"))
