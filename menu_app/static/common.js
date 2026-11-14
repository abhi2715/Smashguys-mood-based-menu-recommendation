"use strict";
// Shared live-emotion layer: camera / screen capture, streaming to the server, face overlay,
// emotion bars, timeline and mood stabilisation. Each app plugs in through `hooks`.

const LABELS = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"];
const EMOJI = { angry: "😠", disgust: "🤢", fear: "😨", happy: "😊", neutral: "😐", sad: "😢", surprise: "😮" };
const COLORS = Object.fromEntries(LABELS.map(l => [l, getComputedStyle(document.documentElement).getPropertyValue(`--c-${l}`).trim()]));

const MIN_FRAME_MS = 70;          // cap ~14 fps
const MOOD_WINDOW_MS = 2000;      // average this much history for the "current" mood
const MOOD_SWITCH_MS = 1200;      // a new mood must lead this long before we switch
const TIMELINE_MS = 60000;

const $ = id => document.getElementById(id);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const hooks = {
  who: "them",                         // label for the tracked face: "them" or "you"
  onStableMood: (mood, now) => {},     // the smoothed mood changed
  onFrame: (now, target, current, faces) => {}, // every result; current = averaged probs or null
  drawFace: null,                      // optional (ctx, face, box, isTarget) to replace the default marker
};

const state = {
  source: "camera",
  deviceId: null,
  stream: null,
  ws: null,
  running: false,
  waiting: false,
  lastSend: 0,
  faces: [],
  targetId: null,
  target: null,           // face currently tracked (redrawn on resize)
  lastSeenTarget: 0,
  history: [],            // {t, probs} for the tracked face
  stableMood: null,
  candidate: null,
  candidateSince: 0,
  stableSince: 0,
};

const video = $("video");
const overlay = $("overlay");
const octx = overlay.getContext("2d");
const grab = document.createElement("canvas");
const gctx = grab.getContext("2d");

function buildLiveUi() {
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

  document.querySelectorAll("[data-start]").forEach(b => b.onclick = () => start(b.dataset.start));
  document.querySelectorAll("#source-seg .seg-btn").forEach(b => b.onclick = () => start(b.dataset.source));
  $("stop-btn").onclick = () => stop();
  $("camera-select").onchange = e => { state.deviceId = e.target.value; start("camera"); };
  overlay.addEventListener("click", pickFace);
  window.addEventListener("resize", () => drawOverlay());
  setInterval(drawTimeline, 500);
  drawTimeline();
  updateHud();
}

function setStatus(text, kind) {
  $("status-text").textContent = text;
  $("status").className = "status-pill" + (kind ? " " + kind : "");
}

/* ------------------------------------------------------------------ */
/* Capture + streaming                                                 */
/* ------------------------------------------------------------------ */
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
  $("stage").style.aspectRatio = `${(video.videoWidth || 16) / (video.videoHeight || 9)}`;
  $("stage-empty").hidden = true;
  $("stage-hud").hidden = false;
  $("stop-btn").hidden = false;
  state.running = true;
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
    state.target = null;
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
/* Results + mood                                                      */
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
    if (!target && now - state.lastSeenTarget > 2000) state.targetId = null;
  }
  if (!target && state.targetId == null) target = state.faces[0] || null;
  if (target) state.lastSeenTarget = now;
  state.target = target;

  if (target) state.history.push({ t: now, probs: target.probs, raw: target.raw || target.probs });
  while (state.history.length && now - state.history[0].t > TIMELINE_MS) state.history.shift();

  drawOverlay(target);
  updateHud(target);
  updateBars(target);
  const current = target ? avgProbs(MOOD_WINDOW_MS) : null;
  if (current) updateStableMood(now, current);
  hooks.onFrame(now, target, current, state.faces);
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

function updateStableMood(now, current) {
  const top = argmax(current);
  if (state.stableMood == null) {
    setStableMood(top, now);
  } else if (top !== state.stableMood) {
    if (state.candidate !== top) { state.candidate = top; state.candidateSince = now; }
    else if (now - state.candidateSince > MOOD_SWITCH_MS) setStableMood(top, now);
  } else {
    state.candidate = null;
  }
}

function setStableMood(mood, now) {
  state.stableMood = mood;
  state.stableSince = now;
  state.candidate = null;
  hooks.onStableMood(mood, now);
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

function drawOverlay(target = state.target) {
  const dpr = window.devicePixelRatio || 1;
  const W = overlay.clientWidth, H = overlay.clientHeight;
  if (overlay.width !== Math.round(W * dpr)) { overlay.width = Math.round(W * dpr); overlay.height = Math.round(H * dpr); }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, W, H);
  if (!state.running || !W || !H) return;   // stage hidden (e.g. another view is open)
  const r = contentRect();
  const mirror = state.source === "camera";
  for (const f of state.faces) {
    let [x, y, w, h] = f.box;
    if (mirror) x = 1 - x - w;
    const bx = r.x + x * r.w, by = r.y + y * r.h, bw = w * r.w, bh = h * r.h;
    const isTarget = target && f.id === target.id;
    if (hooks.drawFace) { hooks.drawFace(octx, f, { x: bx, y: by, w: bw, h: bh }, isTarget); continue; }
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
    const who = isTarget ? `${hooks.who.toUpperCase()} · ` : "";
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

// Draw a square crop of a face from the live video into a canvas (mirrored like the stage for the camera)
function faceThumb(face, canvas, size = 96) {
  if (!video.videoWidth) return;
  const [x, y, w, h] = face.box;
  const side = Math.max(w * video.videoWidth, h * video.videoHeight) * 1.25;
  const cx = (x + w / 2) * video.videoWidth, cy = (y + h / 2) * video.videoHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.height = size * dpr;
  const c = canvas.getContext("2d");
  c.save();
  if (state.source === "camera") { c.translate(canvas.width, 0); c.scale(-1, 1); }
  c.drawImage(video, cx - side / 2, cy - side / 2, side, side, 0, 0, canvas.width, canvas.height);
  c.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function pickFace(e) {
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
}

function updateHud(target) {
  let text;
  if (!state.faces.length) text = "No face detected";
  else if (state.targetId != null) text = `🔒 Tracking person #${state.targetId} (click empty space to unlock)`;
  else text = `Tracking ${hooks.who}${state.faces.length > 1 ? ` · ${state.faces.length} faces — click one to lock` : ""}`;
  $("hud-target").textContent = text;
  const who = hooks.who[0].toUpperCase() + hooks.who.slice(1);
  $("breakdown-who").textContent = target ? `${who} · #${target.id}` : "—";
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

// Optional deep link: ?autostart=camera (handy for kiosks)
function autostartFromUrl() {
  if (new URLSearchParams(location.search).get("autostart") === "camera") start("camera");
}
