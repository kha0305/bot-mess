import { setUnsendEmojis, getUnsendEmojis } from "../config.js";
import { getThread } from "../db.js";

export default {
  name: "setunsend",
  aliases: ["icon"],
  execute: async ({ client, message, contentArgs, PREFIX, replyBot, roles }) => {
    if (!contentArgs) {
      return await replyBot(
        `⚠️ Cú pháp: ${PREFIX}setunsend <Danh sách Icon>\nVí dụ: ${PREFIX}setunsend 🤢 💩 😷`,
      );
    }

    // Bảo mật: Khoá quyền, không cho qua nếu không xác thực được admin
    let hasPerms = false;
    try {
      if (client.getThreadInfo) {
        const threadInfo = await client.getThreadInfo(message.threadId);
        if (threadInfo && threadInfo.isGroup) {
          const adminIds = threadInfo.adminIds || [];
          hasPerms = adminIds.some(
            (id) => String(id) === String(message.senderId),
          );
        }
      }
    } catch (e) {}

    if (!hasPerms) {
      const threadData = await getThread(message.threadId);
      const adminIDs = threadData.adminIDs || [];
      hasPerms = adminIDs.includes(String(message.senderId));
    }

    if (!hasPerms) {
      hasPerms = !!(roles?.isNdh || roles?.isAdmin || roles?.isSuper);
    }

    if (!hasPerms) {
      return await replyBot(
        `🔐 Lỗi Quyền Hạn: Tính năng Setup Icon gỡ tin chỉ dành cho Quản Trị Viên!`,
      );
    }

    // Tách các icon bằng Regex
    // Lấy tất cả ký tự phi chữ cái, khoảng trắng ghép
    let words = contentArgs.split(/\s+/).filter((i) => i.trim() !== "");

    if (words.length === 0)
      return await replyBot("⚠️ Không nhận diện được biểu tượng Emoji hợp lệ.");

    // Ghi đè cấu hình
    setUnsendEmojis(words);
    await replyBot(
      `✅ [Thông Báo Admin]\nĐã thay đổi các Emoji để kích hoạt lệnh "TỰ GỠ TIN NHẮN" thành: [ ${getUnsendEmojis().join(" | ")} ]`,
    );
  },
};
