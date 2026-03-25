#!/bin/bash
# ============================================================
# ScribeFlow - LXC Install / Update Script for Proxmox
# Run this INSIDE a Debian/Ubuntu LXC container as root
#
# Safe to re-run for updates — existing project data in
# DATA_DIR is never touched or removed by this script.
# ============================================================

set -e

SCRIBEFLOW_PORT=${SCRIBEFLOW_PORT:-3051}
INSTALL_DIR="/opt/scribeflow"
DATA_DIR="/var/lib/scribeflow"
SERVICE_USER="scribeflow"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[ScribeFlow]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo -e "${BLUE}"
echo "  ╔═══════════════════════════════════╗"
echo "  ║        ScribeFlow Installer       ║"
echo "  ║   Self-Hosted Writing Workspace   ║"
echo "  ╚═══════════════════════════════════╝"
echo -e "${NC}"

# Check root
[ "$EUID" -ne 0 ] && err "Please run as root"

# Detect OS
if [ -f /etc/debian_version ]; then
  OS="debian"
elif [ -f /etc/alpine-release ]; then
  OS="alpine"
else
  warn "Unknown OS; assuming Debian-like"
  OS="debian"
fi

# ── CHECK FOR EXISTING DATA ──────────────────────────────────────────────
EXISTING_PROJECTS=0
if [ -d "$DATA_DIR/projects" ]; then
  EXISTING_PROJECTS=$(find "$DATA_DIR/projects" -name "*.json" 2>/dev/null | wc -l)
fi

if [ "$EXISTING_PROJECTS" -gt 0 ]; then
  warn "Found ${EXISTING_PROJECTS} existing project(s) in ${DATA_DIR}"
  warn "These will be preserved — this script never modifies project data."
else
  log "No existing project data found — fresh install."
fi

# ── SYSTEM PACKAGES ──────────────────────────────────────────────────────
log "Updating system packages…"
if [ "$OS" = "alpine" ]; then
  apk update && apk upgrade
else
  apt-get update -qq && apt-get upgrade -y -qq
fi

log "Installing dependencies…"
if [ "$OS" = "alpine" ]; then
  apk add --no-cache nodejs npm curl wget
else
  apt-get install -y -qq curl wget gnupg2

  if ! command -v node &>/dev/null || [[ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 18 ]]; then
    log "Installing Node.js 20 LTS…"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    log "Node.js $(node -v) already installed"
  fi
fi

node -v || err "Node.js installation failed"
npm -v  || err "npm installation failed"

# ── SERVICE USER ─────────────────────────────────────────────────────────
if ! id "$SERVICE_USER" &>/dev/null; then
  log "Creating service user '${SERVICE_USER}'…"
  useradd --system --shell /usr/sbin/nologin --home-dir "$INSTALL_DIR" "$SERVICE_USER" || true
fi

# ── DATA DIRECTORY (create if missing, never overwrite) ──────────────────
log "Ensuring data directory exists…"
mkdir -p "$DATA_DIR/projects"
# Only chown if we just created it (don't stomp existing permissions)
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

# ── APPLICATION FILES ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -d "$SCRIPT_DIR/../backend" ]; then
  log "Copying application files…"
  # Stop service before update if it's running
  if systemctl is-active --quiet scribeflow 2>/dev/null; then
    log "Stopping existing service for update…"
    systemctl stop scribeflow
  fi
  # Sync app files — rsync preserves permissions, skips unchanged files
  if command -v rsync &>/dev/null; then
    rsync -a --exclude='node_modules' --exclude='data' "$SCRIPT_DIR/../" "$INSTALL_DIR/"
  else
    cp -r "$SCRIPT_DIR/../." "$INSTALL_DIR/"
  fi
else
  err "Cannot find ScribeFlow source. Run this script from within the ScribeFlow directory."
fi

# ── NODE DEPENDENCIES ────────────────────────────────────────────────────
log "Installing Node.js dependencies…"
cd "$INSTALL_DIR/backend"
npm install --production

# ── PERMISSIONS ──────────────────────────────────────────────────────────
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
# Re-apply data dir ownership in case the copy above changed anything
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"

# ── SYSTEMD SERVICE ───────────────────────────────────────────────────────
log "Writing systemd service…"
cat > /etc/systemd/system/scribeflow.service << EOF
[Unit]
Description=ScribeFlow Writing Application
Documentation=https://github.com/scribeflow
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}/backend

# Server runs startup scan on launch — existing projects in DATA_DIR
# are discovered, validated, and reported in the journal automatically.
ExecStart=$(which node) server.js

Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=scribeflow

Environment=NODE_ENV=production
Environment=PORT=${SCRIBEFLOW_PORT}
Environment=DATA_DIR=${DATA_DIR}

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${DATA_DIR}
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

# ── START ─────────────────────────────────────────────────────────────────
log "Enabling and starting ScribeFlow…"
systemctl daemon-reload
systemctl enable scribeflow
systemctl start scribeflow

# Wait for startup scan to complete
sleep 4

if systemctl is-active --quiet scribeflow; then
  log "ScribeFlow started successfully!"
  if [ "$EXISTING_PROJECTS" -gt 0 ]; then
    log "Startup scan re-imported ${EXISTING_PROJECTS} existing project(s) automatically."
    log "Check the journal for details: journalctl -u scribeflow -n 30"
  fi
else
  err "ScribeFlow failed to start. Check: journalctl -u scribeflow -n 50"
fi

IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        ScribeFlow ready!                           ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  URL:      ${BLUE}http://${IP}:${SCRIBEFLOW_PORT}${NC}"
echo -e "${GREEN}║${NC}  Data:     ${DATA_DIR}"
echo -e "${GREEN}║${NC}  Projects: ${EXISTING_PROJECTS} existing project(s) preserved"
echo -e "${GREEN}║${NC}  Logs:     journalctl -u scribeflow -f"
echo -e "${GREEN}║${NC}  Restart:  systemctl restart scribeflow"
echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
echo ""
