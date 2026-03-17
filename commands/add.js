import qtvCommand from "./qtv.js";

export default {
  name: "add",
  aliases: [],
  description: "Add admin bot cho nhom",
  usages: "[admin] <@tag/reply/uid>",
  hasPermssion: 1,
  cooldowns: 0,
  execute: async (ctx = {}) => {
    const args = String(ctx.contentArgs || "").trim().split(/\s+/).filter(Boolean);
    const first = String(args[0] || "").toLowerCase();
    const isAdminKeyword = first === "admin";
    const hasMention = Array.isArray(ctx?.message?.mentions) && ctx.message.mentions.length > 0;
    const hasReply = !!ctx?.message?.replyTo?.senderId;

    if (!args.length && !hasMention && !hasReply) {
      const prefix = String(ctx.PREFIX || "/");
      if (typeof ctx.replyBot === "function") {
        await ctx.replyBot(
          `⚠️ Dùng đúng:\n${prefix}add <@tag/reply/uid>\nhoặc ${prefix}add admin <@tag/reply/uid>`,
        );
      }
      return;
    }

    const suffix = (isAdminKeyword ? args.slice(1) : args).join(" ").trim();
    const contentArgs = suffix ? `add ${suffix}` : "add";
    return await qtvCommand.execute({
      ...ctx,
      contentArgs,
    });
  },
};
