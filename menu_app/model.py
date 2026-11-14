"""The expression classifier (ResNet-18/34 on 48x48 grayscale faces). Trained in the Face-Expressions-Recognition project."""
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision.models import resnet18, resnet34

LABELS = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"]
NET_SIZE = 112  # faces are upsampled so the pretrained filters see familiar scales
ARCHS = {"resnet18": resnet18, "resnet34": resnet34}


class EmotionNet(nn.Module):
    """ResNet that takes 1x48x48 grayscale faces in [0, 1]."""

    def __init__(self, arch="resnet18"):
        super().__init__()
        self.backbone = ARCHS[arch](weights=None)
        self.backbone.fc = nn.Sequential(nn.Dropout(0.4), nn.Linear(self.backbone.fc.in_features, len(LABELS)))
        self.register_buffer("mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))

    def forward(self, x):
        x = F.interpolate(x, size=(NET_SIZE, NET_SIZE), mode="bilinear", align_corners=False)
        x = (x.repeat(1, 3, 1, 1) - self.mean) / self.std
        return self.backbone(x)
