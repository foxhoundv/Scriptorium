#!/bin/bash
# ============================================================
# ScribeFlow - Proxmox LXC Container Creator
# Run this on your PROXMOX HOST (not inside a container)
# ============================================================

set -e

# ── CONFIGURATION (edit these) ──────────────────────────────
CTID=${1:-200}                    # LXC container ID
HOSTNAME="scribeflow"
TEMPLATE="debian-12-standard"    # or ubuntu-22.04-standard
STORAGE="local-lvm"              # your Proxmox storage
DISK_SIZE="4G"
MEMORY=512
CORES=1
BRIDGE="vmbr0"
SCRIBEFLOW_PORT=3051
# Optional: set a static IP (leave blank for DHCP)
IP_ADDR=""                       # e.g. "192.168.1.50/24"
GATEWAY=""                       # e.g. "192.168.1.1"
# ────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[Proxmox]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

[ "$EUID" -ne 0 ] && err "Run as root on the Proxmox host"

# Find template
log "Finding LXC template…"
TEMPLATE_PATH=$(pveam list local 2>/dev/null | grep "$TEMPLATE" | head -1 | awk '{print $1}' || true)
if [ -z "$TEMPLATE_PATH" ]; then
  log "Downloading template…"
  pveam update
  AVAIL=$(pveam available --section system | grep "$TEMPLATE" | head -1 | awk '{print $2}')
  [ -z "$AVAIL" ] && err "Template '$TEMPLATE' not found. Run: pveam available --section system"
  pveam download local "$AVAIL"
  TEMPLATE_PATH="local:vztmpl/$AVAIL"
fi
log "Using template: $TEMPLATE_PATH"

# Build network config
if [ -n "$IP_ADDR" ] && [ -n "$GATEWAY" ]; then
  NET_CONFIG="name=eth0,bridge=${BRIDGE},ip=${IP_ADDR},gw=${GATEWAY}"
else
  NET_CONFIG="name=eth0,bridge=${BRIDGE},ip=dhcp"
fi

# Create container
log "Creating LXC container (ID: $CTID)…"
pct create "$CTID" "$TEMPLATE_PATH" \
  --hostname "$HOSTNAME" \
  --storage "$STORAGE" \
  --rootfs "${STORAGE}:${DISK_SIZE}" \
  --memory "$MEMORY" \
  --cores "$CORES" \
  --net0 "$NET_CONFIG" \
  --features nesting=0 \
  --unprivileged 1 \
  --start 1 \
  --onboot 1

log "Waiting for container to start…"
sleep 5

# Wait for network
log "Waiting for network…"
for i in {1..30}; do
  if pct exec "$CTID" -- ping -c1 -W1 8.8.8.8 &>/dev/null; then break; fi
  sleep 2
done

# Copy ScribeFlow files into container
log "Copying ScribeFlow files into container…"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pct exec "$CTID" -- mkdir -p /tmp/scribeflow
pct push "$CTID" "$SCRIPT_DIR" /tmp/scribeflow --recursive 2>/dev/null || \
  tar -czf /tmp/scribeflow.tar.gz -C "$(dirname $SCRIPT_DIR)" "$(basename $SCRIPT_DIR)" && \
  pct push "$CTID" /tmp/scribeflow.tar.gz /tmp/scribeflow.tar.gz && \
  pct exec "$CTID" -- tar -xzf /tmp/scribeflow.tar.gz -C /tmp/ && \
  pct exec "$CTID" -- mv /tmp/scribeflow/* /tmp/scribeflow/ 2>/dev/null || true

# Run installer inside container
log "Running ScribeFlow installer inside container…"
pct exec "$CTID" -- bash /tmp/scribeflow/lxc/install.sh

# Get container IP
CONTAINER_IP=$(pct exec "$CTID" -- hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     ScribeFlow LXC Container Ready!               ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  Container ID: $CTID"
echo -e "${GREEN}║${NC}  URL:          ${YELLOW}http://${CONTAINER_IP}:${SCRIBEFLOW_PORT}${NC}"
echo -e "${GREEN}║${NC}  Shell:        pct enter $CTID"
echo -e "${GREEN}║${NC}  Logs:         pct exec $CTID -- journalctl -u scribeflow -f"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
