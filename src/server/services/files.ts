import fs from "fs-extra";
import axios from "axios";
import { serverDir } from "./db";
import { findServer } from "./runtime";

/**
 * Server-side plugin / mod catalog.
 *
 * The browser cannot reliably call Modrinth (CSP, CORS, offline admin
 * networks), so searches and downloads are proxied through the panel.
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

/** Offline-friendly catalog used when Modrinth cannot be reached. */
export const FALLBACK_CATALOG: CatalogHit[] = [
  {
    id: "essentialsx",
    slug: "essentialsx",
    title: "EssentialsX",
    description: "The essential plugin suite for Bukkit/Spigot/Paper servers: homes, warps, kits, economy and 130+ commands.",
    author: "EssentialsX",
    downloads: 48200000,
    follows: 12400,
    iconUrl: null,
    categories: ["management", "utility"],
    versions: ["1.21.4", "1.21.1", "1.20.6"],
    projectType: "plugin",
    pageUrl: "https://modrinth.com/plugin/essentialsx",
  },
  {
    id: "luckperms",
    slug: "luckperms",
    title: "LuckPerms",
    description: "A permissions plugin with a web editor, contexts and full inheritance — the industry standard.",
    author: "Luck",
    downloads: 39100000,
    follows: 9800,
    iconUrl: null,
    categories: ["management"],
    versions: ["1.21.4", "1.21.1", "1.20.6"],
    projectType: "plugin",
    pageUrl: "https://modrinth.com/plugin/luckperms",
  },
  {
    id: "worldedit",
    slug: "worldedit",
    title: "WorldEdit",
    description: "In-game map editor with brushes, schematics and terrain generation for builders.",
    author: "EngineHub",
    downloads: 28400000,
    follows: 7100,
    iconUrl: null,
    categories: ["utility", "decoration"],
    versions: ["1.21.4", "1.21.1", "1.20.6"],
    projectType: "plugin",
    pageUrl: "https://modrinth.com/plugin/worldedit",
  },
  {
    id: "viaversion",
    slug: "viaversion",
    title: "ViaVersion",
    description: "Allow newer Minecraft clients to connect to older servers, and vice versa.",
    author: "ViaVersion",
    downloads: 21300000,
    follows: 6300,
    iconUrl: null,
    categories: ["utility"],
    versions: ["1.21.4", "1.21.1"],
    projectType: "plugin",
    pageUrl: "https://modrinth.com/plugin/viaversion",
  },
  {
    id: "fabric-api",
    slug: "fabric-api",
    title: "Fabric API",
    description: "Required library for almost every Fabric mod. Always install this first.",
    author: "FabricMC",
    downloads: 61300000,
    follows: 15600,
    iconUrl: null,
    categories: ["library"],
    versions: ["1.21.4", "1.21.1", "1.20.6"],
    projectType: "mod",
    pageUrl: "https://modrinth.com/mod/fabric-api",
  },
  {
    id: "lithium",
    slug: "lithium",
    title: "Lithium",
    description: "Performance optimisation mod for the game logic — no behaviour changes.",
    author: "CaffeineMC",
    downloads: 18700000,
    follows: 8200,
    iconUrl: null,
    categories: ["optimization"],
    versions: ["1.21.4", "1.21.1"],
    projectType: "mod",
    pageUrl: "https://modrinth.com/mod/lithium",
  },
  {
    id: "sodium",
    slug: "sodium",
    title: "Sodium",
    description: "Modern rendering engine replacement for smoother frame rates.",
    author: "CaffeineMC",
    downloads: 44500000,
    follows: 19800,
    iconUrl: null,
    categories: ["optimization"],
    versions: ["1.21.4", "1.21.1"],
    projectType: "mod",
    pageUrl: "https://modrinth.com/mod/sodium",
  },
  {
    id: "geyser",
    slug: "geyser",
    title: "Geyser",
    description: "Let Bedrock Edition players join your Java server.",
    author: "GeyserMC",
    downloads: 14200000,
    follows: 5100,
    iconUrl: null,
    categories: ["utility"],
    versions: ["1.21.4", "1.21.1"],
    projectType: "plugin",
    pageUrl: "https://modrinth.com/plugin/geyser",
  },
];

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

export const searchCatalog = async (
  query: string,
  target: "plugins" | "mods" = "plugins",
  gameVersion?: string
): Promise<{ source: "modrinth" | "offline"; hits: CatalogHit[] }> => {
  const facet: any[] = [[target === "mods" ? "project_type:mod" : "project_type:plugin"]];
  if (gameVersion) facet.push([`versions:${gameVersion}`]);
  try {
    const params: Record<string, string> = {
      query: query || "",
      limit: "12",
      index: "relevance",
      facets: JSON.stringify(facet),
    };
    const response = await axios.get(`${MODRINTH}/search`, { params, headers: HEADERS, timeout: 8000 });
    const hits = (response.data?.hits || []).map(mapHit);
    return { source: "modrinth", hits };
  } catch {
    const needle = (query || "").toLowerCase();
    const hits = FALLBACK_CATALOG.filter(
      (item) =>
        item.projectType === (target === "mods" ? "mod" : "plugin") &&
        (!needle ||
          item.title.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle) ||
          item.categories.some((c) => c.includes(needle)))
    );
    return { source: "offline", hits };
  }
};

export const projectVersions = async (slug: string, gameVersion: string, loader: string) => {
  const params: Record<string, string> = {};
  if (gameVersion) params.game_versions = `["${gameVersion}"]`;
  if (loader) params.loaders = `["${loader}"]`;
  const response = await axios.get(`${MODRINTH}/project/${encodeURIComponent(slug)}/version`, {
    params,
    headers: HEADERS,
    timeout: 8000,
  });
  return (response.data || []).map((v: any) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    versionType: v.version_type,
    downloads: v.downloads,
    datePublished: v.date_published,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    file: v.files?.find((f: any) => f.primary) || v.files?.[0] || null,
  }));
};

const loaderFor = (software: string) => {
  const key = String(software || "").toUpperCase();
  if (key === "FABRIC") return "fabric";
  if (key === "FORGE") return "forge";
  if (key === "NEOFORGE") return "neoforge";
  if (key === "QUILT") return "quilt";
  if (key === "VELOCITY") return "velocity";
  if (key === "BUNGEECORD" || key === "WATERFALL") return "bungeecord";
  return "bukkit";
};

/**
 * Downloads a Modrinth version (or any direct jar URL) straight into the
 * server's plugins/ or mods/ folder. Returns the installed file name.
 */
export const installProjectFile = async (
  serverId: string,
  options: { url?: string; versionId?: string; target?: "plugins" | "mods"; fileName?: string }
) => {
  const server = await findServer(serverId);
  if (!server) throw new Error("Server not found");

  const folder = options.target === "mods" ? "mods" : "plugins";
  const dir = `${serverDir(server.id)}/${folder}`;
  await fs.ensureDir(dir);

  let downloadUrl = options.url || "";
  let name = options.fileName || "";

  if (options.versionId) {
    // Resolve the file through Modrinth so the panel also works from a browser
    // that cannot reach the API, and so we always get a .jar URL.
    const version = await axios.get(`${MODRINTH}/version/${encodeURIComponent(options.versionId)}`, {
      headers: HEADERS,
      timeout: 8000,
    });
    const file = version.data?.files?.find((f: any) => f.primary) || version.data?.files?.[0];
    if (!file?.url) throw new Error("That version has no downloadable file");
    downloadUrl = file.url;
    name = name || file.filename || "";
  }

  if (!downloadUrl || !/^https?:\/\//.test(downloadUrl)) {
    throw new Error("A valid download URL or version id is required");
  }

  const response = await axios.get(downloadUrl, { responseType: "arraybuffer", timeout: 60000, headers: HEADERS });
  const buffer = Buffer.from(response.data);
  if (buffer.length < 1024) throw new Error("Downloaded file looks invalid (too small)");

  const fallbackName = `${loaderFor(server.software)}-${Date.now()}.jar`;
  const safeName = String(name || fallbackName).replace(/[^a-zA-Z0-9._-]/g, "-");
  const fileName = safeName.endsWith(".jar") ? safeName : `${safeName}.jar`;
  await fs.writeFile(`${dir}/${fileName}`, buffer);

  return { fileName, folder, bytes: buffer.length };
};

/** Loader identifier used when querying Modrinth for a server's software. */
export const serverLoader = (software: string) => loaderFor(software);
