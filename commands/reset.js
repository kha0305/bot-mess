export default {
  name: "reset",
  aliases: ["restart", "reboot"],
  description: "Khoi dong lai bot",
  usages: "reset",
  hasPermssion: 3,
  cooldowns: 0,
  execute: async ({ replyBot }) => {
    if (typeof replyBot === "function") {
      await replyBot("🔄 Đang khởi động lại bot...");
    }
    setTimeout(() => process.exit(1), 250);
  },
};
