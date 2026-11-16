/**
 * ZK-MC3-PANEL · UI smoke harness
 * ---------------------------------------------------------------------------
 * Renders every route of the real React app inside jsdom against a running
 * panel, so a broken page fails loudly instead of silently shipping.
 *
 *   1. npm run dev                 # panel on :31120
 *   2. npm run qa:render           # renders all routes, exits non-zero on error
 *
 * Optional: QA_TOKEN=<jwt> QA_BASE=http://127.0.0.1:31120 npm run qa:render
 * This file is a developer tool; it is not part of the production bundle.
 */
import fs from "fs";
import path from "path";

const BASE = process.env.QA_BASE || "http://127.0.0.1:31120";
const TOKEN = process.env.QA_TOKEN || "";
const WIDTH = Number(process.env.QA_WIDTH || 1440);
const ROUTES = (process.env.QA_ROUTES ||
  "/login,/register,/forgot-password,/dashboard,/servers,/api-keys,/account," +
  "/admin,/admin/create-server,/admin/servers,/admin/nodes,/admin/users,/admin/api-keys,/admin/settings"
).split(",");

const ROOT = path.dirname(new URL(import.meta.url).pathname);

// Fail fast and loudly if the panel is not reachable — otherwise every protected
// route silently redirects to /login and the suite "passes" against a dead server.
try {
  const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) });
  const body = await res.json();
  if (!res.ok) throw new Error(`health returned ${res.status}`);
  console.log(`panel reachable at ${BASE} (${body.panel} v${body.version})\n`);
} catch (err) {
  console.error(`✖ Cannot reach the panel at ${BASE}: ${err.message}`);
  console.error("  Start it first:  npm run dev");
  process.exit(1);
}
if (!TOKEN) console.warn("! QA_TOKEN not set — authenticated routes will render the login screen instead of the app.\n");
const OUT = process.env.QA_OUT || "/tmp/zk-mc3-qa";
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- build bundle
const { execFileSync } = await import("child_process");
fs.writeFileSync(
  path.join(ROOT, "qa-entry.tsx"),
  `import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SettingsProvider } from "./src/context/SettingsContext";
import { ToastProvider } from "./src/context/ToastContext";
import { AuthProvider } from "./src/context/AuthContext";
import { AppRoutes } from "./src/App";
createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={[window.location.pathname]}>
    <SettingsProvider><ToastProvider><AuthProvider><AppRoutes /></AuthProvider></ToastProvider></SettingsProvider>
  </MemoryRouter>
);`
);
execFileSync(
  "npx",
  ["esbuild", "qa-entry.tsx", "--bundle", "--format=iife", "--outfile=qa-bundle.js",
   "--define:process.env.NODE_ENV=\"development\"", "--jsx=automatic", "--loader:.css=empty", "--log-level=error"],
  { cwd: ROOT, stdio: "inherit" }
);
const BUNDLE = fs.readFileSync(path.join(ROOT, "qa-bundle.js"), "utf8");

// Tailwind: reuse the production stylesheet so class coverage is identical.
let css = "";
const distDirs = fs.existsSync(path.join(ROOT, "dist/assets")) ? fs.readdirSync(path.join(ROOT, "dist/assets")) : [];
const cssFile = distDirs.find((f) => f.endsWith(".css"));
if (cssFile) css = fs.readFileSync(path.join(ROOT, "dist/assets", cssFile), "utf8");

const { JSDOM, VirtualConsole } = await import("jsdom");

async function renderRoute(route) {
  const errors = [];
  const vc = new VirtualConsole();
  const ignore = ["Could not load link", "Not implemented", "Could not parse CSS"];
  vc.on("jsdomError", (e) => {
    const m = e.detail?.stack || e.message || "";
    if (!ignore.some((s) => m.includes(s))) errors.push("jsdom: " + m.slice(0, 300));
  });
  vc.on("error", (m) => errors.push("console.error: " + String(m).slice(0, 300)));

  const dom = new JSDOM(
    `<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div><script>${BUNDLE}</script></body></html>`,
    {
      url: BASE + route, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w) {
        if (TOKEN) w.localStorage.setItem("zk_mc3_token", TOKEN);
        Object.defineProperty(w, "innerWidth", { value: WIDTH, configurable: true });
        Object.defineProperty(w, "outerWidth", { value: WIDTH, configurable: true });
        w.matchMedia = (q) => {
          const min = /min-width:\s*(\d+)/.exec(q);
          const max = /max-width:\s*(\d+)/.exec(q);
          const ok = min ? WIDTH >= +min[1] : max ? WIDTH <= +max[1] : true;
          return { matches: ok, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false };
        };
        w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
        w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
        w.scrollTo = () => {};
        w.HTMLElement.prototype.scrollIntoView = function () {};
        w.onerror = (m) => errors.push("window.onerror: " + String(m).slice(0, 300));
        w.fetch = (input, init) =>
          globalThis.fetch(typeof input === "string" && !/^https?:/.test(input) ? BASE + input : input, init);
        for (const k of ["FormData", "Blob", "Headers", "Request", "Response", "AbortController", "URL"]) w[k] = globalThis[k];
        w.CustomEvent = class extends w.Event { constructor(t, o = {}) { super(t); this.detail = o.detail; } };
      },
    }
  );

  await new Promise((r) => setTimeout(r, 6500));
  const doc = dom.window.document;
  const html = doc.getElementById("root")?.innerHTML || "";
  const file = path.join(OUT, route.replace(/[^\w]+/g, "_") || "root");
  fs.writeFileSync(file + ".html", `<html><head><style>${css}</style></head><body>${html}</body></html>`);
  const text = (doc.body.textContent || "").replace(/\s+/g, " ");
  dom.window.close();

  // A protected route that silently bounces to the sign-in screen is a false pass.
  const PUBLIC = ["/login", "/register", "/forgot-password", "/"];
  // Detect the real login *form*, not the marketing copy that also appears in footers.
  const hasLoginForm =
    doc.querySelectorAll('input[type="password"]').length > 0 &&
    /Welcome back/i.test(text) &&
    /Keep me signed in|Sign in/i.test(text);
  const hasAppShell = doc.querySelectorAll("aside, nav").length > 0;
  // Standalone authenticated screens (such as the forced password rotation) are
  // full-page forms without the app shell, so they must not be mistaken for /login.
  const isBounce = hasLoginForm && /Welcome back/i.test(text) && !/Secure your panel/i.test(text);
  const bounced = !PUBLIC.includes(route) && isBounce && !hasAppShell;
  if (bounced) errors.push("auth: route rendered the login screen — QA_TOKEN missing, expired, or the shell failed to mount");

  return { route, bytes: html.length, errors: [...new Set(errors)], preview: text.slice(0, 100) };
}

const results = [];
for (const route of ROUTES) {
  const r = await renderRoute(route.trim());
  results.push(r);
  // Full-page forms (e.g. the forced password rotation) are legitimately small.
  const MIN_BYTES = ["/change-password"].includes(route.trim()) ? 2500 : 4000;
  const bad = r.errors.length > 0 || r.bytes < MIN_BYTES;
  console.log(
    `${bad ? "✖" : "✔"} ${route.padEnd(26)} ${String(r.bytes).padStart(7)} bytes` +
      (r.errors.length ? `  (${r.errors.length} error${r.errors.length > 1 ? "s" : ""})` : "")
  );
  for (const e of r.errors.slice(0, 3)) console.log("    " + e);
}

fs.rmSync(path.join(ROOT, "qa-entry.tsx"), { force: true });
fs.rmSync(path.join(ROOT, "qa-bundle.js"), { force: true });

const failures = results.filter((r) => r.errors.length || (r.bytes < 4000 && !r.route.includes("change-password")));
console.log(`\n${results.length - failures.length}/${results.length} routes rendered cleanly · artefacts in ${OUT}`);
process.exit(failures.length ? 1 : 0);
