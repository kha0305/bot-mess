import pkgYtdlp from "yt-dlp-exec";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import ffmpeg from "ffmpeg-static";

const { exec: ytdlp } = pkgYtdlp;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempDir = path.join(__dirname, "..", "data", "temp");
const MB = 1024 * 1024;
const MAX_VIDEO_BYTES = Math.max(10 * MB, Number(process.env.VIDEO_MAX_BYTES || 30 * MB));
const SEND_RETRIES = Math.max(1, Number(process.env.VIDEO_SEND_RETRIES || 3));
const SEND_RETRY_DELAY_MS = Math.max(500, Number(process.env.VIDEO_SEND_RETRY_DELAY_MS || 1500));
const VIDEO_DEBUG_LOG = String(process.env.VIDEO_DEBUG_LOG || "true").toLowerCase() !== "false";
const VIDEO_FORMAT_FALLBACKS = [
  {
    label: "720p",
    format:
      "bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/best[height<=720]/best",
  },
  {
    label: "540p",
    format:
      "bv*[ext=mp4][height<=540]+ba[ext=m4a]/b[ext=mp4][height<=540]/best[height<=540]/best",
  },
  {
    label: "480p",
    format:
      "bv*[ext=mp4][height<=480]+ba[ext=m4a]/b[ext=mp4][height<=480]/best[height<=480]/best",
  },
  {
    label: "360p",
    format:
      "bv*[ext=mp4][height<=360]+ba[ext=m4a]/b[ext=mp4][height<=360]/best[height<=360]/best",
  },
  {
    label: "240p",
    format:
      "bv*[ext=mp4][height<=240]+ba[ext=m4a]/b[ext=mp4][height<=240]/best[height<=240]/best",
  },
];
const RETRYABLE_SEND_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

function videoLog(...args) {
  if (!VIDEO_DEBUG_LOG) return;
  console.log("[VIDEO]", ...args);
}

function getSentMessageId(result) {
  if (!result || typeof result !== "object") return "";
  return String(
    result.messageID ||
      result.messageId ||
      result.id ||
      result.key?.id ||
      result[0]?.id ||
      "",
  ).trim();
}

function normalizeId(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

function ensureHandleReplyStore() {
  if (!global.client) global.client = {};
  if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
  return global.client.handleReply;
}

function formatDuration(seconds) {
  if (!seconds) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s]
    .map((value) => (value < 10 ? `0${value}` : String(value)))
    .filter((value, index) => value !== "00" || index > 0)
    .join(":");
}

function normalizeDirectLink(rawInput) {
  const input = String(rawInput || "").trim().replace(/^<|>$/g, "");
  if (!input) return "";

  if (/^https?:\/\//i.test(input)) return input;

  if (
    /^(www\.)?(m\.)?(music\.)?youtube\.com\//i.test(input) ||
    /^youtu\.be\//i.test(input)
  ) {
    return `https://${input}`;
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return `https://youtu.be/${input}`;
  }

  return "";
}

function getPlayableVideoUrl(item = {}) {
  const webpage = normalizeDirectLink(item.webpage_url);
  if (webpage) return webpage;

  const direct = normalizeDirectLink(item.url);
  if (direct) return direct;

  const id = String(item.id || "").trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return `https://www.youtube.com/watch?v=${id}`;
  }

  return String(item.webpage_url || item.url || "").trim();
}

function getDownloadedFilePath(id) {
  const files = fs
    .readdirSync(tempDir)
    .filter(
      (file) =>
        file.startsWith(id) &&
        !file.endsWith(".part") &&
        !file.endsWith(".ytdl"),
    );

  if (!files.length) return "";
  const sorted = files.sort((a, b) => {
    const sizeA = fs.statSync(path.join(tempDir, a)).size;
    const sizeB = fs.statSync(path.join(tempDir, b)).size;
    return sizeB - sizeA;
  });
  return path.join(tempDir, sorted[0]);
}

function cleanupTempFiles(id) {
  try {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      if (file.startsWith(id)) {
        fs.unlinkSync(path.join(tempDir, file));
      }
    }
  } catch {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error) {
  return String(error?.code || error?.cause?.code || "").toUpperCase();
}

function isRetryableSendError(error) {
  const code = getErrorCode(error);
  if (RETRYABLE_SEND_CODES.has(code)) return true;
  const status = Number(error?.response?.status || 0);
  if (status >= 500 || status === 429) return true;
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("server returned 5xx") ||
    msg.includes("timeout") ||
    msg.includes("socket hang up") ||
    msg.includes("not connected") ||
    msg.includes("network")
  );
}

function formatSendError(error) {
  const code = getErrorCode(error);
  const status = Number(error?.response?.status || 0);
  const msg = String(error?.message || "").trim();
  if (status > 0) return `HTTP ${status}${msg ? ` - ${msg}` : ""}`;
  if (code) return `${code}${msg ? ` - ${msg}` : ""}`;
  return msg || "Không rõ lỗi";
}

async function trySendVideoOnce(client, targetId, buffer, isE2EE) {
  try {
    if (isE2EE) {
      await client.sendE2EEVideo(targetId, buffer, "video/mp4");
    } else {
      await client.sendVideo(targetId, buffer, "video.mp4");
    }
    return { method: isE2EE ? "sendE2EEVideo" : "sendVideo" };
  } catch (sendErr) {
    try {
      if (isE2EE && typeof client.sendE2EEDocument === "function") {
        await client.sendE2EEDocument(targetId, buffer, "video.mp4", "video/mp4");
        return { method: "sendE2EEDocument", fallbackFrom: sendErr };
      }
      await client.sendFile(targetId, buffer, "video.mp4", "video/mp4");
      return { method: "sendFile", fallbackFrom: sendErr };
    } catch (fallbackErr) {
      const wrapped = new Error(
        `sendVideo lỗi: ${formatSendError(sendErr)} | fallback lỗi: ${formatSendError(fallbackErr)}`,
      );
      wrapped.code = getErrorCode(fallbackErr) || getErrorCode(sendErr);
      wrapped.primary = sendErr;
      wrapped.cause = fallbackErr;
      throw wrapped;
    }
  }
}

async function sendVideoWithRetry(client, targetId, buffer, isE2EE) {
  let lastError = null;
  for (let attempt = 1; attempt <= SEND_RETRIES; attempt += 1) {
    try {
      videoLog(`Gửi video attempt ${attempt}/${SEND_RETRIES} (${isE2EE ? "E2EE" : "normal"})`);
      return await trySendVideoOnce(client, targetId, buffer, isE2EE);
    } catch (error) {
      lastError = error;
      videoLog(`Gửi attempt ${attempt} lỗi: ${formatSendError(error)}`);
      if (attempt >= SEND_RETRIES || !isRetryableSendError(error)) break;
      await sleep(SEND_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError || new Error("Không thể gửi video");
}

async function removeLoadingMessage(client, loadingMsg, message, msgType) {
  const msgId = getSentMessageId(loadingMsg);
  if (!msgId) return;
  try {
    if (msgType === "E2EE Message" && message.chatJid) {
      await client.unsendE2EEMessage(message.chatJid, msgId);
      return;
    }
    await client.unsendMessage(msgId);
  } catch {}
}

async function downloadVideoWithFallback(inputUrl, currentId) {
  const errors = [];
  videoLog(`Bắt đầu tải: ${inputUrl}`);

  for (const candidate of VIDEO_FORMAT_FALLBACKS) {
    cleanupTempFiles(currentId);
    try {
      videoLog(`Thử tải format ${candidate.label}...`);
      await ytdlp(inputUrl, {
        output: path.join(tempDir, `${currentId}.%(ext)s`),
        noCheckCertificates: true,
        noWarnings: true,
        noPlaylist: true,
        maxFilesize: "40M",
        format: candidate.format,
        mergeOutputFormat: "mp4",
        ffmpegLocation: ffmpeg,
        addHeader: ["referer:youtube.com", "user-agent:googlebot"],
      });
      videoLog(`Tải xong format ${candidate.label}.`);
    } catch (error) {
      errors.push(`[${candidate.label}] ${String(error?.message || error)}`);
      videoLog(`Format ${candidate.label} lỗi: ${String(error?.message || error)}`);
      continue;
    }

    const downloadedFilePath = getDownloadedFilePath(currentId);
    if (!downloadedFilePath || !fs.existsSync(downloadedFilePath)) {
      errors.push(`[${candidate.label}] Không tìm thấy file sau khi tải`);
      continue;
    }

    const stats = fs.statSync(downloadedFilePath);
    if (stats.size > MAX_VIDEO_BYTES) {
      errors.push(
        `[${candidate.label}] Dung lượng ${(stats.size / MB).toFixed(2)}MB > ${Math.floor(MAX_VIDEO_BYTES / MB)}MB`,
      );
      videoLog(
        `Format ${candidate.label} quá nặng: ${(stats.size / MB).toFixed(2)}MB > ${Math.floor(MAX_VIDEO_BYTES / MB)}MB`,
      );
      continue;
    }

    videoLog(`Chọn format ${candidate.label}, size ${(stats.size / MB).toFixed(2)}MB`);
    return { downloadedFilePath, stats, usedLabel: candidate.label };
  }

  throw new Error(
    `Không tải được video phù hợp <=${Math.floor(MAX_VIDEO_BYTES / MB)}MB. ${errors.join(" | ")}`,
  );
}

async function downloadAndSendVideo(client, message, inputUrl, replyBot, msgType, title = "") {
  const currentId = uuidv4();
  let loadingMsg = null;

  try {
    videoLog(`Bắt đầu xử lý video "${title || "unknown"}"`);
    loadingMsg = await replyBot("⏳ Đang tải video về máy chủ (15-40s)...");

    const { downloadedFilePath, usedLabel } = await downloadVideoWithFallback(inputUrl, currentId);

    const buffer = fs.readFileSync(downloadedFilePath);
    videoLog(`Đã đọc buffer ${(buffer.length / MB).toFixed(2)}MB, chuẩn bị gửi...`);
    const isE2EE = msgType === "E2EE Message" && message.chatJid;
    const targetId = isE2EE ? message.chatJid : message.threadId;

    const sendResult = await sendVideoWithRetry(client, targetId, buffer, isE2EE);
    if (sendResult?.fallbackFrom) {
      console.warn(
        `[VIDEO] Đã gửi qua ${sendResult.method} sau khi phương thức chính lỗi: ${formatSendError(sendResult.fallbackFrom)}`,
      );
    }

    await removeLoadingMessage(client, loadingMsg, message, msgType);
    cleanupTempFiles(currentId);
    if (usedLabel !== VIDEO_FORMAT_FALLBACKS[0].label) {
      await replyBot(`ℹ️ Video đã được hạ chất lượng xuống ${usedLabel} để gửi ổn định.`);
    }
    videoLog(`Gửi thành công: ${title || "Hoàn tất"}`);
    await replyBot(`✅ Đã gửi video: ${title || "Hoàn tất"}`);
  } catch (error) {
    cleanupTempFiles(currentId);
    await removeLoadingMessage(client, loadingMsg, message, msgType);
    const msg = String(error?.message || error);
    videoLog(`Xử lý video lỗi: ${msg}`);
    if (msg.includes("File is larger than max-filesize")) {
      await replyBot("❌ Video quá nặng theo giới hạn nguồn tải.");
      return;
    }
    if (isRetryableSendError(error)) {
      await replyBot("❌ Facebook đang lỗi upload video (5xx/tạm mất mạng). Bot đã thử gửi lại nhưng chưa thành công.");
      await replyBot(`🔗 Link video: ${inputUrl}`);
      return;
    }
    await replyBot(`❌ Tải video thất bại: ${msg}`);
  }
}

export default {
  name: "video",
  aliases: ["ytvideo", "vid"],
  version: "1.0.0",
  credits: "Antigravity + Codex",
  description: "Tải và gửi video từ YouTube/link bằng yt-dlp",
  usages: "[từ khóa hoặc link/video id]",
  cooldowns: 5,

  execute: async ({ client, message, contentArgs, replyBot, type }) => {
    const query = String(contentArgs || "").trim();
    const senderId = normalizeId(message?.senderId);
    videoLog(`Execute /video query="${query}" sender=${senderId}`);
    if (!query) {
      await replyBot("❎ Bạn chưa nhập từ khóa hoặc link video.");
      return;
    }

    const directLink = normalizeDirectLink(query);
    if (directLink) {
      await replyBot("⏳ Đang nhận link và tải video...");
      await downloadAndSendVideo(client, message, directLink, replyBot, type);
      return;
    }

    try {
      const output = await ytdlp(`ytsearch10:${query}`, {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        flatPlaylist: true,
        addHeader: ["referer:youtube.com", "user-agent:googlebot"],
      });

      let searchData = null;
      try {
        searchData = JSON.parse(output.stdout || "{}");
      } catch {
        await replyBot("❌ Dữ liệu tìm kiếm không hợp lệ.");
        return;
      }

      const entries = Array.isArray(searchData.entries) ? searchData.entries : [];
      if (!entries.length) {
        await replyBot("❌ Không tìm thấy kết quả nào.");
        return;
      }
      videoLog(`Tìm kiếm "${query}" có ${entries.length} kết quả.`);

      const list = entries.slice(0, 10);
      let msg = `🎬 Tìm thấy ${list.length} video:\n\n`;
      list.forEach((item, index) => {
        msg += `${index + 1}. ${item.title || "Không rõ tên"} (${formatDuration(item.duration)})\n`;
        msg += `🌐 Kênh: ${item.uploader || "Unknown"}\n\n`;
      });
      msg += "👇 Reply số để chọn video cần tải.";

      const sent = await replyBot(msg);
      const sentMsgId = getSentMessageId(sent);
      if (!sentMsgId) return;

      ensureHandleReplyStore().push({
        name: "video",
        messageID: sentMsgId,
        author: senderId,
        type: "select_video",
        results: list,
      });
      videoLog(`Đã lưu handleReply messageID=${sentMsgId}, author=${senderId}`);
    } catch (error) {
      console.error("[VIDEO] Lỗi tìm kiếm:", error?.message || error);
      await replyBot("❌ Không thể tìm kiếm video lúc này.");
    }
  },

  handleReply: async ({ client, message, replyBot, handleReply, type: msgType }) => {
    const senderId = normalizeId(message?.senderId);
    if (!handleReply || senderId !== normalizeId(handleReply.author)) return;
    if (handleReply.type !== "select_video") return;
    videoLog(`handleReply từ sender=${senderId}, messageID=${normalizeId(handleReply.messageID)}`);

    const pick = String(message?.text || "").trim();
    if (!/^\d+$/.test(pick)) {
      await replyBot("❌ Vui lòng reply số thứ tự video.");
      return;
    }

    const index = Number.parseInt(pick, 10) - 1;
    const results = Array.isArray(handleReply.results) ? handleReply.results : [];
    if (index < 0 || index >= results.length) {
      await replyBot("❌ Số thứ tự không hợp lệ.");
      return;
    }

    global.client.handleReply = (global.client.handleReply || []).filter(
      (item) => normalizeId(item.messageID) !== normalizeId(handleReply.messageID),
    );

    const picked = results[index];
    const videoUrl = getPlayableVideoUrl(picked);
    if (!videoUrl) {
      await replyBot("❌ Không lấy được link video hợp lệ.");
      return;
    }
    videoLog(`Đã chọn index=${index + 1}, url=${videoUrl}`);

    await replyBot("⏳ Đang tải video bạn chọn...");
    await downloadAndSendVideo(client, message, videoUrl, replyBot, msgType, picked.title || "");
  },
};
