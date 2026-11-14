"""FastAPI server: streams webcam/screen frames over a WebSocket and returns emotions in real time."""
import asyncio
import os
import time

import cv2
import numpy as np
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .coach import CONTEXTS, coach
from .engine import LABELS, EmotionEngine
from .menu import MENU, recommend

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app = FastAPI(title="MoodLens")
engine = EmotionEngine()
# One inference at a time keeps the GPU from thrashing when several tabs are open
infer_lock = asyncio.Lock()


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/info")
def info():
    return {"labels": LABELS, "contexts": CONTEXTS, "model_val_acc": engine.classifier.val_acc,
            "detector": "YuNet" if engine.detector.yunet is not None else "Haar"}


@app.get("/api/coach")
def get_coach(emotion: str = "neutral", context: str = "casual"):
    return coach(emotion, context)


@app.get("/api/recommend")
def get_recommendation(mood: str = "neutral", diet: str = "any", budget: int | None = None,
                       avoid: list[str] = Query(default=[]), max_spice: int = 2, seed: int | None = None):
    return recommend(mood, diet=diet, budget=budget, avoid=avoid, max_spice=max_spice, seed=seed)


@app.get("/api/menu")
def get_menu():
    return MENU


@app.websocket("/ws")
async def ws_stream(ws: WebSocket):
    await ws.accept()
    tracker = engine.new_tracker()
    loop = asyncio.get_running_loop()
    try:
        while True:
            data = await ws.receive_bytes()
            start = time.perf_counter()
            frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                await ws.send_json({"faces": [], "error": "bad frame"})
                continue
            async with infer_lock:
                faces = await loop.run_in_executor(None, engine.analyze, frame, tracker)
            await ws.send_json({"faces": faces, "ms": round((time.perf_counter() - start) * 1000, 1)})
    except WebSocketDisconnect:
        pass


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
