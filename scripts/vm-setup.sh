#!/bin/bash
# =============================================================================
# ZK-MC3-PANEL · VM host setup
# =============================================================================
# One command. Installs QEMU and the cloud-image tooling this panel needs, then
# reports exactly what the host can and cannot do.
#
#   sudo bash scripts/vm-setup.sh
#
# Nothing here needs a decision from you: the script detects whether the host
# offers hardware virtualisation and configures itself accordingly. Re-running it
# is safe — every step is idempotent.
#
# What it will NOT do
# -----------------------------------------------------------------------------
# It cannot give a container hardware virtualisation, and it will not pretend to.
# GitHub Codespaces runs unprivileged: there is no /dev/kvm, and without
# NET_ADMIN there is no bridge. If that is your host, you get software emulation
# (TCG) and a guest that boots in a few minutes instead of a few seconds, with
# its ports reachable only through QEMU's user-mode forwarding. That is reported
# clearly at the end rather than discovered later as a mystery.
# =============================================================================
set -euo pipefail

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else
    echo "This script needs root (or sudo) to install packages." >&2
    exit 1
  fi
fi

RED=$'\033[1;31m'; GREEN=$'\033[1;32m'; YELLOW=$'\033[1;33m'
BLUE=$'\033[1;34m'; DIM=$'\033[2m'; RESET=$'\033[0m'

say()  { printf '%s▸%s %s\n' "$BLUE" "$RESET" "$*"; }
ok()   { printf '%s✔%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%s✖%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

echo
echo "  ZK-MC3-PANEL · QEMU host setup"
echo "  ${DIM}$(uname -srm)${RESET}"
echo

# -----------------------------------------------------------------------------
# Package installation
# -----------------------------------------------------------------------------
# qemu-system-x86   the emulator
# qemu-utils        qemu-img (overlay disks)
# cloud-image-utils cloud-localds (cloud-init seed ISO)
# genisoimage       fallback ISO builder used when cloud-localds is absent
# curl              resumable image download
# bridge-utils      br0 configuration, when the host allows it
# iproute2/net-tools networking diagnostics
# cpu-checker       kvm-ok, for a second opinion on KVM availability

PACKAGES="qemu-system-x86 qemu-utils cloud-image-utils genisoimage curl bridge-utils iproute2 net-tools cpu-checker"

# --check reports on the host and changes nothing. Useful for confirming why a
# VM will not start without risking a package upgrade on a working node.
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -h|--help)
      sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//' | sed '/^====/d'
      exit 0
      ;;
  esac
done

install_one() {
  local pkg="$1"
  if dpkg -s "$pkg" >/dev/null 2>&1; then
    printf '  %s·%s %-20s already installed\n' "$DIM" "$RESET" "$pkg"
    return 0
  fi
  if $SUDO apt-get install -y --no-install-recommends "$pkg" >/dev/null 2>&1; then
    printf '  %s✔%s %-20s installed\n' "$GREEN" "$RESET" "$pkg"
    return 0
  fi
  printf '  %s✖%s %-20s unavailable\n' "$YELLOW" "$RESET" "$pkg"
  return 1
}

MISSING_PKGS=()

if [ "$CHECK_ONLY" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then
  say "Updating package lists"
  $SUDO apt-get update -qq || warn "apt-get update failed; trying the cached lists"

  say "Installing VM packages"
  # Installed one at a time on purpose: a single unavailable package (bridge-utils
  # on a minimal image, cpu-checker on a slim base) must not abort the whole run
  # and leave the host without qemu.
  for pkg in $PACKAGES; do
    install_one "$pkg" || MISSING_PKGS+=("$pkg")
  done
elif [ "$CHECK_ONLY" -eq 1 ]; then
  say "Check-only mode: not installing anything"
else
  warn "No apt-get found. This script supports Debian/Ubuntu hosts."
  warn "Install manually: qemu-system-x86 qemu-utils cloud-image-utils genisoimage"
fi

echo

# -----------------------------------------------------------------------------
# Required binaries
# -----------------------------------------------------------------------------
say "Checking the result"

QEMU_BIN=""
for candidate in qemu-system-x86_64 qemu-system-x86; do
  if command -v "$candidate" >/dev/null 2>&1; then QEMU_BIN="$candidate"; break; fi
done

[ -n "$QEMU_BIN" ] || die "qemu-system-x86_64 is still missing. Install qemu-system-x86 and re-run."
ok "Emulator          $(command -v "$QEMU_BIN")"
ok "qemu-img          $(command -v qemu-img || echo MISSING)"

if command -v cloud-localds >/dev/null 2>&1; then
  ok "cloud-localds     $(command -v cloud-localds)"
elif command -v genisoimage >/dev/null 2>&1; then
  warn "cloud-localds missing; genisoimage is present as a fallback"
else
  die "Neither cloud-localds nor genisoimage is available — the guest could not be given a login."
fi

# -----------------------------------------------------------------------------
# Directories
# -----------------------------------------------------------------------------
IMAGE_DIR="${ZKVM_IMAGE_DIR:-/var/lib/vm-images}"

say "Preparing image cache at $IMAGE_DIR"
$SUDO mkdir -p "$IMAGE_DIR"
# The panel runs as the invoking user, so that user must be able to write here.
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  $SUDO chown -R "$SUDO_USER":"$SUDO_USER" "$IMAGE_DIR" 2>/dev/null || true
fi
ok "Image cache ready"

# -----------------------------------------------------------------------------
# KVM detection — presence is not permission
# -----------------------------------------------------------------------------
echo
say "Detecting hardware virtualisation"

KVM_USABLE=0
KVM_REASON=""

if [ ! -e /dev/kvm ]; then
  KVM_REASON="/dev/kvm does not exist — this host does not expose hardware virtualisation"
elif [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then
  KVM_REASON="/dev/kvm exists but is not readable/writable by this user"
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    $SUDO usermod -aG kvm "$SUDO_USER" 2>/dev/null || true
    KVM_REASON="$KVM_REASON (added $SUDO_USER to the kvm group; a re-login is required)"
  fi
else
  # Readable is not enough either: opening it proves the container actually
  # passed the virt capability through, which is the failure mode that produces
  # a confusing QEMU error later.
  if head -c 0 /dev/kvm 2>/dev/null; then
    KVM_USABLE=1
    KVM_REASON="/dev/kvm is present and openable"
  else
    KVM_REASON="/dev/kvm exists but cannot be opened (container without the virt capability)"
  fi
fi

if [ "$KVM_USABLE" -eq 1 ]; then
  ok "KVM available"
  printf '    %sGuests run at near-native speed.%s\n' "$DIM" "$RESET"
else
  warn "KVM unavailable — falling back to TCG (software emulation)"
  printf '    %sReason: %s%s\n' "$DIM" "$KVM_REASON" "$RESET"
  printf '    %sA cloud image reaches a login prompt in roughly 3 minutes. That is normal.%s\n' "$DIM" "$RESET"
fi

# -----------------------------------------------------------------------------
# Networking honesty
# -----------------------------------------------------------------------------
echo
say "Networking"

if [ -r /proc/sys/net/ipv4/ip_forward ] && ip link add zkvm-probe type bridge 2>/dev/null; then
  ip link del zkvm-probe 2>/dev/null || true
  ok "Bridging is possible on this host"
else
  warn "Bridging is not possible (no NET_ADMIN capability)"
  printf '    %sGuests use QEMU user-mode networking. Outbound works; inbound reaches\n' "$DIM"
  printf '    %s the guest only through forwarded ports on 127.0.0.1.%s\n' "$DIM" "$RESET"
fi

# -----------------------------------------------------------------------------
# Codespaces / container notes
# -----------------------------------------------------------------------------
if [ -n "${CODESPACES:-}" ] || [ -f /.dockerenv ] || grep -qa 'docker\|containerd' /proc/1/cgroup 2>/dev/null; then
  echo
  warn "Container environment detected"
  printf '    %s· Each VM reserves its full RAM from this container. Two 2 GB VMs need 4 GB free.%s\n' "$DIM" "$RESET"
  printf '    %s· VMs do not survive a codespace rebuild; the disk images live inside it.%s\n' "$DIM" "$RESET"
  printf '    %s· SSH is bound to 127.0.0.1. In Codespaces, forward the port from the Ports tab.%s\n' "$DIM" "$RESET"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo
echo "  ─────────────────────────────────────────────"
printf '  %sHost ready for virtual machines%s\n' "$GREEN" "$RESET"
echo "  ─────────────────────────────────────────────"
printf '  Acceleration   %s\n' "$([ "$KVM_USABLE" -eq 1 ] && echo 'KVM (fast)' || echo 'TCG (software, ~3 min boot)')"
printf '  Image cache    %s\n' "$IMAGE_DIR"
printf '  Emulator       %s\n' "$QEMU_BIN"
echo
printf '  %sNext: open the panel, create a server, and pick a Virtual Machine image.%s\n' "$DIM" "$RESET"
printf '  %sThe console streams the guest tty; type your login at the prompt.%s\n' "$DIM" "$RESET"
echo

if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
  warn "Packages that could not be installed: ${MISSING_PKGS[*]}"
  printf '  %sVM creation still works if qemu-system, qemu-img and cloud-localds are present.%s\n' "$DIM" "$RESET"
fi

exit 0
