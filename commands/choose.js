export default {
  name: "choose",
  aliases: ["pick", "chon", "chọn"],
  description: "Chọn ngẫu nhiên 1 lựa chọn trong danh sách",
  usages: "<lựa_chọn_1 | lựa_chọn_2 | ...>",
  cooldowns: 2,

  execute: async ({ contentArgs, replyBot, PREFIX }) => {
    const raw = String(contentArgs || "").trim();
    if (!raw) {
      return await replyBot(
        `⚠️ Cú pháp: ${PREFIX}choose <A | B | C>\nVí dụ: ${PREFIX}choose ăn phở | ăn bún | ăn cơm`,
      );
    }

    const splitter = raw.includes("|") ? "|" : ",";
    const options = raw
      .split(splitter)
      .map((item) => item.trim())
      .filter(Boolean);

    if (options.length < 2) {
      return await replyBot("⚠️ Cần ít nhất 2 lựa chọn (ngăn cách bằng | hoặc ,).");
    }

    const index = Math.floor(Math.random() * options.length);
    const selected = options[index];

    await replyBot(
      `🎯 Kết quả chọn ngẫu nhiên (${options.length} lựa chọn):\n✅ ${selected}`,
    );
  },
};
