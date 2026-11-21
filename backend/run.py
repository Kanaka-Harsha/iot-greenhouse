"""Start the backend:  python run.py   (same as: uvicorn app.main:app --host 0.0.0.0 --port 8000)"""
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import uvicorn

from app import config  # noqa: F401  (loads .env)

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("BACKEND_PORT", "8000")),
                app_dir=str(BACKEND_DIR),
                proxy_headers=True, forwarded_allow_ips="*")
