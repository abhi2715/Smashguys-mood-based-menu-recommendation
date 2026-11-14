"""Local persistence: placed orders and the Mood Lift scores learned from after-meal rescans."""
import json
import os
import threading
import time

DATA_DIR = os.environ.get("MOODMENU_DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
ORDERS_PATH = os.path.join(DATA_DIR, "orders.jsonl")
LIFT_PATH = os.path.join(DATA_DIR, "mood_lift.json")
_lock = threading.Lock()


def _load_lift():
    try:
        with open(LIFT_PATH) as f:
            return {int(k): v for k, v in json.load(f).items()}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def lift_stats():
    """{item_id: {"avg": average positivity gain, "n": ratings}}"""
    return {k: {"avg": round(v["sum"] / v["n"], 1), "n": v["n"]} for k, v in _load_lift().items() if v["n"]}


def record_lift(item_ids, before, after):
    """Credit every dish in the order with the diner's positivity change (0-100 scale)."""
    delta = float(after) - float(before)
    with _lock:
        data = _load_lift()
        for item_id in set(item_ids):
            entry = data.setdefault(int(item_id), {"sum": 0.0, "n": 0})
            entry["sum"] += delta
            entry["n"] += 1
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(LIFT_PATH, "w") as f:
            json.dump(data, f, indent=1)
    return delta


def next_order_no():
    try:
        with open(ORDERS_PATH) as f:
            return sum(1 for _ in f) + 1
    except FileNotFoundError:
        return 1


def save_order(order):
    with _lock:
        os.makedirs(DATA_DIR, exist_ok=True)
        order["no"] = next_order_no()
        order["time"] = time.strftime("%Y-%m-%d %H:%M")
        with open(ORDERS_PATH, "a") as f:
            f.write(json.dumps(order) + "\n")
    return order
