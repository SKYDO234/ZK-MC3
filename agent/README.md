# Installing a node agent

A **node** is a separate machine that runs game servers. The panel talks to it
over a small zero-dependency HTTP agent. This guide covers the whole path, and
the troubleshooting table at the bottom maps every failure message to its cause.

> The agent is only needed for **remote** nodes. The built-in `Local Node` runs
> inside the panel process and needs no setup.

---

## The short version

The panel does almost all of this for you.

1. **Admin → Nodes → Add node**
2. Type a **name**. That is the only required field.
3. Press **Generate token**. The full token appears — **once** — with a copy
   button, next to a single command:

   ```bash
   curl -fsSL https://<your-panel>/install-agent.sh | sudo bash -s -- zkt_xxxxxxxxxxxx
   ```

4. Paste that on the node as root. Done.

The command needs no editing: the installer is served by the panel itself, so it
already knows where to connect. It prints the machine's **real public address**,
installs Node if missing, starts the agent under **systemd** (or PM2, or a plain
process), verifies `/ping` and `/health`, then tells the panel where the node is.

The node turns green in the panel within seconds — no IP, no port, no extra
field.

> Behind NAT, a Docker bridge, or a **GitHub Codespace**, the machine's own
> interfaces advertise addresses the panel cannot reach. The installer detects
> this and reports the address that actually works, including the
> `https://<codespace>-<port>.app.github.dev` form.

### Why the token is only shown once

It is the node's credential. It is stored hashed nowhere — it lives in plain
text in `.data/nodes.json` on the panel and in the agent's systemd unit — so the
panel deliberately does not re-display it in lists. If it is lost, open the node
and press **Rotate token**; the old one stops working and a new command is
generated.

### If the panel is not reachable from the node

The command is built from the browser's origin. When the panel sits behind a
proxy or on `localhost`, open **Panel address used by the installer** in step 3
of the sheet and set the public URL — the command updates instantly.

## Manual install (any distro, no installer)

```bash
# 1. On the node — Node.js 20 or newer
node --version   # must be >= 20

# 2. Copy the agent over (or clone the repo)
git clone --depth 1 https://github.com/SKYDO234/ZK-MC3.git /opt/zk-mc3
cd /opt/zk-mc3

# 3. Run it
ZK_PANEL_TOKEN=<token-from-panel> PORT=6768 node agent/agent.cjs
```

The agent has **no dependencies** — a single `.cjs` file.

> The file is `.cjs` on purpose: the repository's `package.json` sets
> `"type": "module"`, so a plain `.js` file would be parsed as ESM and die with
> `require is not defined`.

### Keep it running — PM2

```bash
pm2 start agent/agent.cjs --name zk-mc3-agent --update-env \
  --time \
  --  # then export the env or use an ecosystem file
```

The reliable way with PM2 is an ecosystem file:

```js
// agent.ecosystem.config.cjs
module.exports = {
  apps: [{
    name: "zk-mc3-agent",
    script: "/opt/zk-mc3/agent/agent.cjs",
    env: { PORT: "6768", ZK_PANEL_TOKEN: "paste-token-here", ZK_AGENT_NAME: "eu-2" },
  }],
};
```

```bash
pm2 start agent.ecosystem.config.cjs
pm2 save
pm2 startup     # follow the printed command so it survives a reboot
```

### Keep it running — systemd

```ini
# /etc/systemd/system/zk-mc3-agent.service
[Unit]
Description=ZK-MC3-PANEL node agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/zk-mc3
Environment=PORT=6768
Environment=ZK_PANEL_TOKEN=paste-token-here
Environment=ZK_AGENT_NAME=eu-2
ExecStart=/usr/bin/node /opt/zk-mc3/agent/agent.cjs
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now zk-mc3-agent
sudo systemctl status zk-mc3-agent
```

---

## Firewall

The panel connects **to** the node, so the node must accept inbound TCP on the
agent port:

```bash
# ufw
sudo ufw allow 6768/tcp

# firewalld
sudo firewall-cmd --permanent --add-port=6768/tcp && sudo firewall-cmd --reload

# nftables / iptables — allow only the panel host
sudo iptables -A INPUT -p tcp -s <PANEL_IP> --dport 6768 -j ACCEPT
```

---

## Verify it works

Run these **on the node**:

```bash
curl -s http://127.0.0.1:6768/ping
# {"pong":true,"at":...,"node":"eu-2","agentVersion":"1.0.0","tokenRequired":true}

curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:6768/health
# {"status":"healthy",...,"system":{...},"java":{...}}
```

Then from the **panel host** (proves the firewall is open):

```bash
curl -s http://<NODE_IP>:6768/ping
```

Finally in the panel: **Nodes → (node) → Test connection**.

---

## Troubleshooting

Every message below is produced by the panel's Test connection, and tells you
which layer failed.

| Panel message | Cause | Fix |
| --- | --- | --- |
| *Nothing is listening on that host and port.* | Agent not running, or the port does not match | `pm2 logs zk-mc3-agent` / `systemctl status zk-mc3-agent`; confirm `AGENT_PORT` equals the panel's port |
| *The connection timed out.* | Firewall or NAT blocks the port | Open TCP `6768` (or your `AGENT_PORT`) inbound on the node |
| *That hostname does not resolve.* | Typo, or the panel cannot see that DNS name | Use the node's public IP |
| *Agent is running, but it rejected this node's token.* | Agent started with a different `ZK_PANEL_TOKEN` | Re-run with the token from the panel, then `pm2 restart zk-mc3-agent` |
| *Agent responded with HTTP 200 and no health payload.* | Something else (often the panel itself) is on that port | Point the panel at a free port and start the agent there |
| *A node already exists at ip:port* | Duplicate registration | Edit the existing node instead of adding another |
| `ReferenceError: require is not defined` | You ran `agent.js` from an older checkout | Use `agent/agent.cjs` |
| `Agent did not start` | Port taken, or no write access to the log directory | Read the printed log path; free the port with `pkill -f agent/agent.cjs` |

### Rotating a token

**Nodes → key icon** on the card, or **Copy install command** in the detail
sheet. Rotating invalidates the old token, so restart the agent with the new one
immediately or the node will drop offline.

---

## Endpoints

| Method | Path      | Auth | Purpose |
| ------ | --------- | ---- | ------- |
| GET    | `/ping`   | no   | Liveness. Lets the panel tell "nothing listening" apart from "wrong token". |
| GET    | `/health` | yes  | CPU, memory, disk, Java, processes |
| GET    | `/config` | yes  | Sanitised configuration |
| GET    | `/`       | yes  | Banner and endpoint index |

Auth is `Authorization: Bearer <ZK_PANEL_TOKEN>`, or `?token=<token>`.
When `ZK_PANEL_TOKEN` is unset the agent accepts everything — only do that on a
private network.
