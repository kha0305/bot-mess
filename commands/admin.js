import fs from "fs";
import { getThread, updateThread } from "../db.js";
import {
  getBotRoles,
  addBotRole,
  removeBotRole,
  isSuperAdmin,
  ensureBootstrapSuperAdmin,
} from "../config.js";
import { THUE_BOT_PATH } from "../utils/dataPaths.js";

function normalizeId(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

function normalizeIdList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((item) => normalizeId(item?.id ?? item?.userId ?? item)).filter(Boolean))];
}

function normalizeRole(rawRole) {
  const key = String(rawRole || "").trim().toLowerCase();
  if (["super", "superadmin", "sa", "sadmin"].includes(key)) return "superADMIN";
  if (["admin", "ad"].includes(key)) return "ADMIN";
  if (["ndh", "mod", "operator", "hotro", "hỗtrợ"].includes(key)) return "NDH";
  return "";
}

function roleLabel(role) {
  if (role === "superADMIN") return "SuperAdmin";
  if (role === "ADMIN") return "Admin Bot";
  if (role === "NDH") return "Người Hỗ Trợ";
  return "Unknown";
}

function parseTargetIds(message, args = [], startAt = 1) {
  if (Array.isArray(message?.mentions) && message.mentions.length > 0) {
    return normalizeIdList(message.mentions);
  }

  if (message?.mentions && typeof message.mentions === "object") {
    const mentionIds = normalizeIdList(Object.keys(message.mentions));
    if (mentionIds.length > 0) return mentionIds;
  }

  if (message?.replyTo?.senderId) {
    return [normalizeId(message.replyTo.senderId)];
  }

  const output = [];
  for (let i = startAt; i < args.length; i += 1) {
    const token = normalizeId(args[i]);
    if (/^\d+$/.test(token)) output.push(token);
  }
  return normalizeIdList(output);
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

function ensureHandleReplyStore() {
  if (!global.client) global.client = {};
  if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
  return global.client.handleReply;
}

function clearHandleReply(messageID) {
  const target = normalizeId(messageID);
  if (!target || !Array.isArray(global.client?.handleReply)) return;
  global.client.handleReply = global.client.handleReply.filter(
    (item) => normalizeId(item?.messageID || item?.messageId || item?.id) !== target,
  );
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

async function resolveName(client, userId) {
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

function parseDateToTs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const raw = value.trim();
  if (!raw) return 0;

  // dd/mm/yyyy
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    return new Date(yyyy, mm - 1, dd, 23, 59, 59).getTime();
  }

  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function formatRemain(endAtValue) {
  const endTs = parseDateToTs(endAtValue);
  if (!endTs) return "Không rõ";
  const diff = endTs - Date.now();
  if (diff <= 0) return "Đã hết hạn";
  const d = Math.floor(diff / (24 * 60 * 60 * 1000));
  const h = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return `${d} ngày ${h} giờ`;
}

function loadRentRows() {
  try {
    if (!fs.existsSync(THUE_BOT_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(THUE_BOT_PATH, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function buildRentSummary(client) {
  const rows = loadRentRows();
  if (!rows.length) return "(Chưa có dữ liệu thuê bot)";

  const map = new Map();
  for (const row of rows) {
    const uid = normalizeId(row?.id || row?.uid || row?.userId || row?.senderId);
    const tid = normalizeId(row?.t_id || row?.threadID || row?.threadId);
    const startAt = row?.time_start || row?.startDate || row?.createdAt || "";
    const endAt = row?.time_end || row?.expireDate || row?.endDate || "";

    const key = uid || `thread:${tid || "unknown"}`;
    const current = map.get(key) || {
      uid,
      threadIds: [],
      startAt,
      endAt,
    };

    if (tid) current.threadIds.push(tid);

    const currentEnd = parseDateToTs(current.endAt);
    const nextEnd = parseDateToTs(endAt);
    if (nextEnd > currentEnd) {
      current.endAt = endAt;
    }

    if (!current.startAt && startAt) current.startAt = startAt;
    map.set(key, current);
  }

  const lines = [];
  let idx = 1;
  for (const info of map.values()) {
    const uniqueThreadCount = [...new Set(info.threadIds)].length;
    const title = info.uid ? await resolveName(client, info.uid) : "(Không rõ UID người thuê)";
    lines.push(
      `${idx++}. ${title}\n` +
      `→ UID: ${info.uid || "N/A"}\n` +
      `→ Thuê từ: ${info.startAt || "N/A"}\n` +
      `→ Hết hạn: ${info.endAt || "N/A"}\n` +
      `→ Còn lại: ${formatRemain(info.endAt)}\n` +
      `→ Số nhóm thuê: ${uniqueThreadCount}`,
    );
  }
  return lines.join("\n\n");
}

function permissionLabelForSub(sub) {
  if (["add", "remove", "addndh", "removendh"].includes(sub)) return "SuperAdmin";
  if (["only"].includes(sub)) return "NDH/Admin/Super";
  if (["ibrieng"].includes(sub)) return "Admin/Super";
  if (["list"].includes(sub)) return "NDH/Admin/Super";
  if (["qtvonly"].includes(sub)) return "QTV Bot nhóm hoặc NDH/Admin/Super";
  return "Unknown";
}

export default {
  name: "admin",
  aliases: ["role", "botadmin"],
  description: "Quản lý role global + cấu hình chế độ quản trị theo nhóm",
  usages:
    "list | add/remove [super|admin|ndh] <@tag/reply/id> | addndh/removendh <@tag/reply/id> | qtvonly | only | ibrieng",
  hasPermssion: 0,
  cooldowns: 2,

  handleReply: async ({ client, message, handleReply, replyBot }) => {
    if (!handleReply) return;
    const senderId = normalizeId(message?.senderId);
    if (!senderId || senderId !== normalizeId(handleReply.author)) return;

    const rawText = normalizeId(message?.text);
    const index = Number.parseInt(rawText, 10);
    if (!Number.isFinite(index) || index <= 0) {
      await replyBot("❎ Số thứ tự không hợp lệ!");
      return;
    }

    const adminIds = normalizeIdList(handleReply.adminIds || []);
    const ndhIds = normalizeIdList(handleReply.ndhIds || []);
    const total = adminIds.length + ndhIds.length;
    if (index > total) {
      await replyBot("❎ Số thứ tự không hợp lệ!");
      return;
    }

    let role = "ADMIN";
    let targetId = "";
    if (index <= adminIds.length) {
      targetId = adminIds[index - 1];
      role = "ADMIN";
    } else {
      targetId = ndhIds[index - adminIds.length - 1];
      role = "NDH";
    }

    if (!targetId) {
      await replyBot("❎ Không xác định được người dùng cần gỡ.");
      return;
    }

    const removed = removeBotRole(role, targetId);
    clearHandleReply(handleReply.messageID);
    if (!removed.changed) {
      await replyBot(`ℹ️ Không có thay đổi khi gỡ ${roleLabel(role)}.`);
      return;
    }

    const name = await resolveName(client, targetId);
    await replyBot(`✅ Đã gỡ ${roleLabel(role)}:\n${targetId} - ${name}`);
  },

  execute: async ({ client, message, contentArgs, PREFIX, replyBot, roles }) => {
    const senderId = normalizeId(message?.senderId);
    const threadId = normalizeId(message?.threadId);
    ensureBootstrapSuperAdmin(senderId);

    const args = String(contentArgs || "").trim().split(/\s+/).filter(Boolean);
    const sub = String(args[0] || "").toLowerCase();

    if (!sub) {
      await replyBot(
        `=== [ ADMIN SETTING ] ===\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `→ ${PREFIX}admin list: Xem danh sách quản lý\n` +
        `→ ${PREFIX}admin add [super|admin|ndh]: Thêm quản trị viên\n` +
        `→ ${PREFIX}admin remove [super|admin|ndh]: Gỡ quản trị viên\n` +
        `→ ${PREFIX}admin addndh: Thêm người hỗ trợ\n` +
        `→ ${PREFIX}admin removendh: Gỡ người hỗ trợ\n` +
        `→ ${PREFIX}admin qtvonly: Bật/tắt chế độ QTV\n` +
        `→ ${PREFIX}admin only: Bật/tắt chế độ Admin Only\n` +
        `→ ${PREFIX}admin ibrieng: Bật/tắt chế độ chat riêng\n\n` +
        `━━━━━━━━━━━━━━━━━━`,
      );
      return;
    }

    const isSuper = !!roles?.isSuper || isSuperAdmin(senderId);
    const isAdmin = !!roles?.isAdmin || isSuper;
    const isNdh = !!roles?.isNdh || isAdmin;
    const threadData = threadId ? await getThread(threadId) : {};
    const qtvIds = normalizeIdList(threadData?.adminIDs || []);

    const deny = async () => {
      await replyBot(
        `❌ Bạn không đủ quyền dùng "${sub}". Yêu cầu: ${permissionLabelForSub(sub)}.`,
      );
    };

    if (sub === "list") {
      if (!isNdh) return await deny();

      const currentRoles = getBotRoles();
      const superIds = normalizeIdList(currentRoles.superADMIN || []);
      const adminIds = normalizeIdList(currentRoles.ADMIN || []);
      const ndhIds = normalizeIdList(currentRoles.NDH || []);

      const superLines = await Promise.all(
        superIds.map(async (id, i) => `${i + 1}. ${await resolveName(client, id)}\n→ ID: ${id}`),
      );
      const adminLines = await Promise.all(
        adminIds.map(async (id, i) => `${i + 1}. ${await resolveName(client, id)}\n→ ID: ${id}`),
      );
      const ndhLines = await Promise.all(
        ndhIds.map(
          async (id, i) =>
            `${i + 1 + adminIds.length}. ${await resolveName(client, id)}\n→ ID: ${id}`,
        ),
      );

      const rentSummary = await buildRentSummary(client);
      const text =
        `=== [ DANH SÁCH ADMIN & NGƯỜI HỖ TRỢ ] ===\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `=== [ SUPER ADMIN ] ===\n` +
        `${superLines.length ? superLines.join("\n\n") : "(Trống)"}\n\n` +
        `=== [ ADMIN BOT ] ===\n` +
        `${adminLines.length ? adminLines.join("\n\n") : "(Trống)"}\n\n` +
        `=== [ NGƯỜI HỖ TRỢ ] ===\n` +
        `${ndhLines.length ? ndhLines.join("\n\n") : "(Trống)"}\n\n` +
        `=== [ ADMIN THUÊ BOT ] ===\n` +
        `${rentSummary}\n\n` +
        `Reply số thứ tự để xóa ở 2 mục ADMIN BOT/NGƯỜI HỖ TRỢ.`;

      const sent = await replyBot(text);
      const sentMessageId = getSentMessageId(sent);
      if (sentMessageId) {
        ensureHandleReplyStore().push({
          name: "admin",
          messageID: sentMessageId,
          author: senderId,
          adminIds,
          ndhIds,
        });
      }
      return;
    }

    if (sub === "qtvonly") {
      if (qtvIds.length > 0 && !qtvIds.includes(senderId) && !isNdh) return await deny();

      const isQtvOnly = !!threadData.qtvOnly;
      const updateData = { qtvOnly: !isQtvOnly };
      if (qtvIds.length === 0) {
        updateData.adminIDs = [senderId];
      }
      await updateThread(threadId, updateData);
      await replyBot(
        `[ ADMIN ] → ${!isQtvOnly ? "Bật chế độ QTV Only thành công" : "Tắt chế độ QTV Only thành công"}`,
      );
      return;
    }

    if (sub === "only" || sub === "adminonly") {
      if (!isNdh) return await deny();
      const next = !threadData.adminOnly;
      await updateThread(threadId, { adminOnly: next });
      await replyBot(
        `[ ADMIN ] → ${next ? "Bật chế độ Admin Only thành công" : "Tắt chế độ Admin Only thành công"}`,
      );
      return;
    }

    if (sub === "ibrieng" || sub === "privatechat") {
      if (!isAdmin) return await deny();
      const next = !threadData.privateChat;
      await updateThread(threadId, { privateChat: next });
      await replyBot(
        `[ ADMIN ] → ${next ? "Bật chế độ chat riêng thành công" : "Tắt chế độ chat riêng thành công"}`,
      );
      return;
    }

    if (!isSuper) return await deny();

    const doBatchAdd = async (role, targetIds) => {
      const added = [];
      for (const uid of targetIds) {
        const result = addBotRole(role, uid);
        if (result.changed) {
          const name = await resolveName(client, uid);
          added.push(`${uid} - ${name}`);
        }
      }
      return added;
    };

    const doBatchRemove = async (role, targetIds) => {
      const removed = [];
      for (const uid of targetIds) {
        if (role === "superADMIN") {
          const before = getBotRoles();
          if (before.superADMIN.includes(uid) && before.superADMIN.length <= 1) continue;
        }
        const result = removeBotRole(role, uid);
        if (result.changed) {
          const name = await resolveName(client, uid);
          removed.push(`${uid} - ${name}`);
        }
      }
      return removed;
    };

    if (sub === "add" || sub === "them" || sub === "thêm") {
      let role = normalizeRole(args[1]);
      let startAt = 2;
      if (!role) {
        role = "ADMIN";
        startAt = 1;
      }

      const targetIds = parseTargetIds(message, args, startAt);
      if (targetIds.length === 0) {
        await replyBot("⚠️ Không tìm thấy UID mục tiêu. Hãy tag/reply hoặc nhập UID.");
        return;
      }

      const added = await doBatchAdd(role, targetIds);
      if (!added.length) {
        await replyBot(`ℹ️ Không có thay đổi khi thêm ${roleLabel(role)}.`);
        return;
      }
      await replyBot(
        `[ ADMIN ] → Đã thêm ${added.length} người dùng trở thành ${roleLabel(role)}:\n\n${added.join("\n")}`,
      );
      return;
    }

    if (sub === "addndh") {
      const targetIds = parseTargetIds(message, args, 1);
      if (targetIds.length === 0) {
        await replyBot("⚠️ Không tìm thấy UID mục tiêu. Hãy tag/reply hoặc nhập UID.");
        return;
      }
      const added = await doBatchAdd("NDH", targetIds);
      if (!added.length) {
        await replyBot("ℹ️ Không có thay đổi khi thêm Người Hỗ Trợ.");
        return;
      }
      await replyBot(
        `[ ADMIN ] → Đã thêm ${added.length} người dùng trở thành NGƯỜI HỖ TRỢ:\n\n${added.join("\n")}`,
      );
      return;
    }

    if (["remove", "del", "xoa", "xóa", "xoá"].includes(sub)) {
      let role = normalizeRole(args[1]);
      let startAt = 2;
      if (!role) {
        role = "ADMIN";
        startAt = 1;
      }

      const targetIds = parseTargetIds(message, args, startAt);
      if (targetIds.length === 0) {
        await replyBot("⚠️ Không tìm thấy UID mục tiêu. Hãy tag/reply hoặc nhập UID.");
        return;
      }

      const removed = await doBatchRemove(role, targetIds);
      if (!removed.length) {
        await replyBot(`ℹ️ Không có thay đổi khi gỡ ${roleLabel(role)}.`);
        return;
      }
      await replyBot(
        `[ ADMIN ] → Đã gỡ vai trò ${roleLabel(role)} của ${removed.length} người dùng:\n\n${removed.join("\n")}`,
      );
      return;
    }

    if (sub === "removendh") {
      const targetIds = parseTargetIds(message, args, 1);
      if (targetIds.length === 0) {
        await replyBot("⚠️ Không tìm thấy UID mục tiêu. Hãy tag/reply hoặc nhập UID.");
        return;
      }
      const removed = await doBatchRemove("NDH", targetIds);
      if (!removed.length) {
        await replyBot("ℹ️ Không có thay đổi khi gỡ Người Hỗ Trợ.");
        return;
      }
      await replyBot(
        `[ ADMIN ] → Đã gỡ vai trò NGƯỜI HỖ TRỢ của ${removed.length} người dùng:\n\n${removed.join("\n")}`,
      );
      return;
    }

    await replyBot("[ ADMIN ] → Lệnh không hợp lệ! Gõ '/admin' để xem hướng dẫn.");
  },
};
