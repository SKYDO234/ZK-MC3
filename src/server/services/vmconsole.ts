import net from "net";
import fs from "fs-extra";

/**
 * ZK-MC3-PANEL · VM console bridge
 * ---------------------------------------------------------------------------
 * Connects the guest's serial UNIX socket to the panel's socket.io console.
 *
 * The guest end comes from QEMU's `-chardev socket,server=on,wait=off`. QEMU is
 * the listener, the panel is the client, and one connection carries bytes both
 * ways — real keystrokes in, real output out. Nothing here interprets the byte
 * stream: no line buffering, no prompt detection, no ANSI rewriting. A serial
 * console is a raw tty, and anything that "helpfully" reformats it corrupts
 * cursor movement and full-screen programs like `top`.
 *
 * Reconnect policy
 * ---------------------------------------------------------------------------
 * QEMU only creates the socket once the guest's serial device initialises, which
 * under TCG can be seconds after the process appears. Connecting immediately and
 * giving up would mean the console stays dead for the whole boot, so a failed
 * connect retries on a short backoff until either the VM is gone or a timeout.
 */

interface Bridge {
  socket: net.Socket;
  attach: (onData: (chunk: string) => void) => void;
  write: (data: string) => boolean;
  close: () => void;
  /** True once the socket is connected and usable. */
  live: () => boolean;
}

const bridges = new Map<string, Bridge>();

export const hasBridge = (serverId: string) => bridges.has(serverId);

/**
 * Open (or reuse) the bridge for a VM. A single socket is shared by every
 * viewer, which is what a serial console is: there is one tty, and two browser
 * tabs attach to the same one rather than spawning a second session.
 */
export const openBridge = async (
  serverId: string,
  sockPath: string,
  log: (s: string) => void,
  onGuestOutput?: (chunk: string) => void
): Promise<Bridge> => {
  const existing = bridges.get(serverId);
  if (existing && existing.live()) return existing;

  await new Promise<void>((resolve) => {
    const listeners = new Set<(chunk: string) => void>();
    const socket = net.createConnection({ path: sockPath });
    socket.setNoDelay(true);

    const state = { connected: false, closed: false };

    const bridge: Bridge = {
      socket,
      attach(onData) {
        listeners.add(onData);
        return () => listeners.delete(onData) as any;
      },
      write(data) {
        if (!state.connected || socket.destroyed) return false;
        return socket.write(data);
      },
      close() {
        state.closed = true;
        socket.destroy();
        bridges.delete(serverId);
      },
      live: () => state.connected && !socket.destroyed,
    };

    socket.on("connect", () => {
      state.connected = true;
      log("[VM] Serial console attached.\r\n");
      bridges.set(serverId, bridge);
      resolve();
    });

    // The sink is registered for the bridge's whole lifetime, not per viewer.
    // A boot produces output while nobody has the console open, and that output
    // is the only record of what the guest said — dropping it because no browser
    // was attached would leave the operator with an empty console after a failed
    // start, which is exactly when they need it most.
    socket.on("data", (buf: Buffer) => {
      const text = buf.toString("utf8");
      if (onGuestOutput) {
        try {
          onGuestOutput(text);
        } catch {
          /* the sink must never break the stream */
        }
      }
      for (const fn of listeners) {
        try {
          fn(text);
        } catch {
          /* a dead viewer must not kill the bridge */
        }
      }
    });

    socket.on("error", (err: any) => {
      if (!state.connected) {
        // The socket does not exist yet. QEMU binds it during early boot.
        if (err?.code === "ENOENT" || err?.code === "ECONNREFUSED") {
          log(`[VM] Waiting for the guest serial port (${err.code})…\r\n`);
        } else {
          log(`[VM] Console socket error: ${err?.message}\r\n`);
        }
        resolve();
        return;
      }
      log(`[VM] Console connection lost: ${err?.message}\r\n`);
    });

    socket.on("close", () => {
      state.connected = false;
      bridges.delete(serverId);
      if (!state.closed) log("[VM] Serial console detached.\r\n");
      resolve();
    });

    // Never block the caller: a booting VM has no socket for a while, and the
    // start request must not hang waiting for it.
    setTimeout(resolve, 1500);
  });

  return (
    bridges.get(serverId) || {
      socket: net.createConnection({ path: "/dev/null" }),
      attach: () => {},
      write: () => false,
      close: () => {},
      live: () => false,
    }
  );
};

/**
 * Send a line to the guest tty. The panel's command box sends one line at a time
 * and expects Enter to be implied, so \r is appended — a serial console wants
 * CR, not LF, and LF alone echoes but does not submit.
 */
export const sendToGuest = (serverId: string, line: string): boolean => {
  const bridge = bridges.get(serverId);
  if (!bridge || !bridge.live()) return false;
  return bridge.write(`${line}\r`);
};

/** Raw write, for keystrokes and control characters from a real terminal view. */
export const writeRaw = (serverId: string, data: string): boolean => {
  const bridge = bridges.get(serverId);
  if (!bridge || !bridge.live()) return false;
  return bridge.write(data);
};

export const closeBridge = (serverId: string) => {
  const bridge = bridges.get(serverId);
  if (bridge) bridge.close();
  bridges.delete(serverId);
};

export const closeAll = () => {
  for (const id of [...bridges.keys()]) closeBridge(id);
};

/**
 * Wait until the console socket appears, then attach. Called after the QEMU
 * process is spawned; the guest needs time before ttyS0 exists.
 */
export const attachWhenReady = async (
  serverId: string,
  sockPath: string,
  log: (s: string) => void,
  onGuestOutput: (chunk: string) => void,
  opts: { timeoutMs?: number } = {}
) => {
  const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
  while (Date.now() < deadline) {
    if (await fs.pathExists(sockPath)) {
      await openBridge(serverId, sockPath, log, onGuestOutput);
      if (hasBridge(serverId)) return true;
    }
    // A TCG boot can take minutes before ttyS0 binds; keep polling rather than
    // declaring the console dead, but stay silent about it — the banner already
    // told the operator to expect a wait.
    await new Promise((r) => setTimeout(r, 1000));
  }
  log("[VM] The guest serial console did not appear within 3 minutes. The VM may still be booting.");
  return false;
};
