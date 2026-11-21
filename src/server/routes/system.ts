import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { systemSnapshot } from "../services/proc";
import { buildUserDashboard } from "../services/stats";
import { notificationsFor, markRead } from "../services/notifications";
import { activityForUser, listActivity } from "../services/activity";
import { softwareHealth } from "../services/health";
import { getVersions, SOFTWARE_TYPES, upstreamStatus, clearVersionCache } from "../services/software";
import { hostCapabilities, VM_IMAGES } from "../services/qemu";

const router = Router();

router.get("/bootstrap", async (_req, res) => {
  const snap = await systemSnapshot();
  res.json({ system: snap, software: SOFTWARE_TYPES });
});

router.get("/stats", requireAuth, async (_req, res) => {
  res.json(await systemSnapshot());
});

router.get("/software", requireAuth, async (_req, res) => {
  res.json(SOFTWARE_TYPES);
});

/**
 * Host readiness for QEMU. The create form asks before offering VM types: a
 * node without qemu-system installed should say so up front, not fail after the
 * operator has picked an image and clicked create.
 */
router.get("/vm/host", requireAuth, async (_req, res) => {
  const caps = await hostCapabilities(true);
  res.json({
    ready: !caps.blocker,
    blocker: caps.blocker,
    kvm: caps.kvm,
    kvmReason: caps.kvmReason,
    qemu: caps.qemu,
    images: VM_IMAGES.map((i) => ({ id: i.id, label: i.label, version: i.version, ram: i.ram, cpu: i.cpu, disk: i.disk })),
  });
});

router.get("/versions", requireAuth, async (req, res) => {
  const software = String(req.query.software || "PAPER").toUpperCase();
  const versions = await getVersions(software);
  const upstream = upstreamStatus();
  if (!versions.length) {
    return res.status(503).json({
      software,
      versions: [],
      upstream,
      error: upstream.reachable
        ? `No downloadable versions were published for ${software}.`
        : `Cannot reach the ${software} version API from this node. Check outbound internet access — retrying in ${upstream.retryInSeconds}s.`,
    });
  }
  res.json({ software, versions, upstream });
});

// Drops the cached version lists so the next request re-queries upstream.
router.post("/versions/refresh", requireAuth, async (_req, res) => {
  clearVersionCache();
  res.json({ success: true, ...upstreamStatus() });
});

router.get("/dashboard", requireAuth, async (req: any, res) => {
  res.json(await buildUserDashboard(req.user.id, req.user.role));
});

router.get("/activity", requireAuth, async (req: any, res) => {
  const isAdmin = req.user.role === "admin" || req.user.role === "owner";
  res.json(isAdmin && req.query.all === "1" ? await listActivity(60) : await activityForUser(req.user.id, 25));
});

router.get("/notifications", requireAuth, async (req: any, res) => {
  res.json(await notificationsFor(req.user.id, req.user.role));
});

router.post("/notifications/read", requireAuth, async (req: any, res) => {
  await markRead(req.user.id, req.body?.id);
  res.json({ success: true });
});

router.get("/health", requireAuth, async (_req, res) => {
  res.json(await softwareHealth());
});

export default router;
