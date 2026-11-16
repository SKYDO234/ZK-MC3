import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs-extra";
import axios from "axios";
import { resolveJava } from "./runtime";

const execAsync = promisify(exec);

const which = async (bin: string) => {
  try {
    const { stdout } = await execAsync(`command -v ${bin} || which ${bin}`);
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

export const softwareHealth = async () => {
  const javaBin = await resolveJava("21");
  let javaVersion = "not installed";
  if (javaBin) {
    try {
      const { stdout, stderr } = await execAsync(`"${javaBin}" -version 2>&1 | head -1`);
      javaVersion = (stdout || stderr).replace(/"/g, "").trim();
    } catch {
      javaVersion = "unavailable";
    }
  }

  const hasDockerSocket = await fs.pathExists("/var/run/docker.sock");
  let dockerVersion = "not installed";
  if (hasDockerSocket || (await which("docker"))) {
    try {
      const { stdout } = await execAsync("docker --version");
      dockerVersion = stdout.trim();
    } catch {
      dockerVersion = "socket present, cli missing";
    }
  }

  let internet = false;
  try {
    await axios.head("https://api.papermc.io/v2/projects/paper", { timeout: 3000 });
    internet = true;
  } catch {
    internet = false;
  }

  return {
    java: { installed: Boolean(javaBin), path: javaBin, version: javaVersion },
    node: { installed: true, version: process.version, path: process.execPath },
    docker: { installed: Boolean(hasDockerSocket), version: dockerVersion, socket: hasDockerSocket },
    internet: { online: internet },
    python: { installed: Boolean(await which("python3")) },
    git: { installed: Boolean(await which("git")) },
    pm2: { installed: Boolean(await which("pm2")) },
  };
};
