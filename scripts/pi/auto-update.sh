#!/bin/bash
# auto-update.sh — kører hvert 5. minut via systemd timer.
# Henter seneste kode fra GitHub og genstarter services hvis filer ændrede sig.
# Jac skal aldrig SCP eller SSH manuelt igen.

set -euo pipefail

REPO_DIR="/home/pi/aiss-site"
PI_DIR="${REPO_DIR}/scripts/pi"
LOG_TAG="aiss-update"

log() { logger -t "$LOG_TAG" "$*"; echo "[$(date +%H:%M:%S)] $*"; }

cd "$REPO_DIR"

# Gem hash før pull
BEFORE=$(git rev-parse HEAD)

# Pull seneste ændringer (fast-forward only, aldrig konflikter)
git fetch origin main --quiet 2>/dev/null || { log "WARN: git fetch fejlede (netværk?)"; exit 0; }
git reset --hard origin/main --quiet 2>/dev/null || { log "WARN: git reset fejlede"; exit 0; }

AFTER=$(git rev-parse HEAD)

# Ingen ændringer? Done.
if [ "$BEFORE" = "$AFTER" ]; then
    exit 0
fi

log "Ny kode: ${BEFORE:0:8} → ${AFTER:0:8}"

# Tjek om Pi-relevante filer ændrede sig
CHANGED=$(git diff --name-only "$BEFORE" "$AFTER" -- scripts/pi/)

if [ -z "$CHANGED" ]; then
    log "Ændringer var ikke i scripts/pi/ — skipper restart"
    exit 0
fi

log "Ændrede Pi-filer: $CHANGED"

# Geninstallér services hvis .service filer ændrede sig
if echo "$CHANGED" | grep -q '\.service'; then
    log "Service-filer ændret — geninstallerer..."
    sudo cp "${PI_DIR}/ais-ingest.service" /etc/systemd/system/ais-ingest.service
    sudo cp "${PI_DIR}/aiss-watchdog.service" /etc/systemd/system/aiss-watchdog.service 2>/dev/null || true
    sudo systemctl daemon-reload
fi

# Genstart ais-ingest (hovedservice)
if echo "$CHANGED" | grep -qE 'ais_to_supabase\.py|ais-ingest\.service'; then
    log "Genstarter ais-ingest..."
    sudo systemctl restart ais-ingest
    sleep 2
    if systemctl is-active --quiet ais-ingest; then
        log "ais-ingest genstartet OK"
    else
        log "FEJL: ais-ingest startede ikke — ruller IKKE tilbage (tjek journal)"
    fi
fi

# Genstart watchdog hvis dens script ændrede sig
if echo "$CHANGED" | grep -qE 'watchdog\.sh|aiss-watchdog\.service'; then
    log "Genstarter watchdog..."
    sudo systemctl restart aiss-watchdog 2>/dev/null || true
fi

log "Auto-update færdig"
