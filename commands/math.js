function formatNumber(value) {
  if (Number.isInteger(value)) return value.toString();
  return Number(value.toFixed(10)).toString();
}

export default {
  name: "math",
  aliases: ["calc", "tinh", "tính"],
  description: "Tính toán biểu thức toán học nhanh",
  usages: "<biểu_thức>",
  cooldowns: 2,

  execute: async ({ contentArgs, replyBot, PREFIX }) => {
    const rawExpr = String(contentArgs || "").trim();
    if (!rawExpr) {
      return await replyBot(
        `⚠️ Cú pháp: ${PREFIX}math <biểu_thức>\nVí dụ: ${PREFIX}math (25+5)*3/2`,
      );
    }

    // Chỉ cho phép ký tự an toàn trong biểu thức.
    if (!/^[0-9+\-*/%^().,\s]+$/.test(rawExpr)) {
      return await replyBot(
        "❌ Biểu thức không hợp lệ. Chỉ dùng số và các toán tử + - * / % ^ ( ).",
      );
    }

    const normalized = rawExpr.replace(/\^/g, "**");
    let result;

    try {
      result = Function(`"use strict"; return (${normalized});`)();
    } catch (e) {
      return await replyBot("❌ Không thể tính biểu thức này. Vui lòng kiểm tra lại cú pháp.");
    }

    if (typeof result !== "number" || !Number.isFinite(result)) {
      return await replyBot("❌ Kết quả không hợp lệ (có thể do chia cho 0 hoặc tràn số).");
    }

    await replyBot(`🧮 ${rawExpr} = ${formatNumber(result)}`);
  },
};
