import bcrypt from "bcryptjs";
import { readJSON, writeJSON, id, nowISO } from "./db";

export type Role = "owner" | "admin" | "user";

export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  password: string;
  role: Role;
  status: "active" | "suspended";
  avatar: string;
  balance: number;
  credits: number;
  createdAt: string;
  updatedAt: string;
  lastLogin: string | null;
  lastIp: string | null;
  passwordVersion: number;
  twoFactor: boolean;
  preferences: {
    theme: string;
    emailNotifications: boolean;
    crashAlerts: boolean;
    productUpdates: boolean;
    loginAlerts: boolean;
  };
}

export const USERS_FILE = "users.json";

export const listUsers = () => readJSON<User[]>(USERS_FILE, []);

export const saveUsers = (users: User[]) => writeJSON(USERS_FILE, users);

export const findUserById = async (uid: string) => {
  const users = await listUsers();
  return users.find((u) => u.id === uid) || null;
};

export const findUserByLogin = async (login: string) => {
  const users = await listUsers();
  const needle = String(login).trim().toLowerCase();
  return (
    users.find((u) => (u.username || "").toLowerCase() === needle) ||
    users.find((u) => (u.email || "").toLowerCase() === needle) ||
    null
  );
};

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  email: u.email,
  role: u.role,
  status: u.status,
  avatar: u.avatar,
  balance: u.balance || 0,
  credits: u.credits || 0,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
  lastLogin: u.lastLogin,
  lastIp: u.lastIp,
  twoFactor: !!u.twoFactor,
  preferences: u.preferences,
});

export const createUserRecord = async (input: {
  name: string;
  username: string;
  email: string;
  password: string;
  role?: Role;
  balance?: number;
}): Promise<User> => {
  const users = await listUsers();
  const user: User = {
    id: id("usr_"),
    name: input.name,
    username: input.username,
    email: input.email.toLowerCase(),
    password: await hashPassword(input.password),
    role: input.role || "user",
    status: "active",
    avatar: "",
    balance: input.balance ?? 0,
    credits: 0,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    lastLogin: null,
    lastIp: null,
    passwordVersion: 0,
    twoFactor: false,
    preferences: {
      theme: "dark",
      emailNotifications: true,
      crashAlerts: true,
      productUpdates: false,
      loginAlerts: true,
    },
  };
  users.push(user);
  await saveUsers(users);
  return user;
};

export const isAdminRole = (role?: string) => role === "admin" || role === "owner";
