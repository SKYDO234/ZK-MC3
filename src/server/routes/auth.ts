import { Router } from "express";
import jwt from "jsonwebtoken";
import { requireAuth, JWT_SECRET, JWT_EXPIRES_IN, clientIp } from "../middleware/auth";
import { getSettings } from "../services/settings";
import {
  findUserByLogin,
  listUsers,
  publicUser,
  createUserRecord,
  verifyPassword,
  hashPassword,
  findUserById,
  Role,
} from "../services/users";
import { logActivity } from "../services/activity";
import { notify } from "../services/notifications";
import {
  isRateLimited,
  registerFailedAttempt,
  clearAttempts,
  recordSession,
  listSessions,
  revokeSession,
  revokeAllSessions,
  passwordIssues,
} from "../services/sessions";
import { writeJSON } from "../services/db";

const router = Router();

const signToken = (user: any, remember = false) =>
  jwt.sign(
    { id: user.id, username: user.username, role: user.role, passwordVersion: user.passwordVersion || 0 },
    JWT_SECRET,
    { expiresIn: remember ? "30d" : (JWT_EXPIRES_IN as any) }
  );

router.post("/login", async (req, res) => {
  const { login, password, remember } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: "Username/email and password are required" });

  const ip = clientIp(req);
  const throttleKey = `${ip}:${String(login).toLowerCase()}`;
  if (isRateLimited(throttleKey)) {
    return res.status(429).json({ error: "Too many failed attempts. Please wait 10 minutes and try again." });
  }

  const user = await findUserByLogin(String(login));
  if (!user || !(await verifyPassword(String(password), user.password))) {
    registerFailedAttempt(throttleKey);
    return res.status(401).json({ error: "Invalid credentials. Please check your username and password." });
  }

  if (user.status !== "active") {
    return res.status(403).json({ error: "This account has been suspended. Contact support." });
  }

  clearAttempts(throttleKey);
  const users = await listUsers();
  const idx = users.findIndex((u) => u.id === user.id);
  users[idx] = { ...users[idx], lastLogin: new Date().toISOString(), lastIp: ip };
  await writeJSON("users.json", users);

  const token = signToken(user, Boolean(remember));
  await recordSession(user.id, ip, String(req.headers["user-agent"] || "Unknown device"));
  await logActivity({
    type: "auth",
    action: "login",
    message: `${user.username} signed in`,
    actorId: user.id,
    actorName: user.username,
    target: user.id,
    ip,
  });

  res.json({ token, user: publicUser(users[idx]) });
});

router.post("/register", async (req, res) => {
  const settings = await getSettings();
  if (!settings.enableRegistration) {
    return res.status(403).json({ error: "Registration is disabled. Please contact an administrator." });
  }
  const { name, username, email, password } = req.body || {};
  if (!name || !username || !email || !password)
    return res.status(400).json({ error: "All fields are required" });

  const uname = String(username).trim();
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(uname))
    return res.status(400).json({ error: "Username must be 3-24 characters (letters, numbers, . _ -)" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email)))
    return res.status(400).json({ error: "Please enter a valid email address" });

  const issues = await passwordIssues(String(password));
  if (issues.length) return res.status(400).json({ error: issues[0] });

  const existing = await listUsers();
  if (existing.some((u) => u.username.toLowerCase() === uname.toLowerCase()))
    return res.status(409).json({ error: "That username is already taken" });
  if (existing.some((u) => u.email.toLowerCase() === String(email).toLowerCase()))
    return res.status(409).json({ error: "An account with that email already exists" });

  const user = await createUserRecord({
    name: String(name).trim(),
    username: uname,
    email: String(email).trim(),
    password: String(password),
    role: existing.length === 0 ? "owner" : "user",
  });

  await recordSession(user.id, clientIp(req), String(req.headers["user-agent"] || "Unknown device"));
  await notify({
    userId: "@admins",
    title: "New account registered",
    message: `${user.username} (${user.email}) just created an account.`,
    type: "info",
    link: "/admin/users",
  });
  await logActivity({
    type: "auth",
    action: "register",
    message: `${user.username} registered a new account`,
    actorId: user.id,
    actorName: user.username,
    target: user.id,
    ip: clientIp(req),
  });

  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

router.get("/me", requireAuth, async (req: any, res) => {
  const user = await findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(publicUser(user));
});

router.post("/logout", requireAuth, async (req: any, res) => {
  await logActivity({
    type: "auth",
    action: "logout",
    message: `${req.user.username} signed out`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: req.user.id,
    ip: clientIp(req),
  });
  res.json({ success: true });
});

router.patch("/profile", requireAuth, async (req: any, res) => {
  const users = await listUsers();
  const idx = users.findIndex((u) => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  const { name, email, avatar } = req.body || {};
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return res.status(400).json({ error: "Please enter a valid email address" });
  if (email && users.some((u, i) => i !== idx && u.email.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: "That email is already in use" });

  users[idx] = {
    ...users[idx],
    name: name !== undefined ? String(name).slice(0, 60) : users[idx].name,
    email: email !== undefined ? String(email).toLowerCase() : users[idx].email,
    avatar: avatar !== undefined ? String(avatar) : users[idx].avatar,
    updatedAt: new Date().toISOString(),
  };
  await writeJSON("users.json", users);
  res.json(publicUser(users[idx]));
});

router.patch("/preferences", requireAuth, async (req: any, res) => {
  const users = await listUsers();
  const idx = users.findIndex((u) => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  users[idx] = {
    ...users[idx],
    preferences: { ...users[idx].preferences, ...(req.body || {}) },
    updatedAt: new Date().toISOString(),
  };
  await writeJSON("users.json", users);
  res.json(publicUser(users[idx]));
});

router.patch("/password", requireAuth, async (req: any, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const users = await listUsers();
  const idx = users.findIndex((u) => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  if (!(await verifyPassword(String(currentPassword || ""), users[idx].password)))
    return res.status(400).json({ error: "Your current password is incorrect" });
  const issues = await passwordIssues(String(newPassword || ""));
  if (issues.length) return res.status(400).json({ error: issues[0] });

  users[idx] = {
    ...users[idx],
    password: await hashPassword(String(newPassword)),
    passwordVersion: (users[idx].passwordVersion || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  await writeJSON("users.json", users);

  const token = signToken(users[idx]);
  await logActivity({
    type: "auth",
    action: "password",
    message: `${users[idx].username} changed their password`,
    actorId: users[idx].id,
    actorName: users[idx].username,
    target: users[idx].id,
    ip: clientIp(req),
  });
  res.json({ success: true, token });
});

router.get("/sessions", requireAuth, async (req: any, res) => {
  res.json(await listSessions(req.user.id));
});

router.delete("/sessions/:id", requireAuth, async (req: any, res) => {
  await revokeSession(req.user.id, req.params.id);
  res.json({ success: true });
});

router.delete("/sessions", requireAuth, async (req: any, res) => {
  await revokeAllSessions(req.user.id);
  res.json({ success: true });
});

export default router;
