# ZK-MC3 · QEMU Virtual Machines

Real virtual machines on Ubuntu Server cloud images: each guest boots its **own
kernel** under QEMU, with its own disk, memory and network stack.

> **Not a container, not PRoot.** The earlier `Hopingboyz` image was a PRoot
> userspace that shared the host kernel and exited immediately on an unknown
> flag. This replaces it with genuine virtualisation.

---

## Quick start

```bash
sudo bash setup.sh                 # installs everything, no other steps
sudo zkvm create --name dev --ram 2048 --vcpu 2 --disk 20 --series 22.04
sudo zkvm start dev
sudo zkvm console dev              # watch it boot (Ctrl-C to detach)
ssh ubuntu@127.0.0.1 -p 2222       # once booted
```

`setup.sh` installs QEMU, cloud-init tooling, `genisoimage`, network utilities,
detects KVM, downloads the Ubuntu 22.04 image, and installs the `zkvm` command.
It is idempotent — re-running is always safe.

---

## Commands

| Command | Purpose |
|---|---|
| `zkvm create` | Build a VM from a cloud image + cloud-init seed |
| `zkvm start` | Boot it (KVM if usable, otherwise TCG) |
| `zkvm stop` | ACPI power-off, then SIGKILL after 60 s |
| `zkvm restart` | stop + start |
| `zkvm delete --yes` | Remove the VM and its disk |
| `zkvm console` | Stream the serial console |
| `zkvm status [name]` | Table of VMs, or full detail for one |
| `zkvm doctor` | Environment check: KVM, tools, network, disk |
| `zkvm images` | Which Ubuntu series Canonical actually serves |
| `zkvm download <series>` | Fetch and checksum-verify a cloud image |

Create options: `--name --ram --vcpu --disk --series --image --user --password
--ssh-key --hostname --yes`.

---

## Official image URLs

All four LTS series are published by Canonical:

```
20.04  https://cloud-images.ubuntu.com/releases/20.04/release/ubuntu-20.04-server-cloudimg-amd64.img
22.04  https://cloud-images.ubuntu.com/releases/22.04/release/ubuntu-22.04-server-cloudimg-amd64.img
24.04  https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img
26.04  https://cloud-images.ubuntu.com/releases/26.04/release/ubuntu-26.04-server-cloudimg-amd64.img
```

Swap `amd64` for `arm64` on ARM hosts. Checksums:
`https://cloud-images.ubuntu.com/releases/<series>/release/SHA256SUMS` — verified
automatically after each download.

Availability is **probed, not assumed**: `zkvm images` distinguishes
`official image available`, `not published by Canonical`, and
`could not reach cloud-images.ubuntu.com`. It never claims a series is missing
when the real problem is your network.

---

## KVM vs TCG

`zkvm doctor` reports which you have:

- **KVM** (`/dev/kvm` present and openable) — near-native speed.
- **TCG** (software emulation) — everything still works, roughly 10–30× slower.
  Boot takes minutes instead of seconds.

The manager never asks you to choose: it detects and selects automatically.

> GitHub Codespaces does **not** expose nested virtualisation, so `doctor` will
> report TCG there. That is expected, not a misconfiguration.

---

## Networking, honestly

QEMU user-mode (SLIRP) always provides:

- outbound internet from the guest (apt, pip, curl)
- inbound SSH via `hostfwd` on `127.0.0.1:<port>` — `zkvm status` prints it

Bridged/TAP networking is **not offered**: it needs `NET_ADMIN` and a
pre-created bridge, which Codespaces does not grant.

**In a Codespace**, a VM's SSH port is only reachable from inside that
Codespace until you forward it:

> Ports tab → Forward a Port → `2222` → Visibility: Private

Each additional guest service needs its own `hostfwd` and its own forwarded
port. Anything not forwarded is unreachable from outside — this is a Codespace
limitation, not a bug in the manager.

---

## Layout

```
/var/lib/vm-images/          downloaded cloud images (shared by all VMs)
/var/lib/zkvm/vms/<name>/    vm.conf, disk.qcow2, seed.iso, vm.pid, console.log
/var/lib/zkvm/logs/          qemu debug logs
```

Every VM disk is a **qcow2 overlay** on the base image: the download happens
once, and deleting a VM cannot corrupt the base.

## Security

- cloud-init sets a generated password; **change it after first login**
  (`passwd`), or create VMs with `--ssh-key` and no password instead.
- `sudo bash setup.sh --uninstall` removes the command and leaves VM data alone.
