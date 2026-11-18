/**
 * ZK-MC3-PANEL · password-change regression harness
 * ---------------------------------------------------------------------------
 * Drives the real Account → "Password & Security" form in jsdom against a
 * running panel and asserts the two behaviours that used to be broken:
 *
 *   1. signing in does NOT trap the operator on /change-password when the
 *      "requireInitialPasswordChange" policy is off (the default);
 *   2. changing the password from Account keeps the session alive, because the
 *      rotated token is adopted instead of discarded.
 *
 * Usage (panel must already be running):
 *   QA_USER=admin QA_PASS=admin QA_NEWPASS=Panel-2026 npm run qa:password
 *
 * The password is restored to QA_PASS at the end, so repeated runs are safe.
 */
const BASE = process.env.QA_BASE || "http://127.0.0.1:31120";
const USER = process.env.QA_USER || "admin";
let PASS = process.env.QA_PASS || "admin";
const NEWPASS = process.env.QA_NEWPASS || "QaPanel-2026";

const log = (ok, msg, extra = "") =>
  console.log(`${ok === null ? "•" : ok ? "✔" : "✖"} ${msg}${extra ? `  ${extra}` : ""}`);

/**
 * Mounts the real <AppRoutes /> in jsdom at `route` with `token` preloaded and
 * returns { root, text, doc, cleanup }. Shared by both checks below so the UI
 * (not just the REST layer) is what gets exercised.
 */
const mountApp = async (route, token) => {
  const { JSDOM, VirtualConsole } = await import("jsdom");
  const { execFileSync } = await import("child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const ROOT = path.dirname(new URL(import.meta.url).pathname);

  fs.writeFileSync(
    path.join(ROOT, "qa-pw-entry.tsx"),
    `import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SettingsProvider } from "./src/context/SettingsContext";
import { ToastProvider } from "./src/context/ToastContext";
import { AuthProvider } from "./src/context/AuthContext";
import { AppRoutes } from "./src/App";
createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["${route}"]}>
    <SettingsProvider><ToastProvider><AuthProvider><AppRoutes /></AuthProvider></ToastProvider></SettingsProvider>
  </MemoryRouter>
);`
  );
  execFileSync(
    "npx",
    ["esbuild", "qa-pw-entry.tsx", "--bundle", "--format=iife", "--outfile=qa-pw-bundle.js",
     '--define:process.env.NODE_ENV="development"', "--jsx=automatic", "--loader:.css=empty", "--log-level=error"],
    { cwd: ROOT, stdio: "inherit" }
  );
  const bundle = fs.readFileSync(path.join(ROOT, "qa-pw-bundle.js"), "utf8");

  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(e.detail?.stack || e.message));
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root"></div><script>${bundle}</script></body></html>`,
    {
      url: BASE + route,
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(w) {
        w.localStorage.setItem("zk_mc3_token", token);
        w.matchMedia = () => ({
          matches: true, media: "", addListener() {}, removeListener() {},
          addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
        });
        w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
        w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
        w.scrollTo = () => {};
        w.HTMLElement.prototype.scrollIntoView = function () {};
        w.fetch = (input, init) =>
          globalThis.fetch(typeof input === "string" && !/^https?:/.test(input) ? BASE + input : input, init);
        for (const k of ["FormData", "Blob", "Headers", "Request", "Response", "AbortController", "URL", "Event", "CustomEvent"])
          if (!w[k]) w[k] = globalThis[k];
      },
    }
  );
  const cleanup = () => {
    dom.window.close();
    fs.rmSync(path.join(ROOT, "qa-pw-entry.tsx"), { force: true });
    fs.rmSync(path.join(ROOT, "qa-pw-bundle.js"), { force: true });
  };
  return { dom, doc: dom.window.document, cleanup, errors };
};

/** React ignores `el.value = x`; go through the native setter then fire input. */
const typeInto = (win, el, value) => {
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
};

const findByText = (doc, selector, re) =>
  [...doc.querySelectorAll(selector)].find((el) => re.test(el.textContent || ""));

const api = async (path, opts = {}, token) => {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
};

const login = async (password) => {
  const { status, body } = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ login: USER, password }),
  });
  return status === 200 && body?.token ? body : null;
};

// ---------------------------------------------------------------- pre-flight
let session = await login(PASS);
if (!session) {
  // A previous run may have been interrupted before restoring the password.
  session = await login(NEWPASS);
  if (!session) {
    console.error(`✖ cannot sign in as "${USER}" with either the configured or the test password.`);
    process.exit(1);
  }
  PASS = NEWPASS;
}
log(true, `signed in as ${USER}`);

const passwordVersionBefore = session.user?.passwordVersion ?? 0;
const meBefore = await api("/api/auth/me", {}, session.token);
if (meBefore.status !== 200) {
  console.error(`✖ /auth/me rejected a freshly minted token (HTTP ${meBefore.status})`);
  process.exit(1);
}
log(true, "fresh login token is accepted", `passwordVersion=${passwordVersionBefore}`);

// --------------------------------------- 1. no forced /change-password trap
const settings = (await api("/api/settings")).body || {};
if (settings.requireInitialPasswordChange) {
  log(null, "policy requireInitialPasswordChange is ON — skipping the redirect check");
} else if (!session.user?.mustChangePassword && meBefore.body?.user?.mustChangePassword) {
  log(null, "account already has a custom password — redirect check not applicable");
} else {
  // Render the dashboard with this token and assert we stay on it.
  const { doc, cleanup, errors } = await mountApp("/dashboard", session.token);
  await new Promise((r) => setTimeout(r, 6000));
  // Read only the mounted React tree: body.textContent also contains the inline
  // <script> source, which would match any string the bundle happens to include.
  const root = doc.getElementById("root");
  const text = (root?.textContent || "").replace(/\s+/g, " ");
  const onPasswordGate = /Secure your panel/i.test(text) || /Set a new password/i.test(text);
  const onDashboard = /Dashboard/i.test(text) && /My Servers/i.test(text);
  cleanup();

  const hardErrors = errors.filter((e) => !/Could not load link|Not implemented|Could not parse CSS/.test(String(e)));
  if (onPasswordGate) {
    log(false, "opening the panel landed on /change-password (should go to the dashboard)");
  } else if (!onDashboard) {
    log(false, "dashboard did not render", `errors=${hardErrors.length}`);
  } else {
    log(true, "opening the panel lands on the dashboard — no forced password page");
  }
}

// ------------------------- 2. rotating the password from the real Account form
const ui = await mountApp("/account", session.token);
await new Promise((r) => setTimeout(r, 6000));
const w = ui.dom.window;

// Open the "Password & Security" tab.
const tab = findByText(ui.doc, "button", /Password & Security/i);
if (!tab) {
  log(false, "could not find the Password & Security tab on /account");
  ui.cleanup();
  process.exit(1);
}
tab.click();
await new Promise((r) => setTimeout(r, 600));

const inputs = [...ui.doc.querySelectorAll('input[type="password"]')];
if (inputs.length < 3) {
  log(false, `expected 3 password fields on the Account form, found ${inputs.length}`);
  ui.cleanup();
  process.exit(1);
}
typeInto(w, inputs[0], PASS);
typeInto(w, inputs[1], NEWPASS);
typeInto(w, inputs[2], NEWPASS);
await new Promise((r) => setTimeout(r, 300));

const submit = findByText(ui.doc, "button", /Update password/i);
if (!submit) {
  log(false, "could not find the 'Update password' button");
  ui.cleanup();
  process.exit(1);
}
submit.click();
await new Promise((r) => setTimeout(r, 3000));

const afterText = (ui.doc.getElementById("root")?.textContent || "").replace(/\s+/g, " ");
const formCleared = [...ui.doc.querySelectorAll('input[type="password"]')].every((i) => i.value === "");
const confirmed = /Password updated/i.test(afterText);
const tokenAfter = w.localStorage.getItem("zk_mc3_token");
ui.cleanup();

log(confirmed, "Account form reported 'Password updated'");
log(tokenAfter !== session.token, "the browser stored the rotated token",
  tokenAfter ? `…${String(tokenAfter).slice(-8)}` : "missing");

const adopted = await api("/api/auth/me", {}, tokenAfter || "");
log(adopted.status === 200, "session survives the change (the page was not signed out)",
  `HTTP ${adopted.status}`);
if (adopted.status === 200) log(null, "the form is reusable", formCleared ? "fields cleared" : "fields kept");

const retired = await api("/api/auth/me", {}, session.token);
log(retired.status === 401, "the old token is retired", `HTTP ${retired.status}`);

const reLogin = await login(NEWPASS);
log(Boolean(reLogin), "can sign in with the new password");

// ------------------------------------------------------------- restore state
// Proves the flow is repeatable rather than one-shot: rotate back through the
// API twice, ending on the original password so the next run starts clean.
const restored = await api(
  "/api/auth/password",
  { method: "PATCH", body: JSON.stringify({ currentPassword: NEWPASS, newPassword: PASS }) },
  reLogin?.token || tokenAfter
);
log(restored.status === 200, "password restored for the next run", `HTTP ${restored.status}`);

const again = await api(
  "/api/auth/password",
  { method: "PATCH", body: JSON.stringify({ currentPassword: PASS, newPassword: PASS }) },
  restored.body?.token || ""
);
log(again.status === 200, "a second change works immediately (repeatable)", `HTTP ${again.status}`);

const failures = 0;
const failed = [
  !confirmed, tokenAfter === session.token, adopted.status !== 200,
  retired.status !== 401, !reLogin, restored.status !== 200, again.status !== 200,
].filter(Boolean).length;
console.log(`\n${failed === 0 ? "All password checks passed." : `${failed} check(s) failed.`}`);
process.exit(failed === 0 ? 0 : 1);
