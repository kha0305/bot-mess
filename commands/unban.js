import { getThread, updateThread } from "../db.js";
import { unbanUser, listBannedUsers } from "../utils/banStore.js";
import {
  normalizeCategoryKey,
  getCategoryLabel,
  listCategoryKeys,
} from "../utils/commandMeta.js";
import { isAdmin, isNdh, isSuperAdmin } from "../config.js";

function uniqLower(items = []) {
  return [...new Set(items.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
}

function normalizeThreadBanConfig(threadData = {}) {
  const banned = (threadData && typeof threadData.banned === "object" && threadData.banned) || {};
  return {
    commands: uniqLower(banned.commands || []),
    categories: uniqLower(banned.categories || []),
  };
}

function parseTargetUserId(message, args = [], startAt = 0) {
  if (Array.isArray(message.mentions) && message.mentions.length > 0) {
    const uid = String(message.mentions[0]?.userId || message.mentions[0]?.id || "").trim();
    if (uid) return uid;
  }
  if (message.replyTo?.senderId) {
    return String(message.replyTo.senderId).trim();
  }
  for (let i = startAt; i < args.length; i += 1) {
    const token = String(args[i] || "").trim();
    if (/^\d+$/.test(token)) return token;
  }
  return "";
}

function resolveRoleState(senderId, threadData = {}, runtimeRoles = null) {
  if (runtimeRoles) return runtimeRoles;
  const sid = String(senderId);
  const adminIDs = Array.isArray(threadData.adminIDs) ? threadData.adminIDs.map(String) : [];
  return {
    isSuper: isSuperAdmin(sid),
    isAdmin: isAdmin(sid),
    isNdh: isNdh(sid),
    isThreadAdmin: adminIDs.includes(sid),
  };
}

function resolveCommandName(rawName) {
  const name = String(rawName || "").trim().toLowerCase();
  if (!name) return "";
  const cmd = global.client?.commands?.get(name);
  if (cmd?.name) return String(cmd.name).toLowerCase();
  return name;
}

export default {
  name: "unban",
  aliases: ["unlock", "mocam"],
  description: "Go cam user/thread/command/category",
  usages: "cmd <ten|all> | category <ten|all> | thread [id|all] | user <@tag/reply/uid|all>",
  hasPermssion: 1,
  cooldowns: 2,

  execute: async ({ message, contentArgs, replyBot, threadData, roles, PREFIX }) => {
    const threadId = String(message.threadId);
    const senderId = String(message.senderId);
    const currentThread = threadData || (await getThread(threadId));
    const roleState = resolveRoleState(senderId, currentThread, roles);
    const canThreadModerate =
      roleState.isThreadAdmin || roleState.isNdh || roleState.isAdmin || roleState.isSuper;
    const canGlobalModerate = roleState.isNdh || roleState.isAdmin || roleState.isSuper;

    const args = String(contentArgs || "").trim().split(/\s+/).filter(Boolean);
    if (args.length === 0) {
      return await replyBot(
        `⚠️ Cú pháp:\n` +
        `${PREFIX}unban cmd <ten|all>\n` +
        `${PREFIX}unban category <ten|all>\n` +
        `${PREFIX}unban thread [thread_id]\n` +
        `${PREFIX}unban user <@tag/reply/uid|all>`,
      );
    }

    const sub = String(args[0] || "").toLowerCase();
    const bannedCfg = normalizeThreadBanConfig(currentThread);

    if (sub === "cmd" || sub === "command") {
      if (!canThreadModerate) return await replyBot("❌ Chỉ QTV bot/role quản trị mới gỡ cấm lệnh.");
      const rawName = String(args[1] || "").toLowerCase();
      if (!rawName) return await replyBot(`⚠️ Dùng: ${PREFIX}unban cmd <ten|all>`);
      if (rawName === "all") {
        if (bannedCfg.commands.length === 0) return await replyBot("ℹ️ Không có lệnh nào đang bị cấm.");
        bannedCfg.commands = [];
        await updateThread(threadId, { banned: bannedCfg });
        return await replyBot("✅ Đã gỡ cấm toàn bộ lệnh trong nhóm.");
      }
      const commandName = resolveCommandName(rawName);
      if (!bannedCfg.commands.includes(commandName)) {
        return await replyBot(`ℹ️ Lệnh ${commandName} không nằm trong danh sách cấm.`);
      }
      bannedCfg.commands = bannedCfg.commands.filter((item) => item !== commandName);
      await updateThread(threadId, { banned: bannedCfg });
      return await replyBot(`✅ Đã gỡ cấm lệnh ${commandName}.`);
    }

    if (["category", "cate", "categories"].includes(sub)) {
      if (!canGlobalModerate) return await replyBot("❌ Chỉ NDH/Admin/Super mới gỡ cấm category.");
      const rawCategory = String(args.slice(1).join(" ") || "").trim();
      if (!rawCategory) return await replyBot(`⚠️ Dùng: ${PREFIX}unban category <ten|all>`);
      if (rawCategory.toLowerCase() === "all") {
        if (bannedCfg.categories.length === 0) return await replyBot("ℹ️ Không có category nào đang bị cấm.");
        bannedCfg.categories = [];
        await updateThread(threadId, { banned: bannedCfg });
        return await replyBot("✅ Đã gỡ cấm toàn bộ category trong nhóm.");
      }
      const categoryKey = normalizeCategoryKey(rawCategory);
      if (!categoryKey) {
        return await replyBot(
          `⚠️ Category không hợp lệ.\nCác category hỗ trợ: ${listCategoryKeys().join(", ")}`,
        );
      }
      if (!bannedCfg.categories.includes(categoryKey)) {
        return await replyBot(`ℹ️ Category ${getCategoryLabel(categoryKey)} không bị cấm.`);
      }
      bannedCfg.categories = bannedCfg.categories.filter((item) => item !== categoryKey);
      await updateThread(threadId, { banned: bannedCfg });
      return await replyBot(`✅ Đã gỡ cấm category ${getCategoryLabel(categoryKey)}.`);
    }

    if (sub === "thread") {
      if (!canGlobalModerate) return await replyBot("❌ Chỉ NDH/Admin/Super mới gỡ cấm thread.");
      const targetThreadId = String(args[1] || threadId).trim();
      const tData = await getThread(targetThreadId);
      if (!tData.bannedThread) {
        return await replyBot(`ℹ️ Thread ${targetThreadId} không bị cấm.`);
      }
      await updateThread(targetThreadId, {
        ...tData,
        bannedThread: false,
      });
      return await replyBot(`✅ Đã gỡ cấm thread ${targetThreadId}.`);
    }

    if (sub === "user") {
      if (!canGlobalModerate) return await replyBot("❌ Chỉ NDH/Admin/Super mới gỡ cấm user.");
      const target = String(args[1] || "").toLowerCase();
      if (target === "all") {
        const list = listBannedUsers();
        if (!list.length) return await replyBot("ℹ️ Không có user nào bị cấm.");
        let changed = 0;
        for (const item of list) {
          if (unbanUser(item.userId).changed) changed += 1;
        }
        return await replyBot(`✅ Đã gỡ cấm ${changed} user.`);
      }

      const targetId = parseTargetUserId(message, args, 1);
      if (!targetId) {
        return await replyBot(`⚠️ Dùng: ${PREFIX}unban user <@tag/reply/uid|all>`);
      }
      const res = unbanUser(targetId);
      if (!res.changed) return await replyBot(`ℹ️ UID ${targetId} không nằm trong danh sách cấm.`);
      return await replyBot(`✅ Đã gỡ cấm UID ${targetId}.`);
    }

    return await replyBot("⚠️ Tham số không hợp lệ.");
  },
};
