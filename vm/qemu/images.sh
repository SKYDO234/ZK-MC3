#!/usr/bin/env bash
# =============================================================================
#  images.sh · official Ubuntu Server cloud-image catalogue and downloader
# =============================================================================
#  Sourced by zkvm; also runnable directly:
#
#     bash images.sh list
#     bash images.sh download 22.04
#
#  Every URL below is an official Canonical endpoint. Nothing here is a mirror
#  or a third-party re-host: `cloud-images.ubuntu.com/releases/<series>/release/`
#  is the same location `cloud-init` documentation and Canonical's own tooling
#  point at.
#
#  All four series are published today, including 26.04 LTS (Resolute Raccoon,
#  released 2026-11). The 26.04 entry is still *probed* rather than assumed: if a
#  future series is ever listed before Canonical publishes it, `images` reports
#  "not released yet" instead of offering a URL that 404s.
# =============================================================================

# series | display name | codename | supported-by-imager
#
# Availability is always probed live, never assumed: `zkvm images` reports
# "not released yet" for any series Canonical has not published.
readonly ZKVM_IMAGE_SERIES=("20.04" "22.04" "24.04" "26.04")

zkvm_image_name() {
  case "$1" in
    20.04) printf 'Ubuntu 20.04 LTS (Focal Fossa)' ;;
    22.04) printf 'Ubuntu 22.04 LTS (Jammy Jellyfish)' ;;
    24.04) printf 'Ubuntu 24.04 LTS (Noble Numbat)' ;;
    26.04) printf 'Ubuntu 26.04 LTS (Resolute Raccoon)' ;;
    *)     printf 'Ubuntu %s' "$1" ;;
  esac
}

zkvm_image_codename() {
  case "$1" in
    20.04) printf 'focal' ;;
    22.04) printf 'jammy' ;;
    24.04) printf 'noble' ;;
    26.04) printf 'resolute' ;;
    *)     printf 'unknown' ;;
  esac
}

# Minimum Ubuntu release that ships cloud-init on the cloud image with a usable
# default datasource. All four do; kept as a guard for future series.
zkvm_image_supported() {
  case "$1" in
    20.04 | 22.04 | 24.04 | 26.04) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# URLs
# ---------------------------------------------------------------------------

# The canonical cloud image, per architecture. Canonical publishes
#   <base>/release/ubuntu-<series>-server-cloudimg-<arch>.img
# which is the qcow2 image (the `.img` suffix is historical — it is qcow2).
zkvm_image_url() {
  local series="$1" arch="${2:-amd64}"
  printf 'https://cloud-images.ubuntu.com/releases/%s/release/ubuntu-%s-server-cloudimg-%s.img' \
    "$series" "$series" "$arch"
}

# SHA-256SUMS next to the image; used to verify a download instead of trusting
# a byte count.
zkvm_image_sha_url() {
  local series="$1"
  printf 'https://cloud-images.ubuntu.com/releases/%s/release/SHA256SUMS' "$series"
}

# Canonical's release index for a series — how we tell "released" from "not yet".
zkvm_image_index_url() {
  local series="$1"
  printf 'https://cloud-images.ubuntu.com/releases/%s/' "$series"
}

# ---------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------

# Probes Canonical for one series. Prints one of:
#   available     — HTTP 200/301/302 on the release image
#   missing       — HTTP 403/404: Canonical has not published this series
#   unreachable   — no answer at all (DNS, proxy, firewall, no curl)
#
# Collapsing "missing" and "unreachable" into one "not released yet" would tell
# an operator their network was fine when the series genuinely does not exist,
# or vice versa. Both matter, so they are reported separately.
zkvm_image_probe() {
  local series="$1"
  local url
  url="$(zkvm_image_url "$series" "$(zkvm_host_arch)")"

  if ! command -v curl >/dev/null 2>&1; then
    printf 'unreachable'
    return
  fi

  local code
  code="$(curl -sSI -o /dev/null -w '%{http_code}' --max-time 20 "$url" 2>/dev/null || true)"
  case "$code" in
    200 | 301 | 302) printf 'available' ;;
    403 | 404)       printf 'missing' ;;
    *)               printf 'unreachable' ;;
  esac
}

# True when Canonical actually serves a release image for this series.
zkvm_image_available() {
  [ "$(zkvm_image_probe "$1")" = "available" ]
}

# Prints the series that are genuinely downloadable right now, one per line.
zkvm_available_series() {
  local s
  for s in "${ZKVM_IMAGE_SERIES[@]}"; do
    if zkvm_image_available "$s"; then printf '%s\n' "$s"; fi
  done
}

# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

# Resumable download of one cloud image, verified against SHA256SUMS when the
# sums file is reachable. Returns non-zero on failure without leaving a
# half-written file under the final name.
zkvm_download_image() {
  local series="$1"
  local arch dest url sha_url sums expected actual partial

  arch="$(zkvm_host_arch)"
  url="$(zkvm_image_url "$series" "$arch")"
  sha_url="$(zkvm_image_sha_url "$series")"
  dest="${ZKVM_IMAGE_DIR}/ubuntu-${series}-cloudimg-${arch}.img"
  partial="${dest}.part"

  if [ -f "$dest" ]; then
    zkvm_ok "Ubuntu ${series} image already present ($(zkvm_human_size "$(stat -c%s "$dest" 2>/dev/null || echo 0)"))"
    return 0
  fi

  if [ "$(id -u)" -ne 0 ] && [ ! -w "$ZKVM_IMAGE_DIR" ]; then
    zkvm_err "Cannot write to ${ZKVM_IMAGE_DIR}. Re-run as root: sudo zkvm download ${series}"
    return 1
  fi

  mkdir -p "$ZKVM_IMAGE_DIR" 2>/dev/null || true

  zkvm_info "Downloading $(zkvm_image_name "$series")"
  zkvm_info "  from ${url}"
  zkvm_info "  to   ${dest}"

  # -C - resumes an interrupted download; cloud images are ~600 MB.
  if ! curl -fL --progress-bar -C - -o "$partial" "$url"; then
    zkvm_err "Download failed. Check the network, then re-run — it will resume."
    return 1
  fi

  # Verify when the sums file is reachable. A mismatch is fatal: a corrupt base
  # image produces a VM that fails in confusing ways much later.
  sums="$(curl -fsSL --max-time 30 "$sha_url" 2>/dev/null || true)"
  if [ -n "$sums" ]; then
    expected="$(printf '%s\n' "$sums" \
      | awk -v f="ubuntu-${series}-server-cloudimg-${arch}.img" '$2 == f || $2 == "*"f {print $1}' \
      | head -n1)"
    if [ -n "$expected" ]; then
      actual="$(sha256sum "$partial" | awk '{print $1}')"
      if [ "$expected" != "$actual" ]; then
        zkvm_err "Checksum mismatch for Ubuntu ${series}."
        zkvm_err "  expected ${expected}"
        zkvm_err "  got      ${actual}"
        rm -f "$partial"
        return 1
      fi
      zkvm_ok "Checksum verified (sha256 ${expected:0:16}…)"
    else
      zkvm_warn "No checksum listed for this image; continuing unverified."
    fi
  else
    zkvm_warn "Could not fetch SHA256SUMS; image left unverified."
  fi

  mv -f "$partial" "$dest"
  zkvm_ok "Ubuntu ${series} image ready: ${dest} ($(zkvm_human_size "$(stat -c%s "$dest")"))"
}

# Lists what can be downloaded right now, and says why anything is missing.
zkvm_list_images() {
  local s probe name status unreachable=0
  printf '\n  %-8s %-35s %s\n' "SERIES" "NAME" "STATUS"
  printf '  %s\n' "----------------------------------------------------------------------"
  for s in "${ZKVM_IMAGE_SERIES[@]}"; do
    name="$(zkvm_image_name "$s")"
    probe="$(zkvm_image_probe "$s")"
    case "$probe" in
      available)   status="official image available" ;;
      missing)     status="not published by Canonical" ;;
      *)           status="could not reach cloud-images.ubuntu.com"; unreachable=1 ;;
    esac
    printf '  %-8s %-35s %s\n' "$s" "$name" "$status"
  done
  if [ "$unreachable" -eq 1 ]; then
    printf '\n  %s\n' "  Note: this host cannot reach Canonical, so availability below is unverified."
    printf '  %s\n' "  That is a network problem here, not a missing Ubuntu release."
  fi
  printf '\n  Download with:  sudo zkvm download <series>   e.g. sudo zkvm download 22.04\n\n'
}

# Direct-run support: `bash images.sh list` / `bash images.sh download 22.04`
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=/dev/null
  . "${HERE}/lib.sh"
  case "${1:-}" in
    list)     zkvm_list_images ;;
    download) zkvm_download_image "${2:?usage: images.sh download <series>}" ;;
    url)      zkvm_image_url "${2:?usage: images.sh url <series>}" "${3:-amd64}" ;;
    *)        echo "usage: images.sh {list|download <series>|url <series> [arch]}" >&2; exit 2 ;;
  esac
fi
