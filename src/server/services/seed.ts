import { readJSON, nowISO, id } from "./db";
import { createUserRecord, listUsers, hashPassword } from "./users";
import { listServers, saveServers, ServerRecord } from "./runtime";
import { createNode, listNodes, saveNodes } from "./nodes";
import { logActivity } from "./activity";
import { notify } from "./notifications";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();

/**
 * Optional demo dataset (SEED_DEMO=true) so a fresh install has something to show.
 * Never overwrites an existing database.
 */
export const seedDemoData = async () => {
  const users = await listUsers();
  let demo = users.find((u) => u.username === "demo");
  if (!demo) {
    demo = await createUserRecord({
      name: "Demo Client",
      username: "demo",
      email: "demo@zk-mc3.local",
      password: "demo12345",
      role: "user",
      balance: 24.5,
    });
  }

  if (users.length <= 2) {
    for (const seed of [
      { name: "Aarav Mehta", username: "aarav", email: "aarav@example.com", role: "user" as const },
      { name: "Sofia Ramirez", username: "sofia", email: "sofia@example.com", role: "user" as const },
      { name: "Liam Novak", username: "liam", email: "liam@example.com", role: "user" as const },
      { name: "Staff Admin", username: "staff", email: "staff@example.com", role: "admin" as const },
    ]) {
      const existing = (await listUsers()).find((u) => u.username === seed.username);
      if (!existing) {
        await createUserRecord({ ...seed, password: "demo12345" });
      }
    }
  }

  const nodes = await readJSON<any[]>("nodes.json", []);
  if (nodes.length === 0) {
    const node = await createNode({
      name: "Node EU-1",
      hostname: "eu1.zk-mc3.host",
      ip: "10.0.4.21",
      port: 31120,
      cpuCores: 16,
      memoryMb: 32768,
      diskMb: 512000,
      location: "Frankfurt, DE",
      description: "High frequency Ryzen node for EU players.",
    });
    await createNode({
      name: "Node ASIA-1",
      hostname: "asia1.zk-mc3.host",
      ip: "10.0.8.11",
      port: 31120,
      cpuCores: 12,
      memoryMb: 24576,
      diskMb: 409600,
      location: "Singapore, SG",
      description: "Low latency node for South Asia.",
    });
    void node;
  } else {
    // Agent nodes cannot be probed in the demo environment; mark them online.
    await saveNodes(nodes.map((n) => ({ ...n, status: "online", lastSeen: nowISO() })));
  }

  const servers = await listServers();
  if (servers.length === 0) {
    const allUsers = await listUsers();
    const ownerFor = (name: string) => allUsers.find((u) => u.username === name) || allUsers[0];
    const seeds: Array<Partial<ServerRecord> & { ownerUsername: string }> = [
      { name: "Skyblock Legends", ownerUsername: "demo", software: "PAPER", version: "1.21.4", ram: 4096, cpu: 4, disk: 20480, port: 25565, nodeId: "local", status: "offline" },
      { name: "Survival SMP", ownerUsername: "aarav", software: "PURPUR", version: "1.21.4", ram: 6144, cpu: 6, disk: 30720, port: 25566, nodeId: "local", status: "offline" },
      { name: "Creative Plots", ownerUsername: "sofia", software: "PAPER", version: "1.20.6", ram: 2048, cpu: 2, disk: 10240, port: 25567, nodeId: "local", status: "offline" },
      { name: "Fabric ATM10", ownerUsername: "liam", software: "FABRIC", version: "1.21.4", ram: 8192, cpu: 8, disk: 40960, port: 25568, nodeId: "local", status: "offline" },
      { name: "Proxy Network", ownerUsername: "staff", software: "VELOCITY", version: "3.4.0", ram: 1024, cpu: 1, disk: 5120, port: 25577, nodeId: "local", status: "offline" },
    ];
    const records: ServerRecord[] = seeds.map((seed, index) => {
      const owner = ownerFor(seed.ownerUsername);
      return {
        id: id("srv_"),
        name: seed.name as string,
        owner: owner.id,
        ownerName: owner.username,
        description: `${seed.software} ${seed.version} instance`,
        software: seed.software as string,
        version: seed.version as string,
        runtime: "local",
        nodeId: seed.nodeId as string,
        ip: "0.0.0.0",
        port: seed.port as number,
        cpu: seed.cpu as number,
        ram: seed.ram as number,
        disk: seed.disk as number,
        status: "offline",
        createdAt: minutesAgo(60 * 24 * (12 + index * 9)),
        updatedAt: nowISO(),
        startedAt: null,
        lastBackupAt: index % 2 === 0 ? minutesAgo(60 * 14) : null,
        pid: null,
        javaVersion: "21",
        autoRestart: index % 2 === 0,
        planLabel: `${(seed.ram as number) / 1024} GB RAM`,
      };
    });
    await saveServers(records);
  }

  const activities = await readJSON<any[]>("activities.json", []);
  if (activities.length === 0) {
    const allUsers = await listUsers();
    const actor = allUsers[0];
    const entries = [
      { type: "auth", action: "login", message: `${actor.username} signed in`, minutes: 3 },
      { type: "server", action: "start", message: "demo started server \"Skyblock Legends\"", minutes: 22 },
      { type: "backup", action: "create", message: "aarav created a backup of \"Survival SMP\"", minutes: 48 },
      { type: "admin", action: "settings", message: `${actor.username} updated panel settings`, minutes: 96 },
      { type: "server", action: "create", message: "staff created server \"Proxy Network\"", minutes: 180 },
      { type: "api", action: "create", message: "liam generated API key \"CI deploy\"", minutes: 320 },
      { type: "node", action: "create", message: `${actor.username} added the node "Node ASIA-1"`, minutes: 900 },
    ];
    for (const entry of entries.reverse()) {
      await logActivity({
        type: entry.type,
        action: entry.action,
        message: entry.message,
        actorId: actor.id,
        actorName: actor.username,
        target: "demo",
        createdAt: minutesAgo(entry.minutes),
      });
    }
  }

  const notifications = await readJsonSafe();
  if (notifications.length === 0) {
    await notify({
      userId: "*",
      title: "Welcome to ZK-MC3-PANEL",
      message: "Your hosting panel is ready. Deploy your first Minecraft server in under a minute.",
      type: "success",
      link: "/dashboard",
    });
    await notify({
      userId: "@admins",
      title: "Backup completed",
      message: "Nightly backup finished for 5 servers. 0 failures.",
      type: "info",
      link: "/admin/dashboard",
    });
  }
};

const readJsonSafe = async () => readJSON<any[]>("notifications.json", []);

export const seedIfEmpty = async () => {
  await seedDemoData();
};
