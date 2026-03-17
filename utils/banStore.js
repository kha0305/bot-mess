import fs from "fs";
import {
  BANNED_PATH,
  ensureDataLayout,
  ensureFileDirSync,
} from "./dataPaths.js";

function ensureDataDir() {
  ensureDataLayout();
  ensureFileDirSync(BANNED_PATH);
}

function normalizeUserId(rawUserId) {
  return String(rawUserId || "").trim();
}

function normalizeRecord(uid, raw = {}) {
  if (!raw || typeof raw !== "object") {
    return {
      reason: String(raw || "Vi pham quy dinh"),
      by: "",
      at: Date.now(),
      userId: uid,
    };
  }

  return {
    reason: String(raw.reason || raw.note || "Vi pham quy dinh").trim(),
    by: String(raw.by || raw.byUser || "").trim(),
    at: Number(raw.at || raw.time || Date.now()) || Date.now(),
    userId: uid,
  };
}

function normalizeStore(raw) {
  const users = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { users };
  }

  if (raw.users && typeof raw.users === "object" && !Array.isArray(raw.users)) {
    for (const [key, val] of Object.entries(raw.users)) {
      const uid = normalizeUserId(key);
      if (!uid) continue;
      users[uid] = normalizeRecord(uid, val);
    }
    return { users };
  }

  // Legacy format: { "<uid>": { reason: "..." } }
  for (const [key, val] of Object.entries(raw)) {
    const uid = normalizeUserId(key);
    if (!uid) continue;
    users[uid] = normalizeRecord(uid, val);
  }
  return { users };
}

function readRawStore() {
  ensureDataDir();
  if (!fs.existsSync(BANNED_PATH)) return { users: {} };
  try {
    const raw = fs.readFileSync(BANNED_PATH, "utf-8");
    if (!raw.trim()) return { users: {} };
    return normalizeStore(JSON.parse(raw));
  } catch (e) {
    console.error("[BAN] Khong the doc banned.json:", e.message);
    return { users: {} };
  }
}

function writeStore(store) {
  ensureDataDir();
  const payload = JSON.stringify(normalizeStore(store), null, 2);
  const tmpPath = `${BANNED_PATH}.tmp`;
  fs.writeFileSync(tmpPath, payload, "utf-8");
  fs.renameSync(tmpPath, BANNED_PATH);
}

export function getBanStore() {
  return readRawStore();
}

export function getBannedReason(rawUserId) {
  const uid = normalizeUserId(rawUserId);
  if (!uid) return null;
  const store = readRawStore();
  return store.users[uid]?.reason || null;
}

export function isUserBanned(rawUserId) {
  return !!getBannedReason(rawUserId);
}

export function banUser(rawUserId, reason, byUserId = "") {
  const uid = normalizeUserId(rawUserId);
  if (!uid) return { changed: false };
  const store = readRawStore();
  const before = store.users[uid];
  store.users[uid] = normalizeRecord(uid, {
    reason: String(reason || "Vi pham quy dinh"),
    by: String(byUserId || ""),
    at: Date.now(),
  });
  writeStore(store);
  return { changed: !before, record: store.users[uid] };
}

export function unbanUser(rawUserId) {
  const uid = normalizeUserId(rawUserId);
  if (!uid) return { changed: false };
  const store = readRawStore();
  if (!store.users[uid]) return { changed: false };
  delete store.users[uid];
  writeStore(store);
  return { changed: true };
}

export function listBannedUsers() {
  const store = readRawStore();
  return Object.values(store.users).sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
}
