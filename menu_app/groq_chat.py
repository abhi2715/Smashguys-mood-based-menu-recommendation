"""Minimal Groq chat client (OpenAI-compatible API) using only the standard library.

The key is read from GROQ_API_KEY, or from a `.env` file in the project root (one KEY=value per line).
Set GROQ_MODEL to use a different model.
"""
import asyncio
import json
import os
import re
import ssl
import urllib.error
import urllib.request

API_URL = "https://api.groq.com/openai/v1/chat/completions"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_HISTORY = 16       # most recent messages sent to the model
MAX_CHARS = 2000       # per message, keeps prompts small


def _load_dotenv():
    try:
        with open(os.path.join(ROOT, ".env")) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


_load_dotenv()
MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
# Free Groq keys get ~8k tokens/minute per model; when one is rate limited, the next one answers
MODELS = list(dict.fromkeys([MODEL, "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]))


def _ssl_context():
    # python.org builds on macOS ship without CA certificates: prefer certifi, else the system bundle
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    for path in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
        if os.path.exists(path):
            return ssl.create_default_context(cafile=path)
    return ssl.create_default_context()


SSL_CONTEXT = _ssl_context()


def available():
    return bool(os.environ.get("GROQ_API_KEY"))


def clean_history(messages):
    """Keep only user/assistant turns with text, trimmed, ending on a user turn."""
    out = [{"role": m["role"], "content": str(m.get("content", ""))[:MAX_CHARS]}
           for m in messages if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content")]
    return out[-MAX_HISTORY:]


def _post(payload):
    req = urllib.request.Request(API_URL, data=json.dumps(payload).encode(), method="POST", headers={
        "Authorization": f"Bearer {os.environ['GROQ_API_KEY']}",
        "Content-Type": "application/json",
        "User-Agent": "mood-apps-chatbot/1.0",
    })
    with urllib.request.urlopen(req, timeout=45, context=SSL_CONTEXT) as r:
        return json.load(r)


async def chat(system, messages, max_tokens=700, json_mode=False):
    """Returns {"reply": str} or {"error": str}."""
    if not available():
        return {"error": "Chatbot is offline: no GROQ_API_KEY set (add it to .env and restart)."}
    history = clean_history(messages)
    if not history or history[-1]["role"] != "user":
        return {"error": "Send a message first."}
    data, error = None, None
    for model in MODELS:
        payload = {"model": model, "messages": [{"role": "system", "content": system}] + history,
                   "temperature": 0.5, "max_completion_tokens": max_tokens}
        if model.startswith("openai/gpt-oss"):
            payload["reasoning_effort"] = "low"
        elif model.startswith("qwen/"):
            payload["reasoning_format"] = "hidden"
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        try:
            data = await asyncio.get_running_loop().run_in_executor(None, _post, payload)
            break
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                return {"error": "The Groq API key was rejected. Check GROQ_API_KEY in .env."}
            if exc.code in (429, 498, 503):  # rate limited / over capacity: try the next model
                error = {"error": "The chatbot is busy (Groq rate limit) — try again in a few seconds."}
                continue
            if exc.code in (400, 404) and model != MODELS[-1]:  # model unavailable for this key
                error = {"error": f"Chat request failed ({exc.code})."}
                continue
            return {"error": f"Chat request failed ({exc.code})."}
        except (urllib.error.URLError, TimeoutError) as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, ssl.SSLError):
                return {"error": "Secure connection to Groq failed (SSL certificates). Run: venv/bin/pip install certifi"}
            return {"error": "Can't reach Groq — check the internet connection."}
    if data is None:
        return error
    reply = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    reply = re.sub(r"<think>.*?</think>", "", reply, flags=re.S).strip()
    return {"reply": reply} if reply else {"error": "Empty reply — try asking again."}
