import { Router } from "express";
import { requireAdmin, requireAuth, clientIp } from "../middleware/auth";
import {
  listUsers,
  publicUser,
  createUserRecord,
  hashPassword,
  findUserById,
  Role,
} from "../services/users";
import { readJSON, writeJSON, nowISO } from "../services/db";
import { logActivity } from "../services/activity";
import { notify } from "../services/notifications";
import { listServerIdsByOwner } from "../services/stats";
import { passwordIssues } from "../services/sessions";

const router = Router();

/** Any authenticated user may list usernames (used by owner selectors). */
router.get("/directory", requireAuth, async (_req, res) => {
  const users = await listUsers();
  res.json(users.map((u) => ({ id: u.id, username: u.username, name: u.name, role: u.role })));
});

router.use(requireAdmin);

router.get("/", async (req, res) => {
  const users = await listUsers();
  const servers = await readJSON<any[]>("servers.json", []);
  res.json(
    users.map((u) => ({
      ...publicUser(u),
      serverCount: servers.filter((s) => s.owner === u.id).length,
    }))
  );
});

router.post("/", async (req: any, res) => {
  const { name, username, email, password, role = "user", balance = 0, status = "active" } = req.body || {};
  if (!name || !username || !email || !password)
    return res.status(400).json({ error: "Name, username, email and password are required" });
  if (!["user", "admin", "owner"].includes(role))
    return res.status(400).json({ error: "Invalid role" });
  if (role === "owner" && req.user.role !== "owner")
    return res.status(403).json({ error: "Only the owner can create another owner" });

  const users = await listUsers();
  if (users.some((u) => u.username.toLowerCase() === String(username).toLowerCase()))
    return res.status(409).json({ error: "Username already exists" });
  if (users.some((u) => u.email.toLowerCase() === String(email).toLowerCase()))
    return res.status(409).json({ error: "Email already exists" });
  const issues = await passwordIssues(String(password));
  if (issues.length) return res.status(400).json({ error: issues[0] });

  const user = await createUserRecord({
    name,
    username,
    email,
    password,
    role: role as Role,
    balance: Number(balance) || 0,
  });
  if (status === "suspended") {
    const latest = await listUsers();
    const idx = latest.findIndex((u) => u.id === user.id);
    if (idx !== -1) {
      latest[idx].status = "suspended";
      await writeJSON("users.json", latest);
      user.status = "suspended";
    }
  }
  await logActivity({
    type: "admin",
    action: "user-create",
    message: `${req.user.username} created the account "${username}"`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: user.id,
    ip: clientIp(req),
  });
  res.status(201).json(publicUser(user));
});

router.patch("/:id", async (req: any, res) => {
  const users = await listUsers();
  const idx = users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  const target = users[idx];
  if (target.role === "owner" && req.user.role !== "owner")
    return res.status(403).json({ error: "Only the owner can modify an owner account" });

  const { name, email, username, role, status, balance, password, twoFactor } = req.body || {};
  if (role && !["user", "admin", "owner"].includes(role))
    return res.status(400).json({ error: "Invalid role" });
  if (role === "owner" && req.user.role !== "owner")
    return res.status(403).json({ error: "Only the owner can promote to owner" });
  if (email && users.some((u, i) => i !== idx && u.email.toLowerCase() === String(email).toLowerCase()))
    return res.status(409).json({ error: "Email already in use" });
  if (username && users.some((u, i) => i !== idx && u.username.toLowerCase() === String(username).toLowerCase()))
    return res.status(409).json({ error: "Username already in use" });

  let passwordHash: string | undefined;
  let passwordVersion = target.passwordVersion || 0;
  if (password) {
    const issues = await passwordIssues(String(password));
    if (issues.length) return res.status(400).json({ error: issues[0] });
    passwordHash = await hashPassword(String(password));
    passwordVersion += 1;
  }

  users[idx] = {
    ...target,
    ...(name !== undefined ? { name } : {}),
    ...(email !== undefined ? { email: String(email).toLowerCase() } : {}),
    ...(username !== undefined ? { username } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(balance !== undefined ? { balance: Number(balance) } : {}),
    ...(twoFactor !== undefined ? { twoFactor: Boolean(twoFactor) } : {}),
    ...(passwordHash ? { password: passwordHash, passwordVersion } : {}),
    updatedAt: nowISO(),
  };
  await writeJSON("users.json", users);
  await logActivity({
    type: "admin",
    action: "user-update",
    message: `${req.user.username} updated the account "${users[idx].username}"`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: users[idx].id,
    ip: clientIp(req),
  });
  res.json(publicUser(users[idx]));
});

router.delete("/:id", async (req: any, res) => {
  const users = await listUsers();
  const target = users.find((u) => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.id === req.user.id) return res.status(400).json({ error: "You cannot delete your own account" });
  if (target.role === "owner" && req.user.role !== "owner")
    return res.status(403).json({ error: "Only the owner can delete an owner account" });

  const servers = await readJSON<any[]>("servers.json", []);
  if (servers.some((s) => s.owner === target.id))
    return res.status(400).json({ error: "Reassign or delete this user's servers first" });

  await writeJSON("users.json", users.filter((u) => u.id !== target.id));
  await logActivity({
    type: "admin",
    action: "user-delete",
    message: `${req.user.username} deleted the account "${target.username}"`,
    actorId: req.user.id,
    actorName: req.user.username || "",
    target: target.id,
    ip: clientIp(req),
  });
  res.json({ success: true });
});

router.post("/:id/notify", async (req: any, res) => {
  const target = await findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });
  const { title, message, type = "info" } = req.body || {};
  if (!title || !message) return res.status(400).json({ error: "Title and message are required" });
  await notify({ userId: target.id, title, message, type, link: "/dashboard" });
  res.json({ success: true });
});

router.get("/:id/summary", async (req, res) => {
  const target = await findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });
  const servers = await listServerIdsByOwner(target.id);
  res.json({ user: publicUser(target), servers });
});

export default router;
