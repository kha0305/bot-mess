import { getThread, updateThread } from "../db.js";

function normalizeId(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

function normalizeIdList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((item) => normalizeId(item?.id ?? item?.userId ?? item)).filter(Boolean))];
}

function getSentMessageId(result) {
  if (!result || typeof result !== "object") return "";
  return normalizeId(
    result.messageID ||
      result.messageId ||
      result.id ||
      result.key?.id ||
      result[0]?.id ||
      "",
  );
}

function ensureHandleReactionStore() {
  if (!global.client) global.client = {};
  if (!Array.isArray(global.client.handleReaction)) global.client.handleReaction = [];
  return global.client.handleReaction;
}

function clearHandleReaction(messageID) {
  const target = normalizeId(messageID);
  if (!target || !Array.isArray(global.client?.handleReaction)) return;
  global.client.handleReaction = global.client.handleReaction.filter(
    (item) => normalizeId(item?.messageID || item?.messageId || item?.id) !== target,
  );
}

function getMentionedIds(message) {
  if (Array.isArray(message?.mentions) && message.mentions.length > 0) {
    return normalizeIdList(message.mentions);
  }

  if (message?.mentions && typeof message.mentions === "object") {
    return normalizeIdList(Object.keys(message.mentions));
  }

  return [];
}

function toBigIntIfPossible(value) {
  const raw = normalizeId(value);
  if (!/^\d+$/.test(raw)) return value;
  try {
    return BigInt(raw);
  } catch {
    return value;
  }
}

async function resolveParticipantIds(client, threadId) {
  if (!client || typeof client.getThreadInfo !== "function") return [];

  try {
    const info = await client.getThreadInfo(toBigIntIfPossible(threadId));
    const candidates = [
      info?.participantIDs,
      info?.participantIds,
      info?.participants,
      info?.memberIds,
      info?.members,
      info?.userIds,
    ];

    const all = [];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        all.push(...candidate);
      }
    }
    return normalizeIdList(all);
  } catch {
    return [];
  }
}

async function resolveUserName(client, userId) {
  const uid = normalizeId(userId);
  if (!uid) return "Unknown";
  try {
    const info = await client.getUserInfo(toBigIntIfPossible(uid));
    const name = String(info?.name || "").trim();
    return name || uid;
  } catch {
    return uid;
  }
}

export default {
  name: "qtv",
  aliases: ["adminbox", "quanly"],
  description: "Thêm hoặc xoá QTV bot của nhóm (xác nhận bằng reaction)",
  usages: "add|del [@tag/reply/id/all] | list",
  hasPermssion: 1,
  cooldowns: 5,

  execute: async ({ client, message, contentArgs, PREFIX, replyBot, roles }) => {
    const threadId = normalizeId(message?.threadId);
    const senderId = normalizeId(message?.senderId);
    const botId = normalizeId(client?.currentUserId);
    if (!threadId || !senderId) return;

    const threadData = await getThread(threadId);
    const canGlobalManage = !!(roles?.isNdh || roles?.isAdmin || roles?.isSuper);
    let adminIDs = normalizeIdList(threadData.adminIDs || []);

    if (
      adminIDs.length > 0 &&
      !adminIDs.includes(senderId) &&
      !canGlobalManage
    ) {
      await replyBot("❎ Bạn không đủ quyền dùng lệnh này.");
      return;
    }

    const args = String(contentArgs || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const subCmd = String(args[0] || "").toLowerCase();

    if (!subCmd) {
      await replyBot(
        `⚠️ Cú pháp: ${PREFIX}qtv [add|del|list] [@tag/reply/id/all]\nVí dụ: ${PREFIX}qtv add @Tên`,
      );
      return;
    }

    if (
      subCmd === "list" ||
      subCmd === "ds" ||
      (subCmd === "all" && args.length === 1)
    ) {
      if (adminIDs.length === 0) {
        await replyBot("⚠️ Nhóm này chưa có QTV bot nào.");
        return;
      }

      const lines = await Promise.all(
        adminIDs.map(async (id, index) => {
          const name = await resolveUserName(client, id);
          return `${index + 1}. ${name} (UID: ${id})`;
        }),
      );

      await replyBot(
        `📌 DANH SÁCH QTV BOT (${adminIDs.length})\n\n${lines.join("\n")}`,
      );
      return;
    }

    if (subCmd !== "add" && subCmd !== "del" && subCmd !== "remove") {
      await replyBot(
        `⚠️ Cú pháp không hợp lệ. Dùng: ${PREFIX}qtv [add|del|list] [@tag/reply/id/all]`,
      );
      return;
    }

    const mode = subCmd === "remove" ? "del" : subCmd;
    const modeArg = String(args[1] || "").toLowerCase();
    let userIDs = [];

    if (modeArg === "all" || modeArg === "@all") {
      if (mode === "add") {
        const participants = await resolveParticipantIds(client, threadId);
        userIDs = participants.filter(
          (id) => id !== botId && !adminIDs.includes(id),
        );
      } else {
        userIDs = adminIDs.filter((id) => id !== botId && id !== senderId);
      }
    } else {
      const mentionIds = getMentionedIds(message);
      if (mentionIds.length > 0) {
        userIDs = mentionIds;
      } else if (message?.replyTo?.senderId) {
        userIDs = [normalizeId(message.replyTo.senderId)];
      } else if (args[1]) {
        userIDs = [normalizeId(args[1])];
      } else if (mode === "add") {
        userIDs = [senderId];
      }
    }

    userIDs = normalizeIdList(userIDs).filter((id) => id && id !== botId);

    if (userIDs.length === 0) {
      if (modeArg === "all") {
        await replyBot(
          mode === "add"
            ? "❎ Không tìm thấy người dùng hợp lệ nào để thêm QTV."
            : "❎ Không tìm thấy QTV hợp lệ nào để gỡ.",
        );
      } else {
        await replyBot(
          `⚠️ Không có người dùng mục tiêu. Dùng: ${PREFIX}qtv ${mode} [@tag/reply/id/all]`,
        );
      }
      return;
    }

    const action = mode === "add" ? "thêm" : "gỡ";
    const sent = await replyBot(
      `📌 Thả cảm xúc vào tin nhắn này để xác nhận ${action} ${userIDs.length} QTV.`,
    );
    const sentMessageId = getSentMessageId(sent);

    if (!sentMessageId) {
      await replyBot("⚠️ Không thể tạo phiên xác nhận, vui lòng thử lại.");
      return;
    }

    ensureHandleReactionStore().push({
      name: "qtv",
      type: mode,
      messageID: sentMessageId,
      author: senderId,
      userIDs,
      threadId,
    });
  },

  handleReaction: async ({ client, event, message, handleReaction, replyBot }) => {
    if (!handleReaction) return;

    const actorId = normalizeId(
      message?.senderId ||
        event?.actorId ||
        event?.userID ||
        event?.senderId ||
        event?.senderID,
    );
    const author = normalizeId(handleReaction.author);
    if (!actorId || !author || actorId !== author) return;

    const handleMsgId = normalizeId(
      handleReaction.messageID || handleReaction.messageId || handleReaction.id,
    );
    clearHandleReaction(handleMsgId);

    const threadId = normalizeId(
      handleReaction.threadId ||
        handleReaction.threadID ||
        message?.threadId ||
        event?.threadId,
    );
    if (!threadId) return;

    const mode = normalizeId(handleReaction.type).toLowerCase();
    const targetIds = normalizeIdList(handleReaction.userIDs || []);
    if (targetIds.length === 0) {
      await replyBot("⚠️ Không có danh sách người dùng để xử lý.");
      return;
    }

    const threadData = await getThread(threadId);
    let adminIDs = normalizeIdList(threadData.adminIDs || []);

    const successIds = [];
    let skipped = 0;

    if (mode === "add") {
      for (const uid of targetIds) {
        if (adminIDs.includes(uid)) {
          skipped += 1;
          continue;
        }
        adminIDs.push(uid);
        successIds.push(uid);
      }
    } else if (mode === "del") {
      for (const uid of targetIds) {
        if (!adminIDs.includes(uid)) {
          skipped += 1;
          continue;
        }
        adminIDs = adminIDs.filter((id) => id !== uid);
        successIds.push(uid);
      }
    } else {
      await replyBot("⚠️ Phiên xác nhận không hợp lệ.");
      return;
    }

    adminIDs = normalizeIdList(adminIDs);
    await updateThread(threadId, { adminIDs });

    const topNames = await Promise.all(
      successIds.slice(0, 5).map((id) => resolveUserName(client, id)),
    );

    let msg =
      mode === "add"
        ? `✅ Đã thêm ${successIds.length} QTV thành công.`
        : `✅ Đã gỡ ${successIds.length} QTV thành công.`;

    if (topNames.length > 0) {
      msg += `\n👤 ${topNames.join(", ")}${successIds.length > 5 ? "..." : ""}`;
    }
    if (skipped > 0) {
      msg += `\n⚠️ Bỏ qua ${skipped} người (đã tồn tại/không hợp lệ).`;
    }
    msg += `\n📌 Tổng QTV hiện tại: ${adminIDs.length}`;

    await replyBot(msg);
  },
};
