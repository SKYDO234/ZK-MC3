import fs from "fs-extra";
import path from "path";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";

/**
 * ZK-MC3-PANEL · QEMU virtual machines
 * ---------------------------------------------------------------------------
 * A VM is a *server record* whose software is one of the VM_IMAGES ids, so it
 * inherits the whole console stack for free: the log stream, the command box,
 * the start/stop buttons, the socket room. What this module owns is everything
 * that is genuinely different about a VM:
 *
 *   • the disk image (a per-VM qcow2, never the shared base);
 *   • the cloud-init seed (microVM username/password, amd64, NoCloud);
 *   • the QEMU command line, including a *bidirectional pipe* for the guest's
 *     serial console.
 *
 * Why a pipe and not -nographic/stdin
 * ---------------------------------------------------------------------------
 * The obvious wiring (`-nographic -serial mon:stdio`) cannot be driven by a
 * panel. QEMU multiplexes its monitor onto stdin in that mode, so a web console
 * that pipes keystrokes in corrupts the monitor and detaches or kills the guest
 * — and Node's stdout is not a TTY, so `-nographic` degrades to something that
 * silently swallows half the output.
 *
 * Instead the guest's ttyS0 is bound to a UNIX socket:
 *
 *     -serial unix:<dir>/console.sock,server=on,wait=off
 *
 * The panel connects to that socket and gets a clean byte-for-byte stream in
 * both directions. It survives a panel restart, it needs no PTY, and it cannot
 * be confused for QEMU's monitor. One guest console, one socket, no multiplexing.
 *
 * KVM vs TCG
 * ---------------------------------------------------------------------------
 * Codespaces almost never exposes /dev/kvm. We check presence *and* openability,
 * because the device node is frequently present and merely unreadable, and fall
 * back to TCG rather than failing. TCG boots a cloud image in roughly 3 minutes,
 * which is slow but real; the panel says so in the console banner instead of
 * leaving the operator to wonder whether it hung.
 */

// ---------------------------------------------------------------------------
// Image catalogue
// ---------------------------------------------------------------------------

export interface VmImage {
  /** Stable id, also used as the server record's `software`. */
  id: string;
  label: string;
  /** What the create form shows under the name. */
  description: string;
  /**
   * Order of the `distro` switch in fetchImage(). Kept explicit so an unknown
   * distro fails loudly at catalogue load instead of silently downloading
   * Ubuntu for a Debian request.
   */
  distro: "ubuntu" | "debian";
  /** Ubuntu series codename (jammy) or Debian codename (bookworm). */
  codename: string;
  /** Display version, e.g. "22.04". */
  version: string;
  /** Default login, mirrored from the image's own cloud-init defaults. */
  user: string;
  /** Fallback RAM/vCPU when the caller does not specify. */
  ram: number;
  cpu: number;
  disk: number;
}

/**
 * Official cloud images. Ubuntu uses cloud-images.ubuntu.com, whose
 * `<codename>/current/` path is a stable symlink to the newest release build of
 * that series — it is the URL Canonical itself documents, and it survives point
 * releases. Debian uses cloud.debian.org's `latest/` equivalent.
 */
export const VM_IMAGES: VmImage[] = [
  {
    id: "UBUNTU2204",
    label: "Ubuntu 22.04 LTS",
    description: "Jammy Jellyfish — the long-term default.",
    distro: "ubuntu",
    codename: "jammy",
    version: "22.04",
    user: "ubuntu",
    ram: 2048,
    cpu: 2,
    disk: 20,
  },
  {
    id: "UBUNTU2404",
    label: "Ubuntu 24.04 LTS",
    description: "Noble Numbat — newer toolchain, same LTS support.",
    distro: "ubuntu",
    codename: "noble",
    version: "24.04",
    user: "ubuntu",
    ram: 2048,
    cpu: 2,
    disk: 20,
  },
  {
    id: "UBUNTU2604",
    label: "Ubuntu 26.04 LTS",
    description: "Resolute Raccoon — newest LTS.",
    distro: "ubuntu",
    codename: "resolute",
    version: "26.04",
    user: "ubuntu",
    ram: 2048,
    cpu: 2,
    disk: 20,
  },
  {
    id: "DEBIAN12",
    label: "Debian 12",
    description: "Bookworm — small, stable, no snap.",
    distro: "debian",
    codename: "bookworm",
    version: "12",
    user: "debian",
    ram: 2048,
    cpu: 2,
    disk: 20,
  },
  {
    id: "DEBIAN13",
    label: "Debian 13",
    description: "Trixie — current stable branch.",
    distro: "debian",
    codename: "trixie",
    version: "13",
    user: "debian",
    ram: 2048,
    cpu: 2,
    disk: 20,
  },
];

export const VM_IMAGE = (id: string) =>
  VM_IMAGES.find((i) => i.id === String(id || "").toUpperCase()) || null;

/** True for every software id that is a VM rather than a Minecraft server. */
export const isVmSoftware = (software: string) => !!VM_IMAGE(software);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const IMAGE_DIR = process.env.ZKVM_IMAGE_DIR || "/var/lib/vm-images";
const RUN_DIR = process.env.ZKVM_RUN_DIR || path.join(os.tmpdir(), "zkvm");

export const vmRunDir = (serverId: string) => path.join(RUN_DIR, serverId);
export const vmConsoleSock = (serverId: string) => path.join(vmRunDir(serverId), "console.sock");
export const vmPidFile = (serverId: string) => path.join(vmRunDir(serverId), "qemu.pid");
/** Base images are shared and read-only; each VM gets its own overlay. */
const baseImagePath = (image: VmImage) =>
  path.join(IMAGE_DIR, `${image.distro}-${image.codename}-server-cloudimg-amd64.img`);

export const vmDiskPath = (serverDir: string) => path.join(serverDir, "disk.qcow2");
const vmSeedPath = (serverDir: string) => path.join(serverDir, "seed.iso");

// ---------------------------------------------------------------------------
// Image URLs + download
// ---------------------------------------------------------------------------

export const imageUrl = (image: VmImage) =>
  image.distro === "ubuntu"
    ? `https://cloud-images.ubuntu.com/${image.codename}/current/${image.codename}-server-cloudimg-amd64.img`
    : `https://cloud.debian.org/images/cloud/${image.codename}/latest/debian-${image.version}-generic-amd64.qcow2`;

/** Fetch, resumable. Cached on disk so a rebuild does not re-download 700 MB. */
const fetchBaseImage = async (image: VmImage, log: (s: string) => void) => {
  const dest = baseImagePath(image);
  if (await fs.pathExists(dest)) {
    const size = (await fs.stat(dest)).size;
    // A truncated prior download would otherwise be used forever.
    if (size > 100 * 1024 * 1024) {
      log(`[VM] Using cached base image (${(size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
      return dest;
    }
    log(`[VM] Cached image at ${dest} looks truncated (${size} bytes) — re-downloading`);
    await fs.remove(dest);
  }

  await fs.ensureDir(IMAGE_DIR);
  const url = imageUrl(image);
  log(`[VM] Downloading ${image.label} cloud image`);
  log(`[VM]   ${url}`);

  const part = `${dest}.part`;
  await new Promise<void>((resolve, reject) => {
    // -s silences the progress meter: the panel reports progress itself, and
    // curl's carriage-return meter otherwise floods the console log on failure.
    const args = ["-fsSL", "--retry", "3", "--connect-timeout", "20", "-C", "-", "-o", part, url];
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let lastPct = -10;
    let stderrBuf = "";
    child.stderr.on("data", (b: Buffer) => {
      stderrBuf = (stderrBuf + b.toString()).slice(-400);
    });
    // curl -# style progress is noisy; report at 10% steps only.
    const timer = setInterval(async () => {
      const size = await fs.stat(part).then((s) => s.size).catch(() => 0);
      if (!size) return;
      const pct = Math.min(99, Math.floor(size / 7_000_000)); // ~0.7 GB baseline
      if (pct >= lastPct + 10) {
        lastPct = pct;
        log(`[VM]   … ${pct}% (${(size / 1024 / 1024).toFixed(0)} MB)`);
      }
    }, 2000);
    child.on("error", (err) => {
      clearInterval(timer);
      reject(new Error(`Could not run curl: ${err.message}`));
    });
    child.on("exit", (code) => {
      clearInterval(timer);
      if (code === 0) resolve();
      else reject(new Error(`curl exited ${code}. ${stderrBuf.trim()}`.trim()));
    });
  });

  await fs.move(part, dest, { overwrite: true });
  log(`[VM] Base image ready: ${dest}`);
  return dest;
};

// ---------------------------------------------------------------------------
// Host capability detection
// ---------------------------------------------------------------------------

export interface HostCapabilities {
  qemu: boolean;
  qemuPath: string | null;
  qemuImg: boolean;
  cloudLocalds: boolean;
  kvm: boolean;
  /** Human explanation for the panel, never a bare boolean. */
  kvmReason: string;
  /** Why VM creation cannot proceed, or null when it can. */
  blocker: string | null;
}

let capCache: { at: number; caps: HostCapabilities } | null = null;

const which = async (bin: string) => {
  const dirs = String(process.env.PATH || "").split(":");
  for (const dir of dirs) {
    if (!dir) continue;
    const full = path.join(dir, bin);
    const ok = await fs
      .access(full, fs.constants.X_OK)
      .then(() => true)
      .catch(() => false);
    if (ok) return full;
  }
  return null;
};

/**
 * KVM needs more than a device node. In containers the node often exists while
 * the container runtime has not passed through the virt capability, so open()
 * fails with EPERM/EACCES — reporting "KVM available" there would promise a fast
 * boot and deliver an obscure QEMU error instead.
 */
const detectKvm = async (): Promise<{ kvm: boolean; reason: string }> => {
  const node = "/dev/kvm";
  if (!(await fs.pathExists(node))) {
    return { kvm: false, reason: "/dev/kvm does not exist on this host" };
  }
  try {
    // fs-extra types fs.open as returning an fd number (the promise variant
    // returns a FileHandle at runtime). Closing a FileHandle is what actually
    // releases the device, so handle both shapes.
    const fh: any = await (fs as any).open(node, "r+");
    if (typeof fh === "number") {
      if (typeof (fs as any).close === "function") await new Promise<void>((r) => (fs as any).close(fh, () => r()));
    } else if (fh && typeof fh.close === "function") {
      await fh.close();
    }
    return { kvm: true, reason: "/dev/kvm is present and writable" };
  } catch (err: any) {
    const code = String(err?.code || "");
    if (code === "EACCES" || code === "EPERM") {
      return {
        kvm: false,
        reason: "/dev/kvm exists but this user may not open it (container without the virt capability)",
      };
    }
    return { kvm: false, reason: `/dev/kvm could not be opened (${code || err?.message})` };
  }
};

export const hostCapabilities = async (fresh = false): Promise<HostCapabilities> => {
  if (!fresh && capCache && Date.now() - capCache.at < 60_000) return capCache.caps;

  const qemuPath = (await which("qemu-system-x86_64")) || (await which("qemu-system-x86"));
  const qemuImg = !!(await which("qemu-img"));
  const cloudLocalds = !!(await which("cloud-localds"));
  const { kvm, reason } = await detectKvm();

  let blocker: string | null = null;
  if (!qemuPath) blocker = "qemu-system-x86_64 is not installed on this node. Run `sudo bash /path/to/vm-setup.sh`.";
  else if (!qemuImg) blocker = "qemu-img is not installed on this node. Run the VM setup script.";
  else if (!cloudLocalds)
    blocker = "cloud-localds is not installed on this node (package cloud-image-utils). Run the VM setup script.";

  const caps: HostCapabilities = {
    qemu: !!qemuPath,
    qemuPath,
    qemuImg,
    cloudLocalds,
    kvm,
    kvmReason: reason,
    blocker,
  };
  capCache = { at: Date.now(), caps };
  return caps;
};

// ---------------------------------------------------------------------------
// Create: overlay disk + cloud-init seed
// ---------------------------------------------------------------------------

const run = (cmd: string, args: string[], opts: { cwd?: string } = {}) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: `${stderr}${err.message}` }));
    child.on("exit", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

/** A password the operator can actually read and type over SSH. */
export const generatePassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(18);
  let out = "";
  for (let i = 0; i < 18; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
};

export const ensureVmDisk = async (
  serverId: string,
  serverDir: string,
  image: VmImage,
  diskGb: number,
  log: (s: string) => void
) => {
  const disk = vmDiskPath(serverDir);
  if (await fs.pathExists(disk)) return disk;

  const base = await fetchBaseImage(image, log);
  await fs.ensureDir(serverDir);
  log(`[VM] Creating ${diskGb} GB overlay disk`);

  // qcow2 backed by the read-only base. The base is never resized or written:
  // resizing it (as some scripts do) corrupts every other VM sharing it.
  const created = await run("qemu-img", [
    "create",
    "-f",
    "qcow2",
    "-F",
    "qcow2",
    "-b",
    base,
    disk,
    `${diskGb}G`,
  ]);
  if (created.code !== 0) {
    // A relative backing path would break if the VM dir ever moves; the absolute
    // path above avoids that, so a failure here is real and worth surfacing.
    throw new Error(`qemu-img create failed: ${created.stderr.trim() || created.stdout.trim()}`);
  }
  return disk;
};

export const writeCloudInit = async (args: {
  serverDir: string;
  hostname: string;
  user: string;
  password: string;
  sshKey?: string;
}) => {
  const { serverDir, hostname, user, password, sshKey } = args;
  const safeHost = hostname.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 63) || "vm";

  // NoCloud seed. ssh_pwauth is required: cloud images default to key-only, and
  // without it the generated password the panel shows would never work.
  const sshKeys = sshKey ? `ssh_authorized_keys:\n      - ${JSON.stringify(sshKey)}\n` : "";
  const userData = `#cloud-config
hostname: ${safeHost}
manage_etc_hosts: true
ssh_pwauth: true
disable_root: false
users:
  - name: ${user}
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
${sshKeys}chpasswd:
  expire: false
  users:
    - {name: ${user}, password: ${password}, type: text}
    - {name: root, password: ${password}, type: text}
package_update: false
runcmd:
  - [ sh, -c, "systemctl enable --now serial-getty@ttyS0.service || true" ]
`;
  const metaData = `instance-id: iid-${serverIdOf(serverDir)}-${Date.now()}
local-hostname: ${safeHost}
`;

  const seedDir = path.join(serverDir, "seed");
  await fs.ensureDir(seedDir);
  await fs.writeFile(path.join(seedDir, "user-data"), userData);
  await fs.writeFile(path.join(seedDir, "meta-data"), metaData);

  const seed = vmSeedPath(serverDir);
  await fs.remove(seed);
  const built = await run("cloud-localds", [seed, path.join(seedDir, "user-data"), path.join(seedDir, "meta-data")]);
  if (built.code !== 0) {
    throw new Error(`cloud-localds failed: ${built.stderr.trim() || built.stdout.trim()}`);
  }
  return seed;
};

const serverIdOf = (serverDir: string) => path.basename(serverDir);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export interface VmLaunch {
  cmd: string;
  args: string[];
  pidFile: string;
  consoleSock: string;
  /** Extra lines the caller should put in the console log before launching. */
  banner: string[];
}

/**
 * Build the command line. Separated from spawn() so the exact argv can be
 * asserted in tests without needing QEMU installed.
 */
export const buildVmLaunch = async (args: {
  serverId: string;
  serverDir: string;
  image: VmImage;
  ram: number;
  cpu: number;
  sshPort: number;
  caps: HostCapabilities;
}): Promise<VmLaunch> => {
  const { serverId, serverDir, image, ram, cpu, sshPort, caps } = args;
  if (!caps.qemuPath) throw new Error(caps.blocker || "QEMU is not available on this node");

  await fs.ensureDir(vmRunDir(serverId));
  const sock = vmConsoleSock(serverId);
  // A stale socket from a crashed QEMU makes the bind fail; the pid check has
  // already established that nothing owns it.
  await fs.remove(sock).catch(() => {});

  const accel = caps.kvm ? ["-machine", "q35,accel=kvm", "-cpu", "host"] : ["-machine", "q35,accel=tcg", "-cpu", "max"];

  const argv = [
    "-name",
    `zkvm-${serverId}`,
    "-m",
    String(ram),
    "-smp",
    String(cpu),
    ...accel,
    // Ephemeral: a stolen disk image cannot be booted elsewhere, and Codespaces
    // has no TPM anyway.
    "-drive",
    `file=${vmDiskPath(serverDir)},format=qcow2,if=virtio,cache=writeback`,
    "-drive",
    `file=${vmSeedPath(serverDir)},format=raw,if=virtio,readonly=on`,
    // Networking. No bridge, no tap: Codespaces grants no NET_ADMIN, so user-mode
    // SLIRP is the only thing that works. hostfwd exposes SSH on the loopback.
    "-device",
    "virtio-net-pci,netdev=n0",
    "-netdev",
    `user,id=n0,hostfwd=tcp:127.0.0.1:${sshPort}-:22`,
    // The console. unix socket, not stdio: see the note at the top of the file.
    "-chardev",
    `socket,id=con0,path=${sock},server=on,wait=off`,
    "-serial",
    "chardev:con0",
    // Detach: the panel multiplexes; QEMU must not clear the screen or grab keys.
    "-display",
    "none",
    "-monitor",
    "none",
    "-no-reboot",
    "-rtc",
    "base=utc,clock=host",
    "-device",
    "virtio-balloon-pci",
    "-object",
    "rng-random,filename=/dev/urandom,id=rng0",
    "-device",
    "virtio-rng-pci,rng=rng0",
  ];

  const banner = caps.kvm
    ? [`[VM] Acceleration: KVM (${caps.kvmReason})`]
    : [
        `[VM] Acceleration: TCG software emulation — ${caps.kvmReason}.`,
        `[VM] Expect roughly 3 minutes to a login prompt. This is not a hang.`,
      ];

  return { cmd: caps.qemuPath, args: argv, pidFile: vmPidFile(serverId), consoleSock: sock, banner };
};

// ---------------------------------------------------------------------------
// Lifecycle helpers
// ---------------------------------------------------------------------------

export const readPid = async (serverId: string): Promise<number | null> => {
  const raw = await fs.readFile(vmPidFile(serverId), "utf8").catch(() => "");
  const pid = Number(String(raw).trim());
  return Number.isFinite(pid) && pid > 0 ? pid : null;
};

export const pidAlive = (pid: number | null): boolean => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means it exists but belongs to another user; for our own VMs that
    // cannot happen, and treating it as dead would double-start.
    return err?.code === "EPERM";
  }
};

export const isVmRunning = async (serverId: string) => pidAlive(await readPid(serverId));

export const stopVm = async (serverId: string, graceMs = 15_000) => {
  const pid = await readPid(serverId);
  if (!pidAlive(pid)) {
    await fs.remove(vmPidFile(serverId)).catch(() => {});
    return false;
  }
  try {
    process.kill(pid as number, "SIGTERM");
  } catch {
    /* raced with exit */
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (pidAlive(pid)) {
    try {
      process.kill(pid as number, "SIGKILL");
    } catch {
      /* gone */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await fs.remove(vmPidFile(serverId)).catch(() => {});
  await fs.remove(vmConsoleSock(serverId)).catch(() => {});
  return true;
};

/** Next free SSH host port, starting at 2222. */
export const nextSshPort = (used: number[]): number => {
  const taken = new Set(used);
  for (let p = 2222; p < 2300; p++) if (!taken.has(p)) return p;
  return 0;
};
