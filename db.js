import sqlite3 from "sqlite3";
import { open } from "sqlite";
import fs from "fs";
import path from "path";
import {
  DATA_DIR,
  MAIN_DB_PATH,
  RENT_DATA_PATH,
  RENT_DATA_BAK_PATH,
  RENT_DATA_TMP_PATH,
  USERS_MIRROR_PATH,
  USERS_MIRROR_BAK_PATH,
  USERS_MIRROR_TMP_PATH,
  USERS_OLD_ARCHIVE_PATH,
  ensureDataLayout,
  ensureFileDirSync,
} from "./utils/dataPaths.js";

const rentPath = RENT_DATA_PATH;
const rentBakPath = RENT_DATA_BAK_PATH;
const rentTmpPath = RENT_DATA_TMP_PATH;
const usersMirrorPath = USERS_MIRROR_PATH;
const usersMirrorBakPath = USERS_MIRROR_BAK_PATH;
const usersMirrorTmpPath = USERS_MIRROR_TMP_PATH;
const legacyUsersPath = path.join(process.cwd(), "users.json");
const usersOldArchivePath = USERS_OLD_ARCHIVE_PATH;
const USERS_MIRROR_DEBOUNCE_MS = 1000;
let rentDb = {};
let usersMirrorTimer = null;
let usersMirrorDirty = false;

let db;

function normalizeThreadId(rawId) {
  const id = String(rawId ?? "").trim();
  if (!id || id === "undefined" || id === "null") return "";
  return id;
}

function normalizeThreadRecord(threadId, raw = {}) {
  const base = raw && typeof raw === "object" ? raw : {};
  const expireValue = Number(base.expireAt);
  const normalized = {
    ...base,
    id: String(base.id || threadId),
    expireAt:
      Number.isFinite(expireValue) && Number.isSafeInteger(expireValue) ? expireValue : 0,
  };

  if (normalized.expireAt < 0) {
    normalized.expireAt = 0;
  }

  if (Array.isArray(base.adminIDs)) {
    normalized.adminIDs = [...new Set(base.adminIDs.map((i) => String(i).trim()).filter(Boolean))];
  }

  return normalized;
}

function normalizeRentDb(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const output = {};
  for (const [threadId, value] of Object.entries(raw)) {
    const normalizedId = normalizeThreadId(threadId);
    if (!normalizedId) continue;
    output[normalizedId] = normalizeThreadRecord(normalizedId, value);
  }
  return output;
}

function parseJsonFileSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

function writeJsonAtomic(filePath, bakPath, tmpPath, payload, label = "JSON") {
  ensureDataLayout();
  ensureFileDirSync(filePath);
  ensureFileDirSync(tmpPath);
  ensureFileDirSync(bakPath);

  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, bakPath);
    } catch (e) {
      console.error(`[DB] Không thể tạo backup ${label}:`, e.message);
    }
  }

  fs.writeFileSync(tmpPath, payload, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function persistRentDb() {
  const payload = JSON.stringify(rentDb, null, 2);
  writeJsonAtomic(rentPath, rentBakPath, rentTmpPath, payload, "rent_data");
}

function normalizeUserNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function normalizeUserRecord(rawId, raw = {}) {
  const base = raw && typeof raw === "object" ? raw : {};
  return {
    id: String(rawId),
    balance: normalizeUserNumber(base.balance, 0),
    lastDaily: Math.max(0, normalizeUserNumber(base.lastDaily, 0)),
    lastCave: Math.max(0, normalizeUserNumber(base.lastCave, 0)),
    lastWork: Math.max(0, normalizeUserNumber(base.lastWork, 0)),
    debt: Math.max(0, normalizeUserNumber(base.debt, 0)),
    lastLoanAt: Math.max(0, normalizeUserNumber(base.lastLoanAt, 0)),
  };
}

function normalizeUsersMirror(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const output = {};
  for (const [id, value] of Object.entries(raw)) {
    if (value && typeof value === "object") {
      output[String(id)] = normalizeUserRecord(id, value);
    } else {
      output[String(id)] = normalizeUserRecord(id, { balance: value });
    }
  }
  return output;
}

async function getUsersCount() {
  const row = await db.get("SELECT COUNT(*) AS total FROM users");
  return Number(row?.total || 0);
}

async function importUsersMap(usersMap, sourceLabel = "unknown") {
  const entries = Object.entries(normalizeUsersMirror(usersMap));
  if (entries.length === 0) return 0;

  for (const [id, user] of entries) {
    await db.run(
      "INSERT OR IGNORE INTO users (id, balance, lastDaily, lastCave, lastWork, debt, lastLoanAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, user.balance, user.lastDaily, user.lastCave, user.lastWork, user.debt, user.lastLoanAt],
    );
  }

  console.log(`[DB] Đã nạp ${entries.length} user từ ${sourceLabel}.`);
  return entries.length;
}

function getArchiveUsersOldPath() {
  if (!fs.existsSync(usersOldArchivePath)) return usersOldArchivePath;
  return path.join(DATA_DIR, `users_old_${Date.now()}.json`);
}

async function migrateLegacyUsersJson() {
  if (!fs.existsSync(legacyUsersPath)) return;
  try {
    const oldData = parseJsonFileSafe(legacyUsersPath);
    if (oldData && typeof oldData === "object") {
      await importUsersMap(oldData, "legacy users.json");
    }
    fs.renameSync(legacyUsersPath, getArchiveUsersOldPath());
    console.log("[DB] Đã lưu trữ users.json cũ vào thư mục data/.");
  } catch (e) {
    console.error("[DB] Lỗi chuyển đổi users.json cũ:", e.message);
  }
}

async function restoreUsersFromMirrorIfDbEmpty() {
  const count = await getUsersCount();
  if (count > 0) return false;

  try {
    const primary = parseJsonFileSafe(usersMirrorPath);
    if (primary && typeof primary === "object") {
      const imported = await importUsersMap(primary, "users mirror");
      if (imported > 0) return true;
    }
  } catch (e) {
    console.error("[DB] Lỗi đọc users mirror chính:", e.message);
  }

  try {
    const backup = parseJsonFileSafe(usersMirrorBakPath);
    if (backup && typeof backup === "object") {
      const imported = await importUsersMap(backup, "users mirror backup");
      if (imported > 0) return true;
    }
  } catch (e) {
    console.error("[DB] Lỗi đọc users mirror backup:", e.message);
  }

  return false;
}

async function persistUsersMirrorNow() {
  try {
    const rows = await db.all(
      "SELECT id, balance, lastDaily, lastCave, lastWork, debt, lastLoanAt FROM users",
    );
    const out = {};
    for (const row of rows) {
      out[String(row.id)] = normalizeUserRecord(row.id, row);
    }
    writeJsonAtomic(
      usersMirrorPath,
      usersMirrorBakPath,
      usersMirrorTmpPath,
      JSON.stringify(out, null, 2),
      "users mirror",
    );
    usersMirrorDirty = false;
  } catch (e) {
    console.error("[DB] Lỗi ghi users mirror:", e.message);
  }
}

function scheduleUsersMirrorPersist() {
  usersMirrorDirty = true;
  if (usersMirrorTimer) return;
  usersMirrorTimer = setTimeout(async () => {
    usersMirrorTimer = null;
    if (!usersMirrorDirty) return;
    await persistUsersMirrorNow();
  }, USERS_MIRROR_DEBOUNCE_MS);
}

// Khởi tạo Database
export async function initDb() {
  ensureDataLayout();

  db = await open({
    filename: MAIN_DB_PATH,
    driver: sqlite3.Database,
  });

  // Tăng độ bền dữ liệu SQLite khi máy/bot tắt đột ngột
  try {
    await db.exec("PRAGMA journal_mode = WAL;");
    await db.exec("PRAGMA synchronous = FULL;");
  } catch (e) {}

  // Đọc dữ liệu thuê bot từ JSON + cơ chế tự phục hồi
  if (fs.existsSync(rentPath)) {
    try {
      const parsed = parseJsonFileSafe(rentPath) || {};
      const normalized = normalizeRentDb(parsed);
      rentDb = normalized;
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        persistRentDb();
        console.log("[DB] Đã tự làm sạch rent_data với threadID không hợp lệ.");
      }
    } catch (e) {
      console.error("[DB] Lỗi đọc file rent_data.json:", e.message);
      try {
        const bakParsed = parseJsonFileSafe(rentBakPath);
        if (bakParsed && typeof bakParsed === "object") {
          rentDb = normalizeRentDb(bakParsed);
          console.log("[DB] Đã phục hồi rent_data từ file backup.");
          persistRentDb();
        } else {
          rentDb = {};
        }
      } catch (eBak) {
        console.error("[DB] Lỗi đọc file backup rent_data:", eBak.message);
        rentDb = {};
      }
    }
  } else {
    rentDb = {};
    persistRentDb();
  }

  // Tạo bảng dữ liệu người dùng nếu chưa có
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      lastDaily INTEGER DEFAULT 0
    );
  `);

  try {
    await db.exec(`ALTER TABLE users ADD COLUMN lastCave INTEGER DEFAULT 0;`);
  } catch (e) {}

  try {
    await db.exec(`ALTER TABLE users ADD COLUMN lastWork INTEGER DEFAULT 0;`);
  } catch (e) {}

  try {
    await db.exec(`ALTER TABLE users ADD COLUMN debt INTEGER DEFAULT 0;`);
  } catch (e) {}

  try {
    await db.exec(`ALTER TABLE users ADD COLUMN lastLoanAt INTEGER DEFAULT 0;`);
  } catch (e) {}

  await migrateLegacyUsersJson();
  await restoreUsersFromMirrorIfDbEmpty();
  await persistUsersMirrorNow();

  console.log("[DB] SQLite đã kết nối và sẵn sàng.");
}

export async function flushRuntimeData() {
  if (usersMirrorTimer) {
    clearTimeout(usersMirrorTimer);
    usersMirrorTimer = null;
  }

  persistRentDb();
  await persistUsersMirrorNow();

  try {
    await db?.exec?.("PRAGMA wal_checkpoint(FULL);");
  } catch (e) {}
}

// Lấy thông tin user (trả về Object)
export async function getUser(rawId) {
  const id = String(rawId);
  const user = await db.get("SELECT * FROM users WHERE id = ?", [id]);
  if (!user) {
    // Nếu chưa có, tạo mặc định
    await db.run(
      "INSERT INTO users (id, balance, lastDaily, lastCave, lastWork, debt, lastLoanAt) VALUES (?, 0, 0, 0, 0, 0, 0)",
      [id],
    );
    scheduleUsersMirrorPersist();
    return { id, balance: 0, lastDaily: 0, lastCave: 0, lastWork: 0, debt: 0, lastLoanAt: 0 };
  }
  return normalizeUserRecord(id, user);
}

// Cập nhật thông tin User (Thay thế cho saveDb)
export async function updateUser(rawId, updateFields) {
  const id = String(rawId);
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updateFields)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }

  if (fields.length === 0) return;

  await db.run(
    "INSERT OR IGNORE INTO users (id, balance, lastDaily, lastCave, lastWork, debt, lastLoanAt) VALUES (?, 0, 0, 0, 0, 0, 0)",
    [id],
  );

  values.push(id);
  const query = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
  await db.run(query, values);
  scheduleUsersMirrorPersist();
}

// Lấy thông tin Thread (Nhóm) từ JSON
export async function getThread(id) {
  const threadId = normalizeThreadId(id);
  if (!threadId) {
    return normalizeThreadRecord("", { id: "", expireAt: 0 });
  }
  if (!rentDb[threadId]) {
    rentDb[threadId] = normalizeThreadRecord(threadId, { id: threadId, expireAt: 0 });
    persistRentDb();
  } else {
    rentDb[threadId] = normalizeThreadRecord(threadId, rentDb[threadId]);
  }
  return rentDb[threadId];
}

// Cập nhật thông tin Thread lưu vào JSON
export async function updateThread(id, updateFields) {
  const threadId = normalizeThreadId(id);
  if (!threadId) return;
  if (!rentDb[threadId]) {
    rentDb[threadId] = normalizeThreadRecord(threadId, { id: threadId, expireAt: 0 });
  }

  for (const [key, value] of Object.entries(updateFields)) {
    rentDb[threadId][key] = value;
  }

  rentDb[threadId] = normalizeThreadRecord(threadId, rentDb[threadId]);
  persistRentDb();
}
