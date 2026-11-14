# Smash Guys Mood Menu

Scans your face, reads your mood and builds a matching order from the Smash Guys menu — then measures whether
the food actually made you happier.

## Run

```
python3.12 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/python run.py
```

Opens http://localhost:8001. Press **📸 Scan my vibe**, or pick a mood by hand.

## Features

| Feature | What it does |
|---|---|
| **Vibe scan** | A 2.5 s scan averages your expression (no flicker), then a slot-machine reveal lands on your mood |
| **Mood combo** | Main + side + drink + dessert matched to your mood, each with a reason; best combo under your budget |
| **Time of day** | Morning coffee, afternoon coolers, dinner hearties, late-night indulgence |
| **Table mode** | Scans everyone at the table: each person gets picks for their own mood, plus plates to share and a per-person bill |
| **Order + QR ticket** | Cart with quantities, 5% GST and bill split; placing an order prints a ticket with a QR code for the server |
| **Mood Lift** | After eating, tap *After-meal mood check*: we rescan and record how much each dish lifted the mood |
| **Learning recommender** | Dishes with a proven mood lift get boosted for everyone and show a 😊 +N badge; a leaderboard ranks them |
| **Mood receipt** | Download a shareable image of your order, vibe and mood lift |
| **Filters** | Veg / non-veg, spice level, budget, allergens (egg, nuts, mushroom, alcohol — from the menu's allergen page) |

| Mood | Vibe | Leans towards |
|---|---|---|
| Happy | Celebration Mode | indulgent, celebratory, chef's specials |
| Sad | Comfort Mode | mac & cheese, warm, chocolate |
| Angry | Cool-Down Mode | icy, refreshing, calming, no spice or caffeine |
| Fear | Safe & Steady | familiar classics, soothing drinks |
| Disgust | Palate Reset | fresh, light, zesty |
| Surprise | Adventure Mode | new, bold, unusual |
| Neutral | Chef's Picks | chef recommended, classics |

Video is analysed on this machine and never uploaded. Orders and Mood Lift scores are stored locally in `data/`
(set `MOODMENU_DATA_DIR` to keep them elsewhere).

## Chatbot (Smashy 🍔)

Tap **🍔 Chat** (bottom-right) to talk to Smashy, a Groq-powered assistant that knows the whole menu, your current mood,
filters and order. It answers questions about dishes, prices, diet, spice and allergens, builds combos (budgets are
computed exactly by the recommender), and every dish it mentions gets a **＋ Add** button that drops it into your order.

The key lives in `.env` (git-ignored): `GROQ_API_KEY=gsk_...` (optional `GROQ_MODEL=...`). If a model hits the free-tier
rate limit, the next one (`gpt-oss-120b` → `gpt-oss-20b` → `qwen3.8-27b`) answers instead. Chat messages, mood and
order go to the Groq API; video never does.

## Layout

- `menu_app/menu.py` – menu data (from `menu-source/`) and the mood/time/lift-aware recommender, incl. table orders
- `menu_app/store.py` – orders and Mood Lift persistence
- `menu_app/engine.py` – YuNet face detection, eye alignment, emotion model ensemble, per-face smoothing
- `menu_app/server.py` – FastAPI server, order + QR endpoint, WebSocket frame stream
- `menu_app/static/` – UI: `common.js` (shared live-camera layer), `menu.js`
- `models/` – every `emotion_*.pt` in here is averaged into the ensemble, plus the YuNet face detector

To change the menu, edit `MENU` in `menu_app/menu.py`.
