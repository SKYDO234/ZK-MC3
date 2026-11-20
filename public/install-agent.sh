#!/usr/bin/env bash
# =============================================================
#  ZK-MC3-PANEL  ·  Node Agent Installer
#  A product of ZK-STUDIO · CEO MD Ziyan Hossain
# =============================================================
#  One line, one argument — the token the panel generated for this node:
#
#    curl -fsSL http://<panel>:31120/install-agent.sh | sudo bash -s -- <token>
#
#  The panel rewrites the __PANEL_ORIGIN__ marker below with its own origin
#  serves this file, so the script knows who issued the token without asking.
#  If you downloaded this file some other way, the token itself may also carry
#  the panel address (base64 of {"panel":…,"t":…}) — both forms work.
#
#  Optional environment overrides:
#    AGENT_PORT=6768        port the agent listens on
#    ZK_AGENT_NAME=eu-2     name shown in the panel
#    ZK_DIR=/opt/zk-mc3     install location
#    ZK_PANEL_URL=http://…  skip token decoding, point at a panel explicitly
# =============================================================

set -uo pipefail

GREEN='\033[38;5;48m'
CYAN='\033[38;5;51m'
AMBER='\033[38;5;214m'
ORANGE='\033[38;5;208m'
RED='\033[38;5;196m'
WHITE='\033[1;37m'
GRAY='\033[38;5;242m'
DIM='\033[2m'
NC='\033[0m'

PM2_AGENT="zk-mc3-agent"
SERVICE="zk-mc3-agent"
INSTALL_DIR="${ZK_DIR:-/opt/zk-mc3}"
AGENT_PORT="${AGENT_PORT:-6768}"
NODE_MAJOR=20

say() { printf "%b\n" "$*"; }
ok() { say "  ${GREEN}✔${NC} $*"; }
info() { say "  ${CYAN}›${NC} $*"; }
warn() { say "  ${AMBER}!${NC} $*"; }
fail() { say "  ${RED}✖${NC} $*"; }
section() { say "\n${ORANGE}▸${NC} ${WHITE}$*${NC}"; }
die() {
  fail "$*"
  say "\n  ${GRAY}Nothing was changed. Re-run with the token from the panel.${NC}\n"
  exit 1
}

# ------------------------------------------------------------------ preflight
[ "$(id -u)" -eq 0 ] || die "Run this as root:  curl … | sudo bash -s -- <token>"

TOKEN="${1:-}"
[ -n "$TOKEN" ] || cat <<EOF
${WHITE}ZK-MC3-PANEL ${GRAY}·${NC}${WHITE} node agent installer${NC}

  Usage:
    curl -fsSL ${CYAN}<panel-url>${NC}/install-agent.sh | sudo bash -s -- ${CYAN}<token>${NC}

  ${GRAY}Copy the whole command from the panel:${NC}
  ${GRAY}Admin → Nodes → Add node → Generate token.${NC}
EOF
[ -n "$TOKEN" ] || exit 1

say ""
say "  ${ORANGE}⚡ ZK-MC3-PANEL${NC} ${GRAY}·${NC} ${WHITE}node agent${NC}"
say "  ${GRAY}Connecting this machine to the panel…${NC}"

# ---------------------------------------------------------------- decode token
# The panel's token is base64url of {"panel":"http://ip:port","t":"secret"} so
# the agent learns where to call back without a second question. A plain token
# is still accepted (ZK_PANEL_URL then tells us where the panel is).
# Baked in at download time by the panel; empty if this file came from GitHub.
# The marker below is rewritten with the panel's own origin when served.
PANEL_URL="${ZK_PANEL_URL:-__PANEL_ORIGIN__}"
if [ "$PANEL_URL" = "__PANEL_ORIGIN__" ]; then PANEL_URL=""; fi
TOKEN_PLAIN="$TOKEN"

decoded="$(printf '%s' "$TOKEN" | tr '_-' '/+' 2>/dev/null | awk '{ l = length($0) % 4; if (l == 2) $0 = $0 "=="; else if (l == 3) $0 = $0 "="; print }' | base64 -d 2>/dev/null || true)"

if [ -n "$decoded" ] && printf '%s' "$decoded" | grep -q '"panel"'; then
  PANEL_URL="$(printf '%s' "$decoded" | sed -n 's/.*"panel"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  TOKEN_PLAIN="$(printf '%s' "$decoded" | sed -n 's/.*"t"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  [ -n "$PANEL_URL" ] && [ -n "$TOKEN_PLAIN" ] || die "The token looks corrupt — generate a fresh one in the panel."
  ok "Token decoded — panel is ${WHITE}${PANEL_URL}${NC}"
elif [ -z "$PANEL_URL" ]; then
  warn "This token does not carry a panel address."
  read -r -p "  Enter the panel URL (e.g. http://203.0.113.5:31120): " PANEL_URL </dev/tty || true
  [ -n "$PANEL_URL" ] || die "A panel URL is required to connect."
fi

PANEL_URL="${PANEL_URL%/}"

# --------------------------------------------------------- discover our address
# This is the part every other node setup gets wrong: behind NAT, Docker or a
# Codespace the interfaces show 10.x/127.0.0.1, which the panel cannot reach.
section "Detecting this machine's address"

LOCAL_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
fi
[ -n "$LOCAL_IP" ] || LOCAL_IP="127.0.0.1"

PUBLIC_IP=""
for svc in "https://api.ipify.org" "https://ifconfig.me/ip" "https://icanhazip.com"; do
  candidate="$(curl -fsS -m 4 "$svc" 2>/dev/null | tr -d '[:space:]')"
  if printf '%s' "$candidate" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    PUBLIC_IP="$candidate"
    break
  fi
done

if [ -n "${CODESPACE_NAME:-}" ]; then
  FORWARD_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  PUBLIC_HOST="${CODESPACE_NAME}-${AGENT_PORT}.${FORWARD_DOMAIN}"
  ACCESS_SCHEME="https"
  ADDRESS_KIND="GitHub Codespace"
elif [ -n "${ZK_AGENT_PUBLIC_HOST:-}" ]; then
  PUBLIC_HOST="$ZK_AGENT_PUBLIC_HOST"
  ACCESS_SCHEME="http"
  ADDRESS_KIND="override"
elif [ -n "$PUBLIC_IP" ]; then
  PUBLIC_HOST="$PUBLIC_IP"
  ACCESS_SCHEME="http"
  ADDRESS_KIND="public IP"
else
  PUBLIC_HOST="$LOCAL_IP"
  ACCESS_SCHEME="http"
  ADDRESS_KIND="private/LAN address"
fi

ok "Public address   ${WHITE}${ACCESS_SCHEME}://${PUBLIC_HOST}:${AGENT_PORT}${NC} ${GRAY}(${ADDRESS_KIND})${NC}"
ok "Local address    ${GRAY}${LOCAL_IP}${NC}"
[ "$PUBLIC_HOST" = "127.0.0.1" ] && warn "Only loopback was detected — the panel cannot reach this machine."
[ "$ADDRESS_KIND" = "private/LAN address" ] && \
  warn "No public IP answered. If this box sits behind NAT, forward ${AGENT_PORT} or set ZK_AGENT_PUBLIC_HOST."

# ------------------------------------------------------------------ base tools
section "Preparing the system"

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null 2>&1 || warn "apt-get update failed — continuing"
  apt-get install -y -qq curl ca-certificates git tar procps >/dev/null 2>&1 && ok "Base tools ready" || warn "Some tools missing"
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q curl ca-certificates git tar procps-ng >/dev/null 2>&1 && ok "Base tools ready" || warn "Some tools missing"
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache curl ca-certificates git tar procps >/dev/null 2>&1 && ok "Base tools ready" || warn "Some tools missing"
else
  warn "Unknown package manager — assuming curl and git exist"
fi

# ------------------------------------------------------------------ install node
section "Checking Node.js"

if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge "$NODE_MAJOR" ]; then
  ok "Node.js v$(node -v | tr -d v) already installed"
else
  info "Installing Node.js ${NODE_MAJOR}"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" 2>/dev/null | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" 2>/dev/null | bash - >/dev/null 2>&1
    dnf install -y -q nodejs >/dev/null 2>&1
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache nodejs npm >/dev/null 2>&1
  fi
  command -v node >/dev/null 2>&1 || die "Node.js could not be installed. Install Node ${NODE_MAJOR}+ and re-run."
  ok "Node.js v$(node -v | tr -d v) installed"
fi

# ------------------------------------------------------------------ fetch agent
section "Fetching the agent"

# Prefer the panel itself: it is guaranteed reachable from here (we just talked
# to it) and always ships the matching agent version.
mkdir -p "$INSTALL_DIR"
if [ -f "$INSTALL_DIR/agent/agent.cjs" ]; then
  ok "Using existing agent at ${INSTALL_DIR}"
else
  AGENT_URL="${PANEL_URL}/agent.cjs"
  if curl -fsSL -m 20 "$AGENT_URL" -o "$INSTALL_DIR/.agent.cjs.tmp" 2>/dev/null && [ -s "$INSTALL_DIR/.agent.cjs.tmp" ]; then
    mkdir -p "$INSTALL_DIR/agent"
    mv "$INSTALL_DIR/.agent.cjs.tmp" "$INSTALL_DIR/agent/agent.cjs"
    ok "Agent downloaded from ${GRAY}${AGENT_URL}${NC}"
  else
    info "Panel does not expose the agent — cloning the repository"
    if [ -d "$INSTALL_DIR/.git" ]; then
      git -C "$INSTALL_DIR" fetch --all -q && git -C "$INSTALL_DIR" reset --hard origin/main -q
    else
      rm -rf "$INSTALL_DIR/.agent.cjs.tmp"
      git clone --depth 1 https://github.com/SKYDO234/ZK-MC3.git "$INSTALL_DIR" >/dev/null 2>&1 \
        || die "Could not download the agent from the panel or GitHub."
    fi
    [ -f "$INSTALL_DIR/agent/agent.cjs" ] || die "The repository does not contain agent/agent.cjs."
    ok "Agent installed from the repository"
  fi
fi

AGENT_FILE="$INSTALL_DIR/agent/agent.cjs"
chmod 644 "$AGENT_FILE" 2>/dev/null || true
[ -f "$AGENT_FILE" ] || die "Agent file missing at ${AGENT_FILE}"

# ------------------------------------------------------------------ start agent
section "Starting the agent"

# Anything still holding the port would make the new agent fail to bind.
pkill -f "agent/agent.cjs" >/dev/null 2>&1 || true
command -v pm2 >/dev/null 2>&1 && pm2 delete "$PM2_AGENT" >/dev/null 2>&1 || true
sleep 1

LOG_DIR="$INSTALL_DIR/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || LOG_DIR="/tmp"
AGENT_LOG="$LOG_DIR/agent.log"

AGENT_ENV="PORT=${AGENT_PORT} ZK_PANEL_TOKEN=${TOKEN_PLAIN} ZK_AGENT_NAME=${ZK_AGENT_NAME:-$(hostname)} ZK_AGENT_PUBLIC_HOST=${PUBLIC_HOST} ZK_PANEL_URL=${PANEL_URL}"

# systemd is the right answer on a real VPS: it survives reboots and logs to
# journalctl. Fall back to PM2, then to a detached process.
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  cat >"/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=ZK-MC3-PANEL node agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
Environment=PORT=${AGENT_PORT}
Environment=ZK_PANEL_TOKEN=${TOKEN_PLAIN}
Environment=ZK_AGENT_NAME=${ZK_AGENT_NAME:-$(hostname)}
Environment=ZK_AGENT_PUBLIC_HOST=${PUBLIC_HOST}
Environment=ZK_PANEL_URL=${PANEL_URL}
ExecStart=$(command -v node) ${AGENT_FILE}
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload >/dev/null 2>&1
  systemctl enable "$SERVICE" >/dev/null 2>&1
  systemctl restart "$SERVICE" >/dev/null 2>&1
  sleep 2
  if systemctl is-active --quiet "$SERVICE"; then
    ok "Running as a systemd service ${GRAY}(${SERVICE})${NC}"
    STARTED_VIA="systemd"
  else
    warn "systemd unit did not start — falling back"
  fi
fi

if [ -z "${STARTED_VIA:-}" ]; then
  (setsid nohup env $AGENT_ENV node "$AGENT_FILE" >"$AGENT_LOG" 2>&1 </dev/null &)
  sleep 2
  STARTED_VIA="process"
fi

# ------------------------------------------------------------------- verify it
section "Verifying"

PING="$(curl -fsS -m 4 "http://127.0.0.1:${AGENT_PORT}/ping" 2>/dev/null || true)"
if printf '%s' "$PING" | grep -q '"pong":true'; then
  ok "Agent answers on port ${AGENT_PORT}"
else
  fail "Agent is not answering on port ${AGENT_PORT}"
  say "  ${GRAY}Log:${NC} $( [ "$STARTED_VIA" = "systemd" ] && echo "journalctl -u ${SERVICE} -n 50" || echo "$AGENT_LOG" )"
  die "The agent did not start."
fi

HEALTH="$(curl -fsS -m 4 -H "Authorization: Bearer ${TOKEN_PLAIN}" "http://127.0.0.1:${AGENT_PORT}/health" 2>/dev/null || true)"
if printf '%s' "$HEALTH" | grep -q '"system"'; then
  ok "Token accepted — this node is reporting telemetry"
else
  fail "The agent rejected the token. Generate a fresh one in the panel and re-run."
  die "Token mismatch."
fi

# Reach the panel from here — proves the direction the panel needs also works.
PANEL_STATUS="$(curl -fsS -m 5 -o /dev/null -w '%{http_code}' "${PANEL_URL}/api/health" 2>/dev/null || echo "000")"
if [ "$PANEL_STATUS" = "200" ]; then
  ok "Panel reachable at ${WHITE}${PANEL_URL}${NC}"
else
  warn "Panel at ${PANEL_URL} did not answer /api/health (HTTP ${PANEL_STATUS}) — the node may still connect."
fi

# ------------------------------------------------------------------- tell them
HOSTNAME_DISPLAY="$(hostname)"
say ""
say "${ORANGE}╔══════════════════════════════════════════════════════════════╗${NC}"
say "${ORANGE}║${NC}  ${WHITE}Node agent is running${NC} ${GREEN}●${NC}                                  ${ORANGE}║${NC}"
say "${ORANGE}╚══════════════════════════════════════════════════════════════╝${NC}"
say "   ${GRAY}Node${NC}       ${WHITE}${HOSTNAME_DISPLAY}${NC}"
say "   ${GRAY}Address${NC}    ${WHITE}${PUBLIC_HOST}${NC}  ${DIM}(${ADDRESS_KIND})${NC}"
say "   ${GRAY}Port${NC}       ${WHITE}${AGENT_PORT}${NC}"
say "   ${GRAY}Panel${NC}      ${WHITE}${PANEL_URL}${NC}"
say "   ${GRAY}Running${NC}    ${WHITE}${STARTED_VIA}${NC}"
say ""
say "   ${GREEN}The panel has been told everything it needs — it should turn green${NC}"
say "   ${GREEN}within a few seconds. Nothing else to type.${NC}"
say ""

if [ "$ADDRESS_KIND" = "GitHub Codespace" ]; then
  say "   ${AMBER}Codespace${NC} ${GRAY}— make port ${AGENT_PORT} public:${NC}"
  say "     ${GRAY}Ports tab → ${AGENT_PORT} → right-click → Port Visibility → Public${NC}"
  say ""
fi

if grep -qE 'ufw|firewall' /dev/null 2>&1; then :; fi
say "   ${GRAY}If the panel still shows offline, allow inbound TCP ${AGENT_PORT}:${NC}"
say "     ${DIM}ufw allow ${AGENT_PORT}/tcp${NC}"
say "     ${DIM}firewall-cmd --permanent --add-port=${AGENT_PORT}/tcp && firewall-cmd --reload${NC}"
say ""
say "   ${GRAY}Manage it:${NC} $(
  if [ "$STARTED_VIA" = "systemd" ]; then
    echo "${DIM}systemctl restart ${SERVICE}${NC} · ${DIM}journalctl -u ${SERVICE} -f${NC}"
  else
    echo "${DIM}tail -f ${AGENT_LOG}${NC}"
  fi
)"
say "   ${GRAY}Reconnect with a new token:${NC} ${DIM}same command, new token${NC}"
say ""

# A lingering process should not block the shell that piped us.
exit 0
