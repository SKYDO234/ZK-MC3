/**
 * Builds dist/server.cjs — the production panel server.
 *
 * `vite build` only produces the browser bundle. Without this step `npm run
 * build` exits 0 while leaving no server behind, and `npm start` / pm2 fail
 * with "Script not found: dist/server.cjs". The build must not be able to
 * succeed without a runnable server, so this script exits non-zero if the
 * bundle is missing or cannot be loaded.
 *
 *   npm run build:server
 */
import fs from "fs-extra";
import path from "path";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ENTRY = path.join(ROOT, "server.ts");
const OUT = path.join(ROOT, "dist", "server.cjs");

const main = async () => {
  if (!(await fs.pathExists(ENTRY))) throw new Error("server.ts is missing");
  await fs.ensureDir(path.dirname(OUT));

  await build({
    entryPoints: [ENTRY],
    outfile: OUT,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    // Keep dependencies external: esbuild cannot bundle native addons, and
    // node_modules is present at runtime after `npm install`.
    packages: "external",
    sourcemap: false,
    logLevel: "error",
    // server.ts resolves optional dotenv config at boot; leaving `require`
    // intact keeps those paths working.
    banner: { js: "/* ZK-MC3-PANEL · server bundle */" },
  });

  const stat = await fs.stat(OUT);
  if (!stat.size) throw new Error("esbuild produced an empty server bundle");
  console.log(`  ✔ dist/server.cjs · ${(stat.size / 1024).toFixed(0)} KB`);
};

main().catch((err) => {
  console.error(`\n✖ Server build failed: ${err.message}\n`);
  process.exit(1);
});
