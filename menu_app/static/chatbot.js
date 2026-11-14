"use strict";
// Floating chatbot widget (Groq-backed). Needs common.js (el, esc).
// createChatbot({name, tagline, avatar, greeting, starters, getContext, renderTags, onTagClick})

function createChatbot(opts) {
  const bot = { open: false, busy: false, messages: [] };

  const fab = el("button", "cb-fab", `<span class="cb-fab-icon">${opts.avatar}</span><span class="cb-fab-label">Chat</span>`);
  fab.setAttribute("aria-label", `Chat with ${opts.name}`);
  const panel = el("section", "cb-panel");
  panel.hidden = true;
  panel.setAttribute("aria-label", `${opts.name} chat`);
  panel.innerHTML = `
    <header class="cb-head">
      <span class="cb-avatar">${opts.avatar}</span>
      <div class="cb-title"><b>${esc(opts.name)}</b><span class="cb-sub">${esc(opts.tagline)}</span></div>
      <button class="cb-icon" data-act="clear" title="New chat" aria-label="New chat">↺</button>
      <button class="cb-icon" data-act="close" title="Close" aria-label="Close chat">✕</button>
    </header>
    <div class="cb-context" id="cb-context"></div>
    <ol class="cb-log" id="cb-log" aria-live="polite"></ol>
    <div class="cb-starters" id="cb-starters"></div>
    <form class="cb-form" id="cb-form">
      <textarea id="cb-input" rows="1" placeholder="Type a message…" aria-label="Message" maxlength="1500"></textarea>
      <button class="cb-send" type="submit" aria-label="Send">➤</button>
    </form>`;
  document.body.append(fab, panel);
  const log = panel.querySelector("#cb-log"), input = panel.querySelector("#cb-input");
  const form = panel.querySelector("#cb-form"), starters = panel.querySelector("#cb-starters");
  const ctxBar = panel.querySelector("#cb-context");

  // Tiny markdown: escape, **bold**, *italic*, "- " bullets, [#id] tags via opts.renderTags
  function format(text) {
    let html = esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<i>$2</i>");
    if (opts.renderTags) html = opts.renderTags(html);
    const out = [];
    let list = null;
    for (const line of html.split("\n")) {
      const m = line.match(/^\s*(?:[-•]|\d+\.)\s+(.*)/);
      if (m) { (list = list || []).push(`<li>${m[1]}</li>`); continue; }
      if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
      if (line.trim()) out.push(`<p>${line}</p>`);
    }
    if (list) out.push(`<ul>${list.join("")}</ul>`);
    return out.join("");
  }

  function addBubble(role, text, cls = "") {
    const li = el("li", `cb-msg cb-${role} ${cls}`);
    li.innerHTML = role === "user" ? `<p>${esc(text)}</p>` : format(text);
    log.append(li);
    log.scrollTop = log.scrollHeight;
    return li;
  }

  function renderStarters() {
    starters.innerHTML = "";
    starters.hidden = bot.messages.length > 0;
    for (const s of opts.starters) {
      const b = el("button", "cb-starter", esc(s));
      b.type = "button";
      b.onclick = () => send(s);
      starters.append(b);
    }
  }

  function renderContext() {
    const c = opts.describeContext ? opts.describeContext() : "";
    ctxBar.innerHTML = c;
    ctxBar.hidden = !c;
  }

  function reset() {
    bot.messages = [];
    log.innerHTML = "";
    addBubble("assistant", opts.greeting);
    renderStarters();
  }

  async function send(text) {
    text = text.trim();
    if (!text || bot.busy) return;
    bot.busy = true;
    form.classList.add("busy");
    starters.hidden = true;
    input.value = "";
    autosize();
    bot.messages.push({ role: "user", content: text });
    addBubble("user", text);
    const typing = addBubble("assistant", "", "cb-typing");
    typing.innerHTML = "<span></span><span></span><span></span>";
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: bot.messages, ...opts.getContext() }),
      });
      const data = await res.json();
      typing.remove();
      if (data.reply) {
        bot.messages.push({ role: "assistant", content: data.reply });
        addBubble("assistant", data.reply);
      } else {
        bot.messages.pop();  // let them retry the same question
        addBubble("assistant", data.error || data.detail || "Something went wrong.", "cb-error");
      }
    } catch (e) {
      typing.remove();
      bot.messages.pop();
      addBubble("assistant", "Can't reach the server — is it still running?", "cb-error");
    }
    bot.busy = false;
    form.classList.remove("busy");
    input.focus();
  }

  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; }

  function toggle(open = !bot.open) {
    bot.open = open;
    panel.hidden = !open;
    fab.classList.toggle("open", open);
    fab.querySelector(".cb-fab-icon").textContent = open ? "✕" : opts.avatar;
    if (open) { renderContext(); input.focus(); log.scrollTop = log.scrollHeight; }
  }

  fab.onclick = () => toggle();
  panel.querySelector('[data-act="close"]').onclick = () => toggle(false);
  panel.querySelector('[data-act="clear"]').onclick = reset;
  form.onsubmit = e => { e.preventDefault(); send(input.value); };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
  log.addEventListener("click", e => { const t = e.target.closest("[data-tag]"); if (t && opts.onTagClick) opts.onTagClick(t.dataset.tag, t); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && bot.open) toggle(false); });
  setInterval(() => { if (bot.open) renderContext(); }, 1500);

  fetch("/api/chat/status").then(r => r.json()).then(s => {
    if (!s.available) panel.querySelector(".cb-sub").textContent = "Offline — add GROQ_API_KEY to .env";
  }).catch(() => {});

  reset();
  return { toggle, send };
}
