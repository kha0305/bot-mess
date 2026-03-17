const os = require("os");
const fs = require("fs").promises;
const path = require("path");
const packageJson = require(path.resolve("package.json"));

const fmt = b => {
  if (b <= 0) return "0 B";
  const i = Math.floor(Math.log2(b) / 10);
  return (b / 1024 ** i).toFixed(1) + " " + ["B", "KB", "MB", "GB", "TB"][i];
};

const bar = (used, total, len = 15) => {
  const ratio = used / total;
  const full = Math.round(ratio * len);
  return "█".repeat(full) + "░".repeat(len - full);
};

const folderSize = async dir => {
  let size = 0;
  const stack = [dir];
  const skip = new Set(["node_modules", ".git"]);
  while (stack.length) {
    const cur = stack.pop();
    try {
      const stat = await fs.stat(cur);
      if (stat.isFile()) size += stat.size;
      else if (!skip.has(path.basename(cur))) {
        const children = await fs.readdir(cur);
        for (const c of children) stack.push(path.join(cur, c));
      }
    } catch { }
  }
  return size;
};

module.exports = {
  config: {
    name: "upt",
    version: "4.2",
    hasPermssion: 3,
    credits: "vtuan",
    description: "Hiển thị thông tin bot siêu rút gọn",
    commandCategory: "ADMIN",
    usages: "",
    cooldowns: 5
  },

  run: async ({ api, event, Users }) => {
    const { senderID, threadID, messageID } = event;
    let username = "User";
    try {
      const u = await Users.getData(senderID);
      username = u.name || u.data?.name || "User";
    } catch {
      username = "Admin";
    }

    const [mem, totalMem, freeMem, dirSize] = await Promise.all([
      process.memoryUsage(),
      os.totalmem(),
      os.freemem(),
      folderSize("./")
    ]);

    const cpuLoad = os.loadavg()[0].toFixed(2);
    const cpuCount = os.cpus().length;

    const up = process.uptime(), sysUp = os.uptime();
    const d = ~~(up / 86400), h = ~~(up / 3600 % 24), m = ~~(up / 60 % 60), s = ~~(up % 60);
    const sd = ~~(sysUp / 86400), sh = ~~(sysUp / 3600 % 24), sm = ~~(sysUp / 60 % 60);

    const usedMem = totalMem - freeMem;
    const ramBar = bar(usedMem, totalMem);

    const msg = `
✨ ── 𝗕𝗢𝗧 𝗦𝗧𝗔𝗧𝗨𝗦 ── ✨
👤 Yêu cầu: ${username}
🤖 Bot: ${d}d ${h}h ${m}m ${s}s
🖥️ Sys: ${sd}d ${sh}h ${sm}m
⚙️ CPU: ${cpuLoad}% [${cpuCount} Cores]
💾 RAM: ${fmt(mem.rss)} (rss) || ${fmt(mem.heapUsed)} (heap)
🔋 SYS: ${fmt(usedMem)} / ${fmt(totalMem)}
[${ramBar}]
📂 Dir: ${fmt(dirSize)} | 📦 Pkgs: ${Object.keys(packageJson.dependencies || {}).length}
        `.trim();

    api.sendMessage(
      {
        body: msg,
      },
      threadID,
      messageID
    );

  }
};