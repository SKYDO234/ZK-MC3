import fs from "fs-extra";
import path from "path";
import archiver from "archiver";
import extract from "extract-zip";
import { BACKUPS_DIR, nowISO } from "./db";
import { serverDir, ServerRecord } from "./runtime";

export interface BackupRecord {
  fileName: string;
  size: number;
  createdAt: string;
  label: string;
}

const backupDir = (serverId: string) => path.join(BACKUPS_DIR, serverId);

export const listBackups = async (serverId: string): Promise<BackupRecord[]> => {
  const dir = backupDir(serverId);
  await fs.ensureDir(dir);
  const files = await fs.readdir(dir).catch(() => []);
  const records = await Promise.all(
    files
      .filter((f) => f.endsWith(".zip"))
      .map(async (fileName) => {
        const stat = await fs.stat(path.join(dir, fileName)).catch(() => null);
        return {
          fileName,
          size: stat?.size || 0,
          createdAt: stat?.mtime.toISOString() || nowISO(),
          label: fileName.replace(/^backup-/, "").replace(/\.zip$/, ""),
        };
      })
  );
  return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
};

export const createBackupZip = async (server: ServerRecord, label = ""): Promise<BackupRecord> => {
  const dir = backupDir(server.id);
  await fs.ensureDir(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = (label || "manual").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40);
  const fileName = `backup-${safeLabel}-${stamp}.zip`;
  const outPath = path.join(dir, fileName);

  const output = fs.createWriteStream(outPath);
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.pipe(output);

  const source = serverDir(server.id);
  const entries = await fs.readdir(source).catch(() => []);
  for (const entry of entries) {
    // Skip caches that bloat backups
    if (["cache", "logs"].includes(entry)) continue;
    const full = path.join(source, entry);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) archive.directory(full, entry);
    else archive.file(full, { name: entry });
  }
  await archive.finalize();
  await new Promise<void>((resolve, reject) => {
    output.on("close", () => resolve());
    output.on("error", reject);
  });

  const stat = await fs.stat(outPath);
  return { fileName, size: stat.size, createdAt: stat.mtime.toISOString(), label: safeLabel };
};

export const restoreBackupZip = async (server: ServerRecord, fileName: string) => {
  const file = path.join(backupDir(server.id), path.basename(fileName));
  if (!(await fs.pathExists(file))) throw new Error("Backup file not found");
  const target = serverDir(server.id);
  await fs.ensureDir(target);
  await extract(file, { dir: target });
  return true;
};
