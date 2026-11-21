# Adding a node on a new machine

A worked example. Every command below was run against a live panel before being
written down. Total time: about two minutes.

**What "a node" means here:** a separate machine that runs game servers for
your panel. The panel never connects *to* it — a small daemon on that machine
dials **out** to the panel over WebSocket and holds the connection open. That is
why there is no port to open, no firewall rule, and no IP to look up.

---

## Before you start

On the **new machine** (the node), you need:

| Requirement | Check with | Notes |
| --- | --- | --- |
| Node.js **20 or newer** | `node --version` | Everything else is bundled |
| `unzip` | `which unzip` | `apt install unzip` if missing |
| `curl` or `wget` | `which curl` | To fetch the daemon |
| **Java** (only for Minecraft) | `java -version` | The panel reports it, it does not install it |
| Outbound internet | — | To reach your panel. **No inbound port needed.** |

If Node.js is missing:

```bash
# Debian / Ubuntu
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs unzip

# Fedora / RHEL
sudo dnf install -y nodejs unzip
```

---

## Step 1 — Open Nodes in the panel

Sign in as an admin and go to **Admin → Nodes**.

You will see the built-in **Local Node**, which runs servers inside the panel
process itself and needs no daemon.

> The built-in **Local Node** is always listed. Your new node appears next to it.

## Step 2 — Add the node

Click **Add node**. Fill in:

| Field | What to put |
| --- | --- |
| **Node name** | Anything memorable — `EU-2`, `VPS-Frankfurt`, `home-box` |
| **Location** | Optional, e.g. `Frankfurt, DE` |

That is the whole form. There is no IP field, no port field, no protocol
dropdown — the daemon reports those about itself when it connects.

Click **Add node**.

## Step 3 — Copy the token

The panel now shows a screen with three things:

1. The **token**, e.g. `zkn_mwpvffitz194r5`, with a **Copy** button
2. A **Download zkdaemon.zip** button
3. The one command to run

> **The token is shown once.** Close this without copying it and you must
> rotate it from the node card. It is the node's credential; the panel does not
> re-display it.

## Step 4 — Put the daemon on the new machine

Two ways. Pick one.

### Option A — the machine can reach the panel (recommended)

You may not be able to download from the panel in a browser and then move the
file to a headless VPS. Fetch it **on the node** instead:

```bash
wget -O zkdaemon.zip http://YOUR-PANEL:31120/downloads/zkdaemon.zip
```

Use the exact same base URL the panel showed you. If your panel has a domain,
`https://panel.example.com/downloads/zkdaemon.zip` works too.

### Option B — download it and copy it over

Click **Download zkdaemon.zip** in the panel, then move it with `scp`:

```bash
scp zkdaemon.zip root@YOUR-NODE-IP:/root/
```

## Step 5 — Unzip

```bash
unzip zkdaemon.zip
cd zkdaemon
ls
```

You should see:

```
README.md  config.json  index.js  install.sh  node_modules  package.json  start.sh
```

`node_modules` is already populated — **do not run `npm install`**. The archive
carries all 13 packages it needs, which is why it works on a machine with no
build tools and no npm registry access.

## Step 6 — Install it

```bash
sudo bash install.sh <token> <panel-url>
```

Using the values from Step 3:

```bash
sudo bash install.sh zkn_mwpvffitz194r5 http://203.0.113.5:31120
```

**`<panel-url>` is the important one.** It must be an address the node can
actually reach:

| Situation | Use |
| --- | --- |
| Panel on a domain | `https://panel.example.com` |
| Panel on a VPS IP | `http://203.0.113.5:31120` |
| Node and panel on the same LAN | `http://192.168.1.50:31120` |
| Panel is on `localhost` on **another** machine | ✗ this will not work — use the panel's real address |

> **Never use `127.0.0.1`** unless the daemon runs on the *same* machine as the
> panel. On a separate machine `127.0.0.1` means *itself*, and the panel is not
> there. This is the single most common mistake.

Expected output:

```
▸ Writing configuration
▸ Starting the daemon
✔ Daemon running — check the panel, the node is online
  journalctl -u zkdaemon -f   to watch it
```

What it did:

- wrote `config.json` with your token and panel URL (mode `0600`)
- installed `/etc/systemd/system/zkdaemon.service` so it starts on boot
- started it and confirmed it is active

On a machine **without systemd** (containers, some Codespaces) it falls back to
a background process and prints its log instead.

## Step 7 — Watch it appear

Go back to **Admin → Nodes**. Within a few seconds the card goes from *offline*
to **online**, and fills itself in from what the daemon reports:

- hostname and the address players would use
- CPU model and core count
- memory and disk
- Java version, if installed

No refresh, no "test connection" button. Nothing else to configure.

## Step 8 — Use it

Create a server with **Admin → Create server** and pick your new node in the
**Node** dropdown. The panel resolves and streams the server files to the node,
then tells the daemon what to spawn. Start/stop/restart and the console all run
on that node, and console output is stored in the panel so it survives a reload.

Existing servers can be pointed at the node by editing them.

---

## Verifying it by hand

On the node:

```bash
systemctl status zkdaemon          # active (running)
journalctl -u zkdaemon -f          # live log
```

The log tells you exactly what it did:

```
⚡ ZK-MC3-PANEL · node daemon
v1.0.0 · vps-frankfurt · node v22.22.3

▸ Connecting
  › Panel http://203.0.113.5:31120
  ✔ Connected over WebSocket — node is online
  Address 203.0.113.10 (public-ip) · 8 cores · 32768 MB
```

In the panel, open the node's **Details** and press **Ping** — it reports the
round-trip to the daemon (usually 1–50 ms).

---

## If it does not work

| What you see | What it means | Fix |
| --- | --- | --- |
| `This daemon is not configured yet` | `config.json` is empty | Use `sudo bash install.sh <token> <panel-url>` |
| `Cannot reach the panel` | Wrong `panel-url`, or the panel is down | `curl <panel-url>/api/health` **on the node** must return 200 |
| `the panel rejected this token` | Token was rotated, or a typo | Rotate in the panel, re-run the installer with the new token |
| Node stays offline; log says connected | Panel restarted and is still booting | Wait a few seconds; it reconnects by itself |
| `Node.js v18 is too old` | Node 20+ required | Install Node 20 (see *Before you start*) |
| Node shows a `10.x` address | No public IP detected (NAT) | Set `ZK_PUBLIC_HOST` (below) |
| Java shows "not installed" | No JDK on the node | `apt install openjdk-21-jre-headless` |

### Setting the public address by hand

Behind NAT the machine's own interfaces are useless to players. The daemon
usually detects the right address itself, but you can be explicit:

```bash
sudo systemctl edit zkdaemon
```

Add:

```ini
[Service]
Environment=ZK_PUBLIC_HOST=play.example.com
```

```bash
sudo systemctl daemon-reload && sudo systemctl restart zkdaemon
```

---

## Day-to-day

```bash
systemctl restart zkdaemon     # restart the daemon
systemctl stop zkdaemon        # stop it (running servers keep running)
journalctl -u zkdaemon -f      # watch
```

Restarting the daemon does **not** kill servers — it re-announces the ones still
running when it reconnects, so a daemon update costs no downtime.

### Rotating the token

Node card → **Remove** is destructive; **Rotate token** is what you want when a
token leaks. It invalidates the old one immediately and gives you a new install
command. The daemon stays offline until you re-run:

```bash
sudo bash install.sh <new-token> <panel-url>
```

### Removing the node

Delete or move its servers first (the panel refuses while any are assigned), then
**Remove** on the card. On the machine:

```bash
sudo systemctl disable --now zkdaemon
sudo rm /etc/systemd/system/zkdaemon.service
sudo rm -rf /path/to/zkdaemon
```

---

## Doing it without the installer

If you would rather not use `install.sh`:

```bash
cd zkdaemon
node . --token zkn_mwpvffitz194r5 --panel http://203.0.113.5:31120
```

That writes `config.json` and starts in the foreground. Afterwards you can just
run `node .` and it reuses the config. `start.sh` does the same thing.

Keep it alive with your own supervisor, or a hand-written unit:

```ini
[Unit]
Description=ZK-MC3-PANEL node daemon
After=network-online.target

[Service]
WorkingDirectory=/opt/zkdaemon
ExecStart=/usr/bin/node /opt/zkdaemon/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
