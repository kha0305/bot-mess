import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BACKUP_DIR, DATA_DIR, ensureDataLayout } from "../utils/dataPaths.js";
import { runDataBackup } from "../utils/backupManager.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = process.cwd();
const META_FILE = "_backup_meta.json";
const EXTRA_DIR = "_extras";

function listSlots(type) {
  const baseDir = path.join(BACKUP_DIR, type);
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
}

function resolveSnapshotDir(scope, slot) {
  if (scope === "latest") {
    return path.join(BACKUP_DIR, "latest");
  }

  if (scope === "hourly" || scope === "daily") {
    const slots = listSlots(scope);
    if (slots.length === 0) {
      throw new Error(`Không có snapshot ${scope}.`);
    }
    const selected = slot || slots[0];
    const target = path.join(BACKUP_DIR, scope, selected);
    if (!fs.existsSync(target)) {
      throw new Error(`Không tìm thấy snapshot ${scope}/${selected}.`);
    }
    return target;
  }

  throw new Error("Scope không hợp lệ. Dùng: latest | hourly | daily");
}

function copySnapshotData(snapshotDir) {
  const entries = fs.readdirSync(snapshotDir, { withFileTypes: true });
  let restoredCount = 0;

  for (const entry of entries) {
    const name = entry.name;
    if (name === META_FILE) continue;

    const src = path.join(snapshotDir, name);
    if (name === EXTRA_DIR && entry.isDirectory()) {
      const extras = fs.readdirSync(src, { withFileTypes: true }).filter((x) => x.isFile());
      for (const extra of extras) {
        const extraSrc = path.join(src, extra.name);
        const extraDest = path.join(ROOT, extra.name);
        fs.cpSync(extraSrc, extraDest, { force: true });
        restoredCount += 1;
      }
      continue;
    }

    const dest = path.join(DATA_DIR, name);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true, force: true });
    restoredCount += 1;
  }

  return restoredCount;
}

function printUsage() {
  console.log(
    "Usage:\n" +
      "  node scripts/restore-backup.js latest\n" +
      "  node scripts/restore-backup.js hourly [YYYY-MM-DD_HH]\n" +
      "  node scripts/restore-backup.js daily [YYYY-MM-DD]\n" +
      "  node scripts/restore-backup.js --list",
  );
}

function printSlotList() {
  const hourly = listSlots("hourly");
  const daily = listSlots("daily");
  console.log("[RESTORE] Available slots:");
  console.log(`- hourly (${hourly.length}): ${hourly.slice(0, 20).join(", ") || "(none)"}`);
  console.log(`- daily  (${daily.length}): ${daily.slice(0, 20).join(", ") || "(none)"}`);
}

async function main() {
  ensureDataLayout();

  const arg1 = String(process.argv[2] || "").trim().toLowerCase();
  const arg2 = String(process.argv[3] || "").trim();

  if (!arg1 || arg1 === "--help" || arg1 === "-h") {
    printUsage();
    return;
  }

  if (arg1 === "--list" || arg1 === "list") {
    printSlotList();
    return;
  }

  const scope = arg1;
  const snapshotDir = resolveSnapshotDir(scope, arg2);
  if (!fs.existsSync(snapshotDir)) {
    throw new Error(`Snapshot không tồn tại: ${snapshotDir}`);
  }

  console.log(`[RESTORE] Source: ${snapshotDir}`);
  console.log("[RESTORE] Tạo backup an toàn trước khi restore...");
  const preBackup = await runDataBackup({ reason: "pre-restore-script" });
  if (!preBackup?.ok) {
    throw new Error(`Không thể tạo pre-backup: ${preBackup?.error || "unknown_error"}`);
  }

  const restoredCount = copySnapshotData(snapshotDir);
  console.log(
    `[RESTORE] OK: đã phục hồi ${restoredCount} mục từ backup.\n` +
      `- pre-backup latest: ${preBackup.latestDir}`,
  );
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  await main().catch((e) => {
    console.error("[RESTORE] Thất bại:", e.message || e);
    process.exit(1);
  });
}
