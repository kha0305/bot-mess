export default {
  name: "hi",
  aliases: ["hello"],
  execute: async ({ client, message, replyBot }) => {
    let displayName = "bạn";
    try {
      const userInfo = await client.getUserInfo(BigInt(message.senderId));
      if (userInfo?.name) displayName = userInfo.name;
    } catch (e) {}
    await replyBot(`Chào ${displayName} 👋! Chúc một ngày vui vẻ.`);
  },
};
