import axios from "axios";
import fs from "fs-extra";
import path from "path";

const HEADERS = {
  "User-Agent": "ZK-MC3-PANEL/1.0 (+https://github.com/SKYDO234/ZK-MC3)",
  Accept: "*/*",
};

export const SOFTWARE_TYPES = [
  { id: "PAPER", label: "Paper", category: "Server", recommended: true, description: "High performance Spigot fork with plugin support." },
  { id: "PURPUR", label: "Purpur", category: "Server", recommended: true, description: "Paper fork with extra gameplay configuration." },
  { id: "VANILLA", label: "Vanilla", category: "Server", description: "Official Mojang Minecraft server." },
  { id: "SPIGOT", label: "Spigot", category: "Server", description: "Classic Bukkit-based server software." },
  { id: "FABRIC", label: "Fabric", category: "Modded", description: "Lightweight mod loader for modern versions." },
  { id: "VELOCITY", label: "Velocity", category: "Proxy", description: "Modern high performance Minecraft proxy." },
  { id: "BUNGEECORD", label: "BungeeCord", category: "Proxy", description: "Proxy for connecting multiple servers." },
  { id: "WATERFALL", label: "Waterfall", category: "Proxy", description: "Paper's BungeeCord fork." },
  { id: "NODEJS", label: "Node.js App", category: "Runtime", description: "Run any Node.js application with a web port." },
  { id: "PYTHON", label: "Python App", category: "Runtime", description: "Run any Python application with a web port." },
];

export const FALLBACK_VERSIONS: Record<string, string[]> = {
  PAPER: ["1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.17.1", "1.16.5", "1.12.2"],
  PURPUR: ["1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.17.1", "1.16.5"],
  VANILLA: ["1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.17.1", "1.16.5", "1.12.2"],
  SPIGOT: ["1.21.4", "1.21.1", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.16.5", "1.12.2"],
  FABRIC: ["1.21.4", "1.21.3", "1.21.1", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.18.2"],
  VELOCITY: ["3.4.0", "3.3.0"],
  BUNGEECORD: ["latest"],
  WATERFALL: ["latest"],
  NODEJS: ["22", "20", "18"],
  PYTHON: ["3.12", "3.11", "3.10"],
};

const versionCache = new Map<string, { at: number; versions: string[] }>();
const CACHE_TTL = 1000 * 60 * 30;

export const getVersions = async (software: string): Promise<string[]> => {
  const key = (software || "PAPER").toUpperCase();
  const cached = versionCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.versions;

  let versions: string[] = [];
  try {
    if (key === "PAPER" || key === "PURPUR") {
      const res = await axios.get(
        key === "PAPER"
          ? "https://api.papermc.io/v2/projects/paper"
          : "https://api.purpurmc.org/v2/purpur",
        { headers: HEADERS, timeout: 7000 }
      );
      const raw: string[] = res.data?.versions || [];
      versions = raw.slice().reverse();
    } else if (key === "VANILLA" || key === "SPIGOT") {
      const res = await axios.get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", {
        headers: HEADERS,
        timeout: 7000,
      });
      versions = (res.data?.versions || [])
        .filter((v: any) => v.type === "release")
        .map((v: any) => v.id)
        .slice(0, 30);
    } else if (key === "FABRIC") {
      const res = await axios.get("https://meta.fabricmc.net/v2/versions/game", { headers: HEADERS, timeout: 7000 });
      versions = (res.data || []).filter((v: any) => v.stable).map((v: any) => v.version).slice(0, 25);
    } else if (key === "VELOCITY") {
      versions = ["3.4.0", "3.3.0", "3.2.0"];
    }
  } catch {
    versions = [];
  }

  if (!versions.length) versions = FALLBACK_VERSIONS[key] || FALLBACK_VERSIONS.PAPER;
  versionCache.set(key, { at: Date.now(), versions });
  return versions;
};

const download = async (url: string, dest: string, minBytes = 200 * 1024, headers: Record<string, string> = {}): Promise<boolean> => {
  const tmp = `${dest}.part`;
  try {
    const res = await axios.get(url, {
      responseType: "stream",
      headers: { ...HEADERS, ...headers },
      timeout: 120000,
      maxRedirects: 8,
    });
    await fs.ensureDir(path.dirname(dest));
    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(tmp);
      res.data.pipe(writer);
      writer.on("finish", () => resolve());
      writer.on("error", reject);
      res.data.on("error", reject);
    });
    const stat = await fs.stat(tmp);
    if (stat.size < minBytes) {
      await fs.remove(tmp).catch(() => {});
      return false;
    }
    await fs.move(tmp, dest, { overwrite: true });
    return true;
  } catch {
    await fs.remove(tmp).catch(() => {});
    return false;
  }
};

const paperApiHeaders = (project: string) => ({
  "User-Agent": `ZK-MC3-PANEL/1.0 (${project})`,
  Accept: "application/json",
});

const resolvePaperUrl = async (version: string): Promise<string | null> => {
  const v = version === "latest" ? (await getVersions("PAPER"))[0] : version;
  // PaperMC v2 API
  try {
    const buildsRes = await axios.get(`https://api.papermc.io/v2/projects/paper/versions/${v}`, {
      headers: paperApiHeaders("paper"),
      timeout: 9000,
    });
    const builds: number[] = buildsRes.data?.builds || [];
    if (builds.length) {
      const build = builds[builds.length - 1];
      return `https://api.papermc.io/v2/projects/paper/versions/${v}/builds/${build}/downloads/paper-${v}-${build}.jar`;
    }
  } catch {
    /* try fill v3 */
  }
  try {
    const res = await axios.get(`https://fill.papermc.io/v3/projects/paper/versions/${v}/builds`, {
      headers: paperApiHeaders("paper"),
      timeout: 9000,
    });
    const latest = Array.isArray(res.data) ? res.data[0] : null;
    return latest?.downloads?.["server:default"]?.url || null;
  } catch {
    return null;
  }
};

const resolvePurpurUrl = async (version: string): Promise<string | null> => {
  const v = version === "latest" ? (await getVersions("PURPUR"))[0] : version;
  try {
    const res = await axios.get(`https://api.purpurmc.org/v2/purpur/${v}/latest`, { headers: HEADERS, timeout: 9000 });
    if (res.data?.build) {
      return `https://api.purpurmc.org/v2/purpur/${v}/${res.data.build}/download`;
    }
  } catch {
    /* ignore */
  }
  return `https://api.purpurmc.org/v2/purpur/${v}/latest/download`;
};

const resolveVanillaUrl = async (version: string): Promise<string | null> => {
  try {
    const manifest = await axios.get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", {
      headers: HEADERS,
      timeout: 9000,
    });
    const versions: any[] = manifest.data?.versions || [];
    const v = version === "latest" ? versions.find((x) => x.type === "release")?.id : version;
    const entry = versions.find((x) => x.id === v) || versions.find((x) => x.type === "release");
    if (!entry) return null;
    const detail = await axios.get(entry.url, { headers: HEADERS, timeout: 9000 });
    return detail.data?.downloads?.server?.url || null;
  } catch {
    return null;
  }
};

const resolveFabricUrl = async (version: string): Promise<string | null> => {
  try {
    const gameVersion = version === "latest" ? (await getVersions("FABRIC"))[0] : version;
    const loaders = await axios.get(
      `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`,
      { headers: HEADERS, timeout: 9000 }
    );
    const loader = loaders.data?.[0]?.loader?.version;
    if (!loader) return null;
    const installers = await axios.get("https://meta.fabricmc.net/v2/versions/installer", {
      headers: HEADERS,
      timeout: 9000,
    });
    const installer = installers.data?.[0]?.version || "1.0.1";
    return `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loader}/${installer}/server/jar`;
  } catch {
    return null;
  }
};

/**
 * Downloads the server jar, trying the official API first then reliable mirrors.
 * Returns the jar path on success.
 */
export const downloadServerJar = async (
  software: string,
  version: string,
  destPath: string,
  onLog: (msg: string) => void = () => {}
): Promise<string> => {
  const type = (software || "PAPER").toUpperCase();
  const candidates: string[] = [];

  if (type === "PAPER") {
    const url = await resolvePaperUrl(version);
    if (url) candidates.push(url);
  } else if (type === "PURPUR") {
    const url = await resolvePurpurUrl(version);
    if (url) candidates.push(url);
  } else if (type === "VANILLA") {
    const url = await resolveVanillaUrl(version);
    if (url) candidates.push(url);
  } else if (type === "FABRIC") {
    const url = await resolveFabricUrl(version);
    if (url) candidates.push(url);
  } else if (type === "VELOCITY") {
    candidates.push("https://api.papermc.io/v2/projects/velocity/versions/3.3.0/builds");
  } else if (type === "BUNGEECORD" || type === "WATERFALL") {
    candidates.push(
      "https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar"
    );
  }

  // Generic mirrors: Purpur provides Paper-compatible jars for most versions,
  // and Bukkit mirrors Spigot builds.
  if (["PAPER", "PURPUR", "SPIGOT", "VANILLA", "FABRIC"].includes(type)) {
    const purpur = await resolvePurpurUrl(version);
    if (purpur) candidates.push(purpur);
    candidates.push(`https://download.getbukkit.org/spigot/spigot-${version}.jar`);
  }

  if (type === "VELOCITY") {
    try {
      const res = await axios.get("https://fill.papermc.io/v3/projects/velocity/versions", {
        headers: paperApiHeaders("velocity"),
        timeout: 9000,
      });
      const versions: any[] = Array.isArray(res.data) ? res.data : res.data?.versions || [];
      const target = version === "latest" ? versions[0] : versions.find((v: any) => (v.version || v) === version) || versions[0];
      const vStr = target?.version || target;
      if (vStr) {
        const builds = await axios.get(
          `https://fill.papermc.io/v3/projects/velocity/versions/${vStr}/builds`,
          { headers: paperApiHeaders("velocity"), timeout: 9000 }
        );
        const url = builds.data?.[0]?.downloads?.["server:default"]?.url;
        if (url) candidates.unshift(url);
      }
    } catch {
      /* ignore */
    }
  }

  for (const url of candidates.filter(Boolean)) {
    onLog(`[Panel] Downloading ${type} ${version} from ${new URL(url).host} ...`);
    const ok = await download(url, destPath, type === "VELOCITY" ? 100 * 1024 : 200 * 1024);
    if (ok) {
      const stat = await fs.stat(destPath);
      onLog(`[Panel] Download complete (${(stat.size / 1024 / 1024).toFixed(1)} MB).`);
      return destPath;
    }
  }

  throw new Error(
    `Unable to download ${type} ${version}. Check the node's internet connection or upload server.jar manually via the file manager.`
  );
};

export const SOFTWARE_LABEL = (type: string) =>
  SOFTWARE_TYPES.find((s) => s.id === (type || "").toUpperCase())?.label || type;

const javaVersionMap: Array<[RegExp, string]> = [
  [/^1\.(21|20\.[5-9])/, "21"],
  [/^1\.(17|18|19|20\.[0-4])/, "17"],
  [/^1\.16/, "11"],
  [/^1\.(8|9|10|11|12|13|14|15)/, "8"],
];

export const javaVersionFor = (software: string, version: string): string => {
  const type = (software || "").toUpperCase();
  if (type === "NODEJS" || type === "PYTHON") return "";
  if (type === "VELOCITY") return "21";
  if (type === "BUNGEECORD" || type === "WATERFALL") return "17";
  const v = String(version || "");
  if (/^(\d+)$/.test(v) && Number(v) >= 1) return "21";
  for (const [re, java] of javaVersionMap) if (re.test(v)) return java;
  return "21";
};
