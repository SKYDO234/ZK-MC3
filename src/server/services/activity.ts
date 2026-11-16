import { readJSON, writeJSON, id, nowISO } from "./db";

export interface ActivityEntry {
  id: string;
  type: string;
  action: string;
  message: string;
  actorId: string;
  actorName: string;
  target: string;
  ip?: string;
  meta?: Record<string, any>;
  createdAt: string;
}

const FILE = "activities.json";
const MAX_ENTRIES = 600;

export const logActivity = async (
  entry: Omit<ActivityEntry, "id" | "createdAt"> & { createdAt?: string }
) => {
  const list = await readJSON<ActivityEntry[]>(FILE, []);
  const record: ActivityEntry = {
    id: id("act_"),
    createdAt: entry.createdAt || nowISO(),
    ...entry,
  };
  list.unshift(record);
  await writeJSON(FILE, list.slice(0, MAX_ENTRIES));
  return record;
};

export const listActivity = async (limit = 50) => {
  const list = await readJSON<ActivityEntry[]>(FILE, []);
  return list.slice(0, limit);
};

export const activityForUser = async (userId: string, limit = 20) => {
  const list = await readJSON<ActivityEntry[]>(FILE, []);
  return list.filter((a) => a.actorId === userId).slice(0, limit);
};
