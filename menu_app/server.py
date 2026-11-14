"""Smash Guys Mood Menu server: reads the diner's mood from the camera and recommends food from the menu."""
import asyncio
import os
import re
import time

import cv2
import numpy as np
import qrcode
import qrcode.image.svg
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import groq_chat
from .engine import LABELS, EmotionEngine
from .menu import MENU, MOODS, daypart, recommend, recommend_table
from .store import lift_stats, record_lift, save_order

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
GST_RATE = 0.05  # restaurant GST in India

app = FastAPI(title="Smash Guys Mood Menu")
engine = EmotionEngine()
# One inference at a time keeps the GPU from thrashing when several tabs are open
infer_lock = asyncio.Lock()



@app.middleware("http")
async def revalidate_static(request, call_next):
    # The UI changes between versions; make browsers check for fresh files instead of reusing stale ones
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/info")
def info():
    return {"labels": LABELS, "models": engine.classifier.info,
            "detector": "YuNet" if engine.detector.yunet is not None else "Haar"}


@app.get("/api/recommend")
def get_recommendation(mood: str = "neutral", diet: str = "any", budget: int | None = None,
                       avoid: list[str] = Query(default=[]), max_spice: int = 2, seed: int | None = None,
                       hour: int | None = None, away: list[int] = Query(default=[])):
    return recommend(mood, diet=diet, budget=budget, avoid=avoid, max_spice=max_spice, seed=seed, hour=hour,
                     lift=lift_stats(), away=away)


@app.get("/api/table")
def get_table(moods: list[str] = Query(default=[]), diet: str = "any", avoid: list[str] = Query(default=[]),
              max_spice: int = 2, seed: int | None = None, hour: int | None = None):
    return recommend_table(moods, diet=diet, avoid=avoid, max_spice=max_spice, seed=seed, hour=hour,
                           lift=lift_stats())


@app.get("/api/menu")
def get_menu():
    return MENU


class OrderLine(BaseModel):
    id: int
    qty: int = 1


class OrderRequest(BaseModel):
    items: list[OrderLine]
    vibe: str = ""
    people: int = 1
    before: float | None = None  # diner's positivity (0-100) when ordering, for the Mood Lift rescan


@app.post("/api/order")
def place_order(req: OrderRequest):
    by_id = {item["id"]: item for item in MENU}
    lines = [{"id": l.id, "name": by_id[l.id]["name"], "price": by_id[l.id]["price"], "qty": max(1, l.qty)}
             for l in req.items if l.id in by_id]
    if not lines:
        raise HTTPException(400, "Order is empty")
    subtotal = sum(l["price"] * l["qty"] for l in lines)
    tax = round(subtotal * GST_RATE)
    order = save_order({"lines": lines, "vibe": req.vibe, "people": max(1, req.people), "subtotal": subtotal,
                        "tax": tax, "total": subtotal + tax, "before": req.before})
    ticket = "\n".join([f"SMASH GUYS · ORDER #{order['no']:04d}", f"Vibe: {req.vibe}"] +
                       [f"{l['qty']} x {l['name']}  ₹{l['price'] * l['qty']}" for l in lines] +
                       [f"Total ₹{order['total']} (incl. GST)"])
    qr = qrcode.make(ticket, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    return {**order, "qr_svg": qr.to_string(encoding="unicode")}


class LiftRequest(BaseModel):
    item_ids: list[int]
    before: float
    after: float


@app.post("/api/lift")
def post_lift(req: LiftRequest):
    delta = record_lift(req.item_ids, req.before, req.after)
    return {"delta": round(delta, 1), "leaderboard": leaderboard()}


@app.get("/api/lift")
def get_lift():
    return {"leaderboard": leaderboard()}


def leaderboard():
    by_id = {item["id"]: item for item in MENU}
    rows = [{"id": k, "name": by_id[k]["name"], "section": by_id[k]["section"], **v}
            for k, v in lift_stats().items() if k in by_id]
    return sorted(rows, key=lambda r: -r["avg"])[:8]


MENU_TEXT = "\n".join(
    f"#{it['id']} {it['name']} | {it['section']} | {it['course']} | ₹{it['price']} | {'veg' if it['veg'] else 'non-veg'}"
    f" | spice {it.get('spicy', 0)}/2 | allergens: {', '.join(it.get('allergens', [])) or 'none listed'}"
    f"{' | chef recommended' if it.get('chef') else ''}{' | new' if it.get('new') else ''} | {it['desc']}"
    for it in MENU)

CHAT_SYSTEM = """You are "Smashy", the friendly in-app assistant for Smash Guys, a burger and comfort-food restaurant.
The app reads the diner's mood from their face and suggests food; you help them choose, answer questions about dishes,
prices, diet, spice and allergens, and suggest combos.

Rules:
- Only recommend dishes from the MENU below. Never invent dishes, prices or ingredients.
- Every time you mention a dish, write its id tag right after the name, like "Brisket Mac [#15]". The app turns tags into
  "add to order" buttons.
- Respect the diner's filters (diet, max spice, allergens to avoid, budget) unless they ask otherwise.
- Budgets: never claim a combo fits a budget unless the prices add up. When "BUDGET COMBO" is given below, prefer it
  and quote its exact total; otherwise list each price and the exact sum.
- Prices are in rupees before 5% GST. All burger buns contain milk. For serious allergies, tell them to confirm with staff.
- Be warm, playful and brief: 2-5 short sentences or a short list. Use the mood to pick dishes, but don't lecture about feelings.
- Plain text only: no tables or headings. You may use **bold** and "- " bullet lines.
- If asked something unrelated to the restaurant or food, answer briefly and steer back to the menu.

MENU (id name | section | course | price | diet | spice | allergens | flags | description):
""" + MENU_TEXT + "\n\nALLERGEN INDEX (complete and exact: use it to answer any allergen question):\n" + "\n".join(
    f"- {a}: " + ", ".join(f"{it['name']} [#{it['id']}]" for it in MENU if a in it.get("allergens", []))
    for a in ("nuts", "egg", "alcohol", "mushroom"))


def _facts():
    """Exact answers to 'cheapest / most expensive / how many' questions, so the model never has to scan 72 prices."""
    lines = []
    for course in ("main", "side", "drink", "dessert"):
        items = [it for it in MENU if it["course"] == course]
        lo, hi = min(items, key=lambda i: i["price"]), max(items, key=lambda i: i["price"])
        lines.append(f"- {course}s ({len(items)}): cheapest {lo['name']} [#{lo['id']}] ₹{lo['price']}; priciest {hi['name']} [#{hi['id']}] ₹{hi['price']}")
    lo, hi = min(MENU, key=lambda i: i["price"]), max(MENU, key=lambda i: i["price"])
    lines.append(f"- whole menu ({len(MENU)} dishes, {sum(i['veg'] for i in MENU)} veg): cheapest {lo['name']} [#{lo['id']}] ₹{lo['price']}; "
                 f"priciest {hi['name']} [#{hi['id']}] ₹{hi['price']}")
    return "\n".join(lines)


CHAT_SYSTEM += "\n\nPRICE FACTS (exact, use them for cheapest / most expensive questions):\n" + _facts()


class ChatRequest(BaseModel):
    messages: list[dict] = []
    mood: str = "neutral"
    diet: str = "any"
    max_spice: int = 2
    budget: int | None = None
    avoid: list[str] = []
    cart: list[OrderLine] = []
    people: int = 1


BUDGET_RE = re.compile(r"(?:₹|\brs\.?|\binr|\bunder|\bbelow|\bwithin|\bbudget(?: of| is)?|\bmax(?:imum)?|\bless than)\s*₹?\s*(\d{3,5})\b"
                       r"|\b(\d{3,5})\s*(?:₹|rs\b|rupees|inr\b|bucks)", re.I)


def mentioned_budget(messages):
    """Rupee amount from the latest user message, e.g. 'veg combo under 800' -> 800."""
    last = next((m.get("content", "") for m in reversed(messages) if isinstance(m, dict) and m.get("role") == "user"), "")
    m = BUDGET_RE.search(str(last))
    return int(m.group(1) or m.group(2)) if m else None


@app.get("/api/chat/status")
def chat_status():
    return {"available": groq_chat.available(), "model": groq_chat.MODEL}


@app.post("/api/chat")
async def post_chat(req: ChatRequest):
    by_id = {item["id"]: item for item in MENU}
    mood_key = req.mood if req.mood in MOODS else "neutral"
    hour = time.localtime().tm_hour
    _, part, _ = daypart(hour)
    cart = ", ".join(f"{l.qty} x {by_id[l.id]['name']} [#{l.id}]" for l in req.cart if l.id in by_id) or "empty"
    picks = recommend(mood_key, diet=req.diet, budget=req.budget, avoid=req.avoid, max_spice=req.max_spice,
                      seed=1, hour=hour, lift=lift_stats())
    combo = ", ".join(f"{p['name']} [#{p['id']}]" for p in picks.get("combo", []) if p)
    diner = (f"\n\nCURRENT DINER\n- Mood: {mood_key} ({MOODS[mood_key]['vibe']})\n- Time: {part or 'now'}\n"
             f"- Filters: diet={req.diet}, max spice={req.max_spice}/2, budget per person="
             f"{'₹' + str(req.budget) if req.budget else 'no limit'}, avoid={', '.join(req.avoid) or 'nothing'}\n"
             f"- People at table: {max(1, req.people)}\n- Current order: {cart}\n"
             f"- The app's own mood combo for them: {combo or 'none'}")
    budget = mentioned_budget(req.messages)
    if budget:
        fit = recommend(mood_key, diet=req.diet, budget=budget, avoid=req.avoid, max_spice=req.max_spice,
                        seed=1, hour=hour, lift=lift_stats())
        items = [p for p in fit.get("combo", []) if p]
        total = sum(p["price"] for p in items)
        diner += (f"\n- BUDGET COMBO for ₹{budget} (computed exactly by the app, before GST): "
                  + (" + ".join(f"{p['name']} [#{p['id']}] ₹{p['price']}" for p in items) + f" = ₹{total}"
                     + ("" if total <= budget else " (nothing fits fully; this is the closest)")
                     if items else "nothing on the menu fits"))
    result = await groq_chat.chat(CHAT_SYSTEM + diner, req.messages)
    if "reply" in result:
        ids = [int(x) for x in re.findall(r"\[#(\d+)\]", result["reply"])]
        result["items"] = [{"id": i, "name": by_id[i]["name"], "price": by_id[i]["price"], "veg": by_id[i]["veg"]}
                           for i in dict.fromkeys(ids) if i in by_id]
    return result


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
