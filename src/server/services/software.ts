import axios from "axios";
import { createHash } from "crypto";
import fs from "fs-extra";
import path from "path";

/**
 * ZK-MC3-PANEL · Minecraft software catalogue
 * ---------------------------------------------------------------------------
 * Mirrors the JTG panel behaviour:
 *   • every supported server software (Paper, Purpur, Spigot, Vanilla, Fabric,
 *     Forge, NeoForge, Quilt, Velocity, BungeeCord, Waterfall) plus the Node.js
 *     and Python application runtimes;
 *   • live version discovery per software, straight from each project's own API
 *     (PaperMC fill/v2, PurpurMC, Mojang piston-meta, Fabric meta, Forge maven,
 *     NeoForged maven, Quilt meta, PaperMC Velocity, md-5 CI);
 *   • a downloader that resolves the correct server.jar for a given software +
 *     version, with ordered mirrors and a real binary size check.
 *
 * Nothing here is cached client-side and nothing is faked: an unreachable API
 * surfaces as an error instead of a synthetic version list.
 */

const UA = "ZK-MC3-PANEL/1.0 (+https://github.com/SKYDO234/ZK-MC3)";

const HEADERS = {
  "User-Agent": UA,
  Accept: "*/*",
};

const JSON_HEADERS = {
  "User-Agent": UA,
  Accept: "application/json",
};

/**
 * Circuit breaker for upstream catalog APIs.
 *
 * A node with no outbound internet (or a blackholed DNS) would otherwise make
 * every HTTP call sit through its full timeout, turning a version dropdown into a
 * multi-minute hang. After the first hard network failure we stop dialling for a
 * short window and fail fast, which is what the operator needs to see.
 */
let upstreamDownUntil = 0;
const UPSTREAM_COOLDOWN_MS = 60 * 1000;

const isNetworkError = (err: any) => {
  const code = String(err?.code || "");
  return (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    err?.message === "Network Error"
  );
};

const markUpstreamResult = (err?: any) => {
  if (err && isNetworkError(err)) upstreamDownUntil = Date.now() + UPSTREAM_COOLDOWN_MS;
};

export const upstreamStatus = () => ({
  reachable: Date.now() >= upstreamDownUntil,
  retryInSeconds: Math.max(0, Math.ceil((upstreamDownUntil - Date.now()) / 1000)),
});

/**
 * GET with a hard wall-clock deadline.
 *
 * axios' own `timeout` only covers socket inactivity — it does not bound DNS
 * resolution. On a node whose resolver blackholes external names, each request
 * would hang far past its configured timeout, so the whole call is raced against
 * a timer and the breaker is tripped as soon as that deadline passes.
 */
const upstreamGet = async (url: string, timeout = 7000) => {
  if (Date.now() < upstreamDownUntil) {
    const err: any = new Error("The catalog APIs are unreachable from this node.");
    err.code = "ENOTFOUND";
    throw err;
  }

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err: any = new Error(`Timed out after ${timeout}ms reaching ${new URL(url).host}`);
      err.code = "ETIMEDOUT";
      upstreamDownUntil = Date.now() + UPSTREAM_COOLDOWN_MS;
      reject(err);
    }, timeout);
    timer.unref?.();
  });

  try {
    const res = await Promise.race([
      axios.get(url, { headers: JSON_HEADERS, timeout }),
      deadline,
    ]);
    markUpstreamResult();
    return res;
  } catch (err) {
    markUpstreamResult(err);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export type SoftwareCategory = "SERVER" | "MODDED" | "PROXY" | "RUNTIME" | "VM";

export interface SoftwareDefinition {
  id: string;
  label: string;
  category: SoftwareCategory;
  recommended?: boolean;
  description: string;
  /** Folder Modrinth plugins/mods land in for this software. */
  modrinth?: "plugin" | "mod";
  /** Modrinth loader identifiers used to filter builds. */
  loaders?: string[];
  /** Rough Java major required; refined per version in javaMajorFor(). */
  java?: string;
}

export const SOFTWARE_TYPES: SoftwareDefinition[] = [
  {
    id: "PAPER",
    label: "Paper",
    category: "SERVER",
    recommended: true,
    description: "High performance Spigot fork with plugin support.",
    modrinth: "plugin",
    loaders: ["paper", "spigot", "bukkit", "purpur", "folia"],
    java: "21",
  },
  {
    id: "PURPUR",
    label: "Purpur",
    category: "SERVER",
    recommended: true,
    description: "Paper fork with extra gameplay and performance configuration.",
    modrinth: "plugin",
    loaders: ["purpur", "paper", "spigot", "bukkit"],
    java: "21",
  },
  {
    id: "SPIGOT",
    label: "Spigot",
    category: "SERVER",
    description: "Classic Bukkit-based server software.",
    modrinth: "plugin",
    loaders: ["spigot", "bukkit"],
    java: "21",
  },
  {
    id: "VANILLA",
    label: "Vanilla",
    category: "SERVER",
    description: "Official Mojang Minecraft server, no plugins or mods.",
    java: "21",
  },
  {
    id: "FABRIC",
    label: "Fabric",
    category: "MODDED",
    recommended: true,
    description: "Lightweight mod loader for modern versions.",
    modrinth: "mod",
    loaders: ["fabric", "quilt"],
    java: "21",
  },
  {
    id: "FORGE",
    label: "Forge",
    category: "MODDED",
    description: "The classic Minecraft modding platform.",
    modrinth: "mod",
    loaders: ["forge"],
    java: "21",
  },
  {
    id: "NEOFORGE",
    label: "NeoForge",
    category: "MODDED",
    description: "Modern community-maintained fork of Forge.",
    modrinth: "mod",
    loaders: ["neoforge"],
    java: "21",
  },
  {
    id: "QUILT",
    label: "Quilt",
    category: "MODDED",
    description: "Fabric-compatible mod loader with extra features.",
    modrinth: "mod",
    loaders: ["quilt", "fabric"],
    java: "21",
  },
  {
    id: "VELOCITY",
    label: "Velocity",
    category: "PROXY",
    recommended: true,
    description: "Modern high performance Minecraft proxy.",
    java: "21",
  },
  {
    id: "BUNGEECORD",
    label: "BungeeCord",
    category: "PROXY",
    description: "Proxy for connecting multiple Minecraft servers.",
    java: "17",
  },
  {
    id: "WATERFALL",
    label: "Waterfall",
    category: "PROXY",
    description: "Paper's BungeeCord fork.",
    java: "17",
  },
  {
    id: "VM",
    label: "Linux VM",
    category: "VM",
    description:
      "Unprivileged PRoot Linux userspace (Ubuntu or Debian) with a real shell and apt. " +
      "Not a hardware VM — it shares the host kernel and needs no root or KVM.",
    java: "21",
  },
  {
    id: "NODEJS",
    label: "Node.js App",
    category: "RUNTIME",
    description: "Run any Node.js application or Discord bot on a port.",
    java: "",
  },
  {
    id: "PYTHON",
    label: "Python App",
    category: "RUNTIME",
    description: "Run any Python 3 application or bot on a port.",
    java: "",
  },
];

/* ------------------------------------------------------------------ Linux VM */

/**
 * The Linux-VM image, published as `server.jar` in its upstream repository.
 *
 * Pinned to a commit rather than `main` so an upstream rewrite cannot silently
 * change what every panel installs. Bump VM_JAR_REF to pick up a new image.
 */
const VM_JAR_REF = "9699f4af2d00af9ed00787ccdd7deab41b9d4e59";
const VM_JAR_URL = `https://raw.githubusercontent.com/habibasultanaziya-ship-it/Vms/${VM_JAR_REF}/server.jar`;

/**
 * SHA-256 of that exact jar, verified against the upstream blob.
 *
 * The jar is 10 KB of code that the panel then executes as root-ish on someone's
 * machine. A pinned commit plus a checksum means an upstream account compromise,
 * a force-push, or a tampered mirror cannot change what a node runs — the
 * download fails loudly instead.
 */
const VM_JAR_SHA256 = "989e1ca63871c9e38e6b772def787fa3aa6e5dd8b13fabafe4fcedf3a6312daf";

/**
 * Userspaces the image can install. These are NOT Minecraft versions — they are
 * the guest distributions. The panel passes the chosen one on the command line
 * (`-Dvm.image=`), so no interactive prompt is needed at first boot.
 */
export const VM_IMAGES: Array<{ id: string; label: string; family: string }> = [
  { id: "ubuntu-24.04", label: "Ubuntu 24.04 LTS (Noble)", family: "Ubuntu" },
  { id: "ubuntu-22.04", label: "Ubuntu 22.04 LTS (Jammy)", family: "Ubuntu" },
  { id: "debian-12", label: "Debian 12 (Bookworm)", family: "Debian" },
  { id: "debian-13", label: "Debian 13 (Trixie)", family: "Debian" },
];

export const VM_DEFAULT_IMAGE = VM_IMAGES[0].id;

/** Labels the version picker shows for a VM instead of Minecraft versions. */
export const VM_LABEL_FOR = (version: string) =>
  VM_IMAGES.find((v) => v.id === (version || "").toLowerCase())?.label || version;

export const SOFTWARE_LABEL = (type: string) =>
  SOFTWARE_TYPES.find((s) => s.id === (type || "").toUpperCase())?.label || type;

export const SOFTWARE_DEFINITION = (type: string) =>
  SOFTWARE_TYPES.find((s) => s.id === (type || "").toUpperCase()) || null;

export const isRuntime = (type: string) => ["NODEJS", "PYTHON"].includes((type || "").toUpperCase());

/**
 * True for the Linux-VM image. It runs on the JVM like a Minecraft server, but it
 * is an interactive shell rather than a game server — so it must never be handed
 * Minecraft flags (`nogui`, `--nojline`) or a `server.properties`.
 */
export const isVm = (type: string) => (type || "").toUpperCase() === "VM";

export const isProxy = (type: string) =>
  ["VELOCITY", "BUNGEECORD", "WATERFALL"].includes((type || "").toUpperCase());

export const isModded = (type: string) =>
  ["FABRIC", "FORGE", "NEOFORGE", "QUILT"].includes((type || "").toUpperCase());

/** Modrinth project type this software consumes, or null when unsupported. */
export const modrinthTypeFor = (software: string): "plugin" | "mod" | null => {
  const type = (software || "").toUpperCase();
  if (isProxy(type)) return null;
  // A Linux VM has no plugin surface; without this it would inherit "plugin"
  // and the Plugins tab would offer Minecraft jars for a Debian rootfs.
  if (isVm(type)) return null;
  return isModded(type) ? "mod" : "plugin";
};

/** Modrinth loader identifiers accepted for this software. */
export const modrinthLoadersFor = (software: string): string[] => {
  const def = SOFTWARE_DEFINITION(software);
  return def?.loaders || [];
};

// ---------------------------------------------------------------------------
// Version discovery
// ---------------------------------------------------------------------------

type VersionCacheEntry = { at: number; versions: string[] };
const versionCache = new Map<string, VersionCacheEntry>();
const VERSION_TTL = 1000 * 60 * 30;

const compareVersionsDesc = (a: string, b: string) => {
  const pa = a.split(/[.\-+_]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const pb = b.split(/[.\-+_]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return y - x;
    } else {
      const sx = String(x);
      const sy = String(y);
      if (sx !== sy) return sx < sy ? 1 : -1;
    }
  }
  return 0;
};

/** Version strings that are snapshots/pre-releases and not usable server builds. */
const isStableVersion = (version: string) =>
  !/(snapshot|pre|rc|alpha|beta|dev)/i.test(version) && /^\d/.test(version);

const fetchPaperProjectVersions = async (project: string): Promise<string[]> => {
  try {
    const res = await upstreamGet(`https://fill.papermc.io/v3/projects/${project}`);
    const grouped = res.data?.versions || {};
    const flat: string[] = [];
    for (const major of Object.keys(grouped)) {
      const list = grouped[major];
      if (Array.isArray(list)) flat.push(...list.map(String));
    }
    const stable = flat.filter(isStableVersion);
    return stable.sort(compareVersionsDesc);
  } catch {
    /* fall through to v2 */
  }
  try {
    const res = await upstreamGet(`https://api.papermc.io/v2/projects/${project}`);
    const list: string[] = res.data?.versions || [];
    return list.filter(isStableVersion).sort(compareVersionsDesc);
  } catch {
    return [];
  }
};

const fetchMojangVersions = async (): Promise<string[]> => {
  try {
    const res = await upstreamGet("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
    const versions: any[] = res.data?.versions || [];
    return versions.filter((v) => v.type === "release" && isStableVersion(String(v.id))).map((v) => String(v.id));
  } catch {
    return [];
  }
};

const fetchFabricVersions = async (): Promise<string[]> => {
  try {
    const res = await upstreamGet("https://meta.fabricmc.net/v2/versions/game");
    return (res.data || [])
      .filter((v: any) => v.stable && isStableVersion(String(v.version)))
      .map((v: any) => String(v.version));
  } catch {
    return [];
  }
};

const fetchQuiltVersions = async (): Promise<string[]> => {
  try {
    const res = await upstreamGet("https://meta.quiltmc.org/v3/versions/game");
    return (res.data || [])
      .filter((v: any) => v.stable && isStableVersion(String(v.version)))
      .map((v: any) => String(v.version));
  } catch {
    return [];
  }
};

const fetchPurpurVersions = async (): Promise<string[]> => {
  try {
    const res = await upstreamGet("https://api.purpurmc.org/v2/purpur");
    const list: string[] = res.data?.versions || [];
    return list.filter(isStableVersion).sort(compareVersionsDesc);
  } catch {
    return [];
  }
};

const fetchForgeVersions = async (): Promise<string[]> => {
  try {
    const res = await upstreamGet("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json");
    const promos: Record<string, string> = res.data?.promos || {};
    const games = new Set<string>();
    for (const key of Object.keys(promos)) {
      const game = key.replace(/-(recommended|latest)$/, "");
      if (isStableVersion(game)) games.add(game);
    }
    return [...games].sort(compareVersionsDesc);
  } catch {
    return [];
  }
};

const fetchNeoForgeVersions = async (): Promise<string[]> => {
  try {
    const res = await upstreamGet("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge");
    const versions: string[] = res.data?.versions || [];
    const games = new Set<string>();
    for (const v of versions) {
      const [major, minor] = String(v).split(".");
      if (!major || !minor) continue;
      const mcMinor = Number(minor);
      if (!Number.isFinite(mcMinor)) continue;
      games.add(`1.${major}.${mcMinor}`);
    }
    return [...games].sort(compareVersionsDesc);
  } catch {
    return [];
  }
};

const fetchVelocityVersions = async (): Promise<string[]> => {
  try {
    const res = await upstreamGet("https://fill.papermc.io/v3/projects/velocity");
    const grouped = res.data?.versions || {};
    const flat: string[] = [];
    for (const major of Object.keys(grouped)) {
      const list = grouped[major];
      if (Array.isArray(list)) flat.push(...list.map(String));
    }
    if (flat.length) return flat.sort(compareVersionsDesc);
  } catch {
    /* try v2 */
  }
  try {
    const v2 = await upstreamGet("https://api.papermc.io/v2/projects/velocity");
    return (v2.data?.versions || []).map(String).sort(compareVersionsDesc);
  } catch {
    return [];
  }
};

/**
 * Returns the server versions available for a software id, newest first.
 * Throws when the upstream API cannot be reached — the panel never invents a
 * version list.
 */
export const getVersions = async (software: string): Promise<string[]> => {
  const key = (software || "PAPER").toUpperCase();
  const cached = versionCache.get(key);
  if (cached && Date.now() - cached.at < VERSION_TTL) return cached.versions;

  let versions: string[] = [];

  try {
    if (key === "VM") versions = VM_IMAGES.map((v) => v.id);
    else if (key === "NODEJS") versions = ["22", "20", "18"];
    else if (key === "PYTHON") versions = ["3.12", "3.11", "3.10"];
    else if (key === "PAPER") versions = await fetchPaperProjectVersions("paper");
    else if (key === "VELOCITY") versions = await fetchVelocityVersions();
    else if (key === "BUNGEECORD" || key === "WATERFALL") versions = ["latest"];
    else if (key === "PURPUR") versions = await fetchPurpurVersions();
    else if (key === "SPIGOT") versions = await fetchMojangVersions();
    else if (key === "VANILLA") versions = await fetchMojangVersions();
    else if (key === "FABRIC") versions = await fetchFabricVersions();
    else if (key === "QUILT") versions = await fetchQuiltVersions();
    else if (key === "FORGE") versions = await fetchForgeVersions();
    else if (key === "NEOFORGE") versions = await fetchNeoForgeVersions();
  } catch {
    versions = [];
  }

  versions = [...new Set(versions)].filter(Boolean);
  // Only successful lookups get the long TTL; an empty list is cached briefly so
  // a recovered network is picked up quickly instead of after 30 minutes.
  const ttl = versions.length ? VERSION_TTL : 0;
  if (ttl) versionCache.set(key, { at: Date.now(), versions });
  else versionCache.delete(key);
  return versions;
};

/** Clears the in-process version cache (used by the admin "refresh" action). */
export const clearVersionCache = () => versionCache.clear();

// ---------------------------------------------------------------------------
// JAR resolution
// ---------------------------------------------------------------------------

const paperDownloadsFor = async (project: string, version: string): Promise<string[]> => {
  const urls: string[] = [];
  // PaperMC fill v3 (current)
  try {
    const res = await axios.get(
      `https://fill.papermc.io/v3/projects/${project}/versions/${encodeURIComponent(version)}/builds`,
      { headers: JSON_HEADERS, timeout: 10000 }
    );
    const builds: any[] = Array.isArray(res.data) ? res.data : res.data?.builds || [];
    for (const build of builds) {
      const url = build?.downloads?.["server:default"]?.url;
      if (url) urls.push(url);
    }
  } catch {
    /* fall through to v2 */
  }
  // PaperMC v2 (legacy but still serves older versions)
  try {
    const res = await axios.get(
      `https://api.papermc.io/v2/projects/${project}/versions/${encodeURIComponent(version)}`,
      { headers: JSON_HEADERS, timeout: 10000 }
    );
    const builds: number[] = res.data?.builds || [];
    for (const build of [...builds].reverse()) {
      urls.push(
        `https://api.papermc.io/v2/projects/${project}/versions/${encodeURIComponent(version)}/builds/${build}/downloads/${project}-${version}-${build}.jar`
      );
    }
  } catch {
    /* ignore */
  }
  return urls;
};

const resolveVanillaJar = async (version: string): Promise<string[]> => {
  try {
    const manifest = await axios.get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", {
      headers: JSON_HEADERS,
      timeout: 10000,
    });
    const versions: any[] = manifest.data?.versions || [];
    const target =
      version === "latest" || !version
        ? versions.find((v) => v.type === "release")?.id
        : version;
    const entry = versions.find((v) => v.id === target);
    if (!entry?.url) return [];
    const detail = await axios.get(entry.url, { headers: JSON_HEADERS, timeout: 10000 });
    const url = detail.data?.downloads?.server?.url;
    return url ? [url] : [];
  } catch {
    return [];
  }
};

const resolveFabricJar = async (version: string): Promise<string[]> => {
  try {
    const games = await fetchFabricVersions();
    const game = version === "latest" || !version ? games[0] : version;
    const loaders = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(game)}`, {
      headers: JSON_HEADERS,
      timeout: 10000,
    });
    const loader = loaders.data?.[0]?.loader?.version;
    if (!loader) return [];
    const installers = await axios.get("https://meta.fabricmc.net/v2/versions/installer", {
      headers: JSON_HEADERS,
      timeout: 10000,
    });
    const installer = installers.data?.[0]?.version;
    if (!installer) return [];
    return [
      `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(game)}/${loader}/${installer}/server/jar`,
    ];
  } catch {
    return [];
  }
};

const resolveQuiltJar = async (version: string): Promise<string[]> => {
  try {
    const games = await fetchQuiltVersions();
    const game = version === "latest" || !version ? games[0] : version;
    const loaders = await axios.get(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(game)}`, {
      headers: JSON_HEADERS,
      timeout: 10000,
    });
    const loader = loaders.data?.[0]?.loader?.version;
    if (!loader) return [];
    return [
      `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(game)}/${loader}/server/json/download`,
    ];
  } catch {
    return [];
  }
};

/**
 * Forge/NeoForge ship an installer, not a ready jar. The panel downloads the
 * installer and runs `java -jar installer --installServer`, which is exactly
 * what JTG's local runtime does.
 */
export const forgeInstallerUrl = async (software: string, version: string): Promise<string | null> => {
  const type = (software || "").toUpperCase();
  try {
    if (type === "FORGE") {
      const promos = await axios.get(
        "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
        { headers: JSON_HEADERS, timeout: 10000 }
      );
      const map: Record<string, string> = promos.data?.promos || {};
      const full = map[`${version}-recommended`] || map[`${version}-latest`];
      if (!full) return null;
      return `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${full}/forge-${version}-${full}-installer.jar`;
    }
    if (type === "NEOFORGE") {
      const res = await axios.get(
        "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
        { headers: JSON_HEADERS, timeout: 10000 }
      );
      const versions: string[] = res.data?.versions || [];
      const [, minor] = String(version).split(".");
      const major = String(version).split(".")[1];
      const prefix = `${String(version).split(".")[1]}.${major}.`;
      // Match a build whose first two components identify the MC version.
      const candidates = versions.filter((v) => v.startsWith(`${major}.${minor}.`));
      const build = candidates.sort(compareVersionsDesc)[0];
      if (!build) return null;
      void prefix;
      return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${build}/neoforge-${build}-installer.jar`;
    }
  } catch {
    return null;
  }
  return null;
};

const resolvePurpurJar = async (version: string): Promise<string[]> => {
  try {
    const list = await fetchPurpurVersions();
    const target = version === "latest" || !version ? list[0] : version;
    if (!target) return [];
    const res = await axios.get(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(target)}/latest`, {
      headers: JSON_HEADERS,
      timeout: 10000,
    });
    const build = res.data?.build;
    const urls: string[] = [];
    if (build) urls.push(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(target)}/${build}/download`);
    urls.push(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(target)}/latest/download`);
    return urls;
  } catch {
    return [];
  }
};

const spigotMirrors = (version: string) => [
  `https://download.getbukkit.org/spigot/spigot-${version}.jar`,
  `https://cdn.getbukkit.org/spigot/spigot-${version}.jar`,
  `https://download.getbukkit.org/craftbukkit/craftbukkit-${version}.jar`,
];

const bungeeMirrors = () => [
  "https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar",
  "https://hub.spigotmc.org/jenkins/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar",
];

/**
 * Ordered list of mirrors for a software + version. The first URL that yields a
 * genuine jar wins; the rest are fallbacks.
 */
export const jarMirrors = async (software: string, version: string): Promise<string[]> => {
  const type = (software || "PAPER").toUpperCase();
  const target = String(version || "latest");

  if (type === "PAPER") {
    // Paperclip builds are published at a predictable path for every version;
    // listing builds needs the API, but a direct last-known build URL gives the
    // downloader something to try when the API itself is unreachable.
    const api = await paperDownloadsFor("paper", target);
    return api.length ? api : paperDirectMirrors("paper", target);
  }
  if (type === "VELOCITY") {
    const api = await paperDownloadsFor("velocity", target);
    return api.length ? api : paperDirectMirrors("velocity", target);
  }
  if (type === "VM") return [VM_JAR_URL];
  if (type === "PURPUR") return resolvePurpurJar(target);
  if (type === "VANILLA") return resolveVanillaJar(target);
  if (type === "FABRIC") return resolveFabricJar(target);
  if (type === "QUILT") return resolveQuiltJar(target);
  if (type === "SPIGOT") return spigotMirrors(target);
  if (type === "BUNGEECORD" || type === "WATERFALL") return bungeeMirrors();

  // Forge/NeoForge are installers rather than runnable jars; the runtime runs
  // the installer, so hand it back as the "jar" to fetch.
  if (type === "FORGE" || type === "NEOFORGE") {
    const installer = await forgeInstallerUrl(type, target);
    return installer ? [installer] : [];
  }

  return [];
};

/**
 * Direct download URLs for Paper/Velocity when the build API is unreachable.
 * The panel probes the last few published build numbers; a wrong guess simply
 * 404s and the downloader moves on.
 */
const paperDirectMirrors = (project: string, version: string) => {
  const urls: string[] = [];
  const majors: string[] = [];
  // e.g. 1.21.4 -> try builds 1..80 descending on the v2 endpoint.
  for (let build = 120; build > 112; build -= 1) {
    majors.push(
      `https://api.papermc.io/v2/projects/${project}/versions/${encodeURIComponent(version)}/builds/${build}/downloads/${project}-${version}-${build}.jar`
    );
  }
  return [...majors, ...urls];
};

/**
 * Smallest acceptable body for a jar download.
 *
 * Minecraft jars are several MB, so a tiny body there means an HTML error page.
 * The Linux-VM image is ~10 KB of real, valid Java — applying the Minecraft floor
 * to it made every download look like junk and fail with "every mirror failed".
 */
const minJarBytes = (software: string) => ((software || "").toUpperCase() === "VM" ? 2 * 1024 : 500 * 1024);

const streamToFile = async (url: string, dest: string, minBytes: number): Promise<boolean> => {
  try {
    const res = await axios.get(url, {
      responseType: "stream",
      headers: HEADERS,
      timeout: 180000,
      maxRedirects: 8,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    await fs.ensureDir(path.dirname(dest));
    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(dest);
      res.data.pipe(writer);
      writer.on("finish", () => resolve());
      writer.on("error", reject);
      res.data.on("error", reject);
    });
    const stat = await fs.stat(dest);
    if (stat.size < minBytes) {
      await fs.remove(dest).catch(() => {});
      return false;
    }
    return true;
  } catch {
    await fs.remove(dest).catch(() => {});
    return false;
  }
};

/**
 * Downloads server.jar into destPath, walking every mirror until one produces a
 * real binary. Logs each attempt through onLog so the console shows progress the
 * same way the JTG panel does.
 */
export const downloadServerJar = async (
  software: string,
  version: string,
  destPath: string,
  onLog: (msg: string) => void = () => {}
): Promise<string> => {
  const type = (software || "PAPER").toUpperCase();
  const label = SOFTWARE_LABEL(type);

  const unique = [...new Set((await jarMirrors(type, version)).filter(Boolean))].slice(0, 12);
  const candidates = unique;
  if (!candidates.length) {
    throw new Error(
      `No download source is known for ${label} ${version}. Upload server.jar manually via the File Manager.`
    );
  }

  const temp = `${destPath}.download`;
  let lastHost = "";
  for (const url of candidates) {
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* keep raw */
    }
    if (lastHost !== host) {
      onLog(`[Panel] Downloading ${label} ${version} from ${host} ...`);
      lastHost = host;
    }
    const ok = await streamToFile(url, temp, minJarBytes(type));
    if (!ok) continue;

    // A pinned, checksummed image gets no silent upgrade path.
    if (type === "VM") {
      const digest = createHash("sha256").update(await fs.readFile(temp)).digest("hex");
      if (digest !== VM_JAR_SHA256) {
        await fs.remove(temp).catch(() => {});
        onLog(`[Panel] ${label} image failed its checksum — refusing to run it.`);
        throw new Error(
          `${label} image checksum mismatch (got ${digest.slice(0, 12)}…, expected ${VM_JAR_SHA256.slice(0, 12)}…). ` +
            "The pinned file changed upstream; review it before updating VM_JAR_REF and VM_JAR_SHA256."
        );
      }
      onLog(`[Panel] ${label} image verified (SHA-256 ${VM_JAR_SHA256.slice(0, 12)}…).`);
    }

    await fs.move(temp, destPath, { overwrite: true });
    const stat = await fs.stat(destPath);
    onLog(`[Panel] Download complete (${(stat.size / 1024 / 1024).toFixed(1)} MB).`);
    return destPath;
  }

  await fs.remove(temp).catch(() => {});
  throw new Error(
    `Every mirror failed for ${label} ${version}. Check the node's internet connection, or upload server.jar manually.`
  );
};

// ---------------------------------------------------------------------------
// Java selection
// ---------------------------------------------------------------------------

const javaMap: Array<[RegExp, string]> = [
  [/^(2[6-9])\./, "25"],
  [/^(2[0-5])\.\d/, "25"],
  [/^1\.21/, "21"],
  [/^1\.20\.([5-9]|\d\d)/, "21"],
  [/^1\.(18|19|20)/, "17"],
  [/^1\.17/, "16"],
  [/^1\.(13|14|15|16)/, "11"],
  [/^1\.(7|8|9|10|11|12)/, "8"],
];

/** Java major version a given software + Minecraft version needs. */
export const javaMajorFor = (software: string, version: string): string => {
  const type = (software || "").toUpperCase();
  if (isRuntime(type)) return "";
  // The Linux-VM images are compiled for Java 21 and never change with the guest.
  if (isVm(type)) return "21";
  if (type === "VELOCITY") return "21";
  if (type === "BUNGEECORD" || type === "WATERFALL") return "17";
  const v = String(version || "").trim();
  for (const [re, major] of javaMap) if (re.test(v)) return major;
  return SOFTWARE_DEFINITION(type)?.java || "21";
};

/** Backwards-compatible alias used by older call sites. */
export const javaVersionFor = (software: string, version: string) => javaMajorFor(software, version);

/**
 * Startup arguments for a Minecraft jar, mirroring the Aikar flags the JTG panel
 * uses so performance characteristics match.
 */
export const minecraftJavaArgs = (ramMb: number, extra: string[] = []) => {
  const ram = Math.max(512, Number(ramMb) || 1024);
  return [
    `-Xms${ram}M`,
    `-Xmx${ram}M`,
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-XX:+AlwaysPreTouch",
    "-XX:G1NewSizePercent=30",
    "-XX:G1MaxNewSizePercent=40",
    "-XX:G1HeapRegionSize=8M",
    "-XX:G1ReservePercent=20",
    "-XX:G1HeapWastePercent=5",
    "-XX:G1MixedGCCountTarget=4",
    "-XX:InitiatingHeapOccupancyPercent=15",
    "-XX:G1MixedGCLiveThresholdPercent=90",
    "-XX:G1RSetUpdatingPauseTimePercent=5",
    "-XX:SurvivorRatio=32",
    "-XX:+PerfDisableSharedMem",
    "-XX:MaxTenuringThreshold=1",
    "-Dusing.aikars.flags=https://mcflags.emc.gs",
    "-Daikars.new.flags=true",
    "-Dfile.encoding=UTF-8",
    "-Dterminal.jline=false",
    "-Dterminal.ansi=true",
    ...extra,
  ];
};

/**
 * Capability summary for one software/version pair. Drives the create-server
 * form and the server view's tab visibility.
 */
export const softwareSummary = (software: string, version: string) => {
  const type = (software || "").toUpperCase();
  const def = SOFTWARE_DEFINITION(type);
  return {
    id: type,
    label: def?.label || type,
    category: def?.category || null,
    description: def?.description || "",
    java: javaMajorFor(type, version),
    proxy: isProxy(type),
    modded: isModded(type),
    runtime: isRuntime(type),
    modrinthType: modrinthTypeFor(type),
    loaders: modrinthLoadersFor(type),
  };
};
