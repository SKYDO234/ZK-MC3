# zkdaemon — ZK-MC3-PANEL node daemon

Turns a bare VPS, a home machine or a Codespace into a node that runs game
servers for your panel. A separate program, like Wings (Pterodactyl) and
skyportd (Skyport) — except the connection is **outbound**, so you never open a
port, find an IP, or touch a firewall.

```
┌──────────┐   WebSocket (daemon dials out)   ┌────────────┐
│  panel   │ ◄──────────────────────────────── │  zkdaemon  │
└──────────┘      commands, console, stats     └────────────┘
```

---

## Install

1. **Panel → Admin → Nodes → Add node** → name it → **Add node**.
2. Copy the token it shows you (it is shown **once**).
3. On the machine you want to use as a node:

```bash
unzip zkdaemon.zip && cd zkdaemon
sudo bash install.sh <token> <panel-url>
```

That is the whole setup. The node turns green in the panel within a few seconds.

`install.sh` writes `config.json`, installs a **systemd** service so it survives
reboots, and starts it. No npm, no build tools, no internet on the node — every
dependency is already inside the zip.

### Without the installer

```bash
unzip zkdaemon.zip && cd zkdaemon
node . --token <token> --panel https://your-panel
```

Or edit `config.json` by hand and run `node .`:

```json
{
  "panelUrl": "https://panel.example.com",
  "token": "zkn_xxxxxxxxxxxx",
  "nodeName": ""
}
```

`nodeName` is optional; the hostname is used when it is empty.

### Requirements

| | |
| --- | --- |
| Node.js | **20 or newer** (`node --version`) |
| Java | Only if you host Minecraft servers — `java -version` |
| Network | **Outbound** HTTPS/WSS to the panel. No inbound port. |

---

## What the daemon does

- **Connects out** to the panel over Socket.IO (`/daemon` namespace) and keeps
  the socket open. Reconnects automatically with backoff after a network blip,
  a panel restart or a reboot.
- **Reports telemetry** — hostname, CPU model and cores, memory, disk, load,
  Java version, and the public address players should connect to.
- **Runs servers** the panel asks it to: it spawns the process, streams stdout
  and stderr back as console output, accepts console commands, and reports exit
  codes. Files arrive over the same socket, in chunks.
- **Survives its own restart**: servers are left running when the daemon stops,
  so a daemon update does not kill a live world. The panel re-attaches when the
  daemon comes back.

Servers live in `data/servers/<serverId>/`, with a `console.log` beside them.

### The address problem, solved

Behind NAT, Docker, CGNAT or a Codespace, the machine's own interfaces report
`10.x` or `127.0.0.1`, which no player can reach. On connect the daemon asks an
external echo service what the world sees and reports **that** address:

```
Address 203.0.113.10 (public-ip) · 8 cores · 32768 MB
```

Force a value with `ZK_PUBLIC_HOST`:

```bash
ZK_PUBLIC_HOST=play.example.com node .
```

---

## Managing it

```bash
systemctl status zkdaemon
systemctl restart zkdaemon
journalctl -u zkdaemon -f
```

Change the token (after rotating it in the panel):

```bash
cd /path/to/zkdaemon
sudo bash install.sh <new-token> <panel-url>
```

---

## Running the panel in a GitHub Codespace

A Codespace only forwards a port to the internet when that port is **public**.
Private ports refuse or redirect external connections, which is what the daemon
reports as:

```
✖ Cannot reach the panel.
  The connection was reset before the panel answered (ECONNRESET).
     On a Codespace this almost always means the port is PRIVATE.
     Fix: Ports tab → port 31120 → right-click → Port Visibility → Public.
```

To fix it:

1. In the Codespace, open the **Ports** tab (next to Terminal).
2. Find the row for the panel's port (`31120`).
3. Right-click it → **Port Visibility** → **Public**.
4. The URL it shows becomes `https://<codespace>-31120.app.github.dev` — use
   **exactly** that as `<panel-url>`.

Notes that save time:

- Making the port public is required **even for a node on the same Codespace**,
  because the daemon still goes out through the tunnel.
- The URL changes if the Codespace is rebuilt; re-run the installer with the new
  one.
- A public port means anyone with the URL reaches the panel, so change the
  default `admin` password immediately.
- The daemon retries every 15 s, so you do **not** need to restart it after
  fixing the visibility — watch for `The panel is reachable again — reconnecting…`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `This daemon is not configured yet` | `config.json` is empty | Run with `--token` and `--panel`, or edit `config.json` |
| `the panel rejected this token` | Token rotated, or copied wrong | Rotate in the panel and re-run the installer with the new token |
| Panel shows the node offline, daemon says connected | Panel restarted and hasn't finished booting | Wait a few seconds; it reconnects by itself |
| `ECONNRESET` / `connection was reset` | On a Codespace: port is private. Elsewhere: wrong port or a proxy | Make the port Public (see above) |
| `Nothing is listening on …` | Wrong port, or panel not running | `curl <panelUrl>/api/health` on the node |
| `"…" does not resolve` | Typo in the hostname | Copy the URL from the panel again |
| `The panel answered 404` | Reachable, but not a ZK-MC3 panel | Check the address and port |
| Server starts then dies instantly | Missing Java, bad jar, port in use | Read the server's console in the panel |
| Node shows a LAN address like `10.0.0.5` | No public IP detected | Set `ZK_PUBLIC_HOST` to your public IP or DNS name |

---

## Licence

MIT · A product of ZK-STUDIO.
