"""Turn an MQTT payload into a database row.

Accepted formats (keys are case-insensitive, may be nested one level, e.g. {"data": {...}}):
  sensor/co2            {"co2": 812} | {"co2_ppm": 812} | {"ppm": 812} | {"value": 812} | 812
  sensor/npk            {"nitrogen": 12, "phosphorus": 8, "potassium": 20} | {"n":12,"p":8,"k":20}
                        | {"N":12,"P":8,"K":20} | "12,8,20"
  sensor/soil-moisture  {"moisture": 41.5} | {"soil_moisture": 41.5} | {"moisture_pct": 41.5}
                        | {"value": 41.5} | 41.5
Anything else is still stored (payload jsonb); the typed columns are then NULL.
"""
from __future__ import annotations

import json
import math
from typing import Any

TOPIC_TYPES = {
    "sensor/co2": "co2",
    "sensor/npk": "npk",
    "sensor/soil-moisture": "soil_moisture",
}

CO2_KEYS = ("co2_ppm", "co2", "ppm", "value", "concentration")
N_KEYS = ("nitrogen", "n", "n_mgkg", "n_ppm")
P_KEYS = ("phosphorus", "p", "p_mgkg", "p_ppm")
K_KEYS = ("potassium", "k", "k_mgkg", "k_ppm")
MOIST_KEYS = ("soil_moisture", "moisture", "moisture_pct", "soilmoisture", "humidity", "value")


def sensor_type_for(topic: str) -> str | None:
    return TOPIC_TYPES.get(topic.strip().lower())


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
    elif isinstance(v, str):
        try:
            f = float(v.strip())
        except ValueError:
            return None
    else:
        return None
    return f if math.isfinite(f) else None


def _flatten(obj: dict) -> dict[str, Any]:
    """Lower-case keys; merge one level of nested dicts (nested values never override)."""
    flat: dict[str, Any] = {}
    nested: dict[str, Any] = {}
    for k, v in obj.items():
        if isinstance(v, dict):
            for k2, v2 in v.items():
                nested.setdefault(str(k2).lower(), v2)
        else:
            flat[str(k).lower()] = v
    for k, v in nested.items():
        flat.setdefault(k, v)
    return flat


def _first(d: dict[str, Any], keys: tuple[str, ...]) -> float | None:
    for k in keys:
        if k in d:
            n = _num(d[k])
            if n is not None:
                return n
    return None


def decode_payload(raw: bytes) -> Any:
    """JSON if possible, otherwise {"raw": text}."""
    text = raw.decode("utf-8", errors="replace").strip()
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return {"raw": text}


def parse_reading(topic: str, raw: bytes) -> dict[str, Any] | None:
    """Returns column values for sensor_readings, or None for an unknown topic."""
    stype = sensor_type_for(topic)
    if stype is None:
        return None
    data = decode_payload(raw)
    row: dict[str, Any] = {
        "topic": topic, "sensor_type": stype,
        "co2_ppm": None, "nitrogen": None, "phosphorus": None, "potassium": None, "soil_moisture": None,
    }

    if isinstance(data, dict) and "raw" in data and len(data) == 1:
        scalar: Any = data["raw"]
        d: dict[str, Any] = {}
    elif isinstance(data, dict):
        scalar = None
        d = _flatten(data)
    else:                                   # bare JSON number / string / list
        scalar = data
        d = {}
    payload = data if isinstance(data, dict) else {"value": data}

    if stype == "co2":
        row["co2_ppm"] = _first(d, CO2_KEYS) if d else _num(scalar)
    elif stype == "soil_moisture":
        row["soil_moisture"] = _first(d, MOIST_KEYS) if d else _num(scalar)
    else:  # npk
        if d:
            row["nitrogen"], row["phosphorus"], row["potassium"] = (
                _first(d, N_KEYS), _first(d, P_KEYS), _first(d, K_KEYS))
        else:
            parts = scalar if isinstance(scalar, list) else str(scalar).replace(";", ",").split(",")
            if len(parts) == 3:
                row["nitrogen"], row["phosphorus"], row["potassium"] = (_num(x) for x in parts)

    row["payload"] = payload
    return row
