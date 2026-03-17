import { getUser, getThread, updateUser } from "../db.js";

export default {
  name: "setmoney",
  aliases: ["givemoney"],
  execute: async ({ client, message, contentArgs, PREFIX, replyBot, roles }) => {
    let targetId = null;

    // Trường hợp 1: Có nhắc đến (Tag) những ai
    if (message.mentions && message.mentions.length > 0) {
      targetId = message.mentions[0].userId;
    }
    // Trường hợp 2: Có dùng tính năng Reply tin nhắn người đó
    else if (message.replyTo && message.replyTo.senderId) {
      targetId = message.replyTo.senderId;
    }

    if (!targetId) {
      return await replyBot(
        `⚠️ Cú pháp: ${PREFIX}setmoney @TagName <Số Tiền>\nHoặc bạn có thể Reply tin nhắn của người đó kèm nội dung: ${PREFIX}setmoney <Số Tiền>`,
      );
    }

    // Lấy số tiền muốn set từ args
    const amountRegex = contentArgs.match(/-?\d+/);
    if (!amountRegex) {
      return await replyBot(
        `⚠️ Bạn quên nhập số tiền cho người này rồi! Cú pháp: ${PREFIX}setmoney @Tag <Số Tiền>`,
      );
    }
    const setAmount = parseInt(amountRegex[0]);

    // Bảo mật: kiểm tra quyền quản trị, ưu tiên quyền admin thật của nhóm
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

    // Fallback theo danh sách admin bot lưu nội bộ
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
        `🔐 Lỗi Quyền Hạn: Tính năng Setup Ví này chỉ dành cho Quản Trị Viên của nhóm! Bạn không phải QTV!`,
      );
    }

    // Nếu vượt qua rào cản -> Thực thi đổi tiền
    await getUser(targetId); // Đảm bảo db có targetId trước
    await updateUser(targetId, { balance: setAmount });

    let targetName = `Người dùng ẩn`;
    try {
      const info = await client.getUserInfo(BigInt(targetId));
      if (info && info.name) {
        targetName = info.name;
      }
    } catch (e) {}

    await replyBot(
      `🏦 [Thông Báo Admin]\nĐã cài đặt ví tiền của *${targetName}* thành công với số tiền là: ${setAmount.toLocaleString("en-US")}$`,
    );
  },
};
