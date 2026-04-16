#!/usr/bin/env python3
"""
ais_to_supabase.py — Pi AIS collector
Sender AIS-positioner til aiss `ingest-positions` Edge Function (v7+).
Kører som systemd service på Raspberry Pi.

Per-reason rejection stats læses fra response["reject_reasons"] +
response["rpc_reject_reasons"] og logges pr. flush + total ved afslutning.
Dermed er "33 % rejected"-mysteriet fra april 2026 ikke længere anonymt.
"""

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
EDGE_FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/ingest-positions"

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

# Cumulative reject-reason counters — populated from the Edge Function response.
# Keys match the ingest-positions reject reasons (see docs/EDGE-FUNCTION-RUNBOOK.md §1.3):
#   mmsi_invalid, invalid_coords, out_of_bounds, null_island,
#   teleportation, duplicate_within_batch (edge-side)
#   + any RPC-side reasons returned in rpc_reject_reasons
reject_reason_totals: dict[str, int] = {}

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

SESSION = requests.Session()
SESSION.headers.update({
    "Content-Type": "application/json",
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
})

def post_edge_function(positions: list[dict]) -> dict:
    """Send til ingest-positions Edge Function.

    Returnerer hele JSON-svaret så callers kan læse både totals og
    per-reason breakdown. På HTTP-fejl returneres et tomt svar med
    accepted=rejected=0 så flush()-loggen ikke crasher.

    Example successful response (ingest-positions v7+):
        {
          "accepted": 42,
          "rejected": 3,
          "edge_rejected": 2,
          "rpc_rejected": 1,
          "reject_reasons": {"duplicate_within_batch": 2, ...},
          "rpc_reject_reasons": {...},
          "source": "pi4_rtlsdr"
        }
    """
    try:
        resp = SESSION.post(
            EDGE_FUNCTION_URL,
            json={"positions": positions},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.RequestException as e:
        log.error(f"[edge] HTTP fejl: {e}")
        return {"accepted": 0, "rejected": 0}
    except Exception as e:
        log.error(f"[edge] Uventet fejl: {e}")
        return {"accepted": 0, "rejected": 0}


def merge_reject_reasons(response: dict) -> dict[str, int]:
    """Slå edge- og RPC-reasons sammen til ét flat dict for denne flush."""
    merged: dict[str, int] = {}
    for key in ("reject_reasons", "rpc_reject_reasons"):
        src = response.get(key) or {}
        if isinstance(src, dict):
            for reason, n in src.items():
                if not isinstance(n, int) or n <= 0:
                    continue
                merged[reason] = merged.get(reason, 0) + n
    return merged


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
    response = post_edge_function(batch)
    accepted = int(response.get("accepted", 0) or 0)
    rejected = int(response.get("rejected", 0) or 0)
    stats["accepted"] += accepted
    stats["rejected"] += rejected

    # Per-reason breakdown — læg både denne flush og total i log.
    reasons = merge_reject_reasons(response)
    if reasons:
        for reason, n in reasons.items():
            reject_reason_totals[reason] = reject_reason_totals.get(reason, 0) + n
        reasons_str = " ".join(f"{k}={v}" for k, v in sorted(reasons.items()))
        log.info(
            f"[new] {accepted} accepted, {rejected} rejected "
            f"(edge={response.get('edge_rejected', '?')} rpc={response.get('rpc_rejected', '?')}) "
            f"reasons: {reasons_str}  |  total sent={stats['sent']}"
        )
    else:
        log.info(
            f"[new] {accepted} accepted, {rejected} rejected  |  total sent={stats['sent']}"
        )

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
# Vessel static data cache (Type 5 / Type 19 → position enrichment + DB persist)
# ---------------------------------------------------------------------------

# In-RAM caches. Dør ved restart — hvilket er OK fordi skibe retransmitterer
# Type 5 hvert 6. minut, så cachen warmer op igen automatisk.
vessel_name_cache: dict[int, str] = {}    # mmsi → skibsnavn (til position enrichment)
vessel_static_cache: dict[int, dict] = {}  # mmsi → sidst-sendte static snapshot

def persist_vessel_static(
    mmsi: int,
    ship_type=None,
    callsign=None,
    imo=None,
    destination=None,
    shipname=None,
):
    """Call upsert_vessel_static RPC i baggrundstråd.

    Erstatter den gamle persist_vessel_name: vi gemmer nu hele Type 5-payloaden
    i én RPC (ship_type, callsign, imo, destination, shipname) i stedet for
    bare navnet via REST PATCH. Det er canonical write-path for alle static
    fields jf. supabase/functions-sql/upsert_vessel_static.sql.
    """
    try:
        resp = SESSION.post(
            f"{SUPABASE_URL}/rest/v1/rpc/upsert_vessel_static",
            json={
                "p_mmsi": int(mmsi),
                "p_ship_type": int(ship_type) if ship_type else None,
                "p_callsign": callsign,
                "p_imo": int(imo) if imo else None,
                "p_destination": destination,
                "p_shipname": shipname,
            },
            timeout=5,
        )
        if resp.status_code in (200, 204):
            log.info(
                f"  [static→db] MMSI={mmsi} ship_type={ship_type} "
                f"name={shipname!r} callsign={callsign!r}"
            )
        else:
            log.warning(
                f"  [static→db] MMSI={mmsi} fejl {resp.status_code}: "
                f"{resp.text[:200]}"
            )
    except Exception as e:
        log.warning(f"  [static→db] MMSI={mmsi} exception: {e}")

# ---------------------------------------------------------------------------
# NMEA parser — bruger pyais til at decode !AIVDM sætninger
# ---------------------------------------------------------------------------

# Buffer til multi-part NMEA beskeder (del 1 af 2 etc.)
nmea_parts: dict[str, list[str]] = {}

def parse_nmea_line(line: str) -> dict | None:
    """
    Decoder én NMEA-linje fra AIS-catcher.
    Returnerer dict med mmsi, lat, lon, sog, cog, timestamp — eller None.
    Type 5 (skibsnavn/static) gemmes til DB og caches.
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

        mmsi = data.get("mmsi")
        lat = data.get("lat")
        lon = data.get("lon")

        # Type 5/19/24 (static/voyage): ship_type + callsign + imo + destination + shipname.
        # Dedupe per-MMSI på hele snapshottet — Type 5 retransmitteres hvert
        # 6. minut, så vi spammer kun DB når noget faktisk ændrer sig.
        shipname = data.get("shipname") or data.get("name")
        ship_type = data.get("ship_type")
        callsign = data.get("callsign")
        imo = data.get("imo")
        destination = data.get("destination")

        if mmsi and (shipname or ship_type or callsign or imo or destination):
            mmsi_int = int(mmsi)

            def _clean(s):
                return str(s).strip().rstrip("@").strip() if s else None

            snap = {
                "shipname": _clean(shipname),
                "ship_type": int(ship_type) if ship_type else None,
                "callsign": _clean(callsign),
                "imo": int(imo) if imo else None,
                "destination": _clean(destination),
            }
            if vessel_static_cache.get(mmsi_int) != snap:
                vessel_static_cache[mmsi_int] = snap
                # Hold name-cache synkron til position enrichment nedenfor.
                if snap["shipname"]:
                    vessel_name_cache[mmsi_int] = snap["shipname"]
                log.info(
                    f"  [type5] MMSI={mmsi} name={snap['shipname']!r} "
                    f"ship_type={snap['ship_type']} callsign={snap['callsign']!r}"
                )
                # Gem til DB i baggrunden — ikke-blokerende.
                threading.Thread(
                    target=persist_vessel_static,
                    kwargs={
                        "mmsi": mmsi_int,
                        "ship_type": snap["ship_type"],
                        "callsign": snap["callsign"],
                        "imo": snap["imo"],
                        "destination": snap["destination"],
                        "shipname": snap["shipname"],
                    },
                    daemon=True,
                ).start()

        # Kun positionsbeskeder med koordinater (type 1,2,3,18,21)
        if mmsi is None or lat is None or lon is None:
            return None

        # Brug cachet navn fra Type 5 til at berige positionen
        cached_name = vessel_name_cache.get(int(mmsi))

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
            "vessel_name": cached_name,
            "ship_type": ship_type if ship_type else data.get("ship_type"),
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
    log.info(f"  decoder: AIS-catcher (extern service)")
    log.info(f"  lytter på UDP {UDP_HOST}:{UDP_PORT}")
    log.info("=" * 50)

    # Start flush thread
    t = threading.Thread(target=flush_loop, daemon=True)
    t.start()

    # AIS-catcher kører som separat systemd service (ais-catcher.service)
    # og sender NMEA til UDP port 10110. Vi lytter bare.
    # VIGTIGT: Start IKKE rtl_ais herfra — AIS-catcher håndterer SDR'en.

    # Lyt på UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_HOST, UDP_PORT))
    sock.settimeout(10.0)

    log.info("Venter på NMEA fra AIS-catcher...")

    try:
        while True:
            try:
                data, _ = sock.recvfrom(4096)
                raw_line = data.decode("utf-8", errors="ignore")
            except socket.timeout:
                log.warning("Ingen data i 10s — tjek at ais-catcher.service kører")
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
        summary = (
            f"Slut. Sendt={stats['sent']} accepted={stats['accepted']} "
            f"rejected={stats['rejected']}"
        )
        if reject_reason_totals:
            reasons_str = " ".join(
                f"{k}={v}" for k, v in sorted(reject_reason_totals.items())
            )
            summary += f" reasons: {reasons_str}"
        log.info(summary)


if __name__ == "__main__":
    main()
