import fs from "fs";
import path from "path";
import {
  CHECKTT_DIR,
  ensureDataLayout,
  ensureFileDirSync,
} from "./utils/dataPaths.js";

const WRITE_DEBOUNCE_MS = 1000;
const threadCache = new Map();
const threadWriteTimers = new Map();

// Hàm khởi tạo thư mục
export function initInteractionDb() {
  ensureDataLayout();
  if (!fs.existsSync(CHECKTT_DIR)) {
    fs.mkdirSync(CHECKTT_DIR, { recursive: true });
  }
}

// Lấy ngày hiện tại (theo dạng DD/MM/YYYY) và Tuần hiện tại
function getCurrentTime() {
  const now = new Date();
  const dateStr = now.toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });

  // Tính tuần
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now - start;
  const oneWeek = 1000 * 60 * 60 * 24 * 7;
  const weekNumber = Math.floor(diff / oneWeek);

  return { date: dateStr, week: weekNumber };
}

function createEmptyRecord() {
  return {
    total: [],
    week: [],
    day: [],
    time: getCurrentTime().date,
    weekTime: getCurrentTime().week,
  };
}

function getThreadFilePath(threadId) {
  return path.join(CHECKTT_DIR, `${threadId}.json`);
}

function writeTextAtomic(filePath, payload) {
  ensureFileDirSync(filePath);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, payload, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function readThreadFromDisk(threadId) {
  const filePath = getThreadFilePath(threadId);
  if (!fs.existsSync(filePath)) return createEmptyRecord();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object") return createEmptyRecord();
    return {
      total: Array.isArray(parsed.total) ? parsed.total : [],
      week: Array.isArray(parsed.week) ? parsed.week : [],
      day: Array.isArray(parsed.day) ? parsed.day : [],
      time: parsed.time || getCurrentTime().date,
      weekTime:
        Number.isFinite(Number(parsed.weekTime)) && Number.isSafeInteger(Number(parsed.weekTime))
          ? Number(parsed.weekTime)
          : getCurrentTime().week,
    };
  } catch (e) {
    return createEmptyRecord();
  }
}

function getState(threadId) {
  const key = String(threadId);
  if (!threadCache.has(key)) {
    threadCache.set(key, { data: readThreadFromDisk(key), dirty: false });
  }
  return threadCache.get(key);
}

function writeThreadToDisk(threadId) {
  const key = String(threadId);
  const state = threadCache.get(key);
  if (!state || !state.dirty) return;
  const filePath = getThreadFilePath(key);
  writeTextAtomic(filePath, JSON.stringify(state.data, null, 2));
  state.dirty = false;
}

function scheduleThreadWrite(threadId) {
  const key = String(threadId);
  if (threadWriteTimers.has(key)) return;
  const timer = setTimeout(() => {
    threadWriteTimers.delete(key);
    writeThreadToDisk(key);
  }, WRITE_DEBOUNCE_MS);
  if (typeof timer.unref === "function") timer.unref();
  threadWriteTimers.set(key, timer);
}

function cloneRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

export function flushAllInteraction() {
  for (const timer of threadWriteTimers.values()) {
    clearTimeout(timer);
  }
  threadWriteTimers.clear();

  for (const threadId of threadCache.keys()) {
    writeThreadToDisk(threadId);
  }
}

let flushHookInited = false;
function initFlushHooks() {
  if (flushHookInited) return;
  flushHookInited = true;

  process.once("beforeExit", () => flushAllInteraction());
  process.once("exit", () => flushAllInteraction());
}

// Mở hoặc tạo db check của nhóm
export function getThreadInteraction(threadId) {
  initFlushHooks();
  return cloneRecord(getState(threadId).data);
}

// Cập nhật db check số tin nhắn nhóm
export function addInteraction(threadId, userId) {
  initFlushHooks();
  const state = getState(threadId);
  const db = state.data;
  const currentTime = getCurrentTime();

  // Reset ngày nếu sang ngày mới
  if (db.time !== currentTime.date) {
    db.day = [];
    db.time = currentTime.date;
  }

  // Reset tuần nếu sang tuần mới
  if (db.weekTime !== currentTime.week) {
    db.week = [];
    db.weekTime = currentTime.week;
  }

  // Tăng đếm Ngày
  const dayRec = db.day.find((u) => u.id === String(userId));
  if (dayRec) {
    dayRec.count++;
  } else {
    db.day.push({ id: String(userId), count: 1 });
  }

  // Tăng đếm Tuần
  const weekRec = db.week.find((u) => u.id === String(userId));
  if (weekRec) {
    weekRec.count++;
  } else {
    db.week.push({ id: String(userId), count: 1 });
  }

  // Tăng đếm Tổng cộng
  const totalRec = db.total.find((u) => u.id === String(userId));
  if (totalRec) {
    totalRec.count++;
  } else {
    db.total.push({ id: String(userId), count: 1 });
  }

  state.dirty = true;
  scheduleThreadWrite(threadId);
  return cloneRecord(db);
}
