export default {
  name: "ping",
  execute: async ({ replyBot }) => {
    await replyBot("Pong! Máy chủ đang chạy rất mượt mà 🏓");
  },
};
