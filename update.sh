#!/usr/bin/env bash
# ============================================================================
#  ZK-MC3-PANEL  ·  updater
#  Pulls the latest source, reinstalls dependencies, rebuilds and restarts.
#  Panel by ZK-STUDIO · CEO MD Ziyan Hossain
# ============================================================================
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

C_OK=$'\033[1;32m'; C_WARN=$'\033[1;33m'; C_ERR=$'\033[1;31m'
C_DIM=$'\033[2m'; C_ACC=$'\033[38;5;208m'; C_RST=$'\033[0m'
ok()   { printf '%s✔%s %s\n' "$C_OK" "$C_RST" "$*"; }
warn() { printf '%s!%s %s\n' "$C_WARN" "$C_RST" "$*"; }
die()  { printf '%s✖%s %s\n' "$C_ERR" "$C_RST" "$*" >&2; exit 1; }
step() { printf '\n%s▸ %s%s\n' "$C_ACC" "$*" "$C_RST"; }

printf '%s\n' "──────────────────────────────────────────────────────────────"
printf ' %sZK-MC3-PANEL%s updater   %spanel by ZK-STUDIO%s\n' "$C_ACC" "$C_RST" "$C_DIM" "$C_RST"
printf '%s\n' "──────────────────────────────────────────────────────────────"

command -v node >/dev/null || die "Node.js is not installed. Run ./install.sh first."
command -v npm  >/dev/null || die "npm is not installed. Run ./install.sh first."

BEFORE="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

step "Fetching latest source"
if [ -d .git ]; then
  git fetch --all --prune >/dev/null 2>&1 || warn "git fetch failed — continuing with local tree"
  git pull --ff-only >/dev/null 2>&1 || warn "git pull skipped (no upstream / local changes)"
  ok "source at $(git rev-parse --short HEAD 2>/dev/null || echo unknown) (was $BEFORE)"
else
  warn "not a git checkout — skipping source update"
fi

step "Installing dependencies"
npm install --no-audit --no-fund
ok "dependencies installed"

step "Building front-end"
npm run build
ok "build complete"

step "Restarting panel"
if command -v pm2 >/dev/null && pm2 describe zk-mc3-panel >/dev/null 2>&1; then
  pm2 restart zk-mc3-panel --update-env >/dev/null
  ok "restarted via pm2"
elif systemctl list-unit-files 2>/dev/null | grep -q '^zk-mc3-panel\.service'; then
  sudo systemctl restart zk-mc3-panel
  ok "restarted via systemd"
else
  if pkill -f "tsx server.ts" 2>/dev/null; then sleep 2; fi
  nohup npx tsx server.ts >>.data/panel.log 2>&1 &
  ok "restarted (nohup) — log: .data/panel.log"
fi

PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '"'"'"' ' || true)"
PORT="${PORT:-6767}"
sleep 3
if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  ok "panel healthy on http://127.0.0.1:${PORT}"
else
  warn "panel did not answer yet — check the log: .data/panel.log"
fi

printf '\n%sUpdate finished.%s  Data in .data/ was left untouched.\n\n' "$C_OK" "$C_RST"
