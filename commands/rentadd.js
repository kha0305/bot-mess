import { getThread, updateThread } from "../db.js";

export default {
  name: "rentadd",
  aliases: ["thuebot", "thuê"],
  execute: async ({ message, contentArgs, PREFIX, replyBot, roles }) => {
    const threadId = message.threadId;
    const senderId = String(message.senderId);
    const threadData = await getThread(threadId);
    const canGlobalManage = !!(roles?.isNdh || roles?.isAdmin || roles?.isSuper);

    let adminIDs = threadData.adminIDs || [];
    if (adminIDs.length === 0) {
      // Khởi tạo admin bot đầu tiên cho nhóm nếu chưa có dữ liệu
      adminIDs = [senderId];
      await updateThread(threadId, { adminIDs });
    } else if (!adminIDs.includes(senderId) && !canGlobalManage) {
      return await replyBot(
        "❌ Chỉ Quản Trị Viên Bot của nhóm mới có quyền gia hạn thuê bot.",
      );
    }

    const dayText = String(contentArgs || "").trim();
    if (!/^\d+$/.test(dayText)) {
      return await replyBot(
        `⚠️ Cú pháp sai! Dùng: ${PREFIX}rentadd <Số ngày>\nVí dụ: ${PREFIX}rentadd 30`,
      );
    }

    const days = Number(dayText);
    if (!Number.isFinite(days) || days <= 0) {
      return await replyBot(
        `⚠️ Cú pháp sai! Dùng: ${PREFIX}rentadd <Số ngày>\nVí dụ: ${PREFIX}rentadd 30`,
      );
    }

    const now = Date.now();
    let currentExpire = Number(threadData.expireAt) || 0;

    // Nếu hạn cũ đã hết (trong quá khứ), ta đổi lại mốc bắt đầu là ngày hôm nay.
    if (currentExpire < now) {
      currentExpire = now;
    }

    // Cộng thêm số lượng millisecond tương ứng với số ngày
    const newExpire = currentExpire + days * 24 * 60 * 60 * 1000;
    await updateThread(threadId, { expireAt: newExpire });

    const dateStr = new Date(newExpire).toLocaleString("vi-VN");
    await replyBot(
      `✅ Đã gia hạn thành công!\n⏳ Bot sẽ hoạt động ở nhóm này đến: ${dateStr}`,
    );
  },
};
