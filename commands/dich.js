import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function stripAnsi(str) {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );
}

export default {
  name: "dich",
  aliases: ["translate", "trans"],
  execute: async ({ client, message, contentArgs, replyBot }) => {
    let content = contentArgs ? contentArgs.trim() : "";
    
    // Nếu reply tin nhắn thì lấy nội dung tin nhắn đó để dịch
    if (!content && (message.replyTo?.text || message.replyTo?.body)) {
      content = message.replyTo.text || message.replyTo.body;
    }

    if (!content) {
      return await replyBot(
        "⚠️ Vui lòng nhập nội dung cần dịch hoặc reply một tin nhắn.\nVí dụ: /dich Hello how are you",
      );
    }

    try {
      const picoclawPath = "D:\\picoclaw\\picoclaw.exe";
      // Sử dụng session riêng cho dịch thuật hoặc chung với ai tùy ý, ở đây dùng chung để giữ ngữ cảnh nếu cần
      const sessionKey = `messenger:${message.senderId}`;
      
      const instruction = "Bạn là một chuyên gia dịch thuật. Hãy dịch nội dung sau sang ngôn ngữ đích (mặc định là tiếng Việt nếu không có yêu cầu khác). Chỉ trả về bản dịch, không giải thích thêm.";
      const question = `${instruction}\n\nNội dung: ${content}`;
      const escapedQuestion = question.replace(/"/g, '\\"');
      
      let command = `"${picoclawPath}" agent -s "${sessionKey}" -m "${escapedQuestion}"`;

      console.log(`[Dịch] Đang thực thi: ${command}`);
      const { stdout } = await execAsync(command, { timeout: 60000 });

      const cleanOutput = stripAnsi(stdout);
      
      // Tách câu trả lời (giống ai.js)
      let aiAnswer = "";
      const matches = cleanOutput.match(/🦞\s*([\s\S]+?)(?=\s*\[INFO\]|$)/g);
      
      if (matches && matches.length > 0) {
        aiAnswer = matches[matches.length - 1].replace(/🦞\s*/, "").trim();
      }

      if (!aiAnswer) {
        const lines = cleanOutput.split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line && !line.includes("[INFO]") && !line.includes("█") && !line.includes("═")) {
            aiAnswer = line.replace(/🦞\s*/, "").trim();
            break;
          }
        }
      }

      if (!aiAnswer || aiAnswer.length < 1) {
        aiAnswer = "Không thể dịch nội dung này.";
      }

      await replyBot(`[ Dịch ] ${aiAnswer}`);

    } catch (error) {
      console.error("Lỗi Dịch:", error.message);
      await replyBot("❌ Lỗi: AI đang gặp sự cố khi xử lý dịch thuật.");
    }
  },
};
