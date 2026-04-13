#!/bin/bash
# ============================================================
# AISS Pi Watchdog
# Kører som systemd service. Holder øje med:
#   1. USB SDR dongle til stede
#   2. ais_to_supabase.py processen kører
#   3. Data faktisk flyder (tjekker /api/health hvert 5. min)
# Genstarter automatisk hvad der er nede.
# ============================================================

SERVICE="ais-ingest"            # systemd service navn
HEARTBEAT_FILE="/tmp/aiss_last_seen"
LOG="/var/log/aiss-watchdog.log"
MAX_AGE_SEC=300                 # alarm hvis ingen data i 5 min

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

restart_service() {
  log "RESTART: $SERVICE"
  systemctl restart "$SERVICE"
  sleep 5
}

check_sdr() {
  # RTL-SDR dongle — lsusb viser 0bda:2838 eller 0bda:2832
  if lsusb | grep -qiE "0bda:283[28]|RTL2838|RTL2832"; then
    return 0
  fi
  log "WARN: SDR dongle ikke fundet via USB"
  return 1
}

check_process() {
  if pgrep -f "ais_to_supabase.py" > /dev/null; then
    return 0
  fi
  log "WARN: ais_to_supabase.py kører ikke"
  return 1
}

check_data_flow() {
  # Tjekker heartbeat-fil skrevet af ais_to_supabase.py
  if [ ! -f "$HEARTBEAT_FILE" ]; then
    log "WARN: Ingen heartbeat-fil endnu — service er måske lige startet"
    return 0
  fi
  local last_mod age
  last_mod=$(stat -c %Y "$HEARTBEAT_FILE")
  age=$(( $(date +%s) - last_mod ))
  if [ "$age" -gt "$MAX_AGE_SEC" ]; then
    log "ALARM: Ingen data i ${age}s (max ${MAX_AGE_SEC}s) — genstarter"
    return 1
  fi
  return 0
}

# ---- Hoved-loop ----
log "Watchdog starter (service=$SERVICE, max_age=${MAX_AGE_SEC}s)"

TICK=0
while true; do
  TICK=$((TICK + 1))

  # Tjek SDR dongle (altid)
  if ! check_sdr; then
    log "SDR mangler — venter 30s og tjekker igen (måske hot-plug)"
    sleep 30
    if ! check_sdr; then
      log "SDR stadig mangler — kan ikke gøre mere end at vente"
    fi
  fi

  # Tjek Python processen
  if ! check_process; then
    restart_service
  fi

  # Tjek data flow hvert tick (hvert minut)
  if ! check_data_flow; then
    restart_service
  fi

  sleep 60
done
