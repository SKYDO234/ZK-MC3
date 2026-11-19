import fs from "fs-extra";
import axios from "axios";
import path from "path";
import { serverDir } from "./db";
import { findServer } from "./runtime";
import { modrinthLoadersFor } from "./software";

/**
 * ZK-MC3-PANEL · Modrinth plugin/mod manager
 * ---------------------------------------------------------------------------
 * Mirrors the JTG panel's behaviour:
 *   • search is proxied through the panel, filtered to the server's project
 *     type (plugin vs mod) and its exact game version;
 *   • every project exposes its full build list, tagged release/beta/alpha;
 *   • "install" resolves the best compatible build (exact loader + exact game
 *     version → minor line → newest loader build) or an explicitly chosen one;
 *   • jars are read from and removed from plugins/ or mods/ directly.
 *
 * There is no curated offline catalogue: if Modrinth is unreachable the request
 * fails loudly so the operator knows the panel is offline, rather than silently
 * showing invented projects.
 */

const MODRINTH = "https://api.modrinth.com/v2";
const HEADERS = { "User-Agent": "ZK-MC3-PANEL/1.0 (+https://github.com/SKYDO234/ZK-MC3)" };

export interface CatalogHit {
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  follows: number;
  iconUrl: string | null;
  categories: string[];
  versions: string[];
  projectType: string;
  pageUrl: string;
}

const clean = (text: string) =>
  String(text || "")
    .replace(/<[^>]*>/g, "")
    .slice(0, 260);

const mapHit = (hit: any): CatalogHit => ({
  id: String(hit.project_id || hit.slug || ""),
  slug: String(hit.slug || ""),
  title: String(hit.title || "Unknown"),
  description: clean(hit.description || ""),
  author: String(hit.author || ""),
  downloads: Number(hit.downloads) || 0,
  follows: Number(hit.follows) || 0,
  iconUrl: hit.icon_url || null,
  categories: Array.isArray(hit.categories) ? hit.categories : [],
  versions: Array.isArray(hit.versions) ? hit.versions.slice(-8).reverse() : [],
  projectType: String(hit.project_type || ""),
  pageUrl: `https://modrinth.com/${hit.project_type || "plugin"}/${hit.slug || hit.project_id}`,
});

/**
 * Searches Modrinth for plugins or mods. Results are filtered to the requested
 * project type and, when supplied, to the server's exact game version.
 */
export const searchCatalog = async (
  query: string,
  target: "plugins" | "mods" = "plugins",
  gameVersion?: string,
  limit = 20
): Promise<{ source: "modrinth"; hits: CatalogHit[] }> => {
  const facet: any[] = [[target === "mods" ? "project_type:mod" : "project_type:plugin"]];
  if (gameVersion) facet.push([`versions:${gameVersion}`]);

  const params: Record<string, string> = {
    query: query || "",
    limit: String(limit),
    index: query ? "relevance" : "downloads",
    facets: JSON.stringify(facet),
  };
  const response = await axios.get(`${MODRINTH}/search`, { params, headers: HEADERS, timeout: 12000 });
  const hits = (response.data?.hits || []).map(mapHit);
  return { source: "modrinth", hits };
};

/** Full project record, used by the version picker. */
export const projectDetail = async (slugOrId: string) => {
  const response = await axios.get(`${MODRINTH}/project/${encodeURIComponent(slugOrId)}`, {
    headers: HEADERS,
    timeout: 12000,
  });
  const data = response.data || {};
  return {
    id: String(data.id || ""),
    slug: String(data.slug || ""),
    title: String(data.title || ""),
    description: clean(data.description || data.body || ""),
    iconUrl: data.icon_url || null,
    downloads: Number(data.downloads) || 0,
    followers: Number(data.followers) || 0,
    categories: Array.isArray(data.categories) ? data.categories : [],
    gameVersions: Array.isArray(data.game_versions) ? data.game_versions : [],
    loaders: Array.isArray(data.loaders) ? data.loaders : [],
    clientSide: data.client_side || "unknown",
    serverSide: data.server_side || "unknown",
    pageUrl: `https://modrinth.com/${data.project_type || "plugin"}/${data.slug || slugOrId}`,
  };
};

export interface ProjectVersion {
  id: string;
  name: string;
  versionNumber: string;
  versionType: "release" | "beta" | "alpha";
  downloads: number;
  datePublished: string;
  gameVersions: string[];
  loaders: string[];
  file: { url: string; filename: string; size: number; primary: boolean } | null;
}

const mapVersion = (v: any): ProjectVersion => {
  const files: any[] = Array.isArray(v.files) ? v.files : [];
  const file =
    files.find((f) => f.primary && String(f.filename).endsWith(".jar")) ||
    files.find((f) => String(f.filename).endsWith(".jar") && !/-sources|-dev/.test(String(f.filename))) ||
    files.find((f) => String(f.filename).endsWith(".jar")) ||
    files[0];
  return {
    id: String(v.id || ""),
    name: String(v.name || v.version_number || ""),
    versionNumber: String(v.version_number || ""),
    versionType: (v.version_type || "release") as ProjectVersion["versionType"],
    downloads: Number(v.downloads) || 0,
    datePublished: String(v.date_published || ""),
    gameVersions: Array.isArray(v.game_versions) ? v.game_versions : [],
    loaders: Array.isArray(v.loaders) ? v.loaders : [],
    file: file
      ? {
          url: String(file.url || ""),
          filename: String(file.filename || ""),
          size: Number(file.size) || 0,
          primary: Boolean(file.primary),
        }
      : null,
  };
};

/** All published versions for a project, optionally narrowed by loader/game version. */
export const projectVersions = async (
  slugOrId: string,
  gameVersion?: string,
  loader?: string
): Promise<ProjectVersion[]> => {
  const params: Record<string, string> = {};
  if (gameVersion) params.game_versions = JSON.stringify([gameVersion]);
  if (loader) params.loaders = JSON.stringify([loader]);
  const response = await axios.get(`${MODRINTH}/project/${encodeURIComponent(slugOrId)}/version`, {
    params,
    headers: HEADERS,
    timeout: 12000,
  });
  return (Array.isArray(response.data) ? response.data : []).map(mapVersion);
};

/**
 * Picks the best installable build for a server, following JTG's resolver:
 *   1. exact loader + exact game version
 *   2. exact loader + matching minor line (1.21 for 1.21.4)
 *   3. exact loader, newest build
 *   4. newest build of any kind
 */
export const resolveModrinthVersion = async (
  projectId: string,
  serverSoftware: string,
  serverVersion: string,
  specificVersionId?: string
): Promise<ProjectVersion | null> => {
  if (specificVersionId) {
    const res = await axios.get(`${MODRINTH}/version/${encodeURIComponent(specificVersionId)}`, {
      headers: HEADERS,
      timeout: 12000,
    });
    const mapped = mapVersion(res.data);
    return mapped.file ? mapped : null;
  }

  const loaders = modrinthLoadersFor(serverSoftware).map((l) => l.toLowerCase());
  const all = (await projectVersions(projectId)).filter((v) => v.file);
  if (!all.length) return null;

  const gameVer = String(serverVersion || "").trim();
  const loaderMatch = (v: ProjectVersion) =>
    !loaders.length || v.loaders.some((l) => loaders.includes(l.toLowerCase()));

  const exact = all.find((v) => loaderMatch(v) && v.gameVersions.includes(gameVer));
  if (exact) return exact;

  const minor = gameVer.split(".").slice(0, 2).join(".");
  if (minor) {
    const line = all.find((v) => loaderMatch(v) && v.gameVersions.some((gv) => gv.startsWith(minor)));
    if (line) return line;
  }

  return all.find(loaderMatch) || all[0] || null;
};

/**
 * Downloads a resolved Modrinth build (or a direct jar URL) straight into the
 * server's plugins/ or mods/ folder.
 */
export const installProjectFile = async (
  serverId: string,
  options: {
    url?: string;
    versionId?: string;
    projectId?: string;
    target?: "plugins" | "mods";
    fileName?: string;
    projectName?: string;
    projectSlug?: string;
  }
) => {
  const server = await findServer(serverId);
  if (!server) throw new Error("Server not found");

  const folder: "plugins" | "mods" = options.target === "mods" ? "mods" : "plugins";
  const dir = `${serverDir(server.id)}/${folder}`;
  await fs.ensureDir(dir);

  let downloadUrl = options.url || "";
  let name = options.fileName || "";
  let versionNumber = "";
  let versionId = options.versionId || "";

  if (!downloadUrl && options.projectId) {
    const resolved = await resolveModrinthVersion(
      options.projectId,
      server.software,
      server.version,
      options.versionId
    );
    if (!resolved?.file?.url) {
      throw new Error(
        `No compatible ${folder === "mods" ? "mod" : "plugin"} build of ${
          options.projectName || options.projectId
        } exists for ${server.software} ${server.version}.`
      );
    }
    downloadUrl = resolved.file.url;
    name = name || resolved.file.filename;
    versionNumber = resolved.versionNumber;
    versionId = resolved.id;
  } else if (!downloadUrl && options.versionId) {
    const res = await axios.get(`${MODRINTH}/version/${encodeURIComponent(options.versionId)}`, {
      headers: HEADERS,
      timeout: 12000,
    });
    const mapped = mapVersion(res.data);
    if (!mapped.file) throw new Error("That version has no downloadable jar.");
    downloadUrl = mapped.file.url;
    name = name || mapped.file.filename;
    versionNumber = mapped.versionNumber;
  }

  if (!downloadUrl || !/^https?:\/\//.test(downloadUrl)) {
    throw new Error("A valid download URL, project id or version id is required");
  }

  const response = await axios.get(downloadUrl, {
    responseType: "arraybuffer",
    timeout: 120000,
    headers: HEADERS,
    maxRedirects: 8,
  });
  const buffer = Buffer.from(response.data);
  if (buffer.length < 1024) throw new Error("The downloaded file is not a valid jar (too small).");

  const fallbackName = `${options.projectSlug || options.projectId || folder}-${Date.now()}.jar`;
  const safeName = String(name || fallbackName).replace(/[^a-zA-Z0-9._-]/g, "-");
  const fileName = safeName.endsWith(".jar") ? safeName : `${safeName}.jar`;
  await fs.writeFile(`${dir}/${fileName}`, buffer);

  return {
    fileName,
    folder,
    bytes: buffer.length,
    versionNumber,
    versionId,
    sourceUrl: downloadUrl,
  };
};

/** Jars currently sitting in plugins/ or mods/ for a server. */
export const listInstalledFiles = async (serverId: string, target: "plugins" | "mods") => {
  const dir = `${serverDir(serverId)}/${target}`;
  await fs.ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: Array<{ filename: string; size: number; modified: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jar")) continue;
    const stat = await fs.stat(`${dir}/${entry.name}`).catch(() => null);
    files.push({
      filename: entry.name,
      size: stat?.size || 0,
      modified: stat?.mtimeMs || 0,
    });
  }
  return files.sort((a, b) => b.modified - a.modified);
};

/** Removes a single jar from plugins/ or mods/. */
export const removeInstalledFile = async (serverId: string, target: "plugins" | "mods", filename: string) => {
  const safe = path.basename(filename);
  if (!safe.toLowerCase().endsWith(".jar")) throw new Error("Only .jar files can be removed here.");
  const file = `${serverDir(serverId)}/${target}/${safe}`;
  if (!(await fs.pathExists(file))) throw new Error("That file is no longer on disk.");
  await fs.remove(file);
  return safe;
};

const loaderFor = (software: string) => modrinthLoadersFor(software)[0] || "bukkit";

/** Loader identifier used when querying Modrinth for a server's software. */
export const serverLoader = (software: string) => loaderFor(software);
