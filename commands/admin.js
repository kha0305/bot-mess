import {
  getBotRoles,
  addBotRole,
  removeBotRole,
  isSuperAdmin,
  ensureBootstrapSuperAdmin,
} from "../config.js";

function normalizeRole(rawRole) {
  const key = String(rawRole || "").trim().toLowerCase();
  if (["super", "superadmin", "sa", "sadmin"].includes(key)) return "superADMIN";
  if (["admin", "ad"].includes(key)) return "ADMIN";
  if (["ndh", "mod", "operator"].includes(key)) return "NDH";
  return "";
}

function roleLabel(role) {
  if (role === "superADMIN") return "SuperAdmin";
  if (role === "ADMIN") return "Admin";
  if (role === "NDH") return "NDH";
  return "Unknown";
}

function parseTargetId(message, args = [], startAt = 0) {
  if (Array.isArray(message.mentions) && message.mentions.length > 0) {
    const uid = String(
      message.mentions[0]?.userId ||
      message.mentions[0]?.id ||
      "",
    ).trim();
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

async function resolveName(client, userId) {
  try {
    const info = await client.getUserInfo(BigInt(userId));
    if (info?.name) return `${info.name} (${userId})`;
  } catch (e) { }
  return `UID ${userId}`;
}

async function formatRoleList(client, title, ids = []) {
  if (!ids.length) return `${title}: (rong)`;
  const lines = [];
  for (let i = 0; i < ids.length; i += 1) {
    const uid = String(ids[i]);
    lines.push(`${i + 1}. ${await resolveName(client, uid)}`);
  }
  return `${title}:\n${lines.join("\n")}`;
}

export default {
  name: "admin",
  aliases: ["role", "botadmin"],
  description: "Quan ly role global (super/admin/ndh)",
  usages: "list | add|them [super|admin|ndh] <@tag/reply/id> | del|xoa [super|admin|ndh] <@tag/reply/id>",
  hasPermssion: 4,
  cooldowns: 0,

  execute: async ({ client, message, contentArgs, PREFIX, replyBot }) => {
    const senderId = String(message.senderId);
    const bootstrapped = ensureBootstrapSuperAdmin(senderId);

    if (!isSuperAdmin(senderId)) {
      return await replyBot("❌ Chỉ SuperAdmin mới dùng được lệnh này.");
    }

    const args = String(contentArgs || "").trim().split(/\s+/).filter(Boolean);
    const sub = String(args[0] || "list").toLowerCase();

    if (sub === "list") {
      const roles = getBotRoles();
      const blocks = await Promise.all([
        formatRoleList(client, "👑 SuperAdmin", roles.superADMIN),
        formatRoleList(client, "⚙️ Admin", roles.ADMIN),
        formatRoleList(client, "🛡️ NDH", roles.NDH),
      ]);
      const bootNote = bootstrapped
        ? "ℹ️ He thong vua khoi tao SuperAdmin dau tien.\n\n"
        : "";
      return await replyBot(`${bootNote}${blocks.join("\n\n")}`);
    }

    const isAdd = ["add", "them", "thêm", "+"].includes(sub);
    const isDel = ["del", "remove", "xoa", "xóa", "xoá", "-"].includes(sub);

    if (!isAdd && !isDel) {
      return await replyBot(
        `⚠️ Cú pháp:\n` +
        `${PREFIX}admin list\n` +
        `${PREFIX}admin them [super|admin|ndh] <@tag/reply/uid>\n` +
        `${PREFIX}admin xoa [super|admin|ndh] <@tag/reply/uid>\n` +
        `* Nếu bỏ trống role thì mặc định là ADMIN`,
      );
    }

    let role = normalizeRole(args[1]);
    let targetArgStart = 2;

    if (!role) {
      role = "ADMIN";
      targetArgStart = 1;
    }

    const targetId = parseTargetId(message, args, targetArgStart);
    if (!targetId) {
      return await replyBot("⚠️ Không tìm thấy UID mục tiêu. Hãy tag/reply hoặc nhập UID.");
    }

    const rolesBefore = getBotRoles();
    if (
      isDel &&
      role === "superADMIN" &&
      rolesBefore.superADMIN.includes(targetId) &&
      rolesBefore.superADMIN.length <= 1
    ) {
      return await replyBot("⚠️ Không thể xóa SuperAdmin cuối cùng.");
    }

    const result =
      isAdd
        ? addBotRole(role, targetId)
        : removeBotRole(role, targetId);

    const targetName = await resolveName(client, targetId);
    const action = isAdd ? "them" : "xoa";

    if (!result.changed) {
      return await replyBot(
        `ℹ️ Không có thay đổi (${action} ${roleLabel(role)} cho ${targetName}).`,
      );
    }

    return await replyBot(
      `✅ Đã ${action} ${roleLabel(role)} cho ${targetName}.`,
    );
  },
};
