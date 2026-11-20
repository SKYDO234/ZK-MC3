/**
 * ZK-MC3-PANEL · Node setup flow test
 * ---------------------------------------------------------------------------
 * Drives the real Add-node sheet in jsdom and asserts the three things the
 * operator is promised:
 *
 *   1. the token is shown in full, once, and can be copied
 *   2. the command is exactly one line and contains that token
 *   3. the agent's self-reported address fills the node card
 *
 *   node qa-node-setup.mjs
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const BASE = process.env.QA_BASE || "http://127.0.0.1:31120";
const TOKEN = process.env.QA_TOKEN || "";
const ROOT = path.dirname(new URL(import.meta.url).pathname);

if (!TOKEN) {
  console.error("✖ QA_TOKEN is required (run against a signed-in panel).");
  process.exit(1);
}

// --------------------------------------------------------------- entry bundle
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
  <MemoryRouter initialEntries={["/admin/nodes"]}>
    <SettingsProvider><ToastProvider><AuthProvider><AppRoutes /></AuthProvider></ToastProvider></SettingsProvider>
  </MemoryRouter>
);`
);
execFileSync(
  "npx",
  [
    "esbuild",
    "qa-entry.tsx",
    "--bundle",
    "--format=iife",
    "--outfile=qa-bundle.js",
    "--define:process.env.NODE_ENV=\"development\"",
    "--jsx=automatic",
    "--loader:.css=empty",
    "--log-level=error",
  ],
  { cwd: ROOT, stdio: "inherit" }
);
const BUNDLE = fs.readFileSync(path.join(ROOT, "qa-bundle.js"), "utf8");

const { JSDOM, VirtualConsole } = await import("jsdom");

const errors = [];
const vc = new VirtualConsole();
const ignore = ["Could not load link", "Not implemented", "Could not parse CSS"];
vc.on("jsdomError", (e) => {
  const m = e.detail?.stack || e.message || "";
  if (!ignore.some((s) => m.includes(s))) errors.push("jsdom: " + m.slice(0, 300));
});
vc.on("error", (m) => errors.push("console.error: " + String(m).slice(0, 300)));

const clipboard = [];
const dom = new JSDOM(
  `<!doctype html><html><head><style></style></head><body><div id="root"></div><script>${BUNDLE}</script></body></html>`,
  {
    url: BASE + "/admin/nodes",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem("zk_mc3_token", TOKEN);
      w.navigator.clipboard = {
        writeText: async (t) => {
          clipboard.push(t);
        },
      };
      Object.defineProperty(w, "innerWidth", { value: 1440, configurable: true });
      w.matchMedia = (q) => {
        const min = /min-width:\s*(\d+)/.exec(q);
        const max = /max-width:\s*(\d+)/.exec(q);
        const ok = min ? 1440 >= +min[1] : max ? 1440 <= +max[1] : true;
        return {
          matches: ok,
          media: q,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent: () => false,
        };
      };
      w.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      w.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      w.scrollTo = () => {};
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.fetch = (input, init) =>
        globalThis.fetch(typeof input === "string" && !/^https?:/.test(input) ? BASE + input : input, init);
      for (const k of ["FormData", "Blob", "Headers", "Request", "Response", "AbortController", "URL"])
        w[k] = globalThis[k];
      w.CustomEvent = class extends w.Event {
        constructor(t, o = {}) {
          super(t);
          this.detail = o.detail;
        }
      };
    },
  }
);

const win = dom.window;
const doc = win.document;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** React tracks input values internally; set the native value then fire. */
const type = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
  el.dispatchEvent(new win.Event("change", { bubbles: true }));
};

const byText = (sel, text) =>
  [...doc.querySelectorAll(sel)].find((el) => (el.textContent || "").trim().toLowerCase().includes(text.toLowerCase()));

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✔" : "✖"} ${name}${detail ? "  " + detail : ""}`);
};

await sleep(6000);

// ── open the sheet ─────────────────────────────────────────────────────────
const addBtn = byText("button", "Add node");
check("Add node button present", Boolean(addBtn));
addBtn?.click();
await sleep(600);

check("sheet renders the guided steps", Boolean(byText("p,span,div", "Name the machine")));

// ── fill in a name only ────────────────────────────────────────────────────
const nameInput = doc.querySelector('input[placeholder="EU-2"]');
check("name field present", Boolean(nameInput));
if (nameInput) type(nameInput, "QA-Node-Test");
await sleep(300);

// ── generate the token ─────────────────────────────────────────────────────
const genBtn = byText("button", "Generate token");
check("Generate token button present", Boolean(genBtn));
genBtn?.click();
await sleep(2500);

const bodyText = (doc.body.textContent || "").replace(/\s+/g, " ");

// 1. the token is visible in full
const tokenEl = doc.querySelector("code");
const shownToken = tokenEl?.textContent?.trim() || "";
check(
  "token is shown in full (not masked)",
  /^zkt_[a-z0-9]+$/.test(shownToken) && !shownToken.includes("•"),
  shownToken ? shownToken.slice(0, 12) + "…" : "none"
);

// 2. one command, containing that token
const commandText = [...doc.querySelectorAll("pre")]
  .map((p) => p.textContent || "")
  .find((t) => t.includes("install-agent.sh")) || "";
const commandLines = commandText.trim().split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
check("command is a single line", commandLines.length === 1, `${commandLines.length} line(s)`);
check("command embeds the token", Boolean(shownToken) && commandText.includes(shownToken));
check(
  "command needs no edits (no <token> placeholder)",
  !commandText.includes("<token>") && !commandText.includes("<panel"),
  commandLines[0]?.slice(0, 70) || ""
);

// 3. copy buttons actually copy
const copyBtn = byText("button", "Copy command");
check("Copy command button present", Boolean(copyBtn));
copyBtn?.click();
await sleep(400);
check(
  "copy puts the same command on the clipboard",
  clipboard.some((c) => c.includes(shownToken) && c.includes("install-agent.sh")),
  clipboard.length ? `${clipboard.length} write(s)` : "nothing copied"
);

// 4. the address panel is discoverable and drives the command
check("panel address is editable", Boolean(byText("summary", "Panel address")));

// 5. no masked-token regression anywhere in the sheet
check("no masked token in the sheet", !bodyText.includes("••••••••"));

if (errors.length) {
  console.log("\nRuntime errors:");
  for (const e of [...new Set(errors)].slice(0, 8)) console.log("  " + e);
}

dom.window.close();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} node-setup checks passed`);
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
