import { getThread } from "../db.js";

export default {
  name: "checkrent",
  aliases: ["checkthue", "checkbot", "rentinfo"],
  execute: async ({ message, PREFIX, replyBot }) => {
    const threadId = message.threadId;
    const threadData = await getThread(threadId);

    const now = Date.now();
    const expireTime = Number(threadData.expireAt) || 0;

    if (expireTime <= now) {
      return await replyBot(
        `⚠️ Box này chưa gia hạn Thuê Bot hoặc đã hết hạn.\nVui lòng dùng lệnh: ${PREFIX}rentadd <số ngày> để gia hạn nha!`,
      );
    }

    const dateStr = new Date(expireTime).toLocaleString("vi-VN");
    const timeLeftMs = expireTime - now;

    const days = Math.floor(timeLeftMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (timeLeftMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
    );
    const mins = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));

    await replyBot(
      `✅ Thông tin Thuê Bot của nhóm này:\n` +
        `- Hạn sử dụng đến: ${dateStr}\n` +
        `- Thời gian còn lại: ${days} ngày ${hours} giờ ${mins} phút.`,
    );
  },
};
