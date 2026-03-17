import pkg_ytdlp from "yt-dlp-exec";
const { exec: ytdlp } = pkg_ytdlp;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import ffmpeg from "ffmpeg-static";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempDir = path.join(__dirname, "..", "data", "temp");
const MB = 1024 * 1024;
const SING_DEBUG_LOG = String(process.env.SING_DEBUG_LOG || "true").toLowerCase() !== "false";

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

function singLog(...args) {
  if (!SING_DEBUG_LOG) return;
  console.log("[SING]", ...args);
}

function normalizeId(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
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

function ensureHandleReplyStore() {
  if (!global.client) global.client = {};
  if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
  return global.client.handleReply;
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

export default {
  name: "sing",
  version: "2.2.0",
  credits: "Antigravity (Optimized yt-dlp)",
  description: "Phát nhạc từ YouTube, TikTok, Facebook... sử dụng yt-dlp",
  usages: "sing [tên bài hát/link YouTube]",
  cooldowns: 5,

  execute: async ({ client, message, contentArgs, replyBot, type }) => {
    const senderId = normalizeId(message?.senderId);
    const query = String(contentArgs || "").trim();
    singLog(`Execute /sing query="${query}" sender=${senderId}`);

    if (!query) {
      return replyBot("❎ Bạn chưa nhập tên bài hát hoặc link cần tải!");
    }

    const directLink = normalizeDirectLink(query);

    try {
      if (directLink) {
        singLog(`Nhận direct link: ${directLink}`);
        await replyBot("⏳ Đang nhận link và tải nhạc...");
        return await downloadAndSend(client, message, directLink, replyBot, type);
      } else {
        const statusMsg = await replyBot(`🔍 Đang tìm kiếm: ${query} trên YouTube...`);

        const output = await ytdlp(`ytsearch10:${query}`, {
          dumpSingleJson: true,
          noCheckCertificates: true,
          noWarnings: true,
          preferFreeFormats: true,
          flatPlaylist: true,
          addHeader: ["referer:youtube.com", "user-agent:googlebot"],
        });

        let searchData;
        try {
          searchData = JSON.parse(output.stdout || "{}");
        } catch {
          console.error("Lỗi parse JSON tìm kiếm:", String(output?.stdout || "").substring(0, 200));
          return replyBot("❌ Lỗi: Dữ liệu từ YouTube trả về không hợp lệ.");
        }

        const entries = Array.isArray(searchData.entries) ? searchData.entries : [];
        if (!entries.length) {
          return replyBot("❌ Không tìm thấy kết quả nào!");
        }
        singLog(`Tìm kiếm "${query}" có ${entries.length} kết quả.`);

        let msg = `🎬 Tìm được ${entries.length} kết quả:\n\n`;
        const list = entries.slice(0, 10);
        list.forEach((item, index) => {
          const duration = formatDuration(item.duration);
          msg += `${index + 1}. ${item.title || "Không rõ tên"} (${duration})\n🌐 Kênh: ${item.uploader || "Unknown"}\n\n`;
        });
        msg += "👇 Reply số để chọn bài hát bạn muốn nghe!";

        const info = await replyBot(msg);
        const sentMsgId = typeof info === "string" ? info : getSentMessageId(info);

        await removeLoadingMessage(client, statusMsg, message, type);

        if (sentMsgId) {
          ensureHandleReplyStore().push({
            name: "sing",
            messageID: sentMsgId,
            author: senderId,
            results: list,
            type: "select_song",
          });
          singLog(`Đã lưu handleReply messageID=${sentMsgId}, author=${senderId}`);
        } else {
          console.error("Lưu handleReply thất bại vì không lấy được Message ID từ info:", info);
        }
      }
    } catch (err) {
      console.error("Lỗi Sing Execute:", err?.message || err);
      return replyBot("⚠️ Lỗi: Không thể tìm kiếm nội dung này.");
    }
  },

  handleReply: async ({ client, message, replyBot, handleReply, type: msgType }) => {
    const senderId = normalizeId(message?.senderId);
    const text = String(message?.text || "").trim();
    const { results = [], type, author } = handleReply;

    if (senderId !== normalizeId(author)) return;
    singLog(`handleReply sender=${senderId}, messageID=${normalizeId(handleReply?.messageID)}`);

    if (type !== "select_song" || !results.length) return;
    if (!/^[0-9]+$/.test(text)) {
      return replyBot("❌ Vui lòng reply số thứ tự bài hát.");
    }

    const idx = Number.parseInt(text, 10) - 1;
    if (idx < 0 || idx >= results.length) {
      return replyBot("❌ Số thứ tự không hợp lệ!");
    }

    global.client.handleReply = (global.client.handleReply || []).filter(
      (item) => normalizeId(item.messageID) !== normalizeId(handleReply.messageID),
    );
    const song = results[idx];
    singLog(`Đã chọn index=${idx + 1}, url=${getPlayableSongUrl(song)}`);
    return await downloadAndSend(
      client,
      message,
      getPlayableSongUrl(song),
      replyBot,
      msgType,
      song.title,
    );
  },
};

async function downloadAndSend(client, message, url, replyBot, msgType, title = "") {
  let loadingMsg;
  const currentId = uuidv4();

  try {
    singLog(`Bắt đầu tải "${title || "unknown"}" từ ${url}`);
    loadingMsg = await replyBot(`⏳ Đang tải bài hát về máy chủ (có thể mất 15-30s)...`);

    const outputTemplate = path.join(tempDir, `${currentId}.%(ext)s`);

    // Tải và sử dụng FFmpeg để convert trực tiếp sang MP3
    await ytdlp(url, {
      output: outputTemplate,
      extractAudio: true,
      audioFormat: "mp3",
      ffmpegLocation: ffmpeg,
      noCheckCertificates: true,
      noWarnings: true,
      noPlaylist: true,
      format: "bestaudio/best",
      maxFilesize: "25M",
      addHeader: ["referer:youtube.com", "user-agent:googlebot"],
    });
    singLog("yt-dlp tải xong, kiểm tra file...");

    // Lấy chính xác file .mp3 được tạo ra
    const fileNameBase = currentId;
    const expectedFilePath = path.join(tempDir, `${fileNameBase}.mp3`);
    let downloadedFilePath = expectedFilePath;

    if (!fs.existsSync(expectedFilePath)) {
      // Đề phòng trường hợp yt-dlp trả về file khác mà không convert (rất hiếm)
      const files = fs.readdirSync(tempDir);
      const fallbackFile = files.find((f) => f.startsWith(fileNameBase) && !f.endsWith(".webm"));
      if (!fallbackFile) {
        throw new Error("Không thể tìm thấy file nhạc sau khi tải.");
      }
      downloadedFilePath = path.join(tempDir, fallbackFile);
    }

    const stats = fs.statSync(downloadedFilePath);
    if (stats.size > 25 * 1024 * 1024) {
      if (fs.existsSync(downloadedFilePath)) fs.unlinkSync(downloadedFilePath);
      return replyBot("❌ Lỗi: File nhạc sau khi tải về quá nặng (>25MB), Messenger không cho phép gửi.");
    }
    singLog(`File audio size ${(stats.size / MB).toFixed(2)}MB`);

    const buffer = fs.readFileSync(downloadedFilePath);
    const isE2EE = msgType === "E2EE Message" && message.chatJid;
    const targetId = isE2EE ? message.chatJid : message.threadId;
    singLog(`Bắt đầu gửi audio (${isE2EE ? "E2EE" : "normal"})`);

    try {
      if (isE2EE) {
        // Gửi qua dạng MP3 với mimeType audio/mpeg để Messenger hiện thanh phát audio
        await client.sendE2EEAudio(targetId, buffer, "audio/mpeg", { ptt: false });
      } else {
        // Gửi voice message chuẩn MP3
        await client.sendVoice(targetId, buffer, "audio.mp3");
      }
      singLog("Gửi audio thành công bằng phương thức chính.");
    } catch (sendErr) {
      console.error(`[SING] Lỗi phương thức chính: ${sendErr?.message || sendErr}`);
      singLog("Thử fallback gửi file...");
      try {
        if (isE2EE && typeof client.sendE2EEDocument === "function") {
          await client.sendE2EEDocument(targetId, buffer, "music_audio.mp3", "audio/mpeg");
        } else {
          // Fallback gửi dạng file mp3 đính kèm
          await client.sendFile(targetId, buffer, "music_audio.mp3", "audio/mpeg");
        }
        singLog("Fallback gửi file thành công.");
      } catch (fallbackErr) {
        console.error(`[SING] Gửi fallback cũng thất bại: ${fallbackErr?.message || fallbackErr}`);
        throw fallbackErr;
      }
    }

    // Xóa file tạm và tin nhắn loading
    try {
      if (fs.existsSync(downloadedFilePath)) fs.unlinkSync(downloadedFilePath);
      // Clean up fallback webm file just in case
      const webmPath = path.join(tempDir, `${fileNameBase}.webm`);
      if (fs.existsSync(webmPath)) fs.unlinkSync(webmPath);
      await removeLoadingMessage(client, loadingMsg, message, msgType);
    } catch {}

    singLog(`Hoàn tất gửi bài: ${title || "Nhạc"}`);
    return replyBot(`✅ Hoàn tất bài: ${title || "Nhạc"}`);

  } catch (err) {
    console.error("Lỗi downloadAndSend (yt-dlp):", err?.message || err);
    singLog(`downloadAndSend lỗi: ${String(err?.message || err)}`);
    // Cleanup files in case of error
    try {
      const files = fs.readdirSync(tempDir);
      files.forEach((f) => {
        if (f.startsWith(currentId)) fs.unlinkSync(path.join(tempDir, f));
      });
    } catch {}

    await removeLoadingMessage(client, loadingMsg, message, msgType);

    let errMsg = "❌ Lỗi hệ thống khi tải nhạc.";
    const errText = String(err?.message || err || "");
    if (errText.includes("File is larger than max-filesize")) {
      errMsg = "❌ Lỗi: Bản nhạc này quá nặng, hãy chọn bài khác ngắn hơn.";
    }
    return replyBot(errMsg);
  }
}

function formatDuration(seconds) {
  if (!seconds) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s]
    .map((v) => (v < 10 ? `0${v}` : String(v)))
    .filter((v, i) => v !== "00" || i > 0)
    .join(":");
}

function normalizeDirectLink(rawInput) {
  const input = String(rawInput || "").trim().replace(/^<|>$/g, "");
  if (!input) return "";

  if (/^https?:\/\//i.test(input)) return input;

  if (/^(www\.)?(m\.)?(music\.)?youtube\.com\//i.test(input) || /^youtu\.be\//i.test(input)) {
    return `https://${input}`;
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return `https://youtu.be/${input}`;
  }

  return "";
}

function getPlayableSongUrl(song = {}) {
  const webpage = normalizeDirectLink(song.webpage_url);
  if (webpage) return webpage;

  const direct = normalizeDirectLink(song.url);
  if (direct) return direct;

  const id = String(song.id || "").trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return `https://www.youtube.com/watch?v=${id}`;
  }

  return String(song.webpage_url || song.url || "").trim();
}
