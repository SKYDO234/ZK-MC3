# ZK-MC3 Local Agent

The agent is a **zero-dependency** Node.js HTTP service that runs on each node
and reports host telemetry back to the panel.

## Start the agent

```bash
PORT=31120 \
ZK_AGENT_NAME="Node EU-1" \
ZK_AGENT_PUBLIC_IP="203.0.113.10" \
ZK_PANEL_TOKEN="$(openssl rand -hex 24)" \
node agent/agent.js
```

Keep it alive with PM2 or systemd:

```bash
pm2 start agent/agent.js --name zk-mc3-agent --update-env
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
ExecStart=/usr/bin/node agent/agent.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

## Endpoints

| Method | Path      | Description                                  |
| ------ | --------- | -------------------------------------------- |
| GET    | `/ping`   | Lightweight liveness probe                    |
| GET    | `/health` | System, Java and process telemetry            |
| GET    | `/config` | Sanitised agent configuration                 |
| GET    | `/`       | Agent banner + endpoint index                 |

All requests must include `Authorization: Bearer <ZK_PANEL_TOKEN>` when a
token is configured.

## Registering the node in the panel

1. Open **Admin → Nodes → Add node**.
2. Enter the public IP/hostname, agent port and hardware capacity.
3. Copy the generated token and start the agent with `ZK_PANEL_TOKEN=<token>`.
4. The node flips to **online** on the next health poll (every ~10 seconds when
   you refresh the node list).
