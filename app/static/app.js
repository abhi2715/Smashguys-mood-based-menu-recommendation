"use strict";

const LABELS = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"];
const EMOJI = { angry: "😠", disgust: "🤢", fear: "😨", happy: "😊", neutral: "😐", sad: "😢", surprise: "😮" };
const COLORS = Object.fromEntries(LABELS.map(l => [l, getComputedStyle(document.documentElement).getPropertyValue(`--c-${l}`).trim()]));
const CONTEXTS = { casual: "☕ Casual chat", work: "💼 Work / meeting", sales: "🤝 Sales / negotiation", date: "💛 Date / personal", support: "🎧 Customer support" };

const MIN_FRAME_MS = 70;          // cap ~14 fps
const MOOD_WINDOW_MS = 2000;      // average this much history for the "current" mood
const MOOD_SWITCH_MS = 1200;      // a new mood must lead this long before we switch
const TIMELINE_MS = 60000;
const ALERT_COOLDOWN_MS = 25000;

const $ = id => document.getElementById(id);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const state = {
  mode: "coach",
  source: "camera",
  deviceId: null,
  stream: null,
  ws: null,
  running: false,
  waiting: false,
  lastSend: 0,
  faces: [],
  targetId: null,
  targetLostAt: 0,
  lastSeenTarget: 0,
  history: [],            // {t, probs} for the tracked face
  stableMood: null,
  candidate: null,
  candidateSince: 0,
  stableSince: 0,
  context: "casual",
  alertsAt: {},
  session: { start: 0, elapsed: 0, counts: Object.fromEntries(LABELS.map(l => [l, 0])), lastT: 0 },
  menu: { diet: "any", spice: 2, budget: null, avoid: new Set(), locked: false, manualMood: null, seed: 1, shownMood: null },
};

const video = $("video");
const overlay = $("overlay");
const octx = overlay.getContext("2d");
const grab = document.createElement("canvas");
const gctx = grab.getContext("2d");

/* ------------------------------------------------------------------ */
/* Static UI setup                                                     */
/* ------------------------------------------------------------------ */
function buildBars() {
  const bars = $("bars");
  for (const l of LABELS) {
    const row = el("div", "bar-row");
    row.dataset.label = l;
    row.innerHTML = `<span class="bar-name">${EMOJI[l]} ${l}</span>
      <div class="bar-track"><div class="bar-fill" style="background:${COLORS[l]}"></div></div>
      <span class="bar-val">0%</span>`;
    bars.appendChild(row);
  }
  $("legend").innerHTML = LABELS.map(l => `<span><i style="background:${COLORS[l]}"></i>${l}</span>`).join("");
  $("session-bars").innerHTML = LABELS.map(l => `<div title="${l}" style="background:${COLORS[l]};width:0"></div>`).join("");
}

function buildChips() {
  const chips = $("context-chips");
  for (const [key, label] of Object.entries(CONTEXTS)) {
    const b = el("button", "chip" + (key === state.context ? " active" : ""), label);
    b.dataset.context = key;
    b.onclick = () => {
      state.context = key;
      chips.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.context === key));
      loadCoach(state.stableMood || "neutral");
    };
    chips.appendChild(b);
  }
  const picker = $("mood-picker");
  const auto = el("button", "mood-chip active", "📷 Live");
  auto.dataset.mood = "";
  picker.appendChild(auto);
  for (const l of LABELS) {
    const b = el("button", "mood-chip", `${EMOJI[l]} ${l}`);
    b.dataset.mood = l;
    picker.appendChild(b);
  }
  picker.onclick = e => {
    const b = e.target.closest(".mood-chip");
    if (!b) return;
    state.menu.manualMood = b.dataset.mood || null;
    picker.querySelectorAll(".mood-chip").forEach(c => c.classList.toggle("active", c === b));
    loadMenu(true);
  };
}

function setStatus(text, kind) {
  $("status-text").textContent = text;
  $("status").className = "status-pill" + (kind ? " " + kind : "");
}

/* ------------------------------------------------------------------ */
/* Mode + source                                                       */
/* ------------------------------------------------------------------ */
function setMode(mode) {
  state.mode = mode;
  document.body.dataset.mode = mode;
  document.querySelectorAll(".mode-btn").forEach(b => {
    const on = b.dataset.mode === mode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on);
  });
  $("panel-coach").hidden = mode !== "coach";
  $("panel-menu").hidden = mode !== "menu";
  if (mode === "coach") {
    $("empty-title").textContent = "Read the room in real time";
    $("empty-sub").textContent = "Point your camera at the person you're talking to, or share your video-call window. Everything runs locally on this machine.";
  } else {
    $("empty-title").textContent = "What's your mood today?";
    $("empty-sub").textContent = "Look into the camera — we'll read your mood and build the perfect Smash Guys order for it.";
    loadMenu(true);
  }
  updateHud();
}

async function start(source) {
  stop(false);
  state.source = source;
  document.querySelectorAll("#source-seg .seg-btn").forEach(b => b.classList.toggle("active", b.dataset.source === source));
  try {
    setStatus("Requesting access…");
    if (source === "screen") {
      state.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
    } else {
      const constraints = { video: state.deviceId ? { deviceId: { exact: state.deviceId } } : { width: 1280, height: 720, facingMode: "user" }, audio: false };
      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
      listCameras();
    }
  } catch (err) {
    setStatus(source === "screen" ? "Screen share cancelled" : "Camera blocked", "error");
    console.error(err);
    return;
  }
  state.stream.getVideoTracks()[0].addEventListener("ended", () => stop());
  video.srcObject = state.stream;
  video.classList.toggle("mirror", source === "camera");
  await video.play();
  const ar = (video.videoWidth || 16) / (video.videoHeight || 9);
  $("stage").style.aspectRatio = `${ar}`;
  $("stage-empty").hidden = true;
  $("stage-hud").hidden = false;
  $("stop-btn").hidden = false;
  state.running = true;
  if (!state.session.start) state.session.start = performance.now();
  state.session.lastT = performance.now();
  connect();
}

function stop(resetUi = true) {
  state.running = false;
  state.waiting = false;
  if (state.ws) { state.ws.onclose = null; state.ws.close(); state.ws = null; }
  if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
  if (resetUi) {
    video.srcObject = null;
    $("stage-empty").hidden = false;
    $("stage-hud").hidden = true;
    $("stop-btn").hidden = true;
    state.faces = [];
    drawOverlay();
    setStatus("Idle");
  }
}

async function listCameras() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
  const sel = $("camera-select");
  sel.hidden = devices.length < 2;
  const current = state.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  sel.innerHTML = devices.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === current ? "selected" : ""}>${esc(d.label || `Camera ${i + 1}`)}</option>`).join("");
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */
function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.binaryType = "arraybuffer";
  state.ws = ws;
  setStatus("Connecting…");
  ws.onopen = () => { setStatus("Live", "live"); state.waiting = false; pump(); };
  ws.onmessage = e => {
    state.waiting = false;
    handleResult(JSON.parse(e.data));
    const wait = Math.max(0, MIN_FRAME_MS - (performance.now() - state.lastSend));
    setTimeout(pump, wait);
  };
  ws.onclose = () => {
    if (state.running) { setStatus("Reconnecting…", "error"); setTimeout(() => state.running && connect(), 1000); }
  };
}

function pump() {
  if (!state.running || state.waiting || !state.ws || state.ws.readyState !== 1 || !video.videoWidth) return;
  const maxW = state.source === "screen" ? 1280 : 640;   // faces in call grids are small: keep more pixels
  const scale = Math.min(1, maxW / video.videoWidth);
  grab.width = Math.round(video.videoWidth * scale);
  grab.height = Math.round(video.videoHeight * scale);
  gctx.drawImage(video, 0, 0, grab.width, grab.height);
  state.waiting = true;
  state.lastSend = performance.now();
  grab.toBlob(blob => {
    if (blob && state.ws && state.ws.readyState === 1) blob.arrayBuffer().then(buf => state.ws.send(buf));
    else state.waiting = false;
  }, "image/jpeg", 0.82);
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */
let fpsT = performance.now(), fpsN = 0, fps = 0;

function handleResult(res) {
  const now = performance.now();
  state.faces = res.faces || [];
  fpsN++;
  if (now - fpsT > 1000) { fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; }
  $("hud-perf").textContent = `${fps.toFixed(0)} fps · ${res.ms ?? "–"} ms`;

  // Resolve which face we're tracking
  let target = null;
  if (state.targetId != null) {
    target = state.faces.find(f => f.id === state.targetId) || null;
    if (target) state.lastSeenTarget = now;
    else if (now - state.lastSeenTarget > 2000) state.targetId = null;
  }
  if (!target && state.targetId == null) target = state.faces[0] || null;
  if (target) state.lastSeenTarget = now;

  if (target) state.history.push({ t: now, probs: target.probs });
  while (state.history.length && now - state.history[0].t > TIMELINE_MS) state.history.shift();

  drawOverlay(target);
  updateHud(target);
  updateBars(target);
  updateMood(now, target);
  updateSession(now);
  if (state.mode === "coach") checkAlerts(now, target);
}

function avgProbs(sinceMs, untilMs = 0) {
  const now = performance.now();
  const out = Object.fromEntries(LABELS.map(l => [l, 0]));
  let n = 0;
  for (const h of state.history) {
    const age = now - h.t;
    if (age <= sinceMs && age >= untilMs) { for (const l of LABELS) out[l] += h.probs[l]; n++; }
  }
  if (!n) return null;
  for (const l of LABELS) out[l] /= n;
  return out;
}
const argmax = p => LABELS.reduce((a, b) => (p[b] > p[a] ? b : a), LABELS[0]);
const valence = p => clamp((p.happy + 0.35 * p.surprise + 0.15 * p.neutral - 0.6 * p.sad - 0.8 * p.angry - 0.7 * p.disgust - 0.6 * p.fear + 0.8) / 1.8, 0, 1);

function updateMood(now, target) {
  const cur = target ? avgProbs(MOOD_WINDOW_MS) : null;
  if (!cur) {
    if (!target && state.stableMood == null) {
      $("coach-headline").textContent = state.running ? "Looking for a face…" : "Waiting for a face…";
    }
    return;
  }
  const top = argmax(cur);
  if (state.stableMood == null) {
    setStableMood(top, now);
  } else if (top !== state.stableMood) {
    if (state.candidate !== top) { state.candidate = top; state.candidateSince = now; }
    else if (now - state.candidateSince > MOOD_SWITCH_MS) setStableMood(top, now);
  } else {
    state.candidate = null;
  }

  const v = valence(cur), a = 1 - cur.neutral;
  $("valence-val").textContent = Math.round(v * 100);
  $("valence-fill").style.width = `${v * 100}%`;
  $("valence-fill").style.backgroundPosition = `${-(1 - v) * 150}px 0`;
  $("arousal-val").textContent = Math.round(a * 100);
  $("arousal-fill").style.width = `${a * 100}%`;
  $("coach-mood-label").textContent = `${state.stableMood} · ${Math.round(cur[state.stableMood] * 100)}% confidence`;
}

function setStableMood(mood, now) {
  state.stableMood = mood;
  state.stableSince = now;
  state.candidate = null;
  const em = $("coach-emoji");
  em.textContent = EMOJI[mood];
  em.classList.remove("bump"); void em.offsetWidth; em.classList.add("bump");
  $("coach-hero").style.setProperty("--mood-color", COLORS[mood]);
  loadCoach(mood);
  if (!state.menu.locked && !state.menu.manualMood) loadMenu(false);
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */
function contentRect() {
  const W = overlay.clientWidth, H = overlay.clientHeight;
  const vw = video.videoWidth || W, vh = video.videoHeight || H;
  const s = Math.min(W / vw, H / vh);
  return { x: (W - vw * s) / 2, y: (H - vh * s) / 2, w: vw * s, h: vh * s };
}

function drawOverlay(target) {
  const dpr = window.devicePixelRatio || 1;
  const W = overlay.clientWidth, H = overlay.clientHeight;
  if (overlay.width !== Math.round(W * dpr)) { overlay.width = Math.round(W * dpr); overlay.height = Math.round(H * dpr); }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, W, H);
  if (!state.running) return;
  const r = contentRect();
  const mirror = state.source === "camera";
  for (const f of state.faces) {
    let [x, y, w, h] = f.box;
    if (mirror) x = 1 - x - w;
    const bx = r.x + x * r.w, by = r.y + y * r.h, bw = w * r.w, bh = h * r.h;
    const isTarget = target && f.id === target.id;
    const c = COLORS[f.emotion];
    octx.save();
    octx.strokeStyle = c;
    octx.lineWidth = isTarget ? 3 : 1.5;
    octx.globalAlpha = isTarget ? 1 : 0.65;
    if (isTarget) { octx.shadowColor = c; octx.shadowBlur = 14; }
    // corner brackets
    const k = Math.min(bw, bh) * 0.22;
    octx.beginPath();
    for (const [cx, cy, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) {
      octx.moveTo(cx + dx * k, cy); octx.lineTo(cx, cy); octx.lineTo(cx, cy + dy * k);
    }
    octx.stroke();
    octx.shadowBlur = 0;
    // label
    const who = isTarget ? (state.mode === "coach" ? "THEM · " : "YOU · ") : "";
    const text = `${EMOJI[f.emotion]} ${who}${f.emotion} ${Math.round(f.confidence * 100)}%`;
    octx.font = "600 13px Inter, system-ui, sans-serif";
    const tw = octx.measureText(text).width + 16;
    const ly = by - 30 > 4 ? by - 30 : by + bh + 6;
    octx.fillStyle = "rgba(10,12,17,.82)";
    roundRect(octx, bx, ly, tw, 24, 12); octx.fill();
    octx.strokeStyle = c; octx.lineWidth = 1; roundRect(octx, bx, ly, tw, 24, 12); octx.stroke();
    octx.fillStyle = "#fff";
    octx.fillText(text, bx + 8, ly + 16.5);
    octx.restore();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function updateHud(target) {
  const who = state.mode === "coach" ? "them" : "you";
  let text;
  if (!state.faces.length) text = "No face detected";
  else if (state.targetId != null) text = `🔒 Tracking person #${state.targetId} (click empty space to unlock)`;
  else text = `Tracking ${who}${state.faces.length > 1 ? ` · ${state.faces.length} faces — click one to lock` : ""}`;
  $("hud-target").textContent = text;
  $("breakdown-who").textContent = target ? (state.mode === "coach" ? "Them" : "You") + ` · #${target.id}` : "—";
}

function updateBars(target) {
  const p = target ? target.probs : null;
  const top = p ? argmax(p) : null;
  for (const row of $("bars").children) {
    const l = row.dataset.label;
    const v = p ? p[l] : 0;
    row.querySelector(".bar-fill").style.width = `${v * 100}%`;
    row.querySelector(".bar-val").textContent = `${Math.round(v * 100)}%`;
    row.classList.toggle("top", l === top);
  }
}

function drawTimeline() {
  const cv = $("timeline");
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  // grid
  c.strokeStyle = "rgba(255,255,255,.05)"; c.lineWidth = 1;
  for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(0, (H * i) / 4); c.lineTo(W, (H * i) / 4); c.stroke(); }
  const BUCKETS = 120, now = performance.now(), bucketMs = TIMELINE_MS / BUCKETS;
  const sums = Array.from({ length: BUCKETS }, () => null);
  for (const h of state.history) {
    const b = BUCKETS - 1 - Math.floor((now - h.t) / bucketMs);
    if (b < 0) continue;
    if (!sums[b]) sums[b] = { n: 0, ...Object.fromEntries(LABELS.map(l => [l, 0])) };
    sums[b].n++; for (const l of LABELS) sums[b][l] += h.probs[l];
  }
  const bw = W / BUCKETS;
  for (let b = 0; b < BUCKETS; b++) {
    const s = sums[b];
    if (!s) continue;
    let y = H;
    for (const l of LABELS) {
      const hh = (s[l] / s.n) * H;
      c.fillStyle = COLORS[l];
      c.globalAlpha = 0.85;
      c.fillRect(b * bw, y - hh, bw + 0.6, hh);
      y -= hh;
    }
  }
  c.globalAlpha = 1;
  if (!state.history.length) {
    c.fillStyle = "#8a93a6"; c.font = "12px Inter, system-ui"; c.textAlign = "center";
    c.fillText("Mood history appears here", W / 2, H / 2 + 4);
  }
}

/* ------------------------------------------------------------------ */
/* Coach                                                               */
/* ------------------------------------------------------------------ */
let coachReq = 0;
async function loadCoach(mood) {
  const id = ++coachReq;
  const data = await fetch(`/api/coach?emotion=${mood}&context=${state.context}`).then(r => r.json());
  if (id !== coachReq) return;
  $("coach-headline").textContent = data.headline;
  $("coach-read").textContent = data.read;
  $("coach-tone").textContent = `Tone · ${data.tone}`;
  $("coach-pace").textContent = `Pace · ${data.pace}`;
  $("coach-do").innerHTML = data.do.map(x => `<li>${esc(x)}</li>`).join("");
  $("coach-avoid").innerHTML = data.avoid.map(x => `<li>${esc(x)}</li>`).join("");
  const say = $("coach-say");
  say.innerHTML = "";
  for (const q of data.say) {
    const b = el("button", "quote", esc(q));
    b.onclick = () => copy(q);
    say.appendChild(b);
  }
}

const ALERTS = {
  dip: { icon: "📉", title: "Mood dipped", kind: "warn", text: "Their positivity just dropped. Pause and check in: “How does that sound to you?”" },
  tension: { icon: "🔥", title: "Tension rising", kind: "warn", text: "Slow down, lower your voice and acknowledge their point before continuing." },
  worry: { icon: "😟", title: "They look uneasy", kind: "warn", text: "Reassure them, simplify, and spell out clear next steps." },
  surprise: { icon: "⚡", title: "Something landed", kind: "info", text: "Pause and let it sink in, then ask how it felt to them." },
  flat: { icon: "😶", title: "Flat engagement", kind: "info", text: "They've been neutral for a while. Ask an open question or share a quick story." },
  rapport: { icon: "✨", title: "Great rapport", kind: "good", text: "They're enjoying this — a good moment for your key point or ask." },
  lost: { icon: "👀", title: "Lost sight of their face", kind: "info", text: "Make sure their face is visible, front-on and well lit." },
};

function checkAlerts(now, target) {
  const fire = key => {
    if (now - (state.alertsAt[key] || -Infinity) < ALERT_COOLDOWN_MS) return;
    state.alertsAt[key] = now;
    showAlert(ALERTS[key]);
  };
  if (!target) {
    if (state.history.length && now - state.lastSeenTarget > 4000) fire("lost");
    return;
  }
  const recent = avgProbs(3000);
  const before = avgProbs(15000, 4000);
  if (!recent) return;
  if (before && valence(before) > 0.5 && valence(before) - valence(recent) > 0.22) fire("dip");
  if (recent.angry + recent.disgust > 0.45) fire("tension");
  if (recent.fear > 0.4) fire("worry");
  const quick = avgProbs(1500);
  if (quick && quick.surprise > 0.5) fire("surprise");
  if (state.stableMood === "neutral" && now - state.stableSince > 25000) fire("flat");
  if (state.stableMood === "happy" && now - state.stableSince > 12000) fire("rapport");
}

let toastTimer = null;
function showAlert(a) {
  const t = $("alert-toast");
  t.className = "alert-toast" + (a.kind === "good" ? " good" : "");
  t.innerHTML = `<span class="ai">${a.icon}</span><div><b>${a.title}</b>${a.text}</div>`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 8000);
  const feed = $("alert-feed");
  if (feed.querySelector(".muted")) feed.innerHTML = "";
  const li = el("li", null, `<time>${fmtTime(state.session.elapsed)}</time><span>${a.icon} <b>${a.title}</b> — ${a.text}</span>`);
  feed.prepend(li);
  while (feed.children.length > 30) feed.lastChild.remove();
}

function updateSession(now) {
  const s = state.session;
  const dt = Math.min(500, now - s.lastT);
  s.lastT = now;
  s.elapsed += dt;
  if (state.stableMood) s.counts[state.stableMood] += dt;
}

function renderSession() {
  const s = state.session;
  $("session-time").textContent = fmtTime(s.elapsed);
  const total = LABELS.reduce((a, l) => a + s.counts[l], 0) || 1;
  [...$("session-bars").children].forEach((d, i) => {
    const l = LABELS[i];
    d.style.width = `${(s.counts[l] / total) * 100}%`;
    d.title = `${l}: ${Math.round((s.counts[l] / total) * 100)}%`;
  });
}

const fmtTime = ms => { const t = Math.floor(ms / 1000); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

function copy(text) {
  navigator.clipboard?.writeText(text);
  const t = $("copy-toast");
  t.hidden = false;
  clearTimeout(copy.timer);
  copy.timer = setTimeout(() => { t.hidden = true; }, 1200);
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */
let menuReq = 0;
async function loadMenu(force) {
  const m = state.menu;
  const mood = m.manualMood || state.stableMood || "neutral";
  if (!force && mood === m.shownMood) return;
  const params = new URLSearchParams({ mood, diet: m.diet, max_spice: m.spice, seed: m.seed });
  if (m.budget) params.set("budget", m.budget);
  for (const a of m.avoid) params.append("avoid", a);
  const id = ++menuReq;
  const data = await fetch(`/api/recommend?${params}`).then(r => r.json());
  if (id !== menuReq) return;
  m.shownMood = mood;
  const live = !m.manualMood && !state.stableMood;
  $("menu-emoji").textContent = live ? "🍔" : data.emoji;
  $("menu-vibe").textContent = live ? "Show us your face" : data.vibe;
  $("menu-line").textContent = live ? "Start the camera and we'll read your mood — or pick one below. Here are the chef's picks meanwhile." : data.line;

  const combo = $("combo");
  combo.innerHTML = data.combo.length ? "" : `<p class="empty-note">Nothing fits those filters — try loosening them.</p>`;
  for (const it of data.combo) combo.appendChild(foodCard(it));
  $("combo-total").textContent = `₹${data.total.toLocaleString("en-IN")}`;

  const addon = $("addon");
  if (data.addon) {
    addon.hidden = false;
    addon.innerHTML = `✨ <b>Mood upgrade:</b> add <b>${esc(data.addon.name)}</b> (₹${data.addon.price}) — ${esc(data.addon.desc)}`;
  } else addon.hidden = true;

  $("more").innerHTML = data.more.map(it => `
    <div class="more-row">
      <div>
        <div class="food-name"><i class="vdot ${it.veg ? "veg" : "nonveg"}"></i>${esc(it.name)} ${badges(it)}</div>
        <div class="food-reason">${esc(it.reason)} · <span class="muted">${esc(it.section)}</span></div>
      </div>
      <span class="price">₹${it.price}</span>
    </div>`).join("");
}

const COURSE_LABEL = { main: "🍔 Main", side: "🍟 Side", drink: "🥤 Drink", dessert: "🍫 Dessert" };
function foodCard(it) {
  const d = el("div", "food");
  d.innerHTML = `
    <div class="food-course"><span>${COURSE_LABEL[it.course]}</span><span class="match">${it.match}% match</span></div>
    <div class="food-name"><i class="vdot ${it.veg ? "veg" : "nonveg"}"></i>${esc(it.name)}</div>
    <div class="food-desc">${esc(it.desc)}</div>
    <div class="food-reason">→ ${esc(it.reason)}</div>
    <div class="food-foot"><div class="badges">${badges(it)}</div><span class="price">₹${it.price}</span></div>`;
  return d;
}
function badges(it) {
  let s = "";
  if (it.new) s += `<span class="badge new">NEW</span>`;
  if (it.chef) s += `<span class="badge chef" title="Chef recommended">👨‍🍳</span>`;
  if (it.spicy) s += `<span class="badge" title="Spicy">${"🌶️".repeat(it.spicy)}</span>`;
  return s;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */
document.querySelectorAll(".mode-btn").forEach(b => b.onclick = () => setMode(b.dataset.mode));
document.querySelectorAll("[data-start]").forEach(b => b.onclick = () => start(b.dataset.start));
document.querySelectorAll("#source-seg .seg-btn").forEach(b => b.onclick = () => start(b.dataset.source));
$("stop-btn").onclick = () => stop();
$("camera-select").onchange = e => { state.deviceId = e.target.value; start("camera"); };

overlay.addEventListener("click", e => {
  if (!state.running) return;
  const rect = overlay.getBoundingClientRect();
  const r = contentRect();
  let nx = (e.clientX - rect.left - r.x) / r.w, ny = (e.clientY - rect.top - r.y) / r.h;
  if (state.source === "camera") nx = 1 - nx;
  const hit = state.faces.find(f => nx >= f.box[0] && nx <= f.box[0] + f.box[2] && ny >= f.box[1] && ny <= f.box[1] + f.box[3]);
  state.targetId = hit ? hit.id : null;
  state.lastSeenTarget = performance.now();
  state.history = [];
  state.stableMood = null;
  updateHud(hit);
});

$("reset-session").onclick = () => {
  state.session = { start: performance.now(), elapsed: 0, counts: Object.fromEntries(LABELS.map(l => [l, 0])), lastT: performance.now() };
  state.alertsAt = {};
  $("alert-feed").innerHTML = `<li class="muted small">No alerts yet.</li>`;
  renderSession();
};

const segPick = (segId, attr, fn) => $(segId).addEventListener("click", e => {
  const b = e.target.closest(".seg-btn");
  if (!b) return;
  $(segId).querySelectorAll(".seg-btn").forEach(x => x.classList.toggle("active", x === b));
  fn(b.dataset[attr]);
  loadMenu(true);
});
segPick("diet-seg", "diet", v => { state.menu.diet = v; });
segPick("spice-seg", "spice", v => { state.menu.spice = Number(v); });
$("budget").addEventListener("input", e => {
  const v = Number(e.target.value);
  state.menu.budget = v >= 2500 ? null : v;
  $("budget-val").textContent = state.menu.budget ? `≤ ₹${v}` : "No limit";
});
$("budget").addEventListener("change", () => loadMenu(true));
$("avoid-chips").addEventListener("click", e => {
  const b = e.target.closest(".chip");
  if (!b) return;
  const a = b.dataset.avoid;
  state.menu.avoid.has(a) ? state.menu.avoid.delete(a) : state.menu.avoid.add(a);
  b.classList.toggle("active", state.menu.avoid.has(a));
  loadMenu(true);
});
$("shuffle-btn").onclick = () => { state.menu.seed = Math.floor(Math.random() * 1e6); loadMenu(true); };
$("lock-btn").onclick = () => {
  state.menu.locked = !state.menu.locked;
  $("lock-btn").textContent = state.menu.locked ? "🔒 Locked" : "🔓 Live";
  if (!state.menu.locked) loadMenu(true);
};

window.addEventListener("resize", () => drawOverlay());
setInterval(() => { drawTimeline(); renderSession(); }, 500);

buildBars();
buildChips();
loadCoach("neutral").then(() => {
  $("coach-headline").textContent = "Waiting for a face…";
  $("coach-read").textContent = "Once a face is detected, you'll get live guidance on how to talk to them.";
});
drawTimeline();

// Optional deep link, e.g. /?mode=menu&autostart=camera (handy for kiosks)
const params = new URLSearchParams(location.search);
if (params.get("mode") === "menu") setMode("menu");
if (params.get("autostart") === "camera") start("camera");
