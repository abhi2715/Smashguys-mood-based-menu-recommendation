"use strict";
// Smash Guys Mood Menu: scan your vibe, get a matching order, measure how much the food lifted your mood.

const SCAN_MS = 2500;
const SCAN_TIMEOUT_MS = 9000;
const GST = 0.05;
const COURSE_LABEL = { main: "🍔 Main", side: "🍟 Side", drink: "🥤 Drink", dessert: "🍫 Dessert" };
const SLOT_EMOJI = ["😊", "😢", "😠", "😨", "🤢", "😮", "😐", "🍔", "🍟", "🥤"];

const menu = {
  mode: "solo",
  diet: "any", spice: 2, budget: null, avoid: new Set(),
  locked: false, manualMood: null, scannedMood: null, seed: 1, shownKey: null,
  away: [],               // dishes to steer away from after a Shuffle
  lastRec: null, lastTable: null,
  scan: null,             // {kind: "order"|"after", start, faces: {id: {sum, n, box, face}}}
  autoScanned: false,
  before: null,           // positivity (0-100) captured by the last order scan
  people: [],             // table scan results [{id, mood, valence, thumb}]
  cart: new Map(),        // id -> {item, qty}
  split: 1,
  lastOrder: null,
};

hooks.who = "you";

/* ------------------------------------------------------------------ */
/* Overlay: comic reticle + scanning laser                             */
/* ------------------------------------------------------------------ */
hooks.drawFace = (ctx, f, box, isTarget) => {
  const strong = isTarget || menu.mode === "table";
  const pad = box.w * 0.12, x = box.x - pad, y = box.y - pad, w = box.w + 2 * pad, h = box.h + 2 * pad;
  const k = Math.min(w, h) * 0.24;
  ctx.save();
  ctx.globalAlpha = strong ? 1 : 0.5;
  ctx.lineCap = "square";
  for (const [lw, color] of [[9, "#141414"], [5, "#ffd54a"]]) {
    ctx.lineWidth = lw; ctx.strokeStyle = color; ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.moveTo(cx + dx * k, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * k);
    }
    ctx.stroke();
  }
  if (menu.scan) {   // laser sweep + grid while scanning
    const p = ((performance.now() - menu.scan.start) % 1100) / 1100;
    const ly = y + h * (p < 0.5 ? p * 2 : 2 - p * 2);
    ctx.fillStyle = "rgba(255,213,74,.12)"; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,213,74,.35)"; ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(x + (w * i) / 6, y); ctx.lineTo(x + (w * i) / 6, y + h); ctx.stroke(); }
    ctx.shadowColor = "#ffd54a"; ctx.shadowBlur = 18; ctx.fillStyle = "#ffd54a"; ctx.fillRect(x, ly - 2, w, 4); ctx.shadowBlur = 0;
  }
  const who = menu.mode === "table" ? `#${f.id}` : isTarget ? "YOU" : `#${f.id}`;
  const text = `${EMOJI[f.emotion]} ${who} · ${f.emotion.toUpperCase()} ${Math.round(f.confidence * 100)}%`;
  ctx.font = "800 13px Inter, system-ui, sans-serif";
  const tw = ctx.measureText(text).width + 18;
  const ly = y - 34 > 2 ? y - 34 : y + h + 8;
  ctx.fillStyle = "#141414"; ctx.fillRect(x + 4, ly + 4, tw, 26);
  ctx.fillStyle = "#ffd54a"; ctx.fillRect(x, ly, tw, 26);
  ctx.strokeStyle = "#141414"; ctx.lineWidth = 2; ctx.strokeRect(x, ly, tw, 26);
  ctx.fillStyle = "#141414"; ctx.fillText(text, x + 9, ly + 17.5);
  ctx.restore();
};

/* ------------------------------------------------------------------ */
/* Live hooks + vibe scan                                              */
/* ------------------------------------------------------------------ */
hooks.onStableMood = () => {
  if (!menu.locked && !menu.manualMood && !menu.scannedMood && menu.mode === "solo") loadMenu(false);
};

hooks.onFrame = (now, target, current, faces) => {
  if (!menu.autoScanned && faces.length && !menu.scan) { menu.autoScanned = true; startScan("order"); }
  if (!menu.scan) return;
  const scan = menu.scan;
  const subjects = menu.mode === "table" ? faces : target ? [target] : [];
  for (const f of subjects) {
    const acc = scan.faces[f.id] || (scan.faces[f.id] = { n: 0, sum: Object.fromEntries(LABELS.map(l => [l, 0])) });
    acc.n++; acc.face = f;
    for (const l of LABELS) acc.sum[l] += f.raw ? f.raw[l] : f.probs[l];
  }
  if (subjects.length && !scan.gotFace) { scan.gotFace = true; scan.start = now; }
  const pct = scan.gotFace ? Math.min(100, Math.round(((now - scan.start) / SCAN_MS) * 100)) : 0;
  $("scan-pct").textContent = `${pct}%`;
  $("scan-text").textContent = !scan.gotFace ? "Looking for a face…" :
    menu.mode === "table" ? `Scanning the table · ${Object.keys(scan.faces).length} ${Object.keys(scan.faces).length === 1 ? "face" : "faces"}` :
    scan.kind === "after" ? "Measuring your after-meal mood…" : "Reading your vibe…";
  if (scan.gotFace && now - scan.start >= SCAN_MS) finishScan();
  else if (!scan.gotFace && now - scan.created > SCAN_TIMEOUT_MS) {
    menu.scan = null; $("scan-hud").hidden = true; toast("No face found — move closer to the camera");
  }
};

function startScan(kind) {
  if (!state.running) { toast("Start the camera first"); return; }
  menu.scan = { kind, start: performance.now(), created: performance.now(), faces: {}, gotFace: false };
  $("scan-hud").hidden = false;
  $("scan-caption").textContent = kind === "after" ? "After-meal check" : "Scanning…";
}

function finishScan() {
  const scan = menu.scan;
  menu.scan = null;
  $("scan-hud").hidden = true;
  $("scan-caption").textContent = "Scan complete";
  const people = Object.entries(scan.faces).filter(([, a]) => a.n >= 4).map(([id, a]) => {
    const probs = Object.fromEntries(LABELS.map(l => [l, a.sum[l] / a.n]));
    const thumb = document.createElement("canvas");
    faceThumb(a.face, thumb, 96);
    const [x, , w] = a.face.box;
    return { id: Number(id), probs, mood: argmax(probs), valence: Math.round(valence(probs) * 100), thumb: thumb.toDataURL(), pos: state.source === "camera" ? 1 - x - w : x };
  }).sort((a, b) => a.pos - b.pos);
  if (!people.length) { toast("Couldn't get a clear read — try again"); return; }

  if (scan.kind === "after") return finishAfterScan(people);
  menu.before = Math.round(people.reduce((s, p) => s + p.valence, 0) / people.length);
  if (menu.mode === "table") {
    menu.people = people;
    menu.split = Math.max(menu.split, people.length);
    const counts = {};
    people.forEach(p => { counts[p.mood] = (counts[p.mood] || 0) + 1; });
    reveal(Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a)), () => loadTable());
  } else {
    menu.scannedMood = people[0].mood;
    menu.manualMood = null;
    setLocked(true);
    setPicker("");
    reveal(people[0].mood, () => loadMenu(true));
  }
}

function reveal(mood, then) {
  const slot = $("slot"), em = $("hero-emoji");
  slot.classList.remove("land"); slot.classList.add("spin");
  let i = 0;
  const spin = setInterval(() => { em.textContent = SLOT_EMOJI[i++ % SLOT_EMOJI.length]; }, 70);
  setTimeout(() => {
    clearInterval(spin);
    slot.classList.remove("spin"); void slot.offsetWidth; slot.classList.add("land");
    em.textContent = EMOJI[mood];
    if (mood === "happy" || mood === "surprise") confetti(160);
    then();
  }, 950);
}

/* ------------------------------------------------------------------ */
/* Solo recommendations                                                */
/* ------------------------------------------------------------------ */
const currentMood = () => menu.manualMood || menu.scannedMood || state.stableMood || "neutral";

function filterParams() {
  const p = new URLSearchParams({ diet: menu.diet, max_spice: menu.spice, seed: menu.seed, hour: new Date().getHours() });
  for (const a of menu.avoid) p.append("avoid", a);
  for (const id of menu.away) p.append("away", id);
  return p;
}

let menuReq = 0;
async function loadMenu(force) {
  const mood = currentMood();
  const params = filterParams();
  params.set("mood", mood);
  if (menu.budget) params.set("budget", menu.budget);
  const key = params.toString();
  if (!force && key === menu.shownKey) return;
  const id = ++menuReq;
  const data = await fetch(`/api/recommend?${params}`).then(r => r.json());
  if (id !== menuReq) return;
  menu.shownKey = key;
  menu.lastRec = data;
  const waiting = !menu.manualMood && !menu.scannedMood && !state.stableMood;
  if (menu.mode === "solo") {
    $("hero-kicker").textContent = waiting ? "Waiting for your face…" : "Your mood says…";
    if (!$("slot").classList.contains("spin")) $("hero-emoji").textContent = waiting ? "🍔" : data.emoji;
    $("hero-vibe").textContent = waiting ? "Show us your face" : data.vibe;
    $("hero-line").textContent = waiting ? "Scan your vibe — or pick a mood below. Chef's picks meanwhile." : data.line;
  }
  $("daypart").textContent = data.daypart || "";

  const combo = $("combo");
  combo.innerHTML = data.combo.length ? "" : `<p class="empty-note">Nothing fits those filters — try loosening them.</p>`;
  for (const it of data.combo) combo.appendChild(foodCard(it));
  $("combo-total").textContent = rupees(data.total);
  $("add-combo").disabled = !data.combo.length;

  const addon = $("addon");
  addon.hidden = !data.addon;
  if (data.addon) addon.innerHTML = `<span>✨ <b>Mood upgrade:</b> ${esc(data.addon.name)} (₹${data.addon.price}) — ${esc(data.addon.desc)}</span>`;

  const more = $("more");
  more.innerHTML = "";
  for (const it of data.more) {
    const row = el("div", "more-row", `
      <div><div class="food-name"><i class="vdot ${it.veg ? "veg" : "nonveg"}"></i>${esc(it.name)} ${badges(it)}</div>
      <div class="food-reason">${esc(it.reason)}</div></div>
      <span class="price">₹${it.price}</span><button class="add-btn" aria-label="Add ${esc(it.name)}">＋</button>`);
    row.querySelector(".add-btn").onclick = () => addItem(it);
    more.appendChild(row);
  }
}

function foodCard(it) {
  const d = el("div", "food");
  d.innerHTML = `
    <div class="food-course"><span>${COURSE_LABEL[it.course]}</span><span class="match">${it.match}% match</span></div>
    <div class="food-name"><i class="vdot ${it.veg ? "veg" : "nonveg"}"></i>${esc(it.name)}</div>
    <div class="food-desc">${esc(it.desc)}</div>
    <div class="food-reason">${esc(it.reason)}</div>
    <div class="food-foot"><div class="badges">${badges(it)}</div><span class="price">₹${it.price}</span><button class="add-btn" aria-label="Add ${esc(it.name)}">＋</button></div>`;
  d.querySelector(".add-btn").onclick = () => addItem(it);
  return d;
}

function badges(it) {
  let s = "";
  if (it.new) s += `<span class="badge new">NEW</span>`;
  if (it.chef) s += `<span class="badge" title="Chef recommended">👨‍🍳</span>`;
  if (it.spicy) s += `<span class="badge" title="Spicy">${"🌶️".repeat(it.spicy)}</span>`;
  if (it.lift && it.lift.avg > 0) s += `<span class="badge lift" title="Average mood lift from ${it.lift.n} after-meal check${it.lift.n > 1 ? "s" : ""}">😊 +${Math.round(it.lift.avg)}</span>`;
  return s;
}

/* ------------------------------------------------------------------ */
/* Table mode                                                          */
/* ------------------------------------------------------------------ */
async function loadTable() {
  if (!menu.people.length) return;
  const params = filterParams();
  for (const p of menu.people) params.append("moods", p.mood);
  const data = await fetch(`/api/table?${params}`).then(r => r.json());
  menu.lastTable = data;
  $("hero-kicker").textContent = "The table says…";
  $("hero-vibe").textContent = data.group_vibe;
  $("hero-line").textContent = `${menu.people.length} ${menu.people.length === 1 ? "person" : "people"} scanned — everyone gets picks for their own mood, plus plates to share.`;
  $("daypart").textContent = data.daypart || "";
  $("table-vibe").textContent = `${menu.people.map(p => EMOJI[p.mood]).join(" ")}`;
  const box = $("table-people");
  box.innerHTML = "";
  data.people.forEach((p, i) => {
    const who = menu.people[i];
    const card = el("div", "person", `
      <div class="person-head"><canvas></canvas><div><b>${EMOJI[p.mood]} ${esc(p.vibe)}</b><small>Person ${i + 1} · ${p.mood} · ${who.valence}% positive</small></div></div>
      <ul>${p.items.map(it => `<li><span><i class="vdot ${it.veg ? "veg" : "nonveg"}"></i> ${esc(it.name)}</span><b>₹${it.price}</b></li>`).join("")}</ul>
      <div class="share"><span>Their share</span><span>${rupees(p.share)}</span></div>`);
    card.style.setProperty("--pc", COLORS[p.mood]);
    const img = new Image();
    img.onload = () => { const c = card.querySelector("canvas"); c.width = c.height = 96; c.getContext("2d").drawImage(img, 0, 0, 96, 96); };
    img.src = who.thumb;
    box.appendChild(card);
  });
  $("table-shared").innerHTML = data.shared.length ? `<b>🍽️ To share:</b> ${data.shared.map(s => `${s.qty}× ${esc(s.name)} (₹${s.price * s.qty})`).join(" · ")}` : "";
  $("table-total").textContent = rupees(data.total);
  $("add-table").disabled = false;
}

function addTableOrder() {
  const t = menu.lastTable;
  if (!t) return;
  for (const p of t.people) for (const it of p.items) addItem(it, 1, true);
  for (const s of t.shared) addItem(s, s.qty, true);
  menu.split = t.people.length;
  toast(`Added the table order for ${t.people.length}`);
  openDrawer();
}

/* ------------------------------------------------------------------ */
/* Cart, order ticket, receipt                                         */
/* ------------------------------------------------------------------ */
const rupees = n => `₹${Math.round(n).toLocaleString("en-IN")}`;

function addItem(item, qty = 1, quiet) {
  const line = menu.cart.get(item.id) || { item, qty: 0 };
  line.qty += qty;
  menu.cart.set(item.id, line);
  renderCart();
  const b = $("cart-btn");
  b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
  if (!quiet) toast(`Added ${item.name}`);
}

function renderCart() {
  const lines = [...menu.cart.values()];
  $("cart-count").textContent = lines.reduce((a, l) => a + l.qty, 0);
  const list = $("cart-lines");
  list.innerHTML = lines.length ? "" : `<li class="empty">Nothing yet — tap ＋ on anything that matches your mood.</li>`;
  for (const l of lines) {
    const li = el("li", null, `<span>${esc(l.item.name)}</span><div class="stepper"><button>−</button><b>${l.qty}</b><button>＋</button></div><b>₹${l.item.price * l.qty}</b>`);
    const [minus, plus] = li.querySelectorAll("button");
    minus.onclick = () => { l.qty--; if (l.qty <= 0) menu.cart.delete(l.item.id); renderCart(); };
    plus.onclick = () => { l.qty++; renderCart(); };
    list.appendChild(li);
  }
  const sub = lines.reduce((a, l) => a + l.item.price * l.qty, 0);
  const tax = Math.round(sub * GST);
  $("cart-sub").textContent = rupees(sub);
  $("cart-tax").textContent = rupees(tax);
  $("cart-total").textContent = rupees(sub + tax);
  $("split-n").textContent = menu.split;
  $("split-each").textContent = `${rupees((sub + tax) / menu.split)} each`;
  $("place-btn").disabled = !lines.length;
}

function openDrawer() { $("drawer").hidden = false; $("scrim").hidden = false; renderCart(); }
function closeDrawer() { $("drawer").hidden = true; $("scrim").hidden = true; }

async function placeOrder() {
  const lines = [...menu.cart.values()];
  const vibe = menu.mode === "table" && menu.lastTable ? menu.lastTable.group_vibe : (menu.lastRec ? menu.lastRec.vibe : "Chef's Picks");
  const res = await fetch("/api/order", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: lines.map(l => ({ id: l.item.id, qty: l.qty })), vibe, people: menu.split, before: menu.before }),
  });
  if (!res.ok) { toast("Couldn't place the order"); return; }
  const order = await res.json();
  menu.lastOrder = { ...order, emoji: EMOJI[currentMood()] || "🍔", itemIds: lines.map(l => l.item.id), lift: null };
  menu.cart.clear();
  renderCart();
  closeDrawer();
  showTicket();
  $("after-btn").hidden = menu.before == null;
}

function showTicket() {
  const o = menu.lastOrder;
  const each = o.people > 1 ? `<div class="row"><span>Split ${o.people} ways</span><span>${rupees(o.total / o.people)} each</span></div>` : "";
  $("ticket").innerHTML = `
    <h3>SMASH GUYS</h3>
    <div class="tno">ORDER #${String(o.no).padStart(4, "0")} · ${esc(o.time)}</div>
    <div class="stamp">${esc(o.vibe)}</div>
    <hr>
    ${o.lines.map(l => `<div class="row"><span>${l.qty} × ${esc(l.name)}</span><span>₹${l.price * l.qty}</span></div>`).join("")}
    <hr>
    <div class="row"><span>Subtotal</span><span>₹${o.subtotal}</span></div>
    <div class="row"><span>GST 5%</span><span>₹${o.tax}</span></div>
    <div class="row grand"><span>TOTAL</span><span>₹${o.total}</span></div>
    ${each}
    <div class="qr">${o.qr_svg}</div>
    <p class="hint">Show this QR to your server</p>
    ${o.lift != null ? `<hr><div class="row grand"><span>MOOD LIFT</span><span>${o.lift >= 0 ? "+" : ""}${o.lift}</span></div>` : ""}
    <div class="actions">
      ${menu.before != null && o.lift == null ? `<button class="btn btn-green" id="t-after">😋 Done eating? Check my mood lift</button>` : ""}
      <button class="btn btn-yellow" id="t-receipt">📸 Save my mood receipt</button>
      <button class="btn btn-ghost" id="t-close">Close</button>
    </div>`;
  $("ticket-modal").hidden = false;
  $("t-close").onclick = () => { $("ticket-modal").hidden = true; };
  $("t-receipt").onclick = saveReceipt;
  if ($("t-after")) $("t-after").onclick = () => { $("ticket-modal").hidden = true; startScan("after"); };
}

async function finishAfterScan(people) {
  const o = menu.lastOrder;
  if (!o) return;
  const after = Math.round(people.reduce((s, p) => s + p.valence, 0) / people.length);
  const res = await fetch("/api/lift", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: o.itemIds, before: menu.before, after }),
  }).then(r => r.json());
  o.lift = Math.round(res.delta);
  o.after = after;
  o.afterEmoji = EMOJI[people[0].mood];
  renderLeaderboard(res.leaderboard);
  $("after-btn").hidden = true;
  if (o.lift > 0) confetti(220);
  toast(o.lift > 0 ? `Mood lift +${o.lift}! The food worked 🎉` : o.lift < 0 ? `Mood ${o.lift}. We'll learn from that.` : "Mood held steady.");
  loadMenu(true);
  showTicket();
}

async function saveReceipt() {
  const o = menu.lastOrder;
  await document.fonts.ready;
  const W = 1080, H = 1350, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#ffd54a"; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(20,20,20,.08)";
  for (let y = 0; y < H; y += 22) for (let x = (y / 22) % 2 ? 11 : 0; x < W; x += 22) { g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#fff"; g.strokeStyle = "#141414"; g.lineWidth = 8;
  g.fillRect(90, 250, W - 180, H - 400); g.strokeRect(90, 250, W - 180, H - 400);
  g.fillStyle = "#141414"; g.textAlign = "center";
  g.font = "96px 'Archivo Black', Inter, sans-serif"; g.fillText("SMASH GUYS", W / 2, 140);
  g.font = "68px 'Kaushan Script', cursive"; g.fillText("my mood receipt", W / 2, 215);
  g.font = "150px system-ui"; g.fillText(o.lift != null ? `${o.emoji}→${o.afterEmoji}` : o.emoji, W / 2, 440);
  g.font = "64px 'Archivo Black', Inter, sans-serif"; g.fillText(o.vibe.toUpperCase(), W / 2, 540);
  g.font = "600 36px Inter, sans-serif"; g.textAlign = "left";
  let y = 630;
  for (const l of o.lines.slice(0, 8)) {
    g.fillText(`${l.qty} × ${l.name}`.slice(0, 34), 150, y);
    g.textAlign = "right"; g.fillText(`₹${l.price * l.qty}`, W - 150, y); g.textAlign = "left";
    y += 54;
  }
  g.setLineDash([16, 12]); g.lineWidth = 4; g.beginPath(); g.moveTo(150, y - 20); g.lineTo(W - 150, y - 20); g.stroke(); g.setLineDash([]);
  g.font = "48px 'Archivo Black', Inter, sans-serif";
  g.fillText("TOTAL", 150, y + 40); g.textAlign = "right"; g.fillText(`₹${o.total}`, W - 150, y + 40);
  if (o.lift != null) {
    g.textAlign = "center"; g.fillStyle = o.lift >= 0 ? "#1f9d6b" : "#e63946";
    g.font = "60px 'Archivo Black', Inter, sans-serif"; g.fillText(`MOOD LIFT ${o.lift >= 0 ? "+" : ""}${o.lift}`, W / 2, y + 140);
  }
  g.fillStyle = "#141414"; g.textAlign = "center"; g.font = "600 30px Inter, sans-serif";
  g.fillText(`Order #${String(o.no).padStart(4, "0")} · ${o.time} · #MoodMenu`, W / 2, H - 70);
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = `smash-guys-mood-receipt-${o.no}.png`;
  a.click();
}

async function loadLeaderboard() {
  const data = await fetch("/api/lift").then(r => r.json());
  renderLeaderboard(data.leaderboard);
}

function renderLeaderboard(rows) {
  $("leaderboard").innerHTML = rows.length ? rows.map(r => `
    <li><div><b>${esc(r.name)}</b><small>${esc(r.section)} · ${r.n} check${r.n > 1 ? "s" : ""}</small></div>
    <span class="lift ${r.avg < 0 ? "neg" : ""}">${r.avg >= 0 ? "+" : ""}${Math.round(r.avg)}</span></li>`).join("")
    : `<li class="empty">No data yet. Order something, then tap <b>😋 After-meal mood check</b> when you're done — we rescan your face and learn which dishes really lift moods. The best ones get boosted for everyone.</li>`;
}

/* ------------------------------------------------------------------ */
/* Confetti + toast                                                    */
/* ------------------------------------------------------------------ */
function confetti(n) {
  const cv = $("confetti"), c = cv.getContext("2d");
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = ["#ffd54a", "#e63946", "#141414", "#1f9d6b", "#3a86ff", "#fb8500"];
  const parts = Array.from({ length: n }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 18, vy: -Math.random() * 18 - 6,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, w: 8 + Math.random() * 8, h: 5 + Math.random() * 6, color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(t) {
    c.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.vy += 0.55; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99;
      c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.fillStyle = p.color; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore();
    }
    if (t - t0 < 2200) requestAnimationFrame(frame); else c.clearRect(0, 0, cv.width, cv.height);
  })(t0);
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */
function buildMoodPicker() {
  const picker = $("mood-picker");
  const live = el("button", "mood-chip active", "📷 From camera");
  live.dataset.mood = "";
  picker.appendChild(live);
  for (const l of LABELS) {
    const b = el("button", "mood-chip", `${EMOJI[l]} ${l}`);
    b.dataset.mood = l;
    picker.appendChild(b);
  }
  picker.onclick = e => {
    const b = e.target.closest(".mood-chip");
    if (!b) return;
    menu.manualMood = b.dataset.mood || null;
    setPicker(b.dataset.mood);
    if (menu.mode === "table") setMode("solo");
    if (menu.manualMood) reveal(menu.manualMood, () => loadMenu(true)); else loadMenu(true);
  };
}
function setPicker(mood) { $("mood-picker").querySelectorAll(".mood-chip").forEach(c => c.classList.toggle("active", c.dataset.mood === (mood || ""))); }

function setLocked(on) {
  menu.locked = on;
  $("lock-btn").textContent = on ? "🔒 Locked" : "🔓 Live";
  $("lock-btn").title = on ? "Picks are frozen — tap to follow your live mood" : "Picks follow your live mood — tap to freeze them";
}

function setMode(mode) {
  menu.mode = mode;
  hooks.who = mode === "table" ? "everyone" : "you";
  $("mode-seg").querySelectorAll(".seg-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  $("solo-card").hidden = mode !== "solo";
  $("table-card").hidden = mode !== "table";
  if (mode === "table") {
    if (menu.people.length) loadTable();
    else if (state.running) startScan("order");
  } else loadMenu(true);
}

function updateFilterSummary() {
  const diet = { any: "Any diet", veg: "Veg", nonveg: "Non-veg" }[menu.diet];
  const spice = ["Mild", "Medium", "Any spice"][menu.spice];
  const avoid = menu.avoid.size ? ` · no ${[...menu.avoid].join(", ")}` : "";
  $("filter-summary").textContent = `${diet} · ${spice} · ${menu.budget ? `≤ ₹${menu.budget}` : "no limit"}${avoid}`;
}
function refresh() { menu.away = []; updateFilterSummary(); if (menu.mode === "table") loadTable(); else loadMenu(true); }

const segPick = (segId, attr, fn) => $(segId).addEventListener("click", e => {
  const b = e.target.closest(".seg-btn");
  if (!b) return;
  $(segId).querySelectorAll(".seg-btn").forEach(x => x.classList.toggle("active", x === b));
  fn(b.dataset[attr]);
  refresh();
});
segPick("diet-seg", "diet", v => { menu.diet = v; });
segPick("spice-seg", "spice", v => { menu.spice = Number(v); });
$("mode-seg").addEventListener("click", e => { const b = e.target.closest(".seg-btn"); if (b) setMode(b.dataset.mode); });
$("budget").addEventListener("input", e => {
  const v = Number(e.target.value);
  menu.budget = v >= 2500 ? null : v;
  $("budget-val").textContent = menu.budget ? `≤ ₹${v}` : "No limit";
});
$("budget").addEventListener("change", refresh);
$("avoid-chips").addEventListener("click", e => {
  const b = e.target.closest(".chip");
  if (!b) return;
  const a = b.dataset.avoid;
  menu.avoid.has(a) ? menu.avoid.delete(a) : menu.avoid.add(a);
  b.classList.toggle("active", menu.avoid.has(a));
  refresh();
});
$("shuffle-btn").onclick = () => {
  menu.seed = Math.floor(Math.random() * 1e6);
  menu.away = (menu.lastRec?.combo || []).map(it => it.id);
  loadMenu(true);
};
$("lock-btn").onclick = () => {
  setLocked(!menu.locked);
  if (!menu.locked) { menu.scannedMood = null; loadMenu(true); }
};
$("add-combo").onclick = () => { if (menu.lastRec) { menu.lastRec.combo.forEach(it => addItem(it, 1, true)); toast("Combo added to your order"); } };
$("add-table").onclick = addTableOrder;
$("rescan-btn").onclick = () => startScan("order");
$("after-btn").onclick = () => startScan("after");
$("cart-btn").onclick = openDrawer;
$("drawer-close").onclick = closeDrawer;
$("scrim").onclick = closeDrawer;
$("split-minus").onclick = () => { menu.split = Math.max(1, menu.split - 1); renderCart(); };
$("split-plus").onclick = () => { menu.split = Math.min(20, menu.split + 1); renderCart(); };
$("place-btn").onclick = placeOrder;
// Rescan is only possible while the camera runs
new MutationObserver(() => { $("rescan-btn").disabled = $("stop-btn").hidden; if ($("stop-btn").hidden) menu.autoScanned = false; })
  .observe($("stop-btn"), { attributes: true });

buildLiveUi();
buildMoodPicker();
updateFilterSummary();
renderCart();
loadMenu(true);
loadLeaderboard();
autostartFromUrl();

/* ------------------------------------------------------------------ */
/* Chatbot: "Smashy" knows the menu, your mood, filters and order      */
/* ------------------------------------------------------------------ */
const menuById = new Map();
fetch("/api/menu").then(r => r.json()).then(items => items.forEach(it => menuById.set(it.id, it))).catch(() => {});

const MOOD_VIBE = { happy: "Celebration", sad: "Comfort", angry: "Cool-Down", fear: "Safe & Steady",
                    disgust: "Palate Reset", surprise: "Adventure", neutral: "Chef's Picks" };

createChatbot({
  name: "Smashy",
  tagline: "Your Smash Guys food buddy",
  avatar: "🍔",
  greeting: "Hey! I'm **Smashy** 🍔 Ask me anything about the menu — what to eat for your mood, what's veg, what's spicy, allergens, or a combo under your budget. Tap ＋ on any dish I suggest to add it to your order.",
  starters: ["What should I eat for my mood?", "Best veg combo under ₹800?", "Something not spicy and no egg", "What goes with my order?"],
  getContext: () => ({
    mood: currentMood(), diet: menu.diet, max_spice: menu.spice, budget: menu.budget, avoid: [...menu.avoid],
    cart: [...menu.cart.values()].map(l => ({ id: l.item.id, qty: l.qty })),
    people: menu.mode === "table" ? Math.max(1, menu.people.length) : 1,
  }),
  describeContext: () => {
    const m = currentMood(), n = [...menu.cart.values()].reduce((a, l) => a + l.qty, 0);
    return `${EMOJI[m] || "😐"} ${esc(MOOD_VIBE[m] || m)} mode · ${esc($("filter-summary").textContent)} · 🛒 ${n}`;
  },
  renderTags: html => html.replace(/\s*\[#(\d+)\]/g, (_, id) => {
    const it = menuById.get(Number(id));
    return it ? ` <button type="button" class="cb-dish" data-tag="${it.id}" title="Add ${esc(it.name)} (₹${it.price}) to order">＋ Add</button>` : "";
  }),
  onTagClick: (id, btn) => {
    const it = menuById.get(Number(id));
    if (!it) return;
    addItem(it);
    btn.classList.add("added");
    btn.textContent = "✓ added";
    setTimeout(() => { btn.classList.remove("added"); btn.textContent = "＋ Add"; }, 1600);
  },
});
