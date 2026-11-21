/**
 * Builds dist/downloads/zkvm.tar.gz from ./vm/qemu.
 *
 * The VM manager is a self-contained shell tree: an operator unpacks it and runs
 * `sudo bash setup.sh`, which installs QEMU and the `zkvm` command. It is not
 * part of the panel bundle because it must run on the host, as root, outside
 * Node entirely.
 *
 *   npm run build:vm
 */
import fs from "fs-extra";
import path from "path";
import { execFileSync } from "child_process";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(ROOT, "..");
const SRC = path.join(REPO, "vm", "qemu");
const OUT_DIR = path.join(REPO, "dist", "downloads");
const OUT = path.join(OUT_DIR, "zkvm.tar.gz");

if (!fs.existsSync(SRC)) {
  console.error(`✖ ${SRC} is missing — nothing to package.`);
  process.exit(1);
}

const FILES = ["zkvm", "lib.sh", "images.sh", "setup.sh", "README.md"];
const missing = FILES.filter((f) => !fs.existsSync(path.join(SRC, f)));
if (missing.length) {
  console.error(`✖ Missing required files in vm/qemu: ${missing.join(", ")}`);
  process.exit(1);
}

fs.ensureDirSync(OUT_DIR);

// tar is already a hard dependency of the VM manager itself, so requiring it
// here costs nothing extra.
try {
  execFileSync("tar", ["-czf", OUT, "-C", path.dirname(SRC), path.basename(SRC)], {
    stdio: "pipe",
  });
} catch (err) {
  console.error(`✖ tar failed: ${err.message}`);
  process.exit(1);
}

const stat = fs.statSync(OUT);
if (!stat.size) {
  console.error("✖ zkvm.tar.gz is empty.");
  process.exit(1);
}

// Every script must be executable after extraction, or `bash setup.sh` is the
// only way in and `./zkvm` fails for anyone who expects a command.
const mode = 0o755;
for (const f of ["zkvm", "setup.sh", "images.sh"]) {
  fs.chmodSync(path.join(SRC, f), mode);
}

console.log(`  ✔ dist/downloads/zkvm.tar.gz · ${(stat.size / 1024).toFixed(0)} KB`);
