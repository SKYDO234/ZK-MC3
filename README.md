<div align="center">

<img src="public/logo.png" alt="ZK-MC3-PANEL" width="420" />

<br />

# ZK-MC3-PANEL

### The modern Minecraft server hosting control panel

<p>
  <img alt="version" src="https://img.shields.io/badge/version-1.0.0-ff7a18?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-ff7a18?style=flat-square" />
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A518%20%C2%B7%20tested%2022-ff7a18?style=flat-square" />
  <img alt="react" src="https://img.shields.io/badge/react-18-ff7a18?style=flat-square" />
  <img alt="typescript" src="https://img.shields.io/badge/typescript-5.7-ff7a18?style=flat-square" />
</p>

<p>
  <b>A product of <a href="#about-zk-studio">ZK-STUDIO</a></b><br />
  CEO &nbsp;<b>MD Ziyan Hossain</b>
</p>

<p>
  <a href="#-quick-install">Quick install</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-screens">Screens</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-api">API</a> ·
  <a href="#-faq">FAQ</a>
</p>

</div>

---

## ✨ What is ZK-MC3-PANEL?

ZK-MC3-PANEL is a **complete, production-ready game server hosting panel** built for
Minecraft. It ships with a stunning dark interface, real process-level server control,
a full file manager, backups, plugin/mod installs, live console streaming and a
powerful administration suite — all in one deployable Node.js application.

No external daemons required. No paid licence. Deploy a server in **under 60 seconds**.

<div align="center">
  <img src="public/logo-full.png" alt="ZK-MC3-PANEL wordmark" width="640" />
</div>

---

## 🚀 Quick install

One command on a fresh Ubuntu / Debian / Rocky / AlmaLinux / Arch VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/SKYDO234/ZK-MC3/main/install.sh -o install.sh
sudo bash install.sh
```

The interactive menu can **install**, **update**, **create admins**, **restart**,
**install the node agent**, check **status** and **uninstall**.

Non-interactive actions:

```bash
sudo bash install.sh install      # full install
sudo bash install.sh update       # pull + rebuild + restart
sudo bash install.sh agent        # install the node agent
sudo bash install.sh createuser   # create/reset an administrator
sudo bash install.sh restart
sudo bash install.sh status
```

After installation the panel listens on **http://your-server-ip:31120**.

> **Default login** — username `admin`, password `admin`.
>
> Because that credential is public, a fresh install **forces a password change on
> first sign-in**: the panel routes you to *Secure your panel* and will not load any
> other screen until the default has been replaced. Set `OWNER_PASSWORD` in `.env`
> before the first boot to skip the prompt entirely.

### Manual install (development)

```bash
git clone https://github.com/SKYDO234/ZK-MC3.git
cd ZK-MC3
cp .env.example .env          # set JWT_SECRET
npm install
npm run dev                   # http://localhost:31120 (Vite + API)
```

Production build:

```bash
npm run build                 # vite build + bundled server -> dist/
npm start                     # serves dist/ + API on PORT (default 31120)
```

### Docker

```bash
cp .env.example .env          # set JWT_SECRET and OWNER_PASSWORD
docker compose up -d --build
docker compose logs -f panel
```

The image bundles OpenJDK 21 so Minecraft servers run out of the box. Panel state
lives in the `zk-mc3-data` volume (`/app/.data`), and the compose file publishes
the Minecraft port range for the built-in allocator.

### Managing an installation

| Command | What it does |
| --- | --- |
| `sudo bash install.sh` | Interactive menu (install / update / agent / create admin / restart / status / uninstall) |
| `sudo bash install.sh update` | Pull, rebuild and restart in one step |
| `bash update.sh` | Same as above, with a health check afterwards |
| `bash uninstall.sh` | Stop and remove the service (keeps `.data/`) |
| `bash uninstall.sh --purge-data` | Also delete server files, backups and the database |

### Verifying a deployment

```bash
npm run typecheck             # TypeScript, zero errors expected
npm run build                 # production bundle
npm run qa:render             # renders every route in jsdom, fails on runtime errors
```

`qa:render` boots the real React bundle against a running panel and asserts that
all 14 routes mount without console errors. Set `QA_TOKEN` to a JWT to exercise
the authenticated pages, e.g.

```bash
QA_TOKEN="$TOKEN" npm run qa:render
```

---

## 🖥 Screens

| Area | Pages |
| --- | --- |
| **Authentication** | Login · Register · Forgot password |
| **User panel** | Dashboard · My Servers · Server detail (Console, Files, Plugins, Backups, Settings) · API Keys · Account |
| **Admin panel** | Admin Overview · Create Server · All Servers · Nodes · User Management · API Keys · Panel Settings · System (platform console, maintenance) |

Every page is responsive, keyboard-friendly and animated with subtle, GPU-friendly
transitions. The whole interface uses a single, consistent design system
(`src/components/ui.tsx`, `src/index.css`).

---

## 🧩 Features

### Server management
- **Real process runtime** — each server runs as an isolated child process with its
  own working directory, port and memory limit (`-Xms/-Xmx`).
- **One-click install** of Paper, Purpur, Vanilla, Spigot, Fabric, Velocity,
  BungeeCord, Waterfall, plus Node.js and Python app runtimes.
- **Live console** over WebSocket — line-numbered terminal, output filtering,
  copy/download, command history (`↑`/`↓`), `Ctrl`+`L` to clear and sticky
  auto-scroll that pauses when you scroll up.
- **Power controls** — start, stop (graceful `stop`/`end`), restart, force kill,
  all reachable from the console header.
- **Live metrics** — CPU %, RSS memory, disk, uptime, **inbound/outbound
  throughput** (read from the kernel's per-socket counters) and sparkline charts.
- **Port guard** — a start that finds its port held by a stale process reclaims
  the socket instead of failing with `EADDRINUSE`.
- **Emulated console without a JDK** — on a node with no Java the panel runs a
  simulated Paper boot/stop sequence and answers console commands, binding the
  real game port, so the panel is fully usable before you install OpenJDK.
- **Auto-restart** on unexpected crashes.
- **Reinstall** rebuilds the jar without touching worlds or configuration.

### File manager
- Browse, create files/folders, rename, delete, upload (multi-file), download.
- Inline code editor for `.properties`, `.yml`, `.json`, `.js`, `.py` and more.
- Zip / unzip archives directly on the node.
- Path-traversal protected — every request is confined to the server directory.

### Backups
- One-click ZIP snapshots of the whole server directory.
- Download, restore and delete backups, with a size/timestamp history.
- Backup writes are streamed to disk — no memory spikes on large worlds.

### Plugins & mods
- Browse **Modrinth** from inside the panel — searches and downloads are proxied
  through the server, so a restricted browser network still works.
- Filters results to builds matching the server software **and** exact version.
- Installs jars straight into `/plugins` or `/mods`.
- Fails with a clear message when Modrinth is unreachable — it never substitutes
  an invented catalog.

### Playit.gg tunnels
- Optional per-server **Tunnel** tab that exposes a server's port to the internet
  with no port forwarding and no router changes.
- The panel downloads the official playit agent, supervises it as a real child
  process, and streams its output live.
- First run prints a **claim link**; open it once to bind the agent to your
  playit.gg account and the tunnel survives restarts.
- Start / stop / restart / reset-identity, with the agent's PID and live log on
  screen. Deleting a server tears its agent down and removes its files.
- Off by default; enable it in **Panel Settings → Features → Playit.gg tunnels**.

### Users & access control
- Four-tier roles: **owner**, **admin**, **user** and per-server access checks.
- Registration with password-strength enforcement, login throttling and
  session invalidation on password change.
- Active-session viewer with per-device revoke.
- Suspend/reactivate accounts, reset passwords, adjust balances.
- Broadcast announcements to every user or just admins.

### API keys
- SHA-256 hashed keys (`zk_…`) displayed **once** at creation.
- 14 granular scopes (`servers.read`, `files.write`, `nodes.write`, `*`, …).
- Expiry windows, revoke, delete, last-used tracking.
- Works for both JWT users and API keys through the same middleware.

### Nodes

A node is a separate machine that runs servers for the panel. Add one in
**Admin → Nodes**, download `zkdaemon.zip`, and run one command on the machine:

```bash
unzip zkdaemon.zip && cd zkdaemon
sudo bash install.sh <token> <panel-url>
```

The daemon dials **out** over WebSocket, so there is no inbound port, no
firewall rule and no IP to look up. It reports the machine's real telemetry and
public address, runs the servers the panel gives it, and reconnects by itself
after a reboot or a network drop. Everything ships inside the zip — no npm, no
build step on the node.

See [`daemon/README.md`](daemon/README.md) for the full guide.

### Nodes, in detail
- Built-in local node reports real CPU/RAM/disk telemetry from this process.
- The daemon is a **separate program** (`daemon/`, packaged as
  `dist/downloads/zkdaemon.zip`) — the panel repo contains it, but nodes never
  clone the panel.
- Registration asks for a **name only**. The token is shown **once**, with a
  copy button; the daemon reports its hostname, CPU model, cores, memory, disk,
  Java version and public address on connect.
- Servers assigned to a node are provisioned and launched **by the daemon**:
  the panel resolves the jar, streams it over the socket in chunks, then tells
  the daemon what to spawn. Console output streams back and is stored in the
  panel, so it survives a reload.
- Status follows the live socket, not a stored flag: kill the daemon and the
  node reads offline immediately; restart it and it re-attaches by itself.

### Panel settings
Eight organised tabs — **Branding, Authentication, Email/SMTP, API, Notifications,
Resource Limits, Billing, System** — covering logo upload, colour theming, session
policy, SMTP, rate limits, per-server quotas, pricing model, maintenance mode and
JSON data export.

### Themes & Fonts (`/admin/themes`)
The whole panel is themeable at runtime — one save restyles every account.

- **Eight UI presets** (Solid, Frosted, Glass, Minimal, Cyberpunk, Neumorphic,
  Neon, Terminal) plus per-surface controls for sidebar, cards, top bar, corner
  radius, sidebar width, border glow, glass blur, font scale, animation speed and
  motion. Everything previews live before you commit.
- **Accent colour** — twelve gradient swatches plus primary/secondary pickers;
  the choice re-colours Tailwind's brand scale through CSS variables.
- **Fonts** — pick from sixteen families (with gaming faces such as Oxanium,
  Orbitron and Rajdhani), loaded on demand from Google Fonts.
- **Background** — upload an image or a looping video (≤200 MB, progress bar),
  paste a direct URL, choose a built-in gradient, or remove it. A wallpaper
  layer sits behind translucent glass surfaces; solid presets hide it.
- Every value is stored in panel settings and served from `/api/settings`, so a
  new client paints the chosen theme on first render.

### Server console
A three-column workspace: the server rail (status card, power actions, menu),
telemetry gauges for CPU / memory / storage with sparklines, a live player
roster read from the server's own join/leave log lines, and a **System console**
window with a stream id, live clock, quick-command chips and an
`admin@node:~$` prompt.

### Platform
- JSON datastore with **atomic, serialised writes** (no corruption under load).
- Socket.IO for live logs, status changes and system stats.
- Audit trail of every significant action with actor + IP.
- Installer bootstraps an owner, generates a random `JWT_SECRET`, installs Java,
  PM2, configures firewall rules and prints the panel URL.

---

## 🏗 Architecture

```
ZK-MC3/
├── server.ts                  Express + Socket.IO + Vite middleware entry
├── install.sh                 Installer & service manager
├── daemon/                     Standalone node daemon (packaged as zkdaemon.zip)
│   ├── index.js                WebSocket client, server supervisor
│   └── install.sh              Generated by scripts/build-daemon.mjs
├── src/
│   ├── components/            Design system, layout, sidebar, topbar
│   ├── context/               Auth, Settings, Toast providers
│   ├── lib/                   API client, formatters, hooks, realtime
│   ├── pages/
│   │   ├── auth/              Login, Register, Forgot password
│   │   ├── user/              Dashboard, Servers, ServerView, API keys, Account
│   │   └── admin/             Overview, CreateServer, Servers, Nodes, Users, API, Settings
│   └── server/
│       ├── middleware/        JWT + API-key auth guards
│       ├── routes/            auth · users · servers · nodes · apikeys · admin · system
│       └── services/          db · runtime · software · backups · settings · stats · nodes …
├── public/                    Logo + static assets
├── scripts/createuser.ts      CLI admin creation
└── .data/                     JSON database + server files (git-ignored)
```

**Runtime model.** The panel spawns each game server as a detached child process with
its own `cwd`, environment and port. Output is piped to both a rolling log file and a
Socket.IO room (`server:<id>`), so any number of browser tabs can watch live without
extra load. CPU and memory are read from `/proc/<pid>` — no agents or cgroups needed.

**Data model.** Everything lives in `.data/*.json` (`users`, `servers`, `nodes`,
`api_keys`, `sessions`, `activities`, `notifications`, `settings`). Writes are queued
per-file and committed atomically via `rename(2)`.

---

## 🔌 API

Authenticate with `Authorization: Bearer <jwt-or-api-key>`.

```http
GET    /api/health                     Public health probe
GET    /api/settings                   Public branding/settings

POST   /api/auth/login                 { login, password, remember }
POST   /api/auth/register              { name, username, email, password }
GET    /api/auth/me
PATCH  /api/auth/profile
PATCH  /api/auth/password
GET    /api/auth/sessions

GET    /api/servers                    List visible servers
POST   /api/servers                    Create (admin / self-service)
GET    /api/servers/:id                Detail + live stats
GET    /api/servers/:id/stats          CPU / RAM / disk / uptime
POST   /api/servers/:id/start|stop|restart|kill
POST   /api/servers/:id/command        Send console command
GET    /api/servers/:id/files?path=     File manager listing
POST   /api/servers/:id/files/save      Save file contents
POST   /api/servers/:id/backups         Create backup
POST   /api/servers/:id/plugins/install  Install plugin/mod

GET    /api/servers/:id/plugins/catalog   Plugin/mod search (proxied)
GET    /api/servers/:id/plugins/versions  Compatible builds for a project

GET    /api/nodes                      Node inventory (admin)
POST   /api/nodes                      Register node (admin)
GET    /api/admin/dashboard            Platform metrics (admin)
GET    /api/admin/health               Host + software inventory (admin)
PUT    /api/admin/settings             Update settings (admin)
GET    /api/admin/system/logs          Captured panel output (admin)
POST   /api/admin/system/action        backup-all|stop-all|clear-cache|
                                       clear-logs|restart-panel (admin)
GET    /api/admin/export               JSON snapshot (admin)
POST   /api/admin/settings/wallpaper/upload   Upload panel background (admin)
DELETE /api/admin/settings/wallpaper          Remove panel background (admin)
```

---

## ⚙️ Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `31120` | HTTP port |
| `NODE_ENV` | `production` | Set to `development` for Vite HMR |
| `JWT_SECRET` | generated | Session signing secret — **set this** |
| `OWNER_USERNAME` | `admin` | First-run owner username |
| `OWNER_PASSWORD` | `admin` | First-run owner password (change after signing in) |
| `OWNER_EMAIL` | `owner@zk-mc3.local` | First-run owner email |
| `JAVA_BIN` | auto-detected | Explicit path to a `java` binary |

A fresh install contains exactly one account (the owner above) and no servers — the
panel never seeds sample data.

---

## 🧪 Testing the runtime

```bash
# 1. Create a Node.js app server (no Java needed)
curl -X POST http://localhost:31120/api/servers \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"My App","software":"NODEJS","version":"22","ram":512,"port":26001}'

# 2. Start it
curl -X POST http://localhost:31120/api/servers/<id>/start -H "Authorization: Bearer $TOKEN"

# 3. Confirm it is live
curl http://localhost:26001
```

Minecraft software additionally needs a JDK on the host
(`sudo apt install openjdk-21-jre-headless`). The installer attempts this automatically
and the panel surfaces a clear warning if Java is missing.

---

## 🖼 Screenshots

<div align="center">
  <img src="public/logo.png" width="160" alt="logo" />
  <br />
  <sub>Add your own screenshots to <code>docs/screenshots/</code> and link them here.</sub>
</div>

---

## ❓ FAQ

**Does it need Docker?**
No. Servers run as native child processes. Docker is optional and not required.

**Can I host multiple Minecraft versions side by side?**
Yes — each server has its own directory, jar, port and Java arguments.

**Where are backups stored?**
`.data/backups/<server-id>/*.zip`, downloadable from the panel.

**How do I reset the admin password?**
`sudo bash install.sh createuser` — enter the username and a new password.

**How do I move to another machine?**
Copy the project folder (including `.data/` and `backups/`), run `bash install.sh`,
and every user, server and backup is preserved.

---

## 📄 License

Released under the **MIT License**.
© ZK-STUDIO — CEO **MD Ziyan Hossain**.

<div align="center">
<br />
<b>ZK-MC3-PANEL</b> · built with care by <b>ZK-STUDIO</b><br />
<sub>Minecraft is a trademark of Mojang Synergies AB. ZK-STUDIO is not affiliated with Mojang or Microsoft.</sub>
</div>
