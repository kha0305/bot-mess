import { getThread, updateThread } from "../db.js";
import { banUser, getBannedReason, listBannedUsers } from "../utils/banStore.js";
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
  name: "ban",
  aliases: ["block", "cam"],
  description: "Cam user/thread/command/category va kiem tra trang thai",
  usages: "check [all|cmd|cate|thread|user] | cmd <ten> | category <ten> | thread [id] | user <@tag/reply/id> [ly_do]",
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
        `${PREFIX}ban check [all|cmd|cate|thread|user]\n` +
        `${PREFIX}ban cmd <ten_lenh>\n` +
        `${PREFIX}ban category <ten_category>\n` +
        `${PREFIX}ban thread [thread_id]\n` +
        `${PREFIX}ban user <@tag/reply/uid> [ly_do]`,
      );
    }

    const sub = String(args[0] || "").toLowerCase();
    const bannedCfg = normalizeThreadBanConfig(currentThread);

    if (sub === "check") {
      if (!canThreadModerate) {
        return await replyBot("❌ Bạn không có quyền xem trạng thái ban.");
      }
      const mode = String(args[1] || "all").toLowerCase();
      if (mode === "cmd") {
        return await replyBot(
          bannedCfg.commands.length
            ? `📛 Lệnh bị cấm: ${bannedCfg.commands.join(", ")}`
            : "✅ Nhóm này chưa cấm lệnh nào.",
        );
      }
      if (["cate", "category", "categories"].includes(mode)) {
        return await replyBot(
          bannedCfg.categories.length
            ? `📂 Category bị cấm: ${bannedCfg.categories.join(", ")}`
            : "✅ Nhóm này chưa cấm category nào.",
        );
      }
      if (mode === "thread") {
        return await replyBot(
          currentThread.bannedThread
            ? `🚫 Thread ${threadId} đang bị cấm.`
            : `✅ Thread ${threadId} đang hoạt động bình thường.`,
        );
      }
      if (mode === "user") {
        const targetId = parseTargetUserId(message, args, 2);
        if (targetId) {
          const reason = getBannedReason(targetId);
          if (reason) return await replyBot(`🚫 UID ${targetId} đang bị cấm: ${reason}`);
          return await replyBot(`✅ UID ${targetId} không bị cấm.`);
        }
        const users = listBannedUsers().slice(0, 20);
        if (!users.length) return await replyBot("✅ Hiện không có user nào bị cấm.");
        return await replyBot(
          `🚫 Danh sách user bị cấm (${users.length}):\n` +
          users.map((item, idx) => `${idx + 1}. ${item.userId} | ${item.reason}`).join("\n"),
        );
      }

      return await replyBot(
        `🛡️ Trạng thái ban:\n` +
        `• Thread: ${currentThread.bannedThread ? "ĐANG BỊ CẤM" : "Hoạt động"}\n` +
        `• Commands: ${bannedCfg.commands.length ? bannedCfg.commands.join(", ") : "(rong)"}\n` +
        `• Categories: ${bannedCfg.categories.length ? bannedCfg.categories.join(", ") : "(rong)"}`,
      );
    }

    if (sub === "cmd" || sub === "command") {
      if (!canThreadModerate) return await replyBot("❌ Chỉ QTV bot/role quản trị mới cấm được lệnh.");
      const rawName = String(args[1] || "").toLowerCase();
      if (!rawName) return await replyBot(`⚠️ Dùng: ${PREFIX}ban cmd <ten_lenh>`);
      const commandName = resolveCommandName(rawName);
      if (bannedCfg.commands.includes(commandName)) {
        return await replyBot(`ℹ️ Lệnh ${commandName} đã bị cấm trước đó.`);
      }
      bannedCfg.commands.push(commandName);
      await updateThread(threadId, { banned: bannedCfg });
      return await replyBot(`✅ Đã cấm lệnh ${commandName} trong nhóm này.`);
    }

    if (["category", "cate", "categories"].includes(sub)) {
      if (!canGlobalModerate) return await replyBot("❌ Chỉ NDH/Admin/Super mới cấm category.");
      const rawCategory = String(args.slice(1).join(" ") || "").trim();
      const categoryKey = normalizeCategoryKey(rawCategory);
      if (!categoryKey) {
        return await replyBot(
          `⚠️ Category không hợp lệ.\nCác category hỗ trợ: ${listCategoryKeys().join(", ")}`,
        );
      }
      if (bannedCfg.categories.includes(categoryKey)) {
        return await replyBot(`ℹ️ Category ${getCategoryLabel(categoryKey)} đã bị cấm.`);
      }
      bannedCfg.categories.push(categoryKey);
      await updateThread(threadId, { banned: bannedCfg });
      return await replyBot(`✅ Đã cấm category ${getCategoryLabel(categoryKey)}.`);
    }

    if (sub === "thread") {
      if (!canGlobalModerate) return await replyBot("❌ Chỉ NDH/Admin/Super mới cấm thread.");
      const targetThreadId = String(args[1] || threadId).trim();
      const tData = await getThread(targetThreadId);
      await updateThread(targetThreadId, {
        ...tData,
        bannedThread: true,
      });
      return await replyBot(`✅ Đã cấm thread ${targetThreadId}.`);
    }

    if (sub === "user") {
      if (!canGlobalModerate) return await replyBot("❌ Chỉ NDH/Admin/Super mới cấm user.");
      const targetId = parseTargetUserId(message, args, 1);
      if (!targetId) {
        return await replyBot(`⚠️ Dùng: ${PREFIX}ban user <@tag/reply/uid> [ly_do]`);
      }
      if (isSuperAdmin(targetId) || isAdmin(targetId) || isNdh(targetId)) {
        return await replyBot("❌ Không thể cấm tài khoản thuộc role quản trị bot.");
      }

      let reason = String(args.slice(2).join(" ") || "").trim();
      if (!reason) reason = "Vi pham quy dinh su dung bot";
      banUser(targetId, reason, senderId);
      return await replyBot(`✅ Đã cấm UID ${targetId}. Lý do: ${reason}`);
    }

    return await replyBot("⚠️ Tham số không hợp lệ. Dùng `ban check` để xem trạng thái.");
  },
};
