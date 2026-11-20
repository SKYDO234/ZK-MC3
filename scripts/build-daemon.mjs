/**
 * Builds dist/downloads/zkdaemon.zip from ./daemon.
 *
 * The daemon is a separate program that an operator downloads and runs on a
 * node machine, so it has to ship as an archive rather than as part of the
 * panel bundle. Two things are baked in:
 *
 *   · node_modules are installed at build time and included, so `node .` works
 *     on a machine with no npm, no build tools and no internet
 *   · install.sh / start.sh are generated here, because their exact contents
 *     depend on how the panel is being served
 *
 *   npm run build:daemon
 */
import fs from "fs-extra";
import path from "path";
import { execFileSync } from "child_process";
import archiver from "archiver";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(ROOT, "..");
const SRC = path.join(REPO, "daemon");
const STAGE = path.join(REPO, "dist", "daemon-build");
const OUT_DIR = path.join(REPO, "dist", "downloads");
const OUT = path.join(OUT_DIR, "zkdaemon.zip");

const log = (m) => console.log("  " + m);

const main = async () => {
  if (!(await fs.pathExists(path.join(SRC, "index.js")))) {
    throw new Error("daemon/index.js is missing");
  }

  console.log("\n▸ Building node daemon package\n");

  await fs.remove(STAGE);
  await fs.ensureDir(STAGE);
  await fs.ensureDir(OUT_DIR);

  // ── sources ────────────────────────────────────────────────────────────
  for (const file of ["index.js", "package.json", "config.example.json", "README.md"]) {
    const from = path.join(SRC, file);
    if (await fs.pathExists(from)) await fs.copy(from, path.join(STAGE, file));
  }
  // config.json ships empty: the installer writes the real one, and a
  // half-filled copy in the archive would be stale the moment it is opened.
  await fs.writeFile(path.join(STAGE, "config.json"), JSON.stringify({ panelUrl: "", token: "", nodeName: "" }, null, 2) + "\n");
  log("copied daemon sources");

  // ── dependencies ───────────────────────────────────────────────────────
  // Installed here (rather than on the node) so `node .` runs on a machine
  // with no npm and no package-registry access. The whole tree is resolved,
  // not just the direct deps: fs-extra needs universalify, socket.io-client
  // needs a dozen packages, and a missing transitive import is a crash on a
  // machine the operator may not have shell access to.
  const pkg = JSON.parse(await fs.readFile(path.join(SRC, "package.json"), "utf8"));
  const deps = Object.keys(pkg.dependencies || {});

  const seen = new Set();
  const queue = [...deps];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const manifest = path.join(REPO, "node_modules", name, "package.json");
    if (!(await fs.pathExists(manifest))) {
      log(`! ${name} is not installed in the panel's node_modules — run npm install`);
      continue;
    }
    const meta = JSON.parse(await fs.readFile(manifest, "utf8"));
    queue.push(...Object.keys(meta.dependencies || {}));
    queue.push(...Object.keys(meta.optionalDependencies || {}).filter((d) => d !== "bufferutil" && d !== "utf-8-validate"));
  }

  let installed = 0;
  for (const name of seen) {
    const source = path.join(REPO, "node_modules", name);
    if (!(await fs.pathExists(source))) continue;
    const target = path.join(STAGE, "node_modules", name);
    await fs.ensureDir(path.dirname(target));
    await fs.copy(source, target, { dereference: true });
    installed += 1;
  }
  log(`bundled ${installed} packages (${deps.length} direct, ${installed - deps.length} transitive)`);

  // ── launcher scripts ───────────────────────────────────────────────────
  await fs.writeFile(
    path.join(STAGE, "install.sh"),
    `#!/usr/bin/env bash
# ZK-MC3-PANEL · node daemon installer
#
#   sudo bash install.sh <token> [panel-url]
#
# Runs the daemon as a systemd service so it survives a reboot and reconnects
# by itself. Everything it needs is already in this folder.
set -uo pipefail
cd "$(dirname "$0")"

TOKEN="\${1:-}"
PANEL="\${2:-}"
PORT=""  # unused; the daemon dials out, so it listens on nothing

if [ -z "$TOKEN" ]; then
  echo "Usage: sudo bash install.sh <token> [panel-url]" >&2
  echo "Copy the token from the panel: Admin → Nodes → Add node." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (v20+). Install it, then re-run:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs" >&2
  exit 1
fi

MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 20 ]; then
  echo "Node.js v$MAJOR is too old — the daemon needs v20 or newer." >&2
  exit 1
fi

echo "▸ Writing configuration"
node - "$TOKEN" "$PANEL" <<'NODE'
const fs = require("fs");
const [token, panel] = process.argv.slice(2);
const config = { panelUrl: panel || process.env.ZK_PANEL_URL || "", token, nodeName: "" };
if (!config.panelUrl) {
  console.error("A panel URL is required: sudo bash install.sh <token> <panel-url>");
  process.exit(1);
}
fs.writeFileSync("config.json", JSON.stringify(config, null, 2) + "\\n", { mode: 0o600 });
NODE
[ $? -ne 0 ] && exit 1

echo "▸ Starting the daemon"
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  cat >/etc/systemd/system/zkdaemon.service <<SERVICE
[Unit]
Description=ZK-MC3-PANEL node daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
ExecStart=$(command -v node) $(pwd)/index.js
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
SERVICE
  systemctl daemon-reload
  systemctl enable zkdaemon >/dev/null 2>&1
  systemctl restart zkdaemon
  sleep 2
  if systemctl is-active --quiet zkdaemon; then
    echo "✔ Daemon running — check the panel, the node is online"
    echo "  journalctl -u zkdaemon -f   to watch it"
  else
    echo "✖ The daemon did not start. Run: journalctl -u zkdaemon -n 50" >&2
    exit 1
  fi
else
  echo "systemd not found — running in the background with nohup"
  (setsid nohup node index.js >daemon.log 2>&1 </dev/null &)
  sleep 2
  tail -5 daemon.log
fi
`,
    { mode: 0o755 }
  );

  await fs.writeFile(
    path.join(STAGE, "start.sh"),
    `#!/usr/bin/env bash
# Run the daemon in the foreground (for debugging, or on a host without systemd).
cd "$(dirname "$0")"
exec node index.js "$@"
`,
    { mode: 0o755 }
  );
  log("wrote install.sh and start.sh");

  // ── archive ────────────────────────────────────────────────────────────
  await fs.remove(OUT);
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(OUT);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(STAGE, "zkdaemon");
    archive.finalize();
  });

  const size = (await fs.stat(OUT)).size;
  console.log("");
  log(`✔ ${path.relative(REPO, OUT)} · ${(size / 1024 / 1024).toFixed(2)} MB`);
  log(`  ${pkg.name}@${pkg.version} · ${deps.length} dependencies`);
  console.log("");

  await fs.remove(STAGE);
};

main().catch((err) => {
  console.error("\n✖ " + err.message + "\n");
  process.exit(1);
});
