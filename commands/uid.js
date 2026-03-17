export default {
  name: "uid",
  execute: async ({ message, replyBot }) => {
    await replyBot(`ID của bạn trên hệ thống là: ${message.senderId}`);
  },
};
