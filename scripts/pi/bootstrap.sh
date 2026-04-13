#!/bin/bash
# bootstrap.sh — kør dette ÉN gang på Pi'en for at installere alt.
# Installerer: ais-ingest, watchdog, og auto-update timer.
# Herefter opdaterer Pi'en sig selv via git pull hvert 5. minut.
# Du skal ALDRIG SCP eller SSH igen for at deploye kodeændringer.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER=$(whoami)

echo "[bootstrap] $(date) — starter fuld installation"
echo "[bootstrap] Script dir: ${SCRIPT_DIR}"
echo "[bootstrap] User: ${USER}"

# Opdater stier i service-filer til at matche faktisk placering
for f in ais-ingest.service aiss-watchdog.service aiss-auto-update.service; do
    if [ -f "${SCRIPT_DIR}/${f}" ]; then
        sed -i "s|/home/pi/aiss-site/scripts/pi|${SCRIPT_DIR}|g" "${SCRIPT_DIR}/${f}"
        sed -i "s|/home/pi/aiss-site|$(dirname $(dirname ${SCRIPT_DIR}))|g" "${SCRIPT_DIR}/${f}"
        sed -i "s|User=pi|User=${USER}|g" "${SCRIPT_DIR}/${f}"
    fi
done

# Gør scripts executable
chmod +x "${SCRIPT_DIR}/auto-update.sh"
chmod +x "${SCRIPT_DIR}/watchdog.sh" 2>/dev/null || true

# --- ais-ingest service ---
echo "[bootstrap] Installerer ais-ingest service..."
sudo cp "${SCRIPT_DIR}/ais-ingest.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ais-ingest
sudo systemctl restart ais-ingest
echo "[bootstrap] ais-ingest: $(systemctl is-active ais-ingest)"

# --- watchdog service ---
if [ -f "${SCRIPT_DIR}/aiss-watchdog.service" ]; then
    echo "[bootstrap] Installerer watchdog service..."
    sudo cp "${SCRIPT_DIR}/aiss-watchdog.service" /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable aiss-watchdog
    sudo systemctl restart aiss-watchdog
    echo "[bootstrap] watchdog: $(systemctl is-active aiss-watchdog)"
fi

# --- auto-update timer (det vigtigste: Pi opdaterer sig selv) ---
echo "[bootstrap] Installerer auto-update timer..."
sudo cp "${SCRIPT_DIR}/aiss-auto-update.service" /etc/systemd/system/
sudo cp "${SCRIPT_DIR}/aiss-auto-update.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable aiss-auto-update.timer
sudo systemctl start aiss-auto-update.timer
echo "[bootstrap] auto-update timer: $(systemctl is-active aiss-auto-update.timer)"

# --- Konfigurer git til at undgå detached HEAD og merge-konflikter ---
cd "$(dirname $(dirname ${SCRIPT_DIR}))"
git config pull.rebase false 2>/dev/null || true

echo ""
echo "============================================"
echo " AISS Pi installation færdig!"
echo " Services: ais-ingest, watchdog, auto-update"
echo " Auto-update: hvert 5 minut via git pull"
echo " Du behøver aldrig SSH til denne Pi igen."
echo "============================================"
echo ""
systemctl list-timers aiss-auto-update.timer --no-pager 2>/dev/null || true
