import { getUser, updateUser } from "../db.js";

export default {
  name: "pay",
  aliases: ["chuyentien", "sendmoney", "give"],
  execute: async ({
    client,
    message,
    contentArgs,
    PREFIX,
    replyBot,
    userData,
  }) => {
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
        `⚠️ Cú pháp: ${PREFIX}pay @TagName <Số Tiền>\nHoặc bạn có thể Reply tin nhắn của người cần chuyển kèm nội dung: ${PREFIX}pay <Số Tiền>`,
      );
    }

    if (String(targetId) === String(message.senderId)) {
      return await replyBot("⚠️ Bạn không thể tự chuyển tiền cho chính mình!");
    }

    // Lấy số tiền muốn chuyển từ args
    const amountRegex = contentArgs.match(/\d+/);
    if (!amountRegex) {
      return await replyBot(
        `⚠️ Bạn quên nhập số tiền cho người này rồi! Cú pháp: ${PREFIX}pay @Tag <Số Tiền>`,
      );
    }
    const amount = parseInt(amountRegex[0]);

    if (amount <= 0 || isNaN(amount)) {
      return await replyBot("⚠️ Số tiền chuyển phải lớn hơn 0$!");
    }

    if (userData.balance < amount) {
      return await replyBot(
        `💸 Giao dịch thất bại: Bạn không đủ tiền! Số dư của bạn hiện tại: ${userData.balance.toLocaleString("en-US")}$`,
      );
    }

    // Lấy data người nhận
    const targetUserData = await getUser(targetId);

    // Trừ người gửi, cộng người nhận
    userData.balance -= amount;
    targetUserData.balance += amount;

    await updateUser(userData.id, { balance: userData.balance });
    await updateUser(targetId, { balance: targetUserData.balance });

    let targetName = `Người dùng ẩn`;
    try {
      const info = await client.getUserInfo(BigInt(targetId));
      if (info && info.name) {
        targetName = info.name;
      }
    } catch (e) {}

    await replyBot(
      `💸 *[Giao Dịch Thành Công]*\n✅ Đã chuyển ${amount.toLocaleString("en-US")}$ cho *${targetName}*\n💰 Số dư còn lại của bạn: ${userData.balance.toLocaleString("en-US")}$`,
    );
  },
};
