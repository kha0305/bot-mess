function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  if (minutes || hours || days) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

function toMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export default {
  name: "uptime",
  aliases: ["up", "status"],
  description: "Xem thời gian bot đã chạy và tài nguyên",
  usages: "",
  cooldowns: 5,

  execute: async ({ replyBot }) => {
    const up = process.uptime();
    const mem = process.memoryUsage();
    const startMs = Date.now() - Math.floor(up * 1000);

    const msg =
      `[ BOT STATUS ]\n` +
      `⏱️ Uptime: ${formatDuration(up)}\n` +
      `🕒 Start lúc: ${new Date(startMs).toLocaleString("vi-VN")}\n` +
      `🧠 RAM (RSS): ${toMB(mem.rss)} MB\n` +
      `📦 Heap: ${toMB(mem.heapUsed)} / ${toMB(mem.heapTotal)} MB`;

    await replyBot(msg);
  },
};
