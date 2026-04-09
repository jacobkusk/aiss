#!/usr/bin/env python3
"""
ais_to_supabase.py — Pi AIS collector
Sender AIS-positioner til aiss ingest-ais Edge Function.
Kører som systemd service på Raspberry Pi.
"""

import subprocess
import threading
import time
import json
import socket
import requests
import logging
from datetime import datetime, timezone

try:
    from pyais import decode
    PYAIS_AVAILABLE = True
except ImportError:
    PYAIS_AVAILABLE = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ais")

# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

SUPABASE_URL     = "https://grugesypzsebqcxcdseu.supabase.co"
SUPABASE_KEY     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdydWdlc3lwenNlYnFjeGNkc2V1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MDM4NzYsImV4cCI6MjA5MTA3OTg3Nn0.InIKvUBRTdX8MI6_f0k5d276wRy-W8tAmnBbT6qyhpg"

# Edge Function endpoint (ny pipeline)
EDGE_FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/ingest-ais"

# Gammel RPC endpoint (dual-write fallback, sæt False når valideret)
DUAL_WRITE       = False
RPC_URL          = f"{SUPABASE_URL}/rest/v1/rpc/batch_upsert_positions"

FLUSH_INTERVAL   = 5      # sekunder mellem flushes
MAX_BUFFER       = 200    # max positioner i buffer
UDP_HOST         = "127.0.0.1"
UDP_PORT         = 10110  # rtl_ais default UDP output port

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

position_buffer: list[dict] = []
buffer_lock = threading.Lock()
stats = {"sent": 0, "accepted": 0, "rejected": 0, "errors": 0}

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

SESSION = requests.Session()
SESSION.headers.update({
    "Content-Type": "application/json",
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
})

def post_edge_function(positions: list[dict]) -> tuple[int, int]:
    """Send til ingest-ais Edge Function. Returnerer (accepted, rejected)."""
    try:
        resp = SESSION.post(
            EDGE_FUNCTION_URL,
            json={"positions": positions},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("accepted", 0), data.get("rejected", 0)
    except requests.exceptions.RequestException as e:
        log.error(f"[edge] HTTP fejl: {e}")
        return 0, 0
    except Exception as e:
        log.error(f"[edge] Uventet fejl: {e}")
        return 0, 0


def post_rpc_legacy(positions: list[dict]) -> bool:
    """Dual-write til gamle tabeller via batch_upsert_positions RPC."""
    try:
        resp = SESSION.post(
            RPC_URL,
            json={"p_positions": positions},
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        log.warning(f"[legacy] dual-write fejl: {e}")
        return False

# ---------------------------------------------------------------------------
# Flush
# ---------------------------------------------------------------------------

def flush():
    global position_buffer

    with buffer_lock:
        if not position_buffer:
            return
        batch = position_buffer[:]
        position_buffer = []

    stats["sent"] += len(batch)

    # Primær: Edge Function (ny pipeline)
    accepted, rejected = post_edge_function(batch)
    stats["accepted"] += accepted
    stats["rejected"] += rejected

    log.info(f"[new] {accepted} accepted, {rejected} rejected  |  total sent={stats['sent']}")

    # Dual-write til gamle tabeller (midlertidigt)
    if DUAL_WRITE:
        post_rpc_legacy(batch)

# ---------------------------------------------------------------------------
# Flush thread
# ---------------------------------------------------------------------------

def flush_loop():
    while True:
        time.sleep(FLUSH_INTERVAL)
        try:
            flush()
        except Exception as e:
            log.error(f"flush fejl: {e}")
            stats["errors"] += 1

# ---------------------------------------------------------------------------
# NMEA parser — bruger pyais til at decode !AIVDM sætninger
# ---------------------------------------------------------------------------

# Buffer til multi-part NMEA beskeder (del 1 af 2 etc.)
nmea_parts: dict[str, list[str]] = {}

def parse_nmea_line(line: str) -> dict | None:
    """
    Decoder én NMEA-linje fra rtl_ais.
    Returnerer dict med mmsi, lat, lon, sog, cog, timestamp — eller None.
    Multi-part beskeder (f.eks. !AIVDM,2,1,...) buffereres til del 2 ankommer.
    """
    line = line.strip()
    if not line.startswith("!AIVDM") and not line.startswith("!AIVDO"):
        return None

    try:
        parts = line.split(",")
        total_parts = int(parts[1])
        part_num = int(parts[2])
        msg_id = parts[3]  # typisk tom "" for enkelt-del

        key = msg_id if msg_id else "single"

        if total_parts > 1:
            # Multi-part: buffer til alle dele er modtaget
            if key not in nmea_parts:
                nmea_parts[key] = []
            nmea_parts[key].append(line)
            if len(nmea_parts[key]) < total_parts:
                return None
            lines_to_decode = nmea_parts.pop(key)
        else:
            lines_to_decode = [line]

        msg = decode(*lines_to_decode)
        data = msg.asdict()

        # Kun positionsbeskeder med koordinater (type 1,2,3,18,21)
        mmsi = data.get("mmsi")
        lat = data.get("lat")
        lon = data.get("lon")

        if mmsi is None or lat is None or lon is None:
            return None

        # Byg normaliseret dict til Edge Function
        return {
            "mmsi": mmsi,
            "lat": float(lat),
            "lon": float(lon),
            "sog": float(data.get("speed", 0) or 0),
            "cog": float(data.get("course", 0) or 0),
            "heading": int(data.get("heading", 511) or 511),
            "nav_status": data.get("status"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "vessel_name": data.get("shipname") or data.get("name"),
            "ship_type": data.get("ship_type"),
        }

    except Exception:
        return None

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    log.info("=" * 50)
    log.info("aiss Pi collector starter")
    log.info(f"  endpoint: {EDGE_FUNCTION_URL}")
    log.info(f"  dual-write: {DUAL_WRITE}")
    log.info(f"  flush interval: {FLUSH_INTERVAL}s")
    log.info("=" * 50)

    # Start flush thread
    t = threading.Thread(target=flush_loop, daemon=True)
    t.start()

    # Start rtl_ais — sender decoded NMEA til UDP port 10110
    proc = subprocess.Popen(
        ["rtl_ais", "-h", UDP_HOST, "-P", str(UDP_PORT)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    log.info(f"rtl_ais PID: {proc.pid} — lytter på UDP {UDP_HOST}:{UDP_PORT}")

    # Lyt på UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_HOST, UDP_PORT))
    sock.settimeout(2.0)

    try:
        while True:
            try:
                data, _ = sock.recvfrom(4096)
                raw_line = data.decode("utf-8", errors="ignore")
            except socket.timeout:
                # Tjek at rtl_ais stadig kører
                if proc.poll() is not None:
                    log.error("rtl_ais stoppede uventet — genstarter...")
                    proc = subprocess.Popen(
                        ["rtl_ais", "-h", UDP_HOST, "-P", str(UDP_PORT)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    log.info(f"rtl_ais genstartet PID: {proc.pid}")
                continue

            for line in raw_line.splitlines():
                position = parse_nmea_line(line)
                if position is None:
                    continue

                mmsi = position.get("mmsi")
                lat  = position.get("lat")

                with buffer_lock:
                    position_buffer.append(position)
                    buf_len = len(position_buffer)

                log.info(f"  MMSI={mmsi} lat={lat:.4f} sog={position.get('sog', 0):.1f}kn")

                if buf_len >= MAX_BUFFER:
                    flush()

    except KeyboardInterrupt:
        log.info("Afbrudt — flush resterende...")
        flush()
    finally:
        sock.close()
        proc.terminate()
        log.info(f"Slut. Sendt={stats['sent']} accepted={stats['accepted']} rejected={stats['rejected']}")


if __name__ == "__main__":
    main()
