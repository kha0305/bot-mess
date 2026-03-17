export default {
  name: "info",
  execute: async ({ client, message, replyBot }) => {
    let userInfo = { name: "Không rõ", id: message.senderId };
    try {
      const info = await client.getUserInfo(BigInt(message.senderId));
      if (info) userInfo = info;
    } catch (e) {}
    const infoText =
      `💡 Thẻ Thông Tin:\n` +
      `- Tên: ${userInfo.name}\n` +
      `- ID: ${userInfo.id}\n` +
      `- Có thể gửi link avatar từ graph api bằng ID này.`;
    await replyBot(infoText);
  },
};
