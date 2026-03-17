import axios from "axios";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const SKIP_DIRS = new Set(["node_modules", ".git", "backups"]);
const MAX_SEARCH_DEPTH = 8;
const DEFAULT_NOTE_BASE_URL = "https://lechii.online";
const NOTE_UPLOAD_TIMEOUT_MS = Math.max(3000, Number(process.env.NOTE_UPLOAD_TIMEOUT_MS || 15000));
const NOTE_UPLOAD_RETRIES = Math.max(0, Number(process.env.NOTE_UPLOAD_RETRIES || 2));
const RETRYABLE_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function normalizeId(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

function getSentMessageId(result) {
  if (!result || typeof result !== "object") return "";
  return normalizeId(
    result.messageID ||
      result.messageId ||
      result.id ||
      result.key?.id ||
      result[0]?.id,
  );
}

function ensureHandleReplyStore() {
  if (!global.client) global.client = {};
  if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
  return global.client.handleReply;
}

function ensureHandleReactionStore() {
  if (!global.client) global.client = {};
  if (!Array.isArray(global.client.handleReaction)) global.client.handleReaction = [];
  return global.client.handleReaction;
}

function clearHandleReply(messageID) {
  if (!Array.isArray(global.client?.handleReply)) return;
  const target = normalizeId(messageID);
  global.client.handleReply = global.client.handleReply.filter(
    (item) => normalizeId(item?.messageID) !== target,
  );
}

function clearHandleReaction(messageID) {
  if (!Array.isArray(global.client?.handleReaction)) return;
  const target = normalizeId(messageID);
  global.client.handleReaction = global.client.handleReaction.filter(
    (item) => normalizeId(item?.messageID) !== target,
  );
}

function formatPath(filePath) {
  return path.relative(process.cwd(), filePath) || filePath;
}

function normalizeBaseUrl(raw) {
  const input = String(raw || "").trim();
  if (!input || !/^https?:\/\//i.test(input)) return "";
  return input.replace(/\/+$/, "");
}

function getNoteBaseUrls() {
  const fromEnv = String(process.env.NOTE_BASE_URLS || process.env.NOTE_BASE_URL || "")
    .split(",")
    .map((item) => normalizeBaseUrl(item))
    .filter(Boolean);
  return [...new Set([...fromEnv, DEFAULT_NOTE_BASE_URL])];
}

function buildEditUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  const root = normalized ? `${normalized}/` : `${DEFAULT_NOTE_BASE_URL}/`;
  return new URL(`note/${uuidv4()}`, root);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrCode(error) {
  return String(error?.code || error?.cause?.code || "").toUpperCase();
}

function shouldRetry(error) {
  const code = getErrCode(error);
  if (RETRYABLE_ERROR_CODES.has(code)) return true;
  const status = Number(error?.response?.status || 0);
  return status === 429 || status >= 500;
}

function formatUploadFailure(error) {
  const code = getErrCode(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "Không phân giải được tên miền note server.";
  }
  if (code === "ETIMEDOUT" || code === "ECONNABORTED") {
    return "Kết nối note server bị timeout.";
  }
  const status = Number(error?.response?.status || 0);
  if (status > 0) {
    return `Note server trả về HTTP ${status}.`;
  }
  const msg = String(error?.message || "").trim();
  return msg || "Không rõ nguyên nhân.";
}

async function tryUploadToBaseUrl(baseUrl, data) {
  let lastError = null;
  for (let attempt = 0; attempt <= NOTE_UPLOAD_RETRIES; attempt += 1) {
    const editUrl = buildEditUrl(baseUrl);
    try {
      await axios.put(editUrl.href, data, {
        headers: { "content-type": "text/plain; charset=utf-8" },
        timeout: NOTE_UPLOAD_TIMEOUT_MS,
      });

      const rawUrl = new URL(editUrl.href);
      rawUrl.searchParams.append("raw", "true");
      return {
        raw: rawUrl.href,
        edit: editUrl.href,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= NOTE_UPLOAD_RETRIES || !shouldRetry(error)) break;
      await sleep(350 * (attempt + 1));
    }
  }
  throw lastError || new Error("Không thể upload dữ liệu.");
}

function normalizeRawUrl(url) {
  const input = String(url || "").trim();
  if (!input) return "";
  return input.includes("raw=true")
    ? input
    : `${input}${input.includes("?") ? "&" : "?"}raw=true`;
}

function findFile(name, dir = process.cwd(), depth = 0) {
  const result = [];
  if (depth > MAX_SEARCH_DEPTH) return result;

  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = path.join(dir, entry);

    let stat = null;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      result.push(...findFile(name, fullPath, depth + 1));
      continue;
    }

    if (!stat.isFile()) continue;
    const targetBase = path.parse(String(name || "")).name;
    const entryBase = path.parse(entry).name;
    if (entry === name || entryBase === targetBase) {
      result.push(fullPath);
    }
  }

  return result;
}

async function upload(filePath) {
  const data = fs.readFileSync(filePath, "utf8");
  const stats = fs.statSync(filePath);
  const errors = [];

  for (const baseUrl of getNoteBaseUrls()) {
    try {
      const result = await tryUploadToBaseUrl(baseUrl, data);
      return {
        raw: result.raw,
        edit: result.edit,
        size: stats.size,
        lines: data.split("\n").length,
      };
    } catch (error) {
      errors.push({ baseUrl, error });
    }
  }

  const reason =
    errors.length > 0
      ? errors
          .map((item) => `[${item.baseUrl}] ${formatUploadFailure(item.error)}`)
          .join(" | ")
      : "Không có endpoint note nào khả dụng.";
  const wrapped = new Error(`Không thể upload file lên note server. ${reason}`);
  const lastError = errors[errors.length - 1]?.error;
  if (lastError) {
    wrapped.code = getErrCode(lastError);
    wrapped.cause = lastError;
  }
  throw wrapped;
}

function getUploadHelpMessage(error) {
  const reason = formatUploadFailure(error);
  return `❌ Không thể upload file lên note: ${reason}\n💡 Bạn có thể dùng /note <ten_file> <url_raw> để cập nhật trực tiếp.`;
}

async function replace(filePath, url) {
  const data = (
    await axios.get(url, {
      responseType: "text",
      timeout: NOTE_UPLOAD_TIMEOUT_MS,
    })
  ).data;

  fs.writeFileSync(filePath, data, "utf8");
  const stats = fs.statSync(filePath);
  return {
    rel: formatPath(filePath),
    size: stats.size,
    lines: String(data).split("\n").length,
  };
}

export default {
  name: "note",
  version: "3.6.0",
  hasPermssion: 3,
  credits: "lechii",
  description: "Chỉnh sửa hoặc xuất nội dung code thông minh",
  usages: "<ten_file> [url]",
  commandCategory: "Admin",
  cooldowns: 0,

  findFile,
  upload,
  replace,

  async execute({ message, args = [], replyBot }) {
    const name = String(args[0] || "").trim();
    const url = String(args[1] || "").trim();
    const author = normalizeId(message?.senderId);

    if (!name) {
      await replyBot("❌ Nhập tên file!");
      return;
    }

    const list = findFile(name);
    if (!list.length) {
      await replyBot(`❌ Không tìm thấy file: ${name}`);
      return;
    }

    if (list.length > 1) {
      const content = list
        .map((filePath, index) => {
          const rel = formatPath(filePath);
          const marker = rel.includes("modules") ? " 📁" : "";
          return `${index + 1}. ${rel}${marker}`;
        })
        .join("\n");

      const sent = await replyBot(
        `🔍 Có ${list.length} file:\n\n${content}\n\n💡 Reply số để chọn`,
      );
      const messageID = getSentMessageId(sent);
      if (!messageID) return;

      ensureHandleReplyStore().push({
        name: "note",
        type: "reply",
        messageID,
        files: list,
        url,
        author,
        action: /^https?:\/\//i.test(url) ? "replace" : "export",
      });
      return;
    }

    const filePath = list[0];
    if (/^https?:\/\//i.test(url)) {
      const rawUrl = normalizeRawUrl(url);
      const sent = await replyBot(
        `📁 ${formatPath(filePath)}\n🌐 ${rawUrl}\n💾 Thả cảm xúc để xác nhận`,
      );
      const messageID = getSentMessageId(sent);
      if (!messageID) return;

      ensureHandleReactionStore().push({
        name: "note",
        type: "reaction",
        messageID,
        filePath,
        url: rawUrl,
        author,
        action: "replace",
        threadID: normalizeId(message?.threadId),
      });
      return;
    }

    let up = null;
    try {
      up = await upload(filePath);
    } catch (error) {
      console.error("[NOTE] Upload thất bại:", error);
      await replyBot(getUploadHelpMessage(error));
      return;
    }
    const infoTxt = `📏 ${(up.size / 1024).toFixed(2)} KB | 📄 ${up.lines} dòng`;
    const sent = await replyBot(
      `📝 Raw: ${up.raw}\n\n✏️ Edit: ${up.edit}\n────────────────\n📁 ${formatPath(filePath)}\n${infoTxt}\n💾 Thả cảm xúc để xác nhận`,
    );
    const messageID = getSentMessageId(sent);
    if (!messageID) return;

    ensureHandleReactionStore().push({
      name: "note",
      type: "reaction",
      messageID,
      filePath,
      url: up.raw,
      author,
      action: "replace",
      threadID: normalizeId(message?.threadId),
    });
  },

  async handleReply({ message, handleReply, replyBot }) {
    const author = normalizeId(handleReply?.author);
    const sender = normalizeId(message?.senderId);
    if (!handleReply || !author || sender !== author) return;

    const index = Number.parseInt(String(message?.text || "").trim(), 10) - 1;
    const filePath = handleReply.files?.[index];

    if (!filePath || !fs.existsSync(filePath)) {
      await replyBot("❌ File không hợp lệ");
      return;
    }

    clearHandleReply(handleReply.messageID);

    if (handleReply.action === "replace") {
      const rawUrl = normalizeRawUrl(handleReply.url);
      const sent = await replyBot(
        `📁 ${formatPath(filePath)}\n🌐 ${rawUrl}\n💾 Thả cảm xúc để xác nhận`,
      );
      const messageID = getSentMessageId(sent);
      if (!messageID) return;

      ensureHandleReactionStore().push({
        name: "note",
        type: "reaction",
        messageID,
        filePath,
        url: rawUrl,
        author,
        action: "replace",
        threadID: normalizeId(message?.threadId),
      });
      return;
    }

    let up = null;
    try {
      up = await upload(filePath);
    } catch (error) {
      console.error("[NOTE] Upload thất bại (handleReply):", error);
      await replyBot(getUploadHelpMessage(error));
      return;
    }
    const infoTxt = `📏 ${(up.size / 1024).toFixed(2)} KB | 📄 ${up.lines} dòng`;
    const sent = await replyBot(
      `📝 Raw: ${up.raw}\n\n✏️ Edit: ${up.edit}\n────────────────\n📁 ${formatPath(filePath)}\n${infoTxt}\n💾 Thả cảm xúc để xác nhận`,
    );
    const messageID = getSentMessageId(sent);
    if (!messageID) return;

    ensureHandleReactionStore().push({
      name: "note",
      type: "reaction",
      messageID,
      filePath,
      url: up.raw,
      author,
      action: "replace",
      threadID: normalizeId(message?.threadId),
    });
  },

  async handleReaction({ client, event, message, handleReaction, replyBot }) {
    if (!handleReaction) return;

    const author = normalizeId(handleReaction.author);
    const actor = normalizeId(event?.actorId || event?.userID || message?.senderId);
    if (!author || !actor || actor !== author) return;

    const filePath = handleReaction.filePath;
    const url = handleReaction.url;
    const threadID = event?.threadId || message?.threadId || handleReaction.threadID;
    const send = async (text) => {
      if (typeof replyBot === "function") return await replyBot(text);
      if (!threadID) return null;
      return await client.sendMessage(threadID, String(text || ""));
    };

    if (!filePath || !url) {
      await send("❌ Thiếu dữ liệu file hoặc url");
      clearHandleReaction(handleReaction.messageID);
      return;
    }

    try {
      const result = await replace(filePath, url);
      const infoTxt = `📏 ${(result.size / 1024).toFixed(2)} KB | 📄 ${result.lines} dòng`;
      await send(
        `✅ Đã cập nhật!\n📁 ${result.rel}\n${infoTxt}\n⏰ ${new Date().toLocaleString("vi-VN")}`,
      );
    } catch (error) {
      await send(`❌ Cập nhật thất bại: ${error?.message || error}`);
    } finally {
      clearHandleReaction(handleReaction.messageID);
    }
  },
};
