import { getUser } from "../db.js";

export default {
  name: "balance",
  aliases: ["money"],
  execute: async ({ client, message, userData, replyBot }) => {
    let targetId = null;

    if (message.mentions && message.mentions.length > 0) {
      targetId = message.mentions[0].userId;
    } else if (message.replyTo && message.replyTo.senderId) {
      targetId = message.replyTo.senderId;
    }

    if (targetId && String(targetId) !== String(message.senderId)) {
      const targetUserData = await getUser(targetId);

      let targetName = `Người dùng ẩn`;
      try {
        const info = await client.getUserInfo(BigInt(targetId));
        if (info && info.name) {
          targetName = info.name;
        }
      } catch (e) {}

      await replyBot(
        `💰 Số dư của *${targetName}* đang có là: ${targetUserData.balance.toLocaleString("en-US")}$`,
      );
    } else {
      await replyBot(
        `💰 Số dư của bạn đang có là: ${userData.balance.toLocaleString("en-US")}$`,
      );
    }
  },
};
