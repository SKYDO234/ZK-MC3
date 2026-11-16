import fs from "fs-extra";
import path from "path";

/**
 * Tiny JSON datastore used by ZK-MC3-PANEL.
 * Writes are atomic (tmp file + rename) and serialized per-file so concurrent
 * requests can never corrupt the database.
 */
export const DATA_DIR = path.join(process.cwd(), ".data");
export const SERVERS_DIR = path.join(DATA_DIR, "servers");
export const BACKUPS_DIR = path.join(DATA_DIR, "backups");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

const queues = new Map<string, Promise<any>>();

export const ensureDataDirs = async () => {
  await fs.ensureDir(DATA_DIR);
  await fs.ensureDir(SERVERS_DIR);
  await fs.ensureDir(BACKUPS_DIR);
  await fs.ensureDir(UPLOADS_DIR);
};

export const filePath = (name: string) => path.join(DATA_DIR, name);

export const readJSON = async <T = any>(name: string, fallback: T): Promise<T> => {
  try {
    const raw = await fs.readFile(filePath(name), "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const writeJSON = async (name: string, data: any): Promise<void> => {
  const previous = queues.get(name) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      await fs.ensureDir(DATA_DIR);
      const target = filePath(name);
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
      await fs.rename(tmp, target);
    });
  queues.set(name, next);
  return next;
};

/** Read-modify-write helper with a per-file lock. */
export const mutateJSON = async <T = any>(
  name: string,
  fallback: T,
  mutator: (data: T) => T | Promise<T>
): Promise<T> => {
  const result = await (queues.get(name) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const current = await readJSON<T>(name, fallback);
      const updated = await mutator(current);
      await writeJSON(name, updated);
      return updated;
    });
  return result;
};

export const id = (prefix = "") =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const nowISO = () => new Date().toISOString();

export const serverDir = (serverId: string) => path.join(SERVERS_DIR, serverId);
