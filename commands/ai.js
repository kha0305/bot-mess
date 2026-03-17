import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import axios from "axios";

const execFileAsync = promisify(execFile);
const MAX_AI_OUTPUT = 7000;

function stripAnsi(str) {
  return String(str || "").replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );
}

function resolvePicoclawPath() {
  const candidates = [
    process.env.PICOCLAW_PATH,
    "D:\\picoclaw\\picoclaw.exe",
    path.join(process.cwd(), "picoclaw.exe"),
  ].filter(Boolean);

  for (const item of candidates) {
    if (fs.existsSync(item)) return item;
  }
  return "";
}

function extractUsefulAnswer(rawOutput) {
  const clean = stripAnsi(rawOutput)
    .replace(/\r/g, "")
    .trim();
  if (!clean) return "";

  const byLogo = clean
    .split("🦞")
    .map((s) => s.trim())
    .filter(Boolean);
  if (byLogo.length > 0) {
    const pick = byLogo[byLogo.length - 1];
    if (pick && pick.length > 2) return pick;
  }

  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !line.startsWith("[INFO]") &&
        !line.startsWith("INFO") &&
        !line.startsWith(">") &&
        !line.includes("████") &&
        !line.includes("════"),
    );

  if (lines.length === 0) return "";
  return lines.join("\n").trim();
}

async function downloadImageFromMessage(message) {
  const attachments = message.attachments || [];
  const replyAttachments = message.replyTo?.attachments || [];
  const allAttachments = [...attachments, ...replyAttachments];
  const photo = allAttachments.find((at) => at?.type === "photo" || at?.type === "image");
  if (!photo) return null;

  const imageUrl = photo.url || photo.largePreviewUrl;
  if (!imageUrl) return null;

  const tempDir = path.join(process.cwd(), "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const imagePath = path.join(tempDir, `vision_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`);
  const response = await axios({
    url: imageUrl,
    method: "GET",
    responseType: "arraybuffer",
    timeout: 20000,
  });
  fs.writeFileSync(imagePath, Buffer.from(response.data));
  return imagePath;
}

export default {
  name: "ai",
  aliases: ["picoclaw", "ask", "gen"],
  description: "Hỏi AI bằng văn bản hoặc ảnh (vision)",
  usages: "<câu_hỏi> (hoặc reply ảnh + /ai)",
  cooldowns: 2,

  execute: async ({ message, contentArgs, replyBot }) => {
    let question = String(contentArgs || "").trim();
    let imagePath = null;

    try {
      imagePath = await downloadImageFromMessage(message);
      if (imagePath && !question) {
        question = "Hãy mô tả ảnh này và nêu các chi tiết quan trọng.";
      }
    } catch (err) {
      console.error("[AI] Lỗi tải ảnh vision:", err.message);
    }

    if (!question && !imagePath) {
      return await replyBot(
        "⚠️ Vui lòng nhập câu hỏi hoặc gửi ảnh rồi dùng /ai.",
      );
    }

    const picoclawPath = resolvePicoclawPath();
    if (!picoclawPath) {
      return await replyBot(
        "❌ Chưa tìm thấy picoclaw.exe.\nHãy đặt tại `D:\\picoclaw\\picoclaw.exe` hoặc set biến môi trường `PICOCLAW_PATH`.",
      );
    }

    try {
      const sessionKey = `messenger:${message.senderId}`;
      const nowStr = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
      const prompt =
        `Bạn là trợ lý AI trả lời ngắn gọn, chính xác, lịch sự.\n` +
        `Thời gian hiện tại: ${nowStr}.\n` +
        `Nếu câu hỏi cần dữ liệu mới, hãy dùng web search.\n` +
        `Câu hỏi: ${question}`;

      const args = ["agent", "-s", sessionKey, "-m", prompt];
      if (imagePath) {
        args.push("-i", imagePath);
      }

      const { stdout, stderr } = await execFileAsync(picoclawPath, args, {
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 4,
        windowsHide: true,
      });

      const merged = `${stdout || ""}\n${stderr || ""}`;
      let aiAnswer = extractUsefulAnswer(merged);
      if (!aiAnswer) {
        aiAnswer = "AI đã xử lý xong yêu cầu của bạn.";
      }
      if (aiAnswer.length > MAX_AI_OUTPUT) {
        aiAnswer = `${aiAnswer.slice(0, MAX_AI_OUTPUT)}\n...(rút gọn)`;
      }

      await replyBot(`[ ✧ TRỢ LÝ AI ]\n━━━━━━━━━━━━━━━\n${aiAnswer}`);
    } catch (error) {
      console.error("[AI] Lỗi thực thi:", error.message);
      if (error.code === "ENOENT") {
        return await replyBot("❌ Không chạy được picoclaw.exe (file không tồn tại hoặc sai path).");
      }
      if (String(error.message || "").includes("timed out")) {
        return await replyBot("⏱️ AI xử lý quá lâu, bạn thử lại câu hỏi ngắn hơn nhé.");
      }
      return await replyBot("❌ AI đang gặp sự cố khi xử lý dữ liệu.");
    } finally {
      if (imagePath && fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
        } catch (e) {}
      }
    }
  },
};
