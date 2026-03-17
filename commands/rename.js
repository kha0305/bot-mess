import { getThread } from "../db.js";

export default {
  name: "rename",
  aliases: ["name"],
  execute: async ({ client, message, contentArgs, PREFIX, replyBot, roles }) => {
    // Yêu cầu nội dung chữ args đằng sau
    if (!contentArgs) {
      return await replyBot(
        `⚠️ Thiếu tên mới. Dùng: ${PREFIX}rename <tên mới>`,
      );
    }

    // Bảo mật: chỉ admin được đổi tên nhóm
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
        `🔐 Lỗi Quyền Hạn: Tính năng này chỉ dành cho Quản Trị Viên của nhóm!`,
      );
    }

    await client.renameThread(message.threadId, contentArgs);
    await replyBot(`✅ Đã đổi tên nhóm thành công: ${contentArgs}`);
  },
};
