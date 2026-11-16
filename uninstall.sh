#!/usr/bin/env bash
# ============================================================================
#  ZK-MC3-PANEL  ·  uninstaller
#  Stops the panel, removes the pm2/systemd unit, and (optionally) deletes
#  panel data and the source tree.
#  Panel by ZK-STUDIO · CEO MD Ziyan Hossain
# ============================================================================
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

C_OK=$'\033[1;32m'; C_WARN=$'\033[1;33m'; C_ERR=$'\033[1;31m'
C_DIM=$'\033[2m'; C_ACC=$'\033[38;5;208m'; C_RST=$'\033[0m'
ok()   { printf '%s✔%s %s\n' "$C_OK" "$C_RST" "$*"; }
warn() { printf '%s!%s %s\n' "$C_WARN" "$C_RST" "$*"; }
step() { printf '\n%s▸ %s%s\n' "$C_ACC" "$*" "$C_RST"; }

ASSUME_YES=0
KEEP_DATA=1
for arg in "$@"; do
  case "$arg" in
    -y|--yes)      ASSUME_YES=1 ;;
    --purge-data)  KEEP_DATA=0 ;;
    -h|--help)
      cat <<'USAGE'
Usage: ./uninstall.sh [options]

  -y, --yes      do not prompt for confirmation
  --purge-data   also delete .data (server files, backups, database)
  -h, --help     show this help
USAGE
      exit 0 ;;
  esac
done

printf '%s\n' "──────────────────────────────────────────────────────────────"
printf ' %sZK-MC3-PANEL%s uninstaller   %spanel by ZK-STUDIO%s\n' "$C_ACC" "$C_RST" "$C_DIM" "$C_RST"
printf '%s\n' "──────────────────────────────────────────────────────────────"

if [ "$ASSUME_YES" -eq 0 ]; then
  printf '\nThis will stop ZK-MC3-PANEL and remove its service.\n'
  if [ "$KEEP_DATA" -eq 1 ]; then
    printf 'Panel data in %s.data/%s will be KEPT.\n' "$C_DIM" "$C_RST"
  else
    printf '%sPanel data in .data/ will be DELETED (--purge-data).%s\n' "$C_ERR" "$C_RST"
  fi
  read -r -p "Continue? [y/N] " reply
  case "$reply" in y|Y|yes|YES) ;; *) echo "Aborted."; exit 0 ;; esac
fi

step "Stopping panel"
if command -v pm2 >/dev/null && pm2 describe zk-mc3-panel >/dev/null 2>&1; then
  pm2 delete zk-mc3-panel >/dev/null && ok "pm2 process removed"
fi
if systemctl list-unit-files 2>/dev/null | grep -q '^zk-mc3-panel\.service'; then
  sudo systemctl stop zk-mc3-panel 2>/dev/null || true
  sudo systemctl disable zk-mc3-panel 2>/dev/null || true
  sudo rm -f /etc/systemd/system/zk-mc3-panel.service
  sudo systemctl daemon-reload
  ok "systemd unit removed"
fi
if pkill -f "tsx server.ts" 2>/dev/null; then
  sleep 2
  ok "background process stopped"
fi

step "Removing agent service"
if systemctl list-unit-files 2>/dev/null | grep -q '^zk-mc3-agent\.service'; then
  sudo systemctl stop zk-mc3-agent 2>/dev/null || true
  sudo systemctl disable zk-mc3-agent 2>/dev/null || true
  sudo rm -f /etc/systemd/system/zk-mc3-agent.service
  sudo systemctl daemon-reload
  ok "agent unit removed"
fi

if [ "$KEEP_DATA" -eq 0 ]; then
  step "Deleting panel data"
  rm -rf .data
  ok ".data removed"
else
  warn "kept .data/ (use --purge-data to delete it)"
fi

step "Removing build output and dependencies"
rm -rf dist node_modules
ok "dist/ and node_modules/ removed"

printf '\n%sZK-MC3-PANEL has been uninstalled.%s\n' "$C_OK" "$C_RST"
printf '%sThe source directory is untouched — delete it manually if you wish.%s\n\n' "$C_DIM" "$C_RST"
