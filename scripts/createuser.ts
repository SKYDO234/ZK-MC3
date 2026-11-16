#!/usr/bin/env tsx
/**
 * Creates (or promotes) an administrator account from the CLI.
 * Usage: npm run createuser -- --username admin --password Secret123 --email a@b.c --role owner
 */
import readline from "readline";
import { ensureDataDirs } from "../src/server/services/db";
import { createUserRecord, listUsers, hashPassword } from "../src/server/services/users";
import { writeJSON } from "../src/server/services/db";

const args = process.argv.slice(2);
const flag = (name: string, fallback = "") => {
  const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return fallback;
  if (args[idx].includes("=")) return args[idx].split("=").slice(1).join("=");
  return args[idx + 1] || fallback;
};

const ask = (question: string) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
};

const main = async () => {
  await ensureDataDirs();
  const username = flag("username") || (await ask("Admin username: "));
  const email = flag("email") || (await ask("Admin email: "));
  const password = flag("password") || (await ask("Admin password: "));
  const role = (flag("role", "owner") as "owner" | "admin") || "owner";
  const name = flag("name", "Panel Administrator");

  if (!username || !email || !password) {
    console.error("Username, email and password are required.");
    process.exit(1);
  }
  // Password strength is a per-panel setting; only guard against an empty value here
  // so operators can reset to any password the panel itself would accept.
  if (!password.trim()) {
    console.error("Password cannot be empty.");
    process.exit(1);
  }

  const users = await listUsers();
  const existing = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (existing) {
    existing.password = await hashPassword(password);
    existing.role = role;
    existing.passwordVersion = (existing.passwordVersion || 0) + 1;
    await writeJSON("users.json", users);
    console.log(`✔ Updated ${username} (role: ${role}) and reset the password.`);
    return;
  }

  await createUserRecord({ name, username, email, password, role });
  console.log(`✔ Administrator "${username}" created with role "${role}".`);
};

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
