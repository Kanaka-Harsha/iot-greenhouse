"""PostgreSQL (Supabase) access with connection pool.
Supports psycopg 3 with seamless fallback to psycopg2.
"""
from __future__ import annotations

from contextlib import contextmanager
import logging
from pathlib import Path
from typing import Any

from .config import BACKEND_DIR

log = logging.getLogger("db")
SCHEMA_FILE = BACKEND_DIR / "schema.sql"

try:
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
    from psycopg_pool import ConnectionPool
    # Test if native pq is actually loadable without DLOPEN/AppLocker errors
    from psycopg import pq
    pq.import_from_libpq()
    _USE_PSYCOPG3 = True
except Exception:
    import psycopg2
    from psycopg2.pool import ThreadedConnectionPool
    from psycopg2.extras import RealDictCursor, Json
    _USE_PSYCOPG3 = False

pool: Any = None

READING_COLS = "id, topic, sensor_type, payload, co2_ppm, nitrogen, phosphorus, potassium, soil_moisture, created_at"


def open_pool(db_url: str) -> None:
    global pool
    if _USE_PSYCOPG3:
        # prepare_threshold=None: works with Supabase's pooler in session and transaction mode
        pool = ConnectionPool(db_url, min_size=1, max_size=5, open=False,
                              kwargs={"prepare_threshold": None, "connect_timeout": 10},
                              name="supabase")
        pool.open(wait=True, timeout=20)
    else:
        pool = ThreadedConnectionPool(1, 5, db_url, connect_timeout=10)
    log.info("database pool open (%s)", "psycopg3" if _USE_PSYCOPG3 else "psycopg2")


def close_pool() -> None:
    global pool
    if pool:
        if _USE_PSYCOPG3:
            pool.close()
        else:
            pool.closeall()


@contextmanager
def get_connection():
    if _USE_PSYCOPG3:
        with pool.connection() as conn:
            yield conn
    else:
        conn = pool.getconn()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            pool.putconn(conn)


def _exec(conn: Any, query: str, args: tuple | list | None = None) -> Any:
    if _USE_PSYCOPG3:
        return conn.execute(query, args)
    cur = conn.cursor()
    cur.execute(query, args)
    return cur


@contextmanager
def _dict_cursor(conn: Any):
    if _USE_PSYCOPG3:
        with conn.cursor(row_factory=dict_row) as cur:
            yield cur
    else:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            yield cur


def _json(data: Any) -> Any:
    return Jsonb(data) if _USE_PSYCOPG3 else Json(data)


def create_tables() -> None:
    """Runs schema.sql (idempotent)."""
    sql = Path(SCHEMA_FILE).read_text(encoding="utf-8")
    with get_connection() as conn:
        _exec(conn, sql)
    log.info("tables ready (sensor_readings, relay_commands)")


def ping() -> bool:
    try:
        with get_connection() as conn:
            _exec(conn, "select 1")
        return True
    except Exception:  # noqa: BLE001
        return False


def insert_reading(row: dict[str, Any]) -> int:
    with get_connection() as conn:
        cur = _exec(
            conn,
            """insert into public.sensor_readings
                 (topic, sensor_type, payload, co2_ppm, nitrogen, phosphorus, potassium, soil_moisture)
               values (%s, %s, %s, %s, %s, %s, %s, %s) returning id""",
            (row["topic"], row["sensor_type"], _json(row["payload"]), row["co2_ppm"],
             row["nitrogen"], row["phosphorus"], row["potassium"], row["soil_moisture"]))
        return cur.fetchone()[0]


def latest_readings() -> dict[str, dict | None]:
    out: dict[str, dict | None] = {"co2": None, "npk": None, "soil_moisture": None}
    with get_connection() as conn, _dict_cursor(conn) as cur:
        # newest row that has a usable value (unparseable messages stay in the history)
        cur.execute(
            f"""select distinct on (sensor_type) {READING_COLS}
                from public.sensor_readings
                where (sensor_type = 'co2' and co2_ppm is not null)
                   or (sensor_type = 'npk' and coalesce(nitrogen, phosphorus, potassium) is not null)
                   or (sensor_type = 'soil_moisture' and soil_moisture is not null)
                order by sensor_type, created_at desc""")
        for r in cur.fetchall():
            out[r["sensor_type"]] = dict(r)
    return out


def history(sensor_type: str | None, limit: int, since_hours: float | None) -> list[dict]:
    where, args = [], []
    if sensor_type:
        where.append("sensor_type = %s")
        args.append(sensor_type)
    if since_hours:
        where.append("created_at > now() - make_interval(secs => %s)")
        args.append(since_hours * 3600)
    clause = ("where " + " and ".join(where)) if where else ""
    args.append(limit)
    with get_connection() as conn, _dict_cursor(conn) as cur:
        cur.execute(f"select {READING_COLS} from public.sensor_readings {clause} "
                    f"order by created_at desc limit %s", args)
        return [dict(r) for r in cur.fetchall()]


def log_relay(command: str, topic: str, payload: dict, status: str, error: str | None,
              client_ip: str | None) -> dict:
    with get_connection() as conn, _dict_cursor(conn) as cur:
        cur.execute(
            """insert into public.relay_commands (command, topic, payload, status, error, client_ip)
               values (%s, %s, %s, %s, %s, %s)
               returning id, command, topic, payload, status, error, created_at""",
            (command, topic, _json(payload), status, error, client_ip))
        row = cur.fetchone()
        return dict(row) if row else {}


def relay_history(limit: int) -> list[dict]:
    with get_connection() as conn, _dict_cursor(conn) as cur:
        cur.execute("""select id, command, topic, payload, status, error, created_at
                       from public.relay_commands order by created_at desc limit %s""", (limit,))
        return [dict(r) for r in cur.fetchall()]
