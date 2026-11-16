import { readJSON, writeJSON, id, nowISO, mutateJSON } from "../services/db";
import { getSettings } from "../services/settings";

export interface Session {
  id: string;
  userId: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastSeen: string;
  current?: boolean;
}

const FILE = "sessions.json";

export const recordSession = async (userId: string, ip: string, userAgent: string, sessionId?: string) => {
  const sid = sessionId || id("ses_");
  const sessions = await readJSON<Session[]>(FILE, []);
  const existing = sessions.find((s) => s.id === sid);
  if (existing) {
    existing.lastSeen = nowISO();
    existing.ip = ip;
    existing.userAgent = userAgent;
  } else {
    sessions.push({
      id: sid,
      userId,
      ip,
      userAgent,
      createdAt: nowISO(),
      lastSeen: nowISO(),
    });
  }
  await writeJSON(FILE, sessions.slice(-500));
  return sid;
};

export const listSessions = async (userId: string, currentId?: string) => {
  const sessions = await readJSON<Session[]>(FILE, []);
  return sessions
    .filter((s) => s.userId === userId)
    .map((s) => ({ ...s, current: s.id === currentId }))
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
};

export const revokeSession = async (userId: string, sid: string) => {
  await mutateJSON<Session[]>(FILE, [], (sessions) =>
    sessions.filter((s) => !(s.userId === userId && s.id === sid))
  );
};

export const revokeAllSessions = async (userId: string, exceptId?: string) => {
  await mutateJSON<Session[]>(FILE, [], (sessions) =>
    sessions.filter((s) => !(s.userId === userId && s.id !== exceptId))
  );
};

/** Simple in-memory login throttling + activity logging. */
const attempts = new Map<string, { count: number; until: number }>();

export const isRateLimited = (key: string) => {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= 6;
};

export const registerFailedAttempt = (key: string) => {
  const entry = attempts.get(key) || { count: 0, until: Date.now() + 10 * 60 * 1000 };
  entry.count += 1;
  entry.until = Date.now() + 10 * 60 * 1000;
  attempts.set(key, entry);
};

export const clearAttempts = (key: string) => attempts.delete(key);

export const passwordIssues = async (password: string) => {
  const settings = await getSettings();
  const issues: string[] = [];
  if (!password || password.length < settings.passwordMinLength)
    issues.push(`Password must be at least ${settings.passwordMinLength} characters long.`);
  if (!/[A-Za-z]/.test(password || "")) issues.push("Password must include at least one letter.");
  if (!/[0-9]/.test(password || "")) issues.push("Password must include at least one number.");
  return issues;
};
