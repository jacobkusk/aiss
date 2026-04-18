#!/usr/bin/env python3
"""
collector.py — aisstream.io WebSocket → aiss `ingest-positions` Edge Function.

Fase 1 (Øresund) collector.  Long-lived WebSocket with reconnect,
per-MMSI downsampling, and batched POSTs.  Designed to run as a Fly.io /
Railway single worker (NOT on the Pi — the Pi's RTL-SDR shares that box's
network).

Matches the Pi collector (scripts/pi/ais_to_supabase.py) patterns:
  - Cumulative reject-reason counters (edge + RPC).
  - Buffer-with-timeout flush loop on a background task.
  - Stats summary at SIGINT / SIGTERM.

Environment variables:
  AISSTREAM_API_KEY   — aisstream.io API key (REQUIRED).
  SUPABASE_URL        — defaults to aiss prod project.
  SUPABASE_ANON_KEY   — anon JWT (Authorization header for edge functions).
  INGEST_API_KEY      — optional; must match INGEST_API_KEY in edge env if set.
  AISSTREAM_BBOX      — JSON "[[lat1,lon1],[lat2,lon2]]" (sw, ne).  Default:
                        Øresund [[55.3,12.2],[56.2,13.3]].
  DOWNSAMPLE_SECONDS  — min seconds between stored positions per MMSI. Default 15.
  FLUSH_INTERVAL      — seconds between POST flushes. Default 2.
  MAX_BUFFER          — max positions per flush. Default 1000.

Exit codes:
  0 — clean shutdown (SIGINT/SIGTERM).
  1 — startup error (missing env).
  2 — too many reconnect failures in a row.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
import time
from dataclasses import dataclass, field
from typing import Any

try:
    import websockets
except ImportError:
    print("websockets not installed. `pip install websockets aiohttp`", file=sys.stderr)
    sys.exit(1)

try:
    import aiohttp
except ImportError:
    print("aiohttp not installed. `pip install websockets aiohttp`", file=sys.stderr)
    sys.exit(1)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("aisstream")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

WS_URL = "wss://stream.aisstream.io/v0/stream"

AISSTREAM_API_KEY = os.environ.get("AISSTREAM_API_KEY", "").strip()
SUPABASE_URL = os.environ.get(
    "SUPABASE_URL", "https://grugesypzsebqcxcdseu.supabase.co"
).rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "").strip()
INGEST_API_KEY = os.environ.get("INGEST_API_KEY", "").strip()

INGEST_ENDPOINT = f"{SUPABASE_URL}/functions/v1/ingest-positions"

_DEFAULT_BBOX = [[55.3, 12.2], [56.2, 13.3]]  # Øresund
try:
    BBOXES = json.loads(os.environ.get("AISSTREAM_BBOX", json.dumps(_DEFAULT_BBOX)))
    # aisstream accepts list-of-bboxes; single bbox → wrap
    if isinstance(BBOXES[0][0], (int, float)):
        BBOXES = [BBOXES]
except Exception as e:
    log.error("AISSTREAM_BBOX parse failure: %s", e)
    sys.exit(1)

DOWNSAMPLE_SECONDS = int(os.environ.get("DOWNSAMPLE_SECONDS", "15"))
FLUSH_INTERVAL = float(os.environ.get("FLUSH_INTERVAL", "2.0"))
MAX_BUFFER = int(os.environ.get("MAX_BUFFER", "1000"))
DEDUP_DIST_M = 10  # same MMSI, <10 m, <DOWNSAMPLE_SECONDS → drop

# Reconnect backoff (seconds)
RECONNECT_BACKOFF_INITIAL = 2.0
RECONNECT_BACKOFF_MAX = 60.0
RECONNECT_FAIL_THRESHOLD = 10  # N consecutive failures → exit 2

# Message types we want from aisstream. PositionReport covers Class A;
# StandardClassB / ExtendedClassB cover smaller vessels; ShipStaticData
# gives us ship_type for the per-type speed table (T7).
WANTED_TYPES = [
    "PositionReport",
    "StandardClassBPositionReport",
    "ExtendedClassBPositionReport",
    "ShipStaticData",
]

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------


@dataclass
class Stats:
    ws_connects: int = 0
    ws_reconnects: int = 0
    ws_messages: int = 0
    positions_received: int = 0
    positions_downsampled: int = 0
    positions_posted: int = 0
    accepted: int = 0
    edge_rejected: int = 0
    rpc_rejected: int = 0
    reject_reasons: dict[str, int] = field(default_factory=dict)
    anomalies_logged: int = 0
    http_errors: int = 0
    static_received: int = 0

    def bump_reasons(self, d: dict[str, int]) -> None:
        for k, v in (d or {}).items():
            self.reject_reasons[k] = self.reject_reasons.get(k, 0) + int(v or 0)


stats = Stats()
shutdown_event: asyncio.Event = asyncio.Event()

# In-memory downsample map: mmsi -> (last_sent_epoch, last_lat, last_lon)
last_sent: dict[int, tuple[float, float, float]] = {}

# Position buffer (awaiting flush)
buffer_lock: asyncio.Lock = asyncio.Lock()
position_buffer: list[dict[str, Any]] = []

# ---------------------------------------------------------------------------
# Downsample
# ---------------------------------------------------------------------------


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math

    r = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def should_keep(mmsi: int, lat: float, lon: float, t: float) -> bool:
    """True if position is new enough / moved enough to keep."""
    prev = last_sent.get(mmsi)
    if prev is None:
        last_sent[mmsi] = (t, lat, lon)
        return True
    prev_t, prev_lat, prev_lon = prev
    dt = t - prev_t
    if dt < DOWNSAMPLE_SECONDS:
        # Within window — only keep if vessel *moved* more than DEDUP_DIST_M
        if haversine_m(prev_lat, prev_lon, lat, lon) < DEDUP_DIST_M:
            return False
    last_sent[mmsi] = (t, lat, lon)
    return True


# ---------------------------------------------------------------------------
# aisstream message handling
# ---------------------------------------------------------------------------


def extract_position(msg: dict[str, Any]) -> dict[str, Any] | None:
    """Convert an aisstream envelope into our ingest-positions payload shape."""
    mtype = msg.get("MessageType")
    meta = msg.get("MetaData") or {}
    body = (msg.get("Message") or {}).get(mtype, {}) if mtype else {}

    if mtype in ("PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport"):
        mmsi = meta.get("MMSI") or body.get("UserID")
        lat = body.get("Latitude") if body.get("Latitude") is not None else meta.get("latitude")
        lon = body.get("Longitude") if body.get("Longitude") is not None else meta.get("longitude")
        if mmsi is None or lat is None or lon is None:
            return None

        # aisstream supplies time_utc as ISO 8601 in MetaData
        t_iso = meta.get("time_utc")
        t: float
        if isinstance(t_iso, str):
            # Parse flexibly — aisstream uses "2024-09-01 12:34:56 +0000 UTC"
            try:
                t = time.time()  # fallback
                import re
                from datetime import datetime, timezone

                # Try ISO 8601 with Z first, then the quirky aisstream format
                iso = t_iso.replace(" +0000 UTC", "+00:00").replace(" ", "T", 1)
                dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                t = dt.timestamp()
            except Exception:
                t = time.time()
        else:
            t = time.time()

        return {
            "mmsi": int(mmsi),
            "lat": float(lat),
            "lon": float(lon),
            "t": t,
            "sog": body.get("Sog"),
            "cog": body.get("Cog"),
            "hdg": body.get("TrueHeading"),
            "vessel_name": (meta.get("ShipName") or "").strip() or None,
        }
    return None


def is_static_data(msg: dict[str, Any]) -> bool:
    return msg.get("MessageType") == "ShipStaticData"


# ---------------------------------------------------------------------------
# WebSocket loop with reconnect
# ---------------------------------------------------------------------------


async def subscribe_and_consume(ws: Any) -> None:
    subscribe_msg = {
        "APIKey": AISSTREAM_API_KEY,
        "BoundingBoxes": BBOXES,
        "FilterMessageTypes": WANTED_TYPES,
    }
    await ws.send(json.dumps(subscribe_msg))
    log.info("subscribed bboxes=%s types=%s", BBOXES, WANTED_TYPES)

    async for raw in ws:
        stats.ws_messages += 1
        try:
            msg = json.loads(raw)
        except Exception:
            continue

        if is_static_data(msg):
            stats.static_received += 1
            # Static data is handled by a separate route (ingest-static) — not
            # wired for aisstream yet. Count it so we see the flow.
            continue

        pos = extract_position(msg)
        if pos is None:
            continue

        stats.positions_received += 1

        if not should_keep(pos["mmsi"], pos["lat"], pos["lon"], pos["t"]):
            stats.positions_downsampled += 1
            continue

        async with buffer_lock:
            position_buffer.append(pos)
            if len(position_buffer) >= MAX_BUFFER:
                # Trigger flush early; flusher loop will drain
                pass


async def ws_loop() -> None:
    backoff = RECONNECT_BACKOFF_INITIAL
    consecutive_fails = 0

    while not shutdown_event.is_set():
        try:
            log.info("connecting to %s …", WS_URL)
            async with websockets.connect(
                WS_URL,
                ping_interval=30,
                ping_timeout=30,
                close_timeout=5,
                max_size=2**20,  # 1 MiB
            ) as ws:
                stats.ws_connects += 1
                backoff = RECONNECT_BACKOFF_INITIAL
                consecutive_fails = 0
                await subscribe_and_consume(ws)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            consecutive_fails += 1
            stats.ws_reconnects += 1
            if consecutive_fails >= RECONNECT_FAIL_THRESHOLD:
                log.error(
                    "WS dropped %s times in a row — aborting. Last error: %s",
                    consecutive_fails, e,
                )
                shutdown_event.set()
                return
            log.warning("WS drop (%d): %s — reconnecting in %.1fs", consecutive_fails, e, backoff)
            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=backoff)
                return
            except asyncio.TimeoutError:
                pass
            backoff = min(backoff * 2, RECONNECT_BACKOFF_MAX)


# ---------------------------------------------------------------------------
# Flush loop
# ---------------------------------------------------------------------------


async def post_batch(session: aiohttp.ClientSession, batch: list[dict[str, Any]]) -> None:
    headers = {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "x-source": "aisstream",
    }
    if INGEST_API_KEY:
        headers["x-api-key"] = INGEST_API_KEY

    body = {"positions": batch}
    try:
        async with session.post(INGEST_ENDPOINT, json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            text = await resp.text()
            if resp.status == 200:
                try:
                    data = json.loads(text)
                except Exception:
                    data = {}
                stats.positions_posted += len(batch)
                stats.accepted += int(data.get("accepted", 0) or 0)
                stats.edge_rejected += int(data.get("edge_rejected", 0) or 0)
                stats.rpc_rejected += int(data.get("rpc_rejected", 0) or 0)
                stats.anomalies_logged += int(data.get("anomalies_logged", 0) or 0)
                stats.bump_reasons(data.get("reject_reasons") or {})
                stats.bump_reasons(data.get("rpc_reject_reasons") or {})
            elif resp.status == 429:
                log.warning("429 rate-limited — sleeping 60s")
                stats.http_errors += 1
                await asyncio.sleep(60)
            else:
                stats.http_errors += 1
                log.error("POST %d: %s", resp.status, text[:300])
    except asyncio.CancelledError:
        raise
    except Exception as e:
        stats.http_errors += 1
        log.error("POST failure: %s", e)


async def flusher_loop() -> None:
    async with aiohttp.ClientSession() as session:
        while not shutdown_event.is_set():
            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=FLUSH_INTERVAL)
                # shutdown requested → drain one last time and stop
            except asyncio.TimeoutError:
                pass

            async with buffer_lock:
                if not position_buffer:
                    continue
                batch = position_buffer[:MAX_BUFFER]
                del position_buffer[: len(batch)]

            await post_batch(session, batch)


# ---------------------------------------------------------------------------
# Stats reporter
# ---------------------------------------------------------------------------


async def stats_loop() -> None:
    while not shutdown_event.is_set():
        try:
            await asyncio.wait_for(shutdown_event.wait(), timeout=60.0)
            return
        except asyncio.TimeoutError:
            pass
        log.info(
            "stats received=%d downsampled=%d posted=%d accepted=%d edge_rej=%d rpc_rej=%d anom=%d http_err=%d reasons=%s",
            stats.positions_received,
            stats.positions_downsampled,
            stats.positions_posted,
            stats.accepted,
            stats.edge_rejected,
            stats.rpc_rejected,
            stats.anomalies_logged,
            stats.http_errors,
            stats.reject_reasons,
        )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def check_env() -> None:
    missing: list[str] = []
    if not AISSTREAM_API_KEY:
        missing.append("AISSTREAM_API_KEY")
    if not SUPABASE_ANON_KEY:
        missing.append("SUPABASE_ANON_KEY")
    if missing:
        log.error("missing env: %s", ", ".join(missing))
        sys.exit(1)


def install_signal_handlers(loop: asyncio.AbstractEventLoop) -> None:
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, shutdown_event.set)
        except NotImplementedError:
            # Windows — rely on KeyboardInterrupt
            pass


async def main() -> None:
    check_env()
    log.info(
        "aisstream collector starting. bbox=%s downsample=%ds flush=%.1fs max_buf=%d",
        BBOXES, DOWNSAMPLE_SECONDS, FLUSH_INTERVAL, MAX_BUFFER,
    )
    install_signal_handlers(asyncio.get_running_loop())

    tasks = [
        asyncio.create_task(ws_loop(), name="ws_loop"),
        asyncio.create_task(flusher_loop(), name="flusher_loop"),
        asyncio.create_task(stats_loop(), name="stats_loop"),
    ]

    await shutdown_event.wait()
    log.info("shutdown requested — draining buffer")
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    log.info(
        "final stats: ws_connects=%d ws_reconnects=%d msgs=%d received=%d downsampled=%d posted=%d accepted=%d edge_rej=%d rpc_rej=%d anom=%d http_err=%d reasons=%s",
        stats.ws_connects, stats.ws_reconnects, stats.ws_messages,
        stats.positions_received, stats.positions_downsampled, stats.positions_posted,
        stats.accepted, stats.edge_rejected, stats.rpc_rejected,
        stats.anomalies_logged, stats.http_errors, stats.reject_reasons,
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
