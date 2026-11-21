"""FastAPI backend: AWS IoT (MQTT/TLS) -> Supabase Postgres, REST API for the dashboard.

Run from the backend/ folder:
    uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import logging
import sys
import threading
import time
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from . import db
from .config import settings
from .mqtt_client import IoTClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
                    stream=sys.stdout)
log = logging.getLogger("api")

iot: IoTClient | None = None
_relay_lock = threading.Lock()
_last_relay_at = 0.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    global iot
    problems = settings.check()
    if problems:
        for p in problems:
            log.error("config: %s", p)
        raise RuntimeError("fix the .env settings above and start again")
    try:
        db.open_pool(settings.db_url)
        db.create_tables()
    except Exception as e:  # noqa: BLE001
        log.error("cannot use the database (DB_URL): %s", e)
        log.error("check the Supabase password, that the project is not paused, and the pooler host/port")
        raise

    iot = IoTClient(settings)
    iot.start()
    yield
    iot.stop()
    db.close_pool()


app = FastAPI(title="Greenhouse IoT backend", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ helpers
def require_relay_key(x_api_key: str | None = Header(default=None)) -> None:
    if settings.relay_api_key and x_api_key != settings.relay_api_key:
        raise HTTPException(status_code=401, detail="missing or wrong X-API-Key")


SensorName = Literal["co2", "npk", "soil_moisture", "soil-moisture"]


def _norm_sensor(s: str | None) -> str | None:
    return None if s is None else s.replace("-", "_")


# ------------------------------------------------------------------ routes
@app.get("/")
def root():
    return {"service": "greenhouse-iot-backend", "docs": "/docs", "health": "/api/health"}


@app.get("/api/health")
async def health():
    db_ok = await run_in_threadpool(db.ping)
    return {
        "status": "ok" if db_ok and iot and iot.connected.is_set() else "degraded",
        "database": "ok" if db_ok else "unreachable",
        "mqtt": "connected" if iot and iot.connected.is_set() else "disconnected",
        "aws_iot_endpoint": settings.aws_iot_endpoint,
        "topics": settings.sensor_topics,
        "relay_topic": settings.relay_topic,
        "stats": iot.stats if iot else {},
        "server_time": time.time(),
    }


@app.get("/api/sensors/latest")
async def sensors_latest():
    return await run_in_threadpool(db.latest_readings)


@app.get("/api/sensors/history")
async def sensors_history(
    sensor: SensorName | None = Query(default=None, description="co2 | npk | soil_moisture; empty = all"),
    limit: int = Query(default=100, ge=1, le=1000),
    since_hours: float | None = Query(default=None, gt=0, le=24 * 365),
):
    return await run_in_threadpool(db.history, _norm_sensor(sensor), limit, since_hours)


class RelayCommand(BaseModel):
    command: Literal["on", "off"]


def _send_relay(command: str, client_ip: str | None) -> dict:
    global _last_relay_at
    with _relay_lock:                      # one command at a time, at most 1/RELAY_MIN_INTERVAL_S
        wait = settings.relay_min_interval_s - (time.monotonic() - _last_relay_at)
        if wait > 0:
            raise HTTPException(status_code=429, detail=f"too fast, try again in {wait:.1f} s")
        _last_relay_at = time.monotonic()
        payload = {"command": command}
        try:
            iot.publish_relay(command)
        except Exception as e:  # noqa: BLE001
            entry = db.log_relay(command, settings.relay_topic, payload, "failed", str(e), client_ip)
            raise HTTPException(status_code=503, detail=f"relay command not sent: {e}") from e
        entry = db.log_relay(command, settings.relay_topic, payload, "published", None, client_ip)
        return {"ok": True, "topic": settings.relay_topic, "payload": payload, "log": entry}


@app.post("/api/relay", dependencies=[Depends(require_relay_key)])
@app.post("/api/relay/command", dependencies=[Depends(require_relay_key)], include_in_schema=False)
async def relay_command(body: RelayCommand, request: Request):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else None)
    return await run_in_threadpool(_send_relay, body.command, ip)


@app.get("/api/relay/history")
async def relay_history(limit: int = Query(default=20, ge=1, le=500)):
    return await run_in_threadpool(db.relay_history, limit)
