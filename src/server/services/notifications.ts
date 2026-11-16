import { readJSON, writeJSON, id, nowISO } from "./db";

export interface Notification {
  id: string;
  userId: string; // "*" = broadcast to every user
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  link?: string;
  read: boolean;
  createdAt: string;
}

const FILE = "notifications.json";

export const listNotifications = () => readJSON<Notification[]>(FILE, []);

export const notify = async (input: Omit<Notification, "id" | "read" | "createdAt">) => {
  const list = await listNotifications();
  const record: Notification = {
    id: id("ntf_"),
    read: false,
    createdAt: nowISO(),
    ...input,
  };
  list.unshift(record);
  await writeJSON(FILE, list.slice(0, 400));
  return record;
};

export const notificationsFor = async (userId: string, role: string, limit = 30) => {
  const list = await listNotifications();
  return list
    .filter((n) => n.userId === userId || n.userId === "*" || (n.userId === "@admins" && (role === "admin" || role === "owner")))
    .slice(0, limit);
};

export const markRead = async (userId: string, nid?: string) => {
  const list = await listNotifications();
  const next = list.map((n) => {
    if (nid && n.id !== nid) return n;
    if (!nid && n.userId !== userId) return n;
    if (n.userId === userId || n.userId === "*" || n.userId === "@admins") return { ...n, read: true };
    return n;
  });
  await writeJSON(FILE, next);
};
