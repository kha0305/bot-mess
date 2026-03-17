import fs from "fs";
import path from "path";
import {
  BACKUP_DIR,
  DATA_DIR,
  ensureDataLayout,
} from "./dataPaths.js";

const DEFAULT_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.DATA_BACKUP_INTERVAL_MS || 5 * 60 * 1000),
);
const KEEP_HOURLY = Math.max(1, Number(process.env.DATA_BACKUP_KEEP_HOURLY || 72));
const KEEP_DAILY = Math.max(1, Number(process.env.DATA_BACKUP_KEEP_DAILY || 30));
const BACKUP_TZ = process.env.DATA_BACKUP_TZ || "Asia/Ho_Chi_Minh";

let backupTimer = null;
let running = false;
let lastResult = null;
let preBackupHook = null;

function formatParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: BACKUP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });

  const map = {};
  for (const part of formatter.formatToParts(date)) {
    map[part.type] = part.value;
  }

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
  };
}

function getSlotKeys(date = new Date()) {
  const p = formatParts(date);
  const dayKey = `${p.year}-${p.month}-${p.day}`;
  const hourKey = `${dayKey}_${p.hour}`;
  return { dayKey, hourKey };
}

function copyEntry(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
  });
}

function syncDataToTarget(targetDir) {
  if (!fs.existsSync(DATA_DIR)) return;
  fs.mkdirSync(targetDir, { recursive: true });

  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "backups") continue;
    const src = path.join(DATA_DIR, entry.name);
    const dest = path.join(targetDir, entry.name);
    copyEntry(src, dest);
  }

  const extrasDir = path.join(targetDir, "_extras");
  fs.mkdirSync(extrasDir, { recursive: true });
  const extraFiles = [path.join(process.cwd(), "e2ee_device.json")];
  for (const extra of extraFiles) {
    if (!fs.existsSync(extra)) continue;
    copyEntry(extra, path.join(extrasDir, path.basename(extra)));
  }
}

function pruneOldSlots(slotRoot, keep) {
  if (!fs.existsSync(slotRoot)) return;
  const dirs = fs
    .readdirSync(slotRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  if (dirs.length <= keep) return;
  const stale = dirs.slice(keep);
  for (const dir of stale) {
    fs.rmSync(path.join(slotRoot, dir), { recursive: true, force: true });
  }
}

function writeMeta(targetDir, payload) {
  const metaPath = path.join(targetDir, "_backup_meta.json");
  fs.writeFileSync(metaPath, JSON.stringify(payload, null, 2), "utf-8");
}

export async function runDataBackup({ reason = "manual", preBackup } = {}) {
  if (running) {
    return {
      ok: false,
      skipped: true,
      reason,
      message: "backup_in_progress",
    };
  }

  running = true;
  const startedAt = Date.now();
  try {
    ensureDataLayout();

    const hook = typeof preBackup === "function" ? preBackup : preBackupHook;
    if (typeof hook === "function") {
      await hook();
    }

    const { dayKey, hourKey } = getSlotKeys(new Date(startedAt));
    const latestDir = path.join(BACKUP_DIR, "latest");
    const hourlyDir = path.join(BACKUP_DIR, "hourly", hourKey);
    const dailyDir = path.join(BACKUP_DIR, "daily", dayKey);

    syncDataToTarget(latestDir);
    syncDataToTarget(hourlyDir);
    syncDataToTarget(dailyDir);

    const finishedAt = Date.now();
    const meta = {
      reason,
      timezone: BACKUP_TZ,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      dayKey,
      hourKey,
    };

    writeMeta(latestDir, meta);
    writeMeta(hourlyDir, meta);
    writeMeta(dailyDir, meta);

    pruneOldSlots(path.join(BACKUP_DIR, "hourly"), KEEP_HOURLY);
    pruneOldSlots(path.join(BACKUP_DIR, "daily"), KEEP_DAILY);

    lastResult = {
      ok: true,
      ...meta,
      latestDir,
      hourlyDir,
      dailyDir,
    };
    return lastResult;
  } catch (e) {
    lastResult = {
      ok: false,
      reason,
      startedAt,
      finishedAt: Date.now(),
      error: e?.message || String(e),
    };
    return lastResult;
  } finally {
    running = false;
  }
}

export function startDataBackupScheduler({ intervalMs, preBackup } = {}) {
  const everyMs = Math.max(60 * 1000, Number(intervalMs || DEFAULT_INTERVAL_MS));
  if (typeof preBackup === "function") {
    preBackupHook = preBackup;
  }
  if (backupTimer) return backupTimer;

  backupTimer = setInterval(() => {
    runDataBackup({ reason: "interval" }).catch(() => {});
  }, everyMs);

  if (typeof backupTimer.unref === "function") {
    backupTimer.unref();
  }

  return backupTimer;
}

export async function stopDataBackupScheduler({ finalBackup = false, preBackup } = {}) {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
  if (typeof preBackup === "function") {
    preBackupHook = preBackup;
  }
  if (!finalBackup) return null;
  return await runDataBackup({ reason: "shutdown" });
}

export function getLastBackupResult() {
  return lastResult;
}

