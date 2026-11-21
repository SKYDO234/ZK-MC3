#!/usr/bin/env bash
# =============================================================================
#  lib.sh · shared helpers for the ZK-MC3 QEMU VM manager
# =============================================================================
#  Everything here is sourced by zkvm / setup.sh / images.sh. It must stay free
#  of side effects at source time so `zkvm help` works on a host with nothing
#  installed.
# =============================================================================

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

# Colour only when stdout is a terminal, so piped/pasted logs stay clean.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  readonly ZK_C_RESET=$'\033[0m'
  readonly ZK_C_DIM=$'\033[2m'
  readonly ZK_C_RED=$'\033[31m'
  readonly ZK_C_GREEN=$'\033[32m'
  readonly ZK_C_YELLOW=$'\033[33m'
  readonly ZK_C_BLUE=$'\033[34m'
  readonly ZK_C_CYAN=$'\033[36m'
  readonly ZK_C_BOLD=$'\033[1m'
else
  readonly ZK_C_RESET='' ZK_C_DIM='' ZK_C_RED='' ZK_C_GREEN=''
  readonly ZK_C_YELLOW='' ZK_C_BLUE='' ZK_C_CYAN='' ZK_C_BOLD=''
fi

zkvm_info()  { printf '%s▸%s %s\n' "$ZK_C_CYAN" "$ZK_C_RESET" "$*"; }
zkvm_ok()    { printf '%s✔%s %s\n' "$ZK_C_GREEN" "$ZK_C_RESET" "$*"; }
zkvm_warn()  { printf '%s!%s %s\n' "$ZK_C_YELLOW" "$ZK_C_RESET" "$*" >&2; }
zkvm_err()   { printf '%s✖%s %s\n' "$ZK_C_RED" "$ZK_C_RESET" "$*" >&2; }
zkvm_step()  { printf '\n%s%s▌ %s%s\n' "$ZK_C_BOLD" "$ZK_C_BLUE" "$*" "$ZK_C_RESET"; }

# ---------------------------------------------------------------------------
# Defaults / paths — every one overridable by environment variable
# ---------------------------------------------------------------------------

readonly ZKVM_VERSION="1.0.0"
readonly ZKVM_STATE_DIR="${ZKVM_STATE_DIR:-/var/lib/zkvm}"
readonly ZKVM_IMAGE_DIR="${ZKVM_IMAGE_DIR:-/var/lib/vm-images}"
readonly ZKVM_VM_DIR="${ZKVM_VM_DIR:-${ZKVM_STATE_DIR}/vms}"
readonly ZKVM_SEED_DIR="${ZKVM_SEED_DIR:-${ZKVM_STATE_DIR}/seed}"
readonly ZKVM_LOG_DIR="${ZKVM_LOG_DIR:-${ZKVM_STATE_DIR}/logs}"
# Where the panel bundles this tree, so `bash setup.sh` works after a download.
readonly ZKVM_SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

zkvm_host_arch() {
  case "$(uname -m)" in
    x86_64 | amd64)  printf 'amd64' ;;
    aarch64 | arm64) printf 'arm64' ;;
    *)               printf 'amd64' ;;  # Canonical only ships these two
  esac
}

zkvm_qemu_arch() {
  case "$(uname -m)" in
    aarch64 | arm64) printf 'aarch64' ;;
    *)               printf 'x86_64' ;;
  esac
}

zkvm_qemu_binary() {
  printf 'qemu-system-%s' "$(zkvm_qemu_arch)"
}

zkvm_is_root() { [ "$(id -u)" -eq 0 ]; }

# True inside a GitHub Codespace.
zkvm_is_codespace() {
  [ -n "${CODESPACES:-}" ] || [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ] \
    || [ -n "${CODESPACE_NAME:-}" ]
}

# True when /dev/kvm exists *and* is actually usable by this user.
# Existence alone is not enough: Codespaces often create the node but deny open()
# because nested virtualisation is off.
zkvm_kvm_usable() {
  [ -e /dev/kvm ] || return 1
  [ -r /dev/kvm ] && [ -w /dev/kvm ] || return 1
}

# Human-readable acceleration verdict, used by `status` and `doctor`.
zkvm_accel() {
  if zkvm_kvm_usable; then
    printf 'kvm'
  else
    printf 'tcg'
  fi
}

zkvm_accel_reason() {
  if zkvm_kvm_usable; then
    printf '/dev/kvm is present and accessible — hardware acceleration is on.'
    return
  fi
  if [ -e /dev/kvm ]; then
    printf '/dev/kvm exists but this user cannot open it; run as root or add yourself to the kvm group. Using TCG.'
    return
  fi
  if zkvm_is_codespace; then
    printf 'No /dev/kvm — GitHub Codespaces does not expose nested virtualisation. Using TCG (software emulation).'
    return
  fi
  printf 'No /dev/kvm on this host (bare-metal CPU virtualisation off, or a VM without nesting). Using TCG.'
}

zkvm_has() { command -v "$1" >/dev/null 2>&1; }

zkvm_human_size() {
  local bytes="${1:-0}"
  awk -v b="$bytes" 'BEGIN {
    split("B KB MB GB TB", u, " ");
    i = 1;
    while (b >= 1024 && i < 5) { b /= 1024; i++ }
    printf (i == 1 ? "%.0f %s" : "%.1f %s"), b, u[i];
  }'
}

# ---------------------------------------------------------------------------
# VM registry
# ---------------------------------------------------------------------------
#  One directory per VM:
#     <VM_DIR>/<name>/vm.conf       settings, written by `create`
#     <VM_DIR>/<name>/disk.qcow2    the writable overlay on the base image
#     <VM_DIR>/<name>/seed.iso      cloud-init NoCloud seed
#     <VM_DIR>/<name>/vm.pid        qemu pid while running
#     <VM_DIR>/<name>/console.log   serial output
#  A plain directory tree keeps it inspectable with `ls` and needs no database.

zkvm_vm_exists() {
  [ -f "${ZKVM_VM_DIR}/$1/vm.conf" ]
}

zkvm_vm_names() {
  [ -d "$ZKVM_VM_DIR" ] || return 0
  local d
  for d in "$ZKVM_VM_DIR"/*/; do
    [ -f "${d}vm.conf" ] || continue
    basename "$d"
  done
}

# Loads <name>/vm.conf into VM_* variables in the current shell.
zkvm_vm_load() {
  local name="$1" conf="${ZKVM_VM_DIR}/$1/vm.conf"
  [ -f "$conf" ] || { zkvm_err "No such VM: ${name}"; return 1; }

  VM_NAME="" VM_RAM="" VM_VCPU="" VM_DISK="" VM_SERIES="" VM_IMAGE=""
  VM_USER="" VM_HOSTNAME="" VM_MAC="" VM_CREATED="" VM_SSH_PORT=""
  # shellcheck source=/dev/null
  . "$conf"
  [ "$VM_NAME" = "$name" ] || { zkvm_err "Corrupt vm.conf for ${name}"; return 1; }
}

zkvm_vm_pid() {
  local pidfile="${ZKVM_VM_DIR}/$1/vm.pid"
  [ -f "$pidfile" ] || return 1
  local pid
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  # The pidfile outlives a crash, so confirm the process still exists and is qemu.
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

zkvm_vm_running() {
  zkvm_vm_pid "$1" >/dev/null 2>&1
}

zkvm_vm_state() {
  local name="$1"
  if zkvm_vm_running "$name"; then
    printf 'running'
  else
    printf 'stopped'
  fi
}

# Exclusive lock per VM so two `zkvm start` calls cannot both spawn a qemu.
#
# The lock is keyed on a *background holder* rather than the calling shell: a
# bare `exec 9>file; flock -n 9` stays held until the script exits, so any early
# `return` from a failed start would block every later command. Here the fd is
# owned by a subshell we can kill, and the holder is remembered so every exit
# path — including a crash — releases it.
ZKVM_LOCK_DIR=""

# Exclusive lock per VM so two `zkvm start` calls cannot both spawn a qemu.
#
# Uses an atomic `mkdir` rather than flock(1): flock needs a process to hold the
# descriptor, and a background holder keeps the caller's stdout open (which hangs
# anything piping our output) or outlives a crash. A directory is atomic to
# create, needs no process, and carries its owner's pid for stale detection.
zkvm_vm_lock() {
  local name="$1" lockdir="${ZKVM_VM_DIR}/$1/.lock.d"
  mkdir -p "$(dirname "$lockdir")" || return 1

  if mkdir "$lockdir" 2>/dev/null; then
    printf '%s\n' "$$" >"$lockdir/pid"
    ZKVM_LOCK_DIR="$lockdir"
    return 0
  fi

  # Held. Is the owner still alive? A killed zkvm must not deadlock the VM.
  local owner=""
  [ -f "$lockdir/pid" ] && owner="$(cat "$lockdir/pid" 2>/dev/null || true)"
  if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
    zkvm_err "Another zkvm command is operating on ${name} (pid ${owner})."
    return 1
  fi

  zkvm_warn "Removing a stale lock left by a previous run."
  rm -rf "$lockdir"
  if mkdir "$lockdir" 2>/dev/null; then
    printf '%s\n' "$$" >"$lockdir/pid"
    ZKVM_LOCK_DIR="$lockdir"
    return 0
  fi
  zkvm_err "Could not acquire the lock for ${name}."
  return 1
}

zkvm_vm_unlock() {
  if [ -n "${ZKVM_LOCK_DIR:-}" ]; then
    rm -rf "$ZKVM_LOCK_DIR" 2>/dev/null || true
    ZKVM_LOCK_DIR=""
  fi
}

# ---------------------------------------------------------------------------
# Ports
# ---------------------------------------------------------------------------
#  Every VM gets a host-forwarded SSH port. Starting from 2222 and taking the
#  first free one keeps the rule simple and inspectable.
zkvm_next_ssh_port() {
  mkdir -p "$ZKVM_VM_DIR"
  local port=2222 name
  while [ "$port" -lt 2400 ]; do
    local taken=0
    for name in $(zkvm_vm_names); do
      zkvm_vm_load "$name" >/dev/null 2>&1 || continue
      [ "$VM_SSH_PORT" = "$port" ] && taken=1
    done
    [ "$taken" -eq 0 ] && { printf '%s' "$port"; return 0; }
    port=$((port + 1))
  done
  return 1
}
