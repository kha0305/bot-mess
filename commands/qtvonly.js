import { getThread, updateThread } from "../db.js";

export default {
  name: "qtvonly",
  aliases: ["adminonly"],
  execute: async ({ message, PREFIX, replyBot, roles }) => {
    const threadId = message.threadId;
    const threadData = await getThread(threadId);
    const canGlobalManage = !!(roles?.isNdh || roles?.isAdmin || roles?.isSuper);

    // Lấy trạng thái hiện tại
    const isQtvOnly = !!threadData.qtvOnly;
    const adminIDs = threadData.adminIDs || [];

    // Kiểm tra quyền hạn
    if (
      adminIDs.length > 0 &&
      !adminIDs.includes(String(message.senderId)) &&
      !canGlobalManage
    ) {
      return await replyBot(
        "❌ Tính năng bật/tắt QTVONLY này chỉ dành cho Quản Trị Viên (Bot) của nhóm!",
      );
    }

    // Nếu nhóm chưa có Quản Trị Viên nào, tự gán bản thân người đầu tiên là QTV
    let updateData = { qtvOnly: !isQtvOnly };

    if (adminIDs.length === 0) {
      updateData.adminIDs = [String(message.senderId)];
    }

    // Đảo ngược trạng thái và lưu
    await updateThread(threadId, updateData);

    if (!isQtvOnly) {
      await replyBot(
        "✅ Bật thành công chế độ QTVONLY!\n(Chỉ những Quản Trị Viên Bot mới có thể dùng các lệnh khác).",
      );
    } else {
      await replyBot(
        "❌ Tắt thành công chế độ QTVONLY!\n(Mọi người đều có thể sử dụng các lệnh của Bot).",
      );
    }
  },
};
