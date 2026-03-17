module.exports = {
    config: {
        name: "reset",
        version: "1.0",
        hasPermssion: 3,
        credits: "vtuan",
        description: "Khởi động lại bot",
        commandCategory: "ADMIN",
        cooldowns: 0
    },
    run: ({ api, event }) =>  api.sendMessage("🔄 Đang khởi động lại bot...", event.threadID, () => process.exit(1))
};
