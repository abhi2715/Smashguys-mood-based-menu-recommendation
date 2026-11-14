"""Start the MoodLens web app.

Usage:  venv/bin/python run_app.py [--port 8000] [--no-browser]
Then open http://localhost:8000 (camera access only works on localhost or https).
"""

import argparse
import threading
import webbrowser

import uvicorn


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    url = f"http://localhost:{args.port}"
    print(f"Loading models… then open {url}", flush=True)
    if not args.no_browser:
        threading.Timer(4.0, webbrowser.open, [url]).start()
    uvicorn.run("app.server:app", host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
