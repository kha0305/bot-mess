import { getThread } from "../db.js";

const activeJobs = new Map();

const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

const MIN_INTERVAL_MS = 15 * 1000;
const MAX_INTERVAL_MS = 60 * 60 * 1000;
const MIN_DURATION_MS = 30 * 1000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 800;

function formatDuration(ms) {
  let totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  totalSeconds %= 86400;
  const hours = Math.floor(totalSeconds / 3600);
  totalSeconds %= 3600;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function parseDuration(input) {
  const raw = String(input || "").toLowerCase().trim();
  if (!raw) return null;
  if (!/^[\dsmhd\s]+$/.test(raw)) return null;

  const tokenRegex = /(\d+)\s*([smhd])/g;
  let total = 0;
  let consumed = "";
  let match;

  while ((match = tokenRegex.exec(raw)) !== null) {
    const value = Number(match[1]);
    const unit = match[2];
    total += value * UNIT_MS[unit];
    consumed += match[0];
  }

  const normalizedRaw = raw.replace(/\s+/g, "");
  const normalizedConsumed = consumed.replace(/\s+/g, "");
  if (!total || normalizedRaw !== normalizedConsumed) return null;

  return total;
}

function hasPermission(threadData, senderId, roles) {
  if (roles?.isNdh || roles?.isAdmin || roles?.isSuper) return true;
  const adminIDs = Array.isArray(threadData?.adminIDs) ? threadData.adminIDs : [];
  if (adminIDs.length === 0) return true;
  return adminIDs.includes(String(senderId));
}

function resolveThreadKey(message) {
  const threadId = String(message?.threadId || "").trim();
  if (threadId) return threadId;
  const chatJid = String(message?.chatJid || "").trim();
  if (chatJid) return chatJid;
  return "";
}

function stopJob(threadId) {
  const key = String(threadId);
  const job = activeJobs.get(key);
  if (!job) return null;

  clearInterval(job.intervalTimer);
  clearTimeout(job.stopTimer);
  activeJobs.delete(key);
  return job;
}

async function sendJobMessage(client, job) {
  if (job.isE2EE && job.chatJid) {
    await client.sendE2EEMessage(job.chatJid, job.content);
    return;
  }
  await client.sendMessage(job.threadId, job.content);
}

function startJob({ client, threadId, chatJid, isE2EE, intervalMs, durationMs, content, startedBy }) {
  const key = String(threadId);
  const startedAt = Date.now();
  const endAt = startedAt + durationMs;

  const job = {
    threadId: key,
    chatJid: chatJid || null,
    isE2EE: !!isE2EE,
    intervalMs,
    durationMs,
    content,
    startedBy: String(startedBy),
    startedAt,
    endAt,
    intervalTimer: null,
    stopTimer: null,
  };

  job.intervalTimer = setInterval(async () => {
    const now = Date.now();
    if (now >= job.endAt) {
      stopJob(key);
      return;
    }
    try {
      await sendJobMessage(client, job);
    } catch (e) {
      console.error(`[AUTOSEND] Lỗi gửi tin tự động ở thread ${key}:`, e.message || e);
    }
  }, intervalMs);

  job.stopTimer = setTimeout(() => {
    stopJob(key);
  }, durationMs + 1000);

  activeJobs.set(key, job);
  return job;
}

function renderUsage(PREFIX) {
  return (
    `⚙️ Cú pháp autosend:\n` +
    `• ${PREFIX}autosend start <interval> <duration> <nội dung>\n` +
    `• ${PREFIX}autosend stop\n` +
    `• ${PREFIX}autosend status\n\n` +
    `Ví dụ:\n` +
    `• ${PREFIX}autosend start 30s 10m Đến giờ điểm danh nhé!\n` +
    `• ${PREFIX}autosend 1m 2h Uống nước đi cả nhà`
  );
}

export default {
  name: "autosend",
  aliases: ["automsg", "autonhantin"],
  description: "Tự động gửi tin nhắn theo chu kỳ trong thời gian đặt trước",
  usages: "start <interval> <duration> <nội dung> | stop | status",
  cooldowns: 2,

  execute: async ({ client, message, type, contentArgs, PREFIX, replyBot, roles }) => {
    const threadId = resolveThreadKey(message);
    if (!threadId) {
      return await replyBot("❌ Không xác định được cuộc trò chuyện để chạy autosend.");
    }
    const threadData = await getThread(threadId);

    if (!hasPermission(threadData, message.senderId, roles)) {
      return await replyBot("❌ Chỉ Quản Trị Viên Bot của nhóm mới được dùng autosend.");
    }

    const raw = String(contentArgs || "").trim();
    if (!raw) {
      return await replyBot(renderUsage(PREFIX));
    }

    const tokens = raw.split(/\s+/);
    let subCmd = (tokens.shift() || "").toLowerCase();

    if (["status", "check", "info"].includes(subCmd)) {
      const active = activeJobs.get(threadId);
      if (!active) {
        return await replyBot("ℹ️ Nhóm này hiện không có autosend đang chạy.");
      }

      const remainingMs = Math.max(0, active.endAt - Date.now());
      const statusMsg =
        `📣 AUTOSEND STATUS\n` +
        `• Chu kỳ: ${formatDuration(active.intervalMs)}\n` +
        `• Tổng thời gian: ${formatDuration(active.durationMs)}\n` +
        `• Còn lại: ${formatDuration(remainingMs)}\n` +
        `• Nội dung: ${active.content}`;
      return await replyBot(statusMsg);
    }

    if (["stop", "off", "tat"].includes(subCmd)) {
      const stopped = stopJob(threadId);
      if (!stopped) {
        return await replyBot("ℹ️ Nhóm này không có autosend nào để dừng.");
      }
      return await replyBot("🛑 Đã dừng autosend cho nhóm này.");
    }

    let intervalToken = "";
    let durationToken = "";
    let content = "";

    if (["start", "on", "bat"].includes(subCmd)) {
      intervalToken = tokens.shift();
      durationToken = tokens.shift();
      content = tokens.join(" ").trim();
    } else {
      intervalToken = subCmd;
      durationToken = tokens.shift();
      content = tokens.join(" ").trim();
    }

    const intervalMs = parseDuration(intervalToken);
    const durationMs = parseDuration(durationToken);

    if (!intervalMs || !durationMs || !content) {
      return await replyBot(renderUsage(PREFIX));
    }

    if (intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) {
      return await replyBot(
        `⚠️ Interval phải từ ${formatDuration(MIN_INTERVAL_MS)} đến ${formatDuration(MAX_INTERVAL_MS)}.`,
      );
    }

    if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
      return await replyBot(
        `⚠️ Duration phải từ ${formatDuration(MIN_DURATION_MS)} đến ${formatDuration(MAX_DURATION_MS)}.`,
      );
    }

    if (durationMs < intervalMs) {
      return await replyBot("⚠️ Duration phải lớn hơn hoặc bằng interval.");
    }

    if (content.length > MAX_MESSAGE_LENGTH) {
      return await replyBot(`⚠️ Nội dung quá dài, tối đa ${MAX_MESSAGE_LENGTH} ký tự.`);
    }

    const oldJob = stopJob(threadId);
    const newJob = startJob({
      client,
      threadId,
      chatJid: message.chatJid,
      isE2EE: type === "E2EE Message",
      intervalMs,
      durationMs,
      content,
      startedBy: message.senderId,
    });

    const response =
      `✅ Đã bật autosend thành công.\n` +
      `• Chu kỳ: ${formatDuration(newJob.intervalMs)}\n` +
      `• Thời gian chạy: ${formatDuration(newJob.durationMs)}\n` +
      `• Kết thúc sau: ${new Date(newJob.endAt).toLocaleString("vi-VN")}\n` +
      `• Nội dung: ${newJob.content}` +
      (oldJob ? `\nℹ️ Đã thay thế autosend cũ đang chạy trước đó.` : "");

    return await replyBot(response);
  },
};
