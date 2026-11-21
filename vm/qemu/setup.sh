#!/usr/bin/env bash
# =============================================================================
#  setup.sh · one-shot installer for the ZK-MC3 QEMU VM environment
# =============================================================================
#  Installs everything needed to run real virtual machines, detects whether this
#  host can accelerate them, and installs the `zkvm` command system-wide.
#
#     sudo bash setup.sh              install everything
#     sudo bash setup.sh --check      report only, change nothing
#     sudo bash setup.sh --no-images  skip the Ubuntu 22.04 download
#     bash setup.sh --uninstall       remove the zkvm command (keeps VMs)
#
#  Designed for GitHub Codespaces as well as ordinary Ubuntu/Debian hosts.
#  Everything is idempotent: re-running is always safe.
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "${HERE}/lib.sh"
# shellcheck source=images.sh
. "${HERE}/images.sh"

CHECK_ONLY=0
SKIP_IMAGES=0
UNINSTALL=0
DEFAULT_SERIES="${ZKVM_DEFAULT_SERIES:-22.04}"

while [ $# -gt 0 ]; do
  case "$1" in
    --check)      CHECK_ONLY=1; shift ;;
    --no-images)  SKIP_IMAGES=1; shift ;;
    --uninstall)  UNINSTALL=1; shift ;;
    --series)     DEFAULT_SERIES="${2:?--series needs a value}"; shift 2 ;;
    -h | --help)
      sed -n '2,20p' "$0" | sed 's/^#  \{0,2\}//'
      exit 0
      ;;
    *) zkvm_err "Unknown option: $1"; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# 0 · sanity
# ---------------------------------------------------------------------------

if [ "$UNINSTALL" -eq 1 ]; then
  rm -f /usr/local/bin/zkvm
  zkvm_ok "Removed /usr/local/bin/zkvm. VM data in ${ZKVM_STATE_DIR} was left alone."
  exit 0
fi

if ! zkvm_is_root; then
  zkvm_err "This installer needs root to install packages and write ${ZKVM_IMAGE_DIR}."
  zkvm_err "Re-run with:  sudo bash $0"
  exit 1
fi

if ! zkvm_has apt-get; then
  zkvm_err "This installer targets Ubuntu/Debian (apt-get not found)."
  zkvm_err "On another distribution install: qemu-system-x86 qemu-utils cloud-image-utils genisoimage"
  exit 1
fi

zkvm_step "ZK-MC3 QEMU VM environment · installer"
printf '  %-22s %s\n' "Host"        "$(uname -s) $(uname -r) $(uname -m)"
printf '  %-22s %s\n' "Codespace"   "$(zkvm_is_codespace && echo yes || echo no)"
printf '  %-22s %s\n' "Acceleration" "$(zkvm_accel) — $(zkvm_accel_reason)"
printf '  %-22s %s\n' "Images"      "$ZKVM_IMAGE_DIR"
printf '  %-22s %s\n' "VM data"     "$ZKVM_STATE_DIR"

if [ "$CHECK_ONLY" -eq 1 ]; then
  zkvm_step "Check only — nothing will be changed"
  zkvm_doctor
  exit $?
fi

# ---------------------------------------------------------------------------
# 1 · packages
# ---------------------------------------------------------------------------

zkvm_step "Installing virtualisation packages"

# Always emulate x86_64 so a Codespace on either architecture can run the
# Ubuntu cloud images we document. On an amd64 host qemu-system-x86 is native;
# on arm64 it is full emulation and slow, which `zkvm doctor` says plainly.
PACKAGES=(
  qemu-system-x86
  qemu-utils
  cloud-image-utils
  genisoimage
  wget
  curl
  bridge-utils
  iproute2
  net-tools
  openssh-client
  rsync
  cpu-checker
)

export DEBIAN_FRONTEND=noninteractive

if ! apt-get update -qq; then
  zkvm_warn "apt-get update reported problems; continuing with the existing lists."
fi

# Install one by one so a single unavailable package cannot sink the whole run
# (bridge-utils is absent on some minimal Codespace images).
MISSING=()
for pkg in "${PACKAGES[@]}"; do
  if dpkg -s "$pkg" >/dev/null 2>&1; then
    continue
  fi
  MISSING+=("$pkg")
done

if [ "${#MISSING[@]}" -eq 0 ]; then
  zkvm_ok "All packages already installed."
else
  zkvm_info "Installing: ${MISSING[*]}"
  if apt-get install -y -qq --no-install-recommends "${MISSING[@]}" 2>/tmp/zkvm-apt.log; then
    zkvm_ok "Packages installed."
  else
    zkvm_warn "Bulk install reported errors; retrying individually."
    local_failed=()
    for pkg in "${MISSING[@]}"; do
      if apt-get install -y -qq --no-install-recommends "$pkg" >/dev/null 2>&1; then
        zkvm_ok "$pkg"
      else
        zkvm_warn "$pkg could not be installed"
        local_failed+=("$pkg")
      fi
    done
    if [ "${#local_failed[@]}" -gt 0 ]; then
      zkvm_warn "Unavailable: ${local_failed[*]}"
      zkvm_warn "These are optional or may need a different name on this image."
    fi
  fi
fi

# Hard requirement check — fail now with a useful message instead of at first boot.
if ! zkvm_has "$(zkvm_qemu_binary)"; then
  zkvm_err "$(zkvm_qemu_binary) is still missing. Cannot continue."
  zkvm_err "Try: apt-get install qemu-system-x86"
  exit 1
fi
if ! zkvm_has qemu-img; then
  zkvm_err "qemu-img is missing. Cannot continue."
  exit 1
fi
zkvm_ok "$("$(zkvm_qemu_binary)" --version | head -n1)"

# ---------------------------------------------------------------------------
# 2 · kvm group (present only when the host actually has KVM)
# ---------------------------------------------------------------------------

zkvm_step "Virtualisation support"
if zkvm_kvm_usable; then
  zkvm_ok "KVM available — hardware acceleration enabled."
  # Let the invoking (non-root) user use KVM without sudo on every command.
  # ${VAR:-} everywhere: SUDO_USER is unset when this runs as root directly, and
  # `set -u` would abort on a bare expansion.
  if [ -n "${SUDO_USER:-}" ] && getent group kvm >/dev/null 2>&1; then
    if usermod -aG kvm "${SUDO_USER:-root}" 2>/dev/null; then
      zkvm_ok "Added ${SUDO_USER:-root} to the kvm group (re-login to take effect)."
    fi
  fi
elif [ -e /dev/kvm ]; then
  zkvm_warn "/dev/kvm exists but is not accessible; fixing permissions."
  chmod 666 /dev/kvm 2>/dev/null || true
  if zkvm_kvm_usable; then
    zkvm_ok "KVM is now accessible."
  else
    zkvm_warn "Still cannot open /dev/kvm — falling back to TCG."
  fi
else
  zkvm_warn "No /dev/kvm on this host. Falling back to TCG software emulation."
  if zkvm_is_codespace; then
    zkvm_info "GitHub Codespaces does not expose nested virtualisation, so this is expected."
    zkvm_info "VMs still work — they are just much slower. The manager selects TCG automatically."
  fi
fi

# ---------------------------------------------------------------------------
# 3 · directories
# ---------------------------------------------------------------------------

zkvm_step "Creating directories"
for d in "$ZKVM_IMAGE_DIR" "$ZKVM_STATE_DIR" "$ZKVM_VM_DIR" "$ZKVM_SEED_DIR" "$ZKVM_LOG_DIR"; do
  mkdir -p "$d" || { zkvm_err "Cannot create $d"; exit 1; }
  chmod 755 "$d"
  zkvm_ok "$d"
done

# ---------------------------------------------------------------------------
# 4 · install the zkvm command
# ---------------------------------------------------------------------------

zkvm_step "Installing the zkvm command"
chmod +x "${HERE}/zkvm" "${HERE}/images.sh" "${HERE}/setup.sh" 2>/dev/null || true

INSTALL_DIR="/usr/local/bin"
if [ -w "$INSTALL_DIR" ]; then
  install -m 0755 "${HERE}/zkvm" "${INSTALL_DIR}/zkvm"
  zkvm_ok "${INSTALL_DIR}/zkvm"
else
  zkvm_err "Cannot write to ${INSTALL_DIR}."
  exit 1
fi

# The command locates lib.sh/images.sh next to itself, so install a small
# runtime tree rather than a bare script.
LIB_DIR="/usr/local/lib/zkvm"
mkdir -p "$LIB_DIR"
install -m 0644 "${HERE}/lib.sh" "${LIB_DIR}/lib.sh"
install -m 0644 "${HERE}/images.sh" "${LIB_DIR}/images.sh"
# Re-point the installed launcher at the library tree.
sed -i "s#HERE=\"\$(cd \"\$(dirname \"\${BASH_SOURCE\[0\]}\")\" && pwd)\"#HERE=\"${LIB_DIR}\"#" \
  "${INSTALL_DIR}/zkvm" 2>/dev/null || true
# Fall back to copying the whole manager flat if the sed did not apply.
cp -f "${HERE}/zkvm" "${LIB_DIR}/zkvm"
install -m 0755 "${LIB_DIR}/zkvm" "${INSTALL_DIR}/zkvm"
rm -f "${LIB_DIR}/zkvm"
zkvm_ok "Runtime library in ${LIB_DIR}"

# ---------------------------------------------------------------------------
# 5 · base image
# ---------------------------------------------------------------------------

if [ "$SKIP_IMAGES" -eq 0 ]; then
  zkvm_step "Base images"
  if ! zkvm_image_available "$DEFAULT_SERIES"; then
    zkvm_err "Canonical does not serve a release image for Ubuntu ${DEFAULT_SERIES} right now."
    zkvm_warn "Available series: $(zkvm_available_series | tr '\n' ' ')"
    DEFAULT_SERIES="$(zkvm_available_series | head -n1)"
  fi
  if [ -n "$DEFAULT_SERIES" ] && [ -n "$(zkvm_available_series)" ]; then
    zkvm_download_image "$DEFAULT_SERIES" || zkvm_warn "Image download failed; run 'sudo zkvm download ${DEFAULT_SERIES}' later."
  fi
else
  zkvm_step "Base images"
  zkvm_info "Skipped (--no-images). Fetch later with: sudo zkvm download ${DEFAULT_SERIES}"
fi

# ---------------------------------------------------------------------------
# 6 · codespace networking notes
# ---------------------------------------------------------------------------

if zkvm_is_codespace; then
  zkvm_step "Codespaces networking — what will and will not work"
  cat <<'EOF'
  Works:
    · Outbound internet from inside the guest (apt, pip, curl) — QEMU user-mode NAT
    · SSH into the VM over 127.0.0.1:<port> from inside this Codespace
    · Port forwarding to your browser: Ports tab → Forward a Port → 2222

  Does NOT work (Codespace limitation, not a bug):
    · Bridged/tap networking — no NET_ADMIN capability
    · Reaching the VM from outside except through forwarded localhost ports
    · Inbound connections to arbitrary guest ports unless each is forwarded
    · KVM acceleration — no nested virtualisation

  Each VM's SSH port is printed by `zkvm status`. Forward that port to reach it
  from your own machine.
EOF
fi

# ---------------------------------------------------------------------------
# 7 · summary
# ---------------------------------------------------------------------------

zkvm_step "Done"
zkvm_doctor

cat <<EOF

  Next steps
    1. Create a VM:
         sudo zkvm create --name dev --ram 2048 --vcpu 2 --disk 20 --series 22.04
    2. Boot it:
         sudo zkvm start dev
    3. Watch it come up (TCG boot takes a few minutes):
         sudo zkvm console dev
    4. Log in over SSH once it has booted:
         ssh ubuntu@127.0.0.1 -p 2222

  Manage everything with:  zkvm help

EOF
