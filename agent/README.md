# ZK-MC3 Local Agent

The agent is a **zero-dependency** Node.js HTTP service that runs on each node
and reports host telemetry back to the panel.

## Start the agent

```bash
PORT=31120 \
ZK_AGENT_NAME="Node EU-1" \
ZK_AGENT_PUBLIC_IP="203.0.113.10" \
ZK_PANEL_TOKEN="$(openssl rand -hex 24)" \
node agent/agent.cjs
```

Keep it alive with PM2 or systemd:

```bash
pm2 start agent/agent.cjs --name zk-mc3-agent --update-env
pm2 save
```

### systemd unit

```ini
[Unit]
Description=ZK-MC3-PANEL Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/zk-mc3
Environment=PORT=31120
Environment=ZK_PANEL_TOKEN=replace-me
ExecStart=/usr/bin/node agent/agent.cjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

## Endpoints

| Method | Path      | Description                                  |
| ------ | --------- | -------------------------------------------- |
| GET    | `/ping`   | Liveness probe — **never** requires a token   |
| GET    | `/health` | System, Java and process telemetry            |
| GET    | `/config` | Sanitised agent configuration                 |
| GET    | `/`       | Agent banner + endpoint index                 |

All requests except `/ping` must include
`Authorization: Bearer <ZK_PANEL_TOKEN>` when a token is configured. The
unauthenticated `/ping` exists so the panel can tell "nothing is listening"
apart from "agent is up but the token is wrong" when you test a node.

## Registering the node in the panel

1. Open **Admin → Nodes → Add node**.
2. Enter a name, the public IP/hostname and the agent port, then press
   **Test connection** — the panel reports one specific reason if it fails
   (nothing listening, DNS failure, firewall timeout, or wrong token).
3. Press **Add node**. The modal shows the exact install command with this
   node's real token, already copied to your clipboard.
4. Run it on the node. The card flips to **online** within one refresh; the
   panel then adopts the machine's real hostname, CPU core count and total
   RAM, so you never have to type capacity by hand.

Rotate the token at any time from the node card (**key icon**) — the running
agent must be restarted with the new value.

> Note: the agent is CommonJS (`.cjs`) because the panel's `package.json` sets
> `"type": "module"`. Always launch `agent/agent.cjs`, not `agent.js`.
