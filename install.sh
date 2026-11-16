#!/usr/bin/env bash
# =============================================================
#  ZK-MC3-PANEL  ·  Automated Installer & Manager
#  A product of ZK-STUDIO · CEO MD Ziyan Hossain
# =============================================================
#  Usage:
#    bash install.sh              Interactive manager menu
#    bash install.sh install      Fresh install (Node, PM2, Java, panel)
#    bash install.sh update       Update to the latest version
#    bash install.sh agent        Install & start the node agent only
#    bash install.sh createuser   Create / reset an administrator
#    bash install.sh restart      Restart the panel
#    bash install.sh status       Show status
#    bash install.sh uninstall    Remove ZK-MC3-PANEL
# =============================================================

set -uo pipefail

# ----------------------------------------------------------------- palette
GREEN='\033[38;5;48m'
CYAN='\033[38;5;51m'
BLUE='\033[38;5;75m'
AMBER='\033[38;5;214m'
ORANGE='\033[38;5;208m'
RED='\033[38;5;196m'
WHITE='\033[1;37m'
GRAY='\033[38;5;242m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

PANEL_NAME="ZK-MC3-PANEL"
STUDIO="ZK-STUDIO"
CEO="MD Ziyan Hossain"
REPO_URL="${ZK_REPO_URL:-https://github.com/SKYDO234/ZK-MC3.git}"
BRANCH="${ZK_BRANCH:-main}"
INSTALL_DIR="${ZK_DIR:-/opt/zk-mc3}"
PANEL_PORT="${PANEL_PORT:-6767}"
AGENT_PORT="${AGENT_PORT:-6768}"
PM2_APP="zk-mc3-panel"
PM2_AGENT="zk-mc3-agent"
NODE_MAJOR=20

# ----------------------------------------------------------------- helpers
say() { printf "%b\n" "$*"; }
info() { say "  ${CYAN}›${NC} $*"; }
ok() { say "  ${GREEN}✔${NC} $*"; }
warn() { say "  ${AMBER}!${NC} $*"; }
fail() { say "  ${RED}✖${NC} $*"; }
section() { say "\n${ORANGE}▸ ${WHITE}$*${NC}"; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
fi

run_root() {
  if [ -n "$SUDO" ]; then $SUDO "$@"; else "$@"; fi
}

banner() {
  clear 2>/dev/null || true
  say "${ORANGE}"
  cat <<'ART'
   ███████╗██╗  ██╗   ███╗   ███╗ ██████╗██████╗
   ╚══███╔╝██║ ██╔╝   ████╗ ████║██╔════╝╚════██╗
     ███╔╝ █████╔╝    ██╔████╔██║██║      █████╔╝
    ███╔╝  ██╔═██╗    ██║╚██╔╝██║██║      ╚═══██╗
   ███████╗██║  ██╗██╗██║ ╚═╝ ██║╚██████╗██████╔╝
   ╚══════╝╚═╝  ╚═╝╚═╝╚═╝     ╚═╝ ╚═════╝╚═════╝
ART
  say "${NC}   ${WHITE}${PANEL_NAME}${NC} ${GRAY}· Minecraft Server Hosting Panel${NC}"
  say "   ${GRAY}A product of${NC} ${ORANGE}${STUDIO}${NC} ${GRAY}· CEO ${CEO}${NC}\n"
}

detect_os() {
  OS_NAME="Linux"
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_NAME="${PRETTY_NAME:-${ID:-Linux}}"
    PKG_ID="${ID:-}"
    PKG_LIKE="${ID_LIKE:-}"
  else
    PKG_ID=""
    PKG_LIKE=""
  fi
  ARCH=$(uname -m 2>/dev/null || echo x86_64)
}

pkg_install() {
  local pkgs="$*"
  if command -v apt-get >/dev/null 2>&1; then
    (export DEBIAN_FRONTEND=noninteractive; run_root apt-get update -y -qq >/dev/null 2>&1 || true)
    run_root apt-get install -y -qq $pkgs >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then
    run_root dnf install -y -q $pkgs >/dev/null 2>&1
  elif command -v yum >/dev/null 2>&1; then
    run_root yum install -y -q $pkgs >/dev/null 2>&1
  elif command -v apk >/dev/null 2>&1; then
    run_root apk add --no-cache $pkgs >/dev/null 2>&1
  else
    return 1
  fi
}

install_base_tools() {
  section "Installing base system tools"
  detect_os
  info "Detected ${WHITE}${OS_NAME}${NC} (${ARCH})"
  pkg_install curl wget git tar unzip ca-certificates openssl procps jq >/dev/null 2>&1 || \
    warn "Some base packages may be missing — continuing anyway."
  ok "Base tools ready"
}

install_node() {
  section "Installing Node.js"
  if command -v node >/dev/null 2>&1; then
    CURRENT=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$CURRENT" -ge 18 ] 2>/dev/null; then
      ok "Node.js $(node -v) already installed"
      return 0
    fi
    warn "Node.js v${CURRENT} is too old (need >= 18)"
  fi

  if command -v apt-get >/dev/null 2>&1; then
    info "Adding NodeSource repository (Node ${NODE_MAJOR}.x)"
    (curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | run_root bash - >/dev/null 2>&1) || true
    pkg_install nodejs
  elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    (curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | run_root bash - >/dev/null 2>&1) || true
    pkg_install nodejs
  elif command -v apk >/dev/null 2>&1; then
    pkg_install nodejs npm
  fi

  if ! command -v node >/dev/null 2>&1; then
    warn "Package manager install failed — falling back to nvm"
    export NVM_DIR="$HOME/.nvm"
    (curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash) >/dev/null 2>&1 || true
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install "$NODE_MAJOR" >/dev/null 2>&1 && nvm use "$NODE_MAJOR" >/dev/null 2>&1
  fi

  if command -v node >/dev/null 2>&1; then
    ok "Node.js $(node -v) · npm $(npm -v 2>/dev/null)"
  else
    fail "Node.js installation failed. Install Node.js 18+ manually and re-run."
    exit 1
  fi
}

install_java() {
  section "Installing Java runtime (for Minecraft servers)"
  if command -v java >/dev/null 2>&1; then
    ok "Java already present: $(java -version 2>&1 | head -1 | tr -d '"')"
    return 0
  fi
  info "Installing OpenJDK 21 (headless)"
  pkg_install openjdk-21-jre-headless || pkg_install openjdk-21-jdk-headless || pkg_install java-21-openjdk-headless || \
    pkg_install openjdk-17-jre-headless || warn "Could not auto-install Java 21 — install a JDK manually."
  if command -v java >/dev/null 2>&1; then
    ok "Java installed: $(java -version 2>&1 | head -1 | tr -d '"')"
  else
    warn "Java not found. Minecraft servers will require a JDK (install later with 'apt install openjdk-21-jre-headless')."
  fi
}

install_pm2() {
  section "Installing process manager"
  if command -v pm2 >/dev/null 2>&1; then
    ok "PM2 $(pm2 -v 2>/dev/null) already installed"
    return 0
  fi
  run_root npm install -g pm2 --silent >/dev/null 2>&1 || npm install -g pm2 --silent >/dev/null 2>&1
  if command -v pm2 >/dev/null 2>&1; then
    ok "PM2 installed"
  else
    warn "PM2 could not be installed — panel will run via nohup fallback."
  fi
}

fetch_source() {
  section "Fetching panel source"

  # Already inside the repository?
  if [ -f ./package.json ] && grep -q "zk-mc3-panel" ./package.json 2>/dev/null; then
    INSTALL_DIR="$(pwd)"
    ok "Using existing checkout at ${INSTALL_DIR}"
    return 0
  fi

  run_root mkdir -p "$INSTALL_DIR"
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing clone"
    (cd "$INSTALL_DIR" && run_root git fetch --all -q && run_root git reset --hard "origin/${BRANCH}" -q) || \
      warn "Git update failed — continuing with the current checkout."
  elif [ -f "$INSTALL_DIR/package.json" ]; then
    warn "Directory ${INSTALL_DIR} already contains a project — reusing it."
  else
    info "Cloning ${REPO_URL}"
    run_root git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR" >/dev/null 2>&1 || \
      run_root git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" >/dev/null 2>&1
  fi

  if [ ! -f "$INSTALL_DIR/package.json" ]; then
    fail "Could not obtain the source. Place this script inside the project folder and re-run."
    exit 1
  fi
  ok "Source ready at ${INSTALL_DIR}"
}

configure_env() {
  section "Configuring environment"
  cd "$INSTALL_DIR" || exit 1

  if [ -f .env ]; then
    ok ".env already exists — keeping current secrets"
  else
    JWT_SECRET=$(openssl rand -hex 48 2>/dev/null || head -c 48 /dev/urandom | base64 | tr -d '\n/+=' )
    OWNER_PASS=$(openssl rand -base64 12 2>/dev/null | tr -d '/+=' | head -c 14)
    [ -z "$OWNER_PASS" ] && OWNER_PASS="admin12345"

    cat > .env <<EOF
# ---------------------------------------------------------------
# ${PANEL_NAME} environment · generated $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ---------------------------------------------------------------
NODE_ENV=production
PORT=${PANEL_PORT}

# Session signing secret — DO NOT share or commit
JWT_SECRET=${JWT_SECRET}

# First-run owner account (only used when the user database is empty)
OWNER_USERNAME=admin
OWNER_PASSWORD=${OWNER_PASS}
OWNER_EMAIL=owner@zk-mc3.local

# Optional: absolute path to a java binary
# JAVA_BIN=/usr/lib/jvm/java-21-openjdk-amd64/bin/java

# Demo data seeding (set to false for a clean install)
SEED_DEMO=true
EOF
    chmod 600 .env
    ok ".env generated with a random JWT secret"
    say "    ${DIM}Owner account: ${WHITE}admin${NC}${DIM} / ${WHITE}${OWNER_PASS}${NC}"
  fi

  mkdir -p .data backups public/uploads logs
  ok "Data directories ready"
}

install_deps() {
  section "Installing dependencies & building"
  cd "$INSTALL_DIR" || exit 1
  export NODE_OPTIONS="--max-old-space-size=2048"

  info "npm install (this can take a couple of minutes)"
  if ! npm install --no-audit --no-fund --loglevel=error; then
    warn "Retrying with --legacy-peer-deps"
    npm install --no-audit --no-fund --legacy-peer-deps --loglevel=error || {
      fail "Dependency installation failed."
      exit 1
    }
  fi
  ok "Dependencies installed"

  info "Building the panel"
  npm run build --silent || {
    fail "Build failed. Check the output above."
    exit 1
  }
  ok "Build complete → dist/"
}

start_panel() {
  section "Starting the panel"
  cd "$INSTALL_DIR" || exit 1

  if command -v pm2 >/dev/null 2>&1; then
    pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
    pm2 start dist/server.cjs --name "$PM2_APP" --time --update-env >/dev/null 2>&1
    pm2 save >/dev/null 2>&1 || true
    run_root env PATH="$PATH" pm2 startup >/dev/null 2>&1 || pm2 startup >/dev/null 2>&1 || true
    sleep 2
    if pm2 list 2>/dev/null | grep -q "$PM2_APP.*online"; then
      ok "Panel running under PM2 (${PM2_APP})"
    else
      warn "PM2 did not report 'online' — check 'pm2 logs ${PM2_APP}'"
    fi
  else
    info "Starting with nohup (PM2 unavailable)"
    pkill -f "dist/server.cjs" >/dev/null 2>&1 || true
    (setsid nohup node dist/server.cjs > logs/panel.log 2>&1 < /dev/null &)
    sleep 3
    ok "Panel started — logs at ${INSTALL_DIR}/logs/panel.log"
  fi

  if command -v ss >/dev/null 2>&1 && ss -lnt 2>/dev/null | grep -q ":${PANEL_PORT} "; then
    ok "Listening on port ${PANEL_PORT}"
  elif command -v netstat >/dev/null 2>&1 && netstat -lnt 2>/dev/null | grep -q ":${PANEL_PORT} "; then
    ok "Listening on port ${PANEL_PORT}"
  else
    warn "Port ${PANEL_PORT} is not listening yet — give it a few seconds."
  fi
}

firewall_hint() {
  if command -v ufw >/dev/null 2>&1 && run_root ufw status 2>/dev/null | grep -q "Status: active"; then
    section "Firewall detected"
    info "Allowing panel + game ports"
    run_root ufw allow "${PANEL_PORT}/tcp" >/dev/null 2>&1 || true
    run_root ufw allow 25565:25665/tcp >/dev/null 2>&1 || true
    run_root ufw allow 25565:25665/udp >/dev/null 2>&1 || true
    ok "UFW rules added for ${PANEL_PORT} and 25565-25665"
  elif command -v firewall-cmd >/dev/null 2>&1; then
    run_root firewall-cmd --permanent --add-port="${PANEL_PORT}/tcp" >/dev/null 2>&1 || true
    run_root firewall-cmd --permanent --add-port=25565-25665/tcp >/dev/null 2>&1 || true
    run_root firewall-cmd --reload >/dev/null 2>&1 || true
    ok "firewalld rules added"
  fi
}

detect_ip() {
  local ip
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  if [ -z "$ip" ]; then ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}'); fi
  if [ -z "$ip" ] || [ "$ip" = "127.0.0.1" ]; then
    ip=$(curl -s --max-time 2 ifconfig.me 2>/dev/null || echo "127.0.0.1")
  fi
  echo "${ip:-127.0.0.1}"
}

summary() {
  local ip
  ip=$(detect_ip)
  say ""
  say "${ORANGE}╔══════════════════════════════════════════════════════════════╗${NC}"
  say "${ORANGE}║${NC}  ${WHITE}${PANEL_NAME}${NC} is ready ${GREEN}●${NC}                                    ${ORANGE}║${NC}"
  say "${ORANGE}╚══════════════════════════════════════════════════════════════╝${NC}"
  say "   ${GRAY}Panel URL${NC}      ${WHITE}http://${ip}:${PANEL_PORT}${NC}"
  say "   ${GRAY}Health check${NC}   ${DIM}http://${ip}:${PANEL_PORT}/api/health${NC}"
  say "   ${GRAY}Install dir${NC}    ${INSTALL_DIR}"
  say "   ${GRAY}Studio${NC}         ${STUDIO} · CEO ${CEO}"
  say ""
  say "   ${GRAY}Next steps${NC}"
  say "     ${CYAN}1${NC} Open the panel and sign in as ${WHITE}admin${NC}"
  say "     ${CYAN}2${NC} Change the password in ${WHITE}Account → Password${NC}"
  say "     ${CYAN}3${NC} Create a server in ${WHITE}Admin → Create Server${NC}"
  say "     ${CYAN}4${NC} Install game servers' JDK: ${DIM}apt install openjdk-21-jre-headless${NC}"
  say ""
}

do_install() {
  banner
  install_base_tools
  install_node
  install_java
  install_pm2
  fetch_source
  configure_env
  install_deps
  start_panel
  firewall_hint
  summary
}

do_update() {
  banner
  section "Updating ${PANEL_NAME}"
  fetch_source
  cd "$INSTALL_DIR" || exit 1
  info "Pulling latest source"
  run_root git fetch --all -q 2>/dev/null || true
  run_root git reset --hard "origin/${BRANCH}" -q 2>/dev/null || warn "Git pull skipped"
  install_deps
  start_panel
  ok "Update complete — your data in .data/ was preserved."
}

do_agent() {
  banner
  section "Installing ${PANEL_NAME} node agent"
  install_base_tools
  install_node
  fetch_source
  cd "$INSTALL_DIR" || exit 1

  local token="${ZK_PANEL_TOKEN:-}"
  if [ -z "$token" ]; then
    token=$(openssl rand -hex 24 2>/dev/null || echo "change-me-$(date +%s)")
  fi

  if command -v pm2 >/dev/null 2>&1; then
    pm2 delete "$PM2_AGENT" >/dev/null 2>&1 || true
    PORT="$AGENT_PORT" ZK_PANEL_TOKEN="$token" ZK_AGENT_NAME="$(hostname)" \
      pm2 start agent/agent.js --name "$PM2_AGENT" --update-env >/dev/null 2>&1
    pm2 save >/dev/null 2>&1 || true
    ok "Agent running under PM2 on port ${AGENT_PORT}"
  else
    (setsid nohup env PORT="$AGENT_PORT" ZK_PANEL_TOKEN="$token" node agent/agent.js > logs/agent.log 2>&1 < /dev/null &)
    ok "Agent started on port ${AGENT_PORT}"
  fi

  say ""
  say "   ${GRAY}Register this node in the panel:${NC}"
  say "     ${WHITE}IP${NC}     $(detect_ip)"
  say "     ${WHITE}Port${NC}   ${AGENT_PORT}"
  say "     ${WHITE}Token${NC}  ${token}"
  say ""
  warn "Store the token securely — it authenticates the node against the panel."
}

do_createuser() {
  cd "${INSTALL_DIR}" >/dev/null 2>&1 || cd "$(dirname "$0")" || exit 1
  [ -f package.json ] || { fail "Run this from the panel directory."; exit 1; }
  say "\n${ORANGE}▸${NC} ${WHITE}Create / reset an administrator${NC}\n"
  read -r -p "  Username [admin]: " USERNAME
  USERNAME=${USERNAME:-admin}
  read -r -p "  Email [owner@zk-mc3.local]: " EMAIL
  EMAIL=${EMAIL:-owner@zk-mc3.local}
  read -r -s -p "  Password: " PASSWORD; echo
  read -r -p "  Role (owner/admin) [owner]: " ROLE
  ROLE=${ROLE:-owner}
  npx tsx scripts/createuser.ts --username "$USERNAME" --email "$EMAIL" --password "$PASSWORD" --role "$ROLE"
}

do_restart() {
  cd "${INSTALL_DIR}" >/dev/null 2>&1 || exit 1
  if command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -q "$PM2_APP"; then
    pm2 restart "$PM2_APP" --update-env >/dev/null 2>&1 && ok "Panel restarted (PM2)"
  else
    pkill -f "dist/server.cjs" >/dev/null 2>&1 || true
    (setsid nohup node dist/server.cjs > logs/panel.log 2>&1 < /dev/null &)
    ok "Panel restarted (nohup)"
  fi
}

do_status() {
  banner
  section "Service status"
  cd "${INSTALL_DIR}" >/dev/null 2>&1 || true

  if command -v pm2 >/dev/null 2>&1; then
    say ""
    pm2 list 2>/dev/null | head -12 || true
  fi

  say ""
  if curl -fsS --max-time 3 "http://127.0.0.1:${PANEL_PORT}/api/health" >/dev/null 2>&1; then
    ok "Panel API responding on port ${PANEL_PORT}"
    curl -s "http://127.0.0.1:${PANEL_PORT}/api/health" | head -c 300; echo
  else
    fail "Panel API not responding on port ${PANEL_PORT}"
  fi

  say ""
  say "  ${GRAY}Node${NC}   $(node -v 2>/dev/null || echo 'not installed')"
  say "  ${GRAY}Java${NC}   $(java -version 2>&1 | head -1 | tr -d '\"' 2>/dev/null || echo 'not installed')"
  say "  ${GRAY}Disk${NC}   $(df -h / 2>/dev/null | tail -1 | awk '{print $3" used / "$2" total"}')"
  say ""
}

do_uninstall() {
  banner
  warn "This removes ${PANEL_NAME} from ${INSTALL_DIR}."
  read -r -p "  Type 'yes' to continue: " CONFIRM
  [ "$CONFIRM" = "yes" ] || { info "Cancelled"; return; }
  command -v pm2 >/dev/null 2>&1 && { pm2 delete "$PM2_APP" >/dev/null 2>&1; pm2 delete "$PM2_AGENT" >/dev/null 2>&1; }
  pkill -f "dist/server.cjs" >/dev/null 2>&1 || true
  read -r -p "  Also delete .data (all servers & backups)? [y/N]: " WIPE
  if [ "$WIPE" = "y" ]; then
    run_root rm -rf "$INSTALL_DIR"
  else
    cd "$INSTALL_DIR" 2>/dev/null && run_root find . -maxdepth 1 ! -name '.data' ! -name 'backups' ! -name '.' -exec rm -rf {} +
  fi
  ok "Uninstalled."
}

menu() {
  while true; do
    banner
    say "  ${WHITE}${BOLD}Main menu${NC}"
    say "   ${CYAN}1${NC}  Install panel (recommended)"
    say "   ${CYAN}2${NC}  Update panel"
    say "   ${CYAN}3${NC}  Create / reset administrator"
    say "   ${CYAN}4${NC}  Restart panel"
    say "   ${CYAN}5${NC}  Status"
    say "   ${CYAN}6${NC}  Install node agent"
    say "   ${CYAN}7${NC}  Uninstall"
    say "   ${CYAN}0${NC}  Exit"
    say ""
    read -r -p "  ${ORANGE}Select${NC} › " CHOICE
    case "$CHOICE" in
      1) do_install; read -r -p "  Press Enter to return…" _ ;;
      2) do_update; read -r -p "  Press Enter to return…" _ ;;
      3) do_createuser; read -r -p "  Press Enter to return…" _ ;;
      4) do_restart; read -r -p "  Press Enter to return…" _ ;;
      5) do_status; read -r -p "  Press Enter to return…" _ ;;
      6) do_agent; read -r -p "  Press Enter to return…" _ ;;
      7) do_uninstall; read -r -p "  Press Enter to return…" _ ;;
      0) say "\n  ${GRAY}Bye — ${STUDIO}${NC}\n"; exit 0 ;;
      *) warn "Invalid choice" ;;
    esac
  done
}

ACTION="${1:-menu}"
case "$ACTION" in
  install) do_install ;;
  update) do_update ;;
  agent) do_agent ;;
  createuser) do_createuser ;;
  restart) do_restart ;;
  status) do_status ;;
  uninstall) do_uninstall ;;
  menu|"") menu ;;
  *) say "Unknown action: $ACTION"; say "Use: install | update | agent | createuser | restart | status | uninstall"; exit 1 ;;
esac
