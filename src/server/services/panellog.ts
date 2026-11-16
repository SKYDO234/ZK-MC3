/**
 * Keeps the last N lines the panel process logged, so the admin console can
 * show live platform output without shell access to the host.
 */
const MAX_LINES = 600;
const buffer: string[] = [];

export const panelLogBuffer = buffer;

const capture = (level: "log" | "info" | "warn" | "error", args: any[]) => {
  const text = args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    buffer.push(`${new Date().toISOString()} [${level === "log" ? "info" : level}] ${line}`);
    if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  }
};

export const installLogCapture = () => {
  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: any[]) => {
      capture(level, args);
      original(...args);
    };
  }
};

export const panelLogs = (limit = 200) => buffer.slice(-Math.min(limit, MAX_LINES));
