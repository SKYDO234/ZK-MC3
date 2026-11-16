import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { readJSON, writeJSON } from "../services/db";
import { isAdminRole, listUsers, User } from "../services/users";

export const JWT_SECRET = process.env.JWT_SECRET || "zk-mc3-panel-super-secret-change-me";
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
export const API_KEY_PREFIX = "zk_";

export interface AuthUser {
  id: string;
  name?: string;
  username?: string;
  role: string;
  passwordVersion?: number;
  isApiKey?: boolean;
  scopes?: string[];
  keyId?: string;
}

const extractToken = (req: Request): string => {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7).trim();
  // Standard API-key headers, so integrations can send the key without a Bearer prefix.
  const apiKeyHeader = req.headers["x-api-key"] || req.headers["x-zk-key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) return apiKeyHeader.trim();
  if (req.query && typeof req.query.token === "string") return req.query.token;
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)zk_token=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  return "";
};

const resolveUser = async (uid: string): Promise<User | null> => {
  const users = await listUsers();
  return users.find((u) => u.id === uid) || null;
};

/** Resolves a user (JWT or API key) or responds 401. */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // ---- API key authentication ----
  if (token.startsWith(API_KEY_PREFIX)) {
    try {
      const keys = await readJSON<any[]>("api_keys.json", []);
      const hash = crypto.createHash("sha256").update(token).digest("hex");
      const apiKey = keys.find((k) => k.keyHash === hash);
      if (!apiKey || apiKey.revoked) {
        res.status(401).json({ error: "Invalid or revoked API key" });
        return;
      }
      if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() < Date.now()) {
        res.status(401).json({ error: "API key has expired" });
        return;
      }
      const owner = await resolveUser(apiKey.userId);
      if (!owner || owner.status !== "active") {
        res.status(401).json({ error: "API key owner is inactive" });
        return;
      }
      apiKey.lastUsedAt = new Date().toISOString();
      await writeJSON("api_keys.json", keys);
      (req as any).user = {
        id: owner.id,
        name: owner.name,
        username: owner.username,
        role: owner.role,
        isApiKey: true,
        scopes: apiKey.scopes || [],
        keyId: apiKey.id,
      } as AuthUser;
      next();
      return;
    } catch (err) {
      res.status(500).json({ error: "API key verification failed" });
      return;
    }
  }

  // ---- JWT authentication ----
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const user = await resolveUser(decoded.id);
    if (!user) {
      res.status(401).json({ error: "Account no longer exists" });
      return;
    }
    if (user.status !== "active") {
      res.status(403).json({ error: "This account is suspended" });
      return;
    }
    if ((user.passwordVersion || 0) !== (decoded.passwordVersion || 0)) {
      res.status(401).json({ error: "Session expired, please sign in again" });
      return;
    }
    (req as any).user = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      passwordVersion: user.passwordVersion,
    } as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
};

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  await requireAuth(req, res, () => {
    const user = (req as any).user as AuthUser;
    if (!isAdminRole(user?.role)) {
      res.status(403).json({ error: "Administrator access required" });
      return;
    }
    // An API key acting as an admin still has to hold the matching scope.
    if (user?.isApiKey) {
      const scopes = user.scopes || [];
      if (!scopes.includes("*") && !scopes.some((s) => s.startsWith("users.") || s.startsWith("nodes.") || s.startsWith("settings."))) {
        res.status(403).json({ error: "This API key has no administrative scopes" });
        return;
      }
    }
    next();
  });
};

export const requireOwner = async (req: Request, res: Response, next: NextFunction) => {
  await requireAuth(req, res, () => {
    const user = (req as any).user as AuthUser;
    if (user?.role !== "owner") {
      res.status(403).json({ error: "Owner access required" });
      return;
    }
    next();
  });
};

export const hasScope = (user: AuthUser, scope: string) => {
  if (!user?.isApiKey) return true;
  const scopes = user.scopes || [];
  return scopes.includes("*") || scopes.includes(scope);
};

export const requireScope = (scope: string) => (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user as AuthUser;
  if (!hasScope(user, scope)) {
    res.status(403).json({ error: `API key is missing the "${scope}" scope` });
    return;
  }
  next();
};

export const clientIp = (req: Request) => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "127.0.0.1";
};
