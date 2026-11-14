# Face Expression Recognition → two apps: Smash Guys Mood Menu and Conversation Coach

This repository is the training side of a small system that reads facial expressions from a camera and does
something useful with them. It produced the expression model, and that same model drives two separate web apps
that live in their own folders on the Desktop:

| App | Folder | Port | What it is for |
|---|---|---|---|
| **Smash Guys Mood Menu** | `~/Desktop/SmashGuys-MoodMenu` | 8001 | Looks at a diner's face, picks food from a real restaurant menu to match the mood, takes the order, then checks whether the food actually made the person happier |
| **Conversation Coach** | `~/Desktop/ConversationCoach` | 8000 | Looks at the face of the person *you are talking to* and tells you, live, how to talk to them |

Both apps also have a chatbot (Groq-hosted LLM) that knows the live context of the app it sits in.

Everything about video runs on your own computer. The only data that ever leaves it is chat text and, if you use
the optional Listen feature in Chrome, the audio that Chrome itself sends to Google for speech recognition.

---

## Contents

1. [Quick start](#1-quick-start)
2. [How the shared engine works](#2-how-the-shared-engine-works)
3. [Smash Guys Mood Menu: every feature](#3-smash-guys-mood-menu-every-feature)
4. [Conversation Coach: every feature](#4-conversation-coach-every-feature)
5. [The chatbots](#5-the-chatbots)
6. [HTTP and WebSocket API](#6-http-and-websocket-api)
7. [Files, data and configuration](#7-files-data-and-configuration)
8. [Training the expression model](#8-training-the-expression-model)
9. [Measured results](#9-measured-results)
10. [How to re-run the tests](#10-how-to-re-run-the-tests)
11. [Limits and honest caveats](#11-limits-and-honest-caveats)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Quick start

Both apps use Python 3.12 and have their own `venv`. Open two terminals.

```bash
# Terminal 1: Smash Guys Mood Menu  ->  http://localhost:8001
cd ~/Desktop/SmashGuys-MoodMenu
venv/bin/python run.py

# Terminal 2: Conversation Coach  ->  http://localhost:8000
cd ~/Desktop/ConversationCoach
venv/bin/python run.py
```

Useful flags (same for both): `--port 9000` to change the port, `--no-browser` to stop it opening a tab for you.

Use **Chrome or Edge**. Camera access only works on `localhost` or `https`, so keep the address as `http://localhost:…`.

For the chatbots, each app folder has a `.env` file:

```
GROQ_API_KEY=gsk_...your key...
# GROQ_MODEL=openai/gpt-oss-120b      (optional, this is the default)
```

If the key is missing, everything still works except the chat and the AI wingman.

To set up from scratch on a new machine:

```bash
python3.12 -m venv venv
venv/bin/pip install -r requirements.txt
```

The `models/` folder in each app must contain the face detector (`face_detection_yunet_2023mar.onnx`) and at least
one `emotion_*.pt` checkpoint.

---

## 2. How the shared engine works

Both apps run the same pipeline, so it is described once here.

**Camera to server.** The browser grabs a frame from the webcam (or from a shared window in Coach), shrinks it to at
most 640 px wide (1280 px for a shared call, because faces in a Zoom grid are small), compresses it as a JPEG at
quality 0.82 and sends it as a binary message on a WebSocket. It sends the next frame only after the previous answer
has come back, with at least 70 ms between frames, so it never queues up work. That caps the rate at about 14 frames
per second.

**On the server, for every frame:**

1. **Face detection.** YuNet, a small face detector, finds every face of at least 40×40 px and also gives five
   landmark points. (If the YuNet file is missing the app falls back to OpenCV's Haar cascade, which has no
   landmarks.)
2. **Alignment.** The face is rotated so the eyes are level, then cropped to the same framing that the FER-2013
   training photos have: the crop is 1.25× the face width and the eyes sit 40 % of the way down. Output is a 48×48
   grayscale patch.
3. **Classification.** A ResNet-18 (ImageNet-pretrained, fine-tuned) turns the patch into probabilities for seven
   emotions: angry, disgust, fear, happy, neutral, sad, surprise. The crop is also mirrored, both versions are scored
   and the probabilities are averaged (flip test-time augmentation). If a `models/` folder holds several
   `emotion_*.pt` files, all of them are averaged as an ensemble.
4. **Tracking and smoothing.** Faces get a stable id by matching boxes between frames (intersection-over-union above
   0.25, largest faces first). Each face keeps an exponentially smoothed probability vector (new frame weight 0.35). A
   face that disappears is remembered for 8 frames before its id is dropped.
5. The server answers with JSON: for every face its id, box (as fractions of the frame), top emotion, confidence,
   smoothed probabilities (`probs`) and the unsmoothed ones (`raw`), plus how many milliseconds the frame took.

An `asyncio` lock makes sure only one frame is classified at a time, so several open tabs cannot overload the GPU.
On Apple silicon the model runs on the GPU through MPS; elsewhere it uses the CPU.

**In the browser (shared `common.js`):**

* **Stable mood.** The "current" mood is the average of the last 2 seconds of smoothed probabilities. The displayed
  mood only changes after a different mood has led for more than 1.2 seconds. This stops the label from flickering.
* **Positivity (valence).** A single 0–100 score:
  `clamp((happy + 0.35·surprise + 0.15·neutral − 0.6·sad − 0.8·angry − 0.7·disgust − 0.6·fear + 0.8) / 1.8)`.
* **Overlay.** A canvas is drawn exactly over the video, with the face mark drawn by each app in its own style.
* **Click a face to lock onto it** when several people are in view. Click empty space to unlock. If the locked face
  leaves for more than 2 seconds the lock is released.
* **Camera picker.** When more than one camera exists a drop-down appears.
* **Mirroring.** The camera view is mirrored like a mirror; a shared window is not.
* **Auto-reconnect.** If the WebSocket drops, the status pill says "Reconnecting…" and retries after a second.
* **HUD.** A chip shows who is being tracked ("Tracking you", "Tracking them", "No face detected", "🔒 Tracking
  person #2") and another shows frames per second and server milliseconds.
* **Status pill** in the top bar: Idle, Requesting access, Connecting, Live, Reconnecting, Camera blocked, Screen
  share cancelled.
* **Timeline.** A stacked colour chart of the last 60 seconds of emotion probabilities in 120 buckets, with a legend.
* **Deep link.** Opening the app with `?autostart=camera` starts the camera immediately (handy for a kiosk).
* **Caching.** The server tells the browser to re-check static files every time, so edits show up on reload.

---

## 3. Smash Guys Mood Menu: every feature

Open http://localhost:8001. The look is a loud yellow/black comic style to match the Smash Guys brand.

### 3.1 The menu data

* 72 dishes typed in from the six menu-page images in `menu-source/`: 29 mains, 11 sides/salads, 28 drinks,
  4 desserts, across 19 menu sections (Sides, Salad, Mac & Cheese, Veggie / Fried Chicken / Smash Chicken / Classic /
  Exhibition burgers, Dessert, Fresh Juice, Iced Tea, Mocktail, Shakes, Kombucha, Chocolate, Bottled, Coffee, Cold
  Coffee, Matcha).
* Every dish has: id, name, section, course (main / side / drink / dessert), price in rupees, veg or non-veg, a
  description, flavour tags (22 different ones, e.g. comfort, cheesy, crunchy, refreshing, adventurous), a spice level
  0–2, "chef recommended", "new", and allergens taken from the allergen page of the menu (egg, nuts, mushroom,
  alcohol). All burger buns contain milk, which is stated in the footer.
* To change the menu, edit the `MENU` list in `menu_app/menu.py`.

### 3.2 Reading your mood

* **📸 Scan my vibe** starts the camera. The first time a face appears the app starts a scan on its own.
* **The scan** collects 2.5 seconds of *unsmoothed* readings once a face is found, averages them (so one odd frame
  cannot decide it), and shows a progress percentage with a moving laser line and grid over your face. If no face
  shows up in 9 seconds it gives up with a toast ("No face found — move closer to the camera").
* **Slot-machine reveal.** The hero emoji spins through faces and food for about a second and lands on your mood;
  happy and surprise also throw confetti.
* **🔁 Rescan** runs the scan again (only enabled while the camera runs).
* **"Your vibe" card** shows seven bars, one per emotion, with the strongest one in bold, and who it is about
  ("You · #1").
* **"Vibe trend" card** is the 60-second timeline.
* **Pick a mood by hand.** A row of chips (From camera, Angry, Disgust, Fear, Happy, Neutral, Sad, Surprise) lets
  you ignore the camera. "From camera" goes back.

### 3.3 The seven moods

| Mood | Name shown | The recommender leans towards | Mood upgrade offered |
|---|---|---|---|
| Happy | Celebration Mode | indulgent, celebratory, chef's specials, new | Smashed Truffle Burrata (₹135) |
| Sad | Comfort Mode | comfort, cheesy, warm, chocolate, sweet; avoids spicy | Fried egg (₹65) |
| Angry | Cool-Down Mode | refreshing, cold, calming, crunchy; avoids spice and caffeine | none |
| Fear | Safe & Steady | classic, comfort, calming; avoids new, adventurous, spicy, caffeine | none |
| Disgust | Palate Reset | fresh, light, tangy; avoids heavy and cheesy | none |
| Surprise | Adventure Mode | adventurous, new, spicy, chef's picks | BBQ Braised Brisket (₹298) |
| Neutral | Chef's Picks | chef recommended, classics, hearty | none |

The "mood upgrade" is a small extra shown under the combo ("✨ Mood upgrade: …").

### 3.4 The recommender

* **A combo is one main + one side + one drink + one dessert.** Each dish gets a score from its tags weighted by the
  mood, plus a little random noise, so results are not identical every time.
* **Time of day** changes the weights: ☀️ morning (5–12) favours coffee and energy, 🌤️ afternoon (12–17) cold and
  refreshing, 🌆 dinner (17–22) hearty, 🌙 late night indulgent and sweet with no caffeine. The current part of the
  day is shown as a badge in the top bar.
* **Best combo under a budget.** The app searches the top 8 dishes of every course and keeps the best-scoring
  combination that fits the budget. Leaving a course out costs points (a main almost never gets dropped), so with a
  tight budget it drops the dessert or drink first.
* **"% match"** on every card shows how well the dish fits the mood, and a one-line reason ("Pure comfort food ·
  melty, cheesy goodness").
* **Similar-dish guard.** It will not pick two dishes with the same distinctive name word (e.g. two Caesars).
* **More for your mood.** Below the combo, six more picks ranked by score, each with a ＋ button.
* **Badges** on cards: NEW, 👨‍🍳 chef recommended, 🌶️ per spice level, and 😊 +N for dishes with a proven mood lift.
* **Veg / non-veg dot** on every dish, in the usual Indian green and red.
* **Everything is explained:** hovering a badge shows what it means.

### 3.5 Filters

Open the **FILTERS** card; the closed card shows a summary such as "Veg · Mild · ≤ ₹900 · no egg".

* **Diet:** Any, Veg, Non-veg. (Non-veg only forces mains and sides to be non-veg; drinks and desserts stay.)
* **Spice:** Mild, Medium, Hot.
* **Budget per person:** slider from ₹400 to ₹2,500; the far end means no limit.
* **Avoid:** egg, nuts, mushroom, alcohol. A dish with any of the avoided allergens is never shown.
* Any change refreshes the combo straight away.

### 3.6 Shuffle and Lock

* **🔀 Shuffle** gives a new combo. It remembers the dishes it just showed and pushes them down, so the new combo is
  really different (not just a re-roll that can land on the same thing) whenever your filters allow it.
* **🔓 Live / 🔒 Locked.** While *Live*, the picks follow your face. After a scan the app locks on its own so the
  combo stays still while you browse. Tap the lock to switch back to *Live*.

### 3.7 Table mode

Switch **🙋 Solo / 👥 Table** at the top.

* Scan everyone at the table at once. Every face is read separately.
* **Each person** gets a main and a drink for *their own* mood, with their thumbnail, their positivity and their
  share of the bill. No main is repeated between people.
* **To share:** sides and desserts chosen for the most common mood (a tie goes to whoever sits furthest left), in a
  quantity of about one plate per two people.
* **Table total** and **＋ Add table order** put all of it in the cart and set the bill split to the number of
  people.

### 3.8 Cart, order and ticket

* **🛒 Order** button with a live item count opens a side drawer.
* Each line has − and ＋ buttons; going to zero removes it. The drawer shows subtotal, **5 % GST**, total.
* **Split between N people** with a stepper (1–20) and a per-person amount.
* **Place order →** saves the order and shows a receipt-style **ticket** with an order number, time, the mood
  stamp, line items, totals, split and a **QR code** (an SVG) holding the order text, for the server to scan.
* Orders are appended to `data/orders.jsonl`.

### 3.9 Mood Lift: does the food really help?

* After you order, **😋 After-meal mood check** appears. When you have eaten, scan again.
* The change in your positivity (after minus before, on 0–100) is credited to *every dish in that order*.
* Scores are stored in `data/mood_lift.json` and read by the recommender: a dish with a good average lift gets a
  boost for everyone, and a dish with a negative lift sinks. The boost is capped so a single result cannot take
  over completely.
* A **Mood Lift leaderboard** card lists the top dishes with how many checks each has.
* A **toast** reports the result ("Mood lift +80! The food worked 🎉") and a lift above zero throws confetti.
* The ticket is redrawn with a **MOOD LIFT** line.

### 3.10 Mood receipt

**📸 Save my mood receipt** draws a 1080×1350 picture on a canvas and downloads it as a PNG: brand header, your
mood emoji (and the after-meal emoji arrow if you did the check), vibe name, up to 8 lines of the order, total,
mood lift and order number with the hashtag #MoodMenu. It is made for sharing.

### 3.11 Smashy, the chatbot

See [section 5](#5-the-chatbots). In the Menu app, dishes the bot names become **＋ Add** buttons that put the dish
in the real cart.

### 3.12 Small things worth knowing

* Layout collapses to one column below 1100 px and tightens below 720 px; the chat panel fills the screen below
  520 px.
* A "toast" strip at the bottom confirms actions (added to order, combo added, table order added, errors).
* The footer notes that prices are in ₹ before 5 % GST and that dishes come from different kitchens and may not
  arrive in order.
* Video is analysed on your own machine and never uploaded.

---

## 4. Conversation Coach: every feature

Open http://localhost:8000. A dark theme with a glowing "mood ring" around faces.

### 4.1 Getting video in

* **📷 Start camera** points at the person you are talking to. **🖥️ Share a video call** lets you pick a Zoom, Meet
  or Teams window; the app then reads the faces in that window (up to 1280 px wide frames).
* A **Camera / Video call** switch under the stage changes the source later. **■ Stop** stops it, **⏹ End & debrief**
  stops and opens the report.
* The overlay draws a **mood ring** around each face: coloured arc segments sized by each emotion's share, a spinning
  dashed inner ring, and a pill label ("THEM · happy 92 %"). The locked face is drawn brighter.
* The whole page picks up the colour of the current mood (a soft aura behind everything).

### 4.2 The live read

* **Positivity gauge** (0–100) with the mood emoji in the middle.
* Headline and label: "They're enjoying this", "They seem down", "Tension is rising", "They look uneasy", "Something
  put them off", "That caught their attention", "Calm, listening", plus "happy · 90 % confidence".
* **Expressive** meter (how far from neutral) and **Engaged** meter (how much of the last 5 seconds their face was in
  view, reduced when they look blank).
* **Their vibe** card: seven big bars with the strongest in bold, and a radar chart that shows the whole shape of the
  expression at once.
* **Mood timeline** for the last 60 seconds.

### 4.3 What to say next

* **Five settings:** ☕ Casual, 💼 Work, 🤝 Sales, 💛 Date, 🎧 Support. Pick one and every piece of advice is
  rewritten for it.
* For each of the seven moods the playbook gives: a one-sentence read of the situation, the tone to use, the pace,
  three things to do, two things to avoid, and two ready-to-use lines for each setting (7 moods × 5 settings = 35
  sets).
* **Click any line to copy it** to the clipboard.
* **AI wingman ✨** (a second tab on the same card): press *Suggest replies* and the AI reads the last transcript
  lines and the mood journey and returns a one-sentence read, three short things to say and one thing to avoid.
  Tick **Auto on mood change** and it refreshes by itself when their mood changes (at most every 15 seconds).
  It uses Claude if Anthropic credentials are present, otherwise Groq.

### 4.4 Micro-expressions

* The app compares each *raw* (unsmoothed) reading with the steady mood. If a different non-neutral emotion shows
  above 45 % for at least two frames and then the face returns to the steady mood within 0.7 seconds, it records a
  **micro-expression** ("a flash of irritation (0.4 s) behind a happy face") with a toast, a hint on what to do, and
  an entry in the **Micro-expressions** feed with the line that was said just before.
* It only starts looking once the steady mood has held for 1 second.
* Counter "N caught".

### 4.5 Live alerts

Each alert has a 25-second cool-down so it does not nag.

| Alert | When it fires |
|---|---|
| 📉 Mood dipped | positivity falls by more than 22 points compared with the 4–15 s before (and was above 50) |
| 🔥 Tension rising | angry + disgust above 45 % over the last 3 s |
| 😟 They look uneasy | fear above 40 % over 3 s |
| ⚡ Something landed | surprise above 50 % over 1.5 s |
| 😶 Flat engagement | neutral for more than 25 s |
| ✨ Great rapport | happy for more than 12 s |
| 👀 Lost sight of their face | no face for more than 4 s |

Alerts appear as a toast (8 s), go into an **Alerts** feed and are counted in the debrief.

### 4.6 Room mode (several faces)

When two or more people are in view for more than 1.5 s, a **Room** panel appears:

* A card per person with a thumbnail, mood, and positivity. Click a card to lock onto that person.
* Flags: **looked away** (not seen for 1.5 s) and **zoning out?** (neutral for 20 s).
* A **room vibe** label (🔥 buzzing, 🙂 warm, 😐 flat, 🧊 tense) with an average score.
* A **tip** naming whoever looks worst and suggesting how to bring them in ("👉 #2 looks down. Bring them in:
  'What's your take on this?'").

### 4.7 Live transcript with reactions (🎙️ Listen)

* Uses the browser's speech recognition (Chrome sends the audio to Google for this). Continuous mode with interim
  text, restarts itself when the browser ends a session, and tells you if the microphone is blocked.
* Each finished sentence is added with a time stamp and a coloured dot showing their mood when it was said.
* Three seconds before and after (scored after 4 s) are compared. A rise of 10+ points marks the line
  **✨ landed +N**, a drop of 10+ marks it **⚠ hit a nerve −N**.

### 4.8 Session panel

A running clock, a coloured bar showing how the session was split between moods, and a **Reset** link that clears
the session, the alerts, the flashes and the transcript.

### 4.9 Mini coach (🪟)

A small always-on-top window (Document Picture-in-Picture, Chrome/Edge 116+) that floats over Zoom or Meet. It
shows the mood emoji, headline, a positivity bar, the current suggested line and the latest alert, and updates four
times a second.

### 4.10 Debrief

**▤ Debrief** (or End & debrief) builds a report:

* Title with the dominant mood and duration; stats for duration, average positivity, peak (with time), mood change
  from the first third to the last third, number of micro-expressions, lines that landed.
* **Journey chart:** their positivity over time, coloured by mood, with pink bars for micro-expressions and green /
  red dots for lines that landed or hurt.
* **What worked** (top 5 lines) and **What hurt** (bottom 5), or the best and lowest moments when there is no
  transcript.
* **Hidden reactions** (up to 8) and **Coaching for next time**: tips written from the data (you lifted their mood
  by N points, they stayed neutral most of the time, hidden negative reactions around these times, avoid repeating
  this line, your strongest line was this…).
* **🖨️ Print / PDF** and **⬇ Download report**, which saves a standalone HTML file with the chart as an image, all
  the sections and the full transcript.

### 4.11 Coach, the chatbot

See [section 5](#5-the-chatbots).

### 4.12 Small things worth knowing

* The page works on a phone-width screen and prints cleanly (only the debrief prints).
* A "Copied" toast confirms copy actions.
* If the browser has no speech recognition, the Listen button explains that it needs Chrome or Edge.

---

## 5. The chatbots

Both bots are the same small module (`groq_chat.py`) with a different system prompt. A round button at the bottom
right opens the panel.

**The panel.** Header with name and status, a "context bar" that shows what the bot can currently see, the
conversation, a row of starter questions (they disappear after the first message), a text box that grows as you type
(Enter sends, Shift+Enter makes a new line, 1,500 character limit), a typing indicator while it thinks, an **↺** button
to start a new chat and **✕** (or Esc) to close. Replies support bold, italics and bullet lists; the text is escaped
first, so the model cannot inject HTML.

**Smashy 🍔 (Mood Menu).**
* Sees: the whole menu (id, price, diet, spice, allergens, flags, description), an exact allergen index, the
  diner's current mood and time of day, the filters, the people at the table, what is in the cart and the app's own
  combo for them.
* Every dish it mentions carries a hidden id tag that becomes a **＋ Add** button; the server only accepts ids that
  exist, so the bot cannot add an invented dish.
* **Budget questions are computed, not guessed.** If you write "under 700" the server runs the recommender with that
  budget and hands the bot the exact combo and its total.
* Keeps to the menu: it says "no pizza" when there is no pizza.

**Coach 💬 (Conversation Coach).**
* Sees: the setting, the session time, the other person's current mood and positivity (when a face is tracked), the
  playbook advice for that mood and the last 12 transcript lines with their moods.
* Answers briefly: a one-line read and two or three lines you could say. It treats expression readings as hints, and
  refuses to help manipulate people.

**Model and limits.** Default model `openai/gpt-oss-120b` on Groq. The free tier allows about 8,000 tokens a minute
per model, so if a model is rate limited the next one (`openai/gpt-oss-20b`, then `qwen/qwen3.8-27b`) answers
instead. The last 16 messages are sent. Errors are shown as plain messages in the chat (bad key, rate limit, no
internet, certificate problem).

---

## 6. HTTP and WebSocket API

### Mood Menu (port 8001)

| Route | Purpose |
|---|---|
| `GET /` | the app |
| `GET /api/info` | emotion labels, loaded model files, detector name |
| `GET /api/menu` | all 72 dishes |
| `GET /api/recommend` | `mood, diet, budget, avoid[], max_spice, seed, hour, away[]` → combo, total, more picks, add-on, vibe text |
| `GET /api/table` | `moods[]` (one per person) + the same filters → per-person picks, shared plates, totals |
| `POST /api/order` | `{items:[{id,qty}], vibe, people, before}` → order number, totals with 5 % GST, QR as SVG |
| `POST /api/lift` | `{item_ids, before, after}` → delta and the leaderboard |
| `GET /api/lift` | leaderboard |
| `GET /api/chat/status`, `POST /api/chat` | chatbot |
| `WS /ws` | frames in (JPEG bytes), faces out |

### Conversation Coach (port 8000)

| Route | Purpose |
|---|---|
| `GET /` | the app |
| `GET /api/info` | labels, the five settings, models, detector |
| `GET /api/coach?emotion=&context=` | the playbook entry |
| `GET /api/ai/status`, `POST /api/ai/suggest` | the AI wingman |
| `GET /api/chat/status`, `POST /api/chat` | chatbot |
| `WS /ws` | frames in, faces out |

---

## 7. Files, data and configuration

```
SmashGuys-MoodMenu/
  run.py                    start script
  menu_app/
    server.py               FastAPI app, order + QR, chatbot, WebSocket
    menu.py                 the 72 dishes, moods, time-of-day, recommender, table logic
    store.py                orders and Mood Lift storage (thread-safe)
    engine.py               YuNet + alignment + ResNet ensemble + tracker
    model.py                the ResNet definition
    groq_chat.py            Groq client with model fallback
    static/                 index.html, style.css, common.js, menu.js, chatbot.js
  models/                   YuNet + emotion_*.pt
  models_backup/            earlier FER-2013 checkpoint
  menu-source/              the six menu page images
  data/                     orders.jsonl, mood_lift.json   (created on first use)
  .env                      GROQ_API_KEY (not for git)

ConversationCoach/
  run.py
  coach_app/
    server.py  coach.py (playbook)  ai.py (AI wingman)  engine.py  model.py  groq_chat.py
    static/                 index.html, style.css, common.js, coach.js, report.js, chatbot.js
  models/  models_backup/  .env
```

Environment variables: `GROQ_API_KEY`, `GROQ_MODEL`, `MOODMENU_DATA_DIR` (where Menu stores orders and Mood Lift),
`ANTHROPIC_API_KEY` (optional, makes the AI wingman use Claude).

Stored data (Menu only, on your computer): `orders.jsonl` (one order per line with items, totals, vibe, time and the
"before" score) and `mood_lift.json` (per dish: sum of lifts and number of checks). Delete the files to reset
learning. Nothing is stored for Coach on the server; the session lives in the browser tab.

---

## 8. Training the expression model

| Script | What it does |
|---|---|
| `train.py` | the first model: a small Keras CNN (4 conv blocks, 256-unit dense head) on FER-2013 |
| `train_torch.py` | ImageNet-pretrained ResNet-18/34 in PyTorch: random crop, flip, rotation, brightness/contrast, random erasing, mixup on half the batches, label smoothing 0.1, softened class weights, AdamW with one-cycle learning rate; picks the best epoch on a 10 % validation split and scores the test set once at the end |
| `prepare_aligned.py` | re-crops every dataset face the way the live apps do (detect → level the eyes → FER framing) so the model can be trained on camera-style crops too (`--aligned-mix`) |
| `prepare_ferplus.py` | builds the FER+ set (the 10-annotator relabelling): drops contempt, unknown and not-a-face, keeps vote shares |
| `train_ferplus.py` | fine-tunes on the FER+ vote shares with a soft cross-entropy and scores FER+ PrivateTest once |
| `evaluate_ensemble.py` | scores models and their average on the test set |
| `realtimedetection.py` | a bare OpenCV window with live detection |
| `run_app.py` | the original single app that combined both ideas (kept for reference) |

Data: FER-2013 is in `images/train` (28,709) and `images/test` (7,178), FER+ in `data/ferplus_raw` and
`cache/ferplus.npz`.

---

## 9. Measured results

All numbers below were measured on this machine (Apple GPU through MPS). The scripts are in
`Research paper/MoodLens_paper/scripts/` and the raw results in `.../results/`.

**Expression model**

| Model | Test set | Accuracy | Macro-F1 |
|---|---|---|---|
| Keras CNN (first model) | FER-2013 test (7,178) | 64.25 % | 0.611 |
| ResNet-18 | FER-2013 test | 69.99 % | 0.690 |
| ResNet-18, FER+ fine-tuned | FER+ PrivateTest (3,519) | 85.08 % | 0.766 |
| ResNet-18, FER+ (the one shipped in both apps) | FER+ PrivateTest | 83.38 % | 0.755 |

**Speed (one frame, 640×480 camera, one face):** about 23 ms on the server (decode 1 ms, face detection 12 ms,
alignment and classification 10 ms). Over a real WebSocket the round trip averages 30 ms.

**Recommender (3,000 random filter settings):** zero diet, spice, allergen or budget violations and no empty combos.

**End-to-end UI test:** see section 10.

---

## 10. How to re-run the tests

All scripts live in `Research paper/MoodLens_paper/scripts/` (run from the folder named in each file's header).

```bash
# model accuracy on FER-2013 and FER+
cd ~/Desktop/Face-Expressions-Recognition-main
venv/bin/python "Research paper/MoodLens_paper/scripts/01_eval_models.py"

# latency, recommender, chatbots (servers must be running for latency and chatbots)
cd ~/Desktop/SmashGuys-MoodMenu
venv/bin/python "../Face-Expressions-Recognition-main/Research paper/MoodLens_paper/scripts/04_recommender.py"
```

`06_e2e_screens.py` drives both apps in a headless browser with a simulated camera (a still face image), checks about
40 behaviours and takes the screenshots used in the paper. It uses separate copies of the servers on ports 8100 and
8101 and a scratch data folder, so it never touches your real orders.

---

## 11. Limits and honest caveats

* **Expression is not emotion.** The model reads facial movement, not feelings. People smile when they are unhappy
  and look neutral when they are not. Treat readings as hints.
* **Accuracy is limited by the data.** Even on the cleaner FER+ labels about one face in six is wrong; fear and
  sadness are the weakest classes, and fear is confused with surprise.
* **Micro-expressions at about 14 frames per second.** A real micro-expression can last a twentieth of a second, so
  the detector only catches brief flashes that last at least two frames (around 0.14 s) and at most 0.7 s.
* **The mood label is deliberately slow.** The steady mood needs about 2 seconds to change. That is the price of not
  flickering.
* **Training data bias.** FER-2013 faces are mostly small, grayscale web photos; accuracy will vary with lighting,
  camera angle, age, skin tone and glasses.
* **The Menu app is a prototype for one restaurant's menu.** Dish tags are hand-written, and the learning from Mood
  Lift has no per-person memory.
* **Transcripts have no speaker labels.** The AI cannot always tell who said what.
* **Chat quality depends on a free model with rate limits.**
* Chrome is needed for Listen and the Mini coach.

---

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| "Camera blocked" | allow the camera for `localhost` in the browser's site settings; close other apps using the camera |
| Page loads but never says Live | the server is still loading the model (takes a few seconds), or a different program is on the port: use `--port` |
| Chat says "Chatbot is offline" | add `GROQ_API_KEY=…` to the app's `.env` and restart |
| Chat says "Secure connection to Groq failed" | `venv/bin/pip install certifi` |
| Chat says "busy (rate limit)" | wait a few seconds; the free tier is small |
| Wrong colours or old layout | hard reload (⌘⇧R); the app asks the browser to re-check files, but an extension can interfere |
| Faces not found in a video call | share the call window, not the whole screen, and make the grid tiles large; faces under 40 px are ignored |
| Listen does nothing | use Chrome or Edge, allow the microphone |
| "Mini coach needs Chrome or Edge 116+" | update the browser |
