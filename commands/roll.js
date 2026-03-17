function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export default {
  name: "roll",
  aliases: ["dice", "rand", "random"],
  description: "Quay số ngẫu nhiên theo range hoặc xúc xắc NdM",
  usages: "[min max] | [NdM]",
  cooldowns: 2,

  execute: async ({ contentArgs, replyBot, PREFIX }) => {
    const raw = String(contentArgs || "").trim().toLowerCase();

    if (!raw) {
      const value = randomInt(1, 100);
      return await replyBot(`🎲 Roll mặc định (1-100): ${value}`);
    }

    const diceMatch = raw.match(/^(\d{1,2})d(\d{1,4})$/);
    if (diceMatch) {
      const count = Number(diceMatch[1]);
      const sides = Number(diceMatch[2]);

      if (count < 1 || count > 20 || sides < 2 || sides > 1000) {
        return await replyBot("⚠️ NdM hợp lệ: 1<=N<=20 và 2<=M<=1000.");
      }

      const rolls = [];
      for (let i = 0; i < count; i++) {
        rolls.push(randomInt(1, sides));
      }
      const total = rolls.reduce((sum, x) => sum + x, 0);
      return await replyBot(`🎲 ${count}d${sides}: [${rolls.join(", ")}]\n➡️ Tổng: ${total}`);
    }

    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length === 1 && /^\d+$/.test(parts[0])) {
      const max = Number(parts[0]);
      if (max < 1 || max > 1000000) {
        return await replyBot("⚠️ Giới hạn phải từ 1 đến 1,000,000.");
      }
      const value = randomInt(1, max);
      return await replyBot(`🎯 Random (1-${max}): ${value}`);
    }

    if (parts.length === 2 && /^-?\d+$/.test(parts[0]) && /^-?\d+$/.test(parts[1])) {
      let min = Number(parts[0]);
      let max = Number(parts[1]);
      if (min > max) [min, max] = [max, min];

      if (max - min > 1000000) {
        return await replyBot("⚠️ Khoảng quá lớn. Vui lòng dùng range <= 1,000,000.");
      }

      const value = randomInt(min, max);
      return await replyBot(`🎯 Random (${min}-${max}): ${value}`);
    }

    return await replyBot(
      `⚠️ Cú pháp:\n- ${PREFIX}roll\n- ${PREFIX}roll 1 100\n- ${PREFIX}roll 6\n- ${PREFIX}roll 3d6`,
    );
  },
};
