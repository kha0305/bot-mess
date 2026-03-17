import { getThread, updateThread } from "../db.js";
import { banUser, unbanUser } from "../utils/banStore.js";
import { isAdmin, isNdh, isSuperAdmin } from "../config.js";

export default {
  name: "chuiadmin",
  aliases: ["autoban"],
  execute: async ({ client, message, contentArgs, PREFIX, replyBot, roles }) => {
    const threadData = await getThread(message.threadId);
    let adminIDs = threadData.adminIDs || [];
    const canGlobalManage = !!(roles?.isNdh || roles?.isAdmin || roles?.isSuper);

    // Chỉ cho phép admin hiện tại gọi lệnh (nếu đã có admin)
    if (
      adminIDs.length > 0 &&
      !adminIDs.includes(String(message.senderId)) &&
      !canGlobalManage
    ) {
      return await replyBot(
        "❌ Tính năng này chỉ dành cho Quản Trị Viên (Bot) của nhóm!",
      );
    }

    const args = contentArgs.split(/\s+/);

    if (args[0] === "unban") {
      const targetId = args[1];
      if (!targetId)
        return await replyBot(
          "⚠️ Cần nhập ID người cần unban. Ví dụ: /chuiadmin unban 123456789",
        );
      if (unbanUser(targetId).changed) {
        return await replyBot(
          `✅ Đã gỡ ban thành công cho người dùng có ID: ${targetId}`,
        );
      } else {
        return await replyBot(
          "⚠️ Người dùng này không nằm trong danh sách bị ban.",
        );
      }
    }

    let isAutoban = !!threadData.autoban;
    isAutoban = !isAutoban; // toggle

    await updateThread(message.threadId, { autoban: isAutoban });
    return await replyBot(
      `${isAutoban ? "Bật" : "Tắt"} autoban (chửi admin/bot tự chặn) nhóm này thành công!`,
    );
  },

  handleEvent: async ({ client, message, type, text }) => {
    if (!text) return;
    const threadData = await getThread(message.threadId);

    if (!threadData.autoban) return;

    const senderId = String(message.senderId);
    if (isSuperAdmin(senderId) || isAdmin(senderId) || isNdh(senderId)) return;

    // Bỏ qua nếu là chủ bot / trùng admin
    const adminIDs = threadData.adminIDs || [];
    if (adminIDs.includes(senderId)) return;

    const insults = [
      "admin lol",
      "admin lồn",
      "admin gà",
      "con admin lol",
      "admin ngu lol",
      "admin chó",
      "dm admin",
      "đm admin",
      "dmm admin",
      "đmm admin",
      "đb admin",
      "admin điên",
      "admin dở",
      "admin khùng",
      "đĩ admin",
      "admin paylac rồi",
      "con admin lòn",
      "cmm admin",
      "clap admin",
      "admin ncc",
      "admin oc",
      "admin óc",
      "admin óc chó",
      "cc admin",
      "admin tiki",
      "lozz admintt",
      "lol admin",
      "loz admin",
      "lồn admin",
      "admin lồn",
      "admin lon",
      "admin cac",
      "admin nhu lon",
      "admin như cc",
      "admin như bìu",
      "admin sida",
      "admin fake",
      "bằng ngu",
      "admin shoppee",
      "admin đểu",
      "admin dỡm",
      "bot ngu",
      "bot chó",
      "bot lồn",
      "bot đần",
      "bot dởm",
    ];

    const lowerText = text.toLowerCase();
    for (const insult of insults) {
      if (lowerText.includes(insult)) {
        // Ban user này
        banUser(senderId, insult, "autoban");

        let name = senderId;
        try {
          const info = await client.getUserInfo(BigInt(senderId));
          if (info && info.name) name = info.name;
        } catch (e) {}

        const msg = `[ AUTOBAN ]\n\n➝ ${name}, Bạn vừa chửi Admin/Bot của tôi nên đã bị cấm dùng Bot vĩnh viễn. Lý do: "${insult}". Nếu muốn được ân xá vui lòng liên hệ Admin.`;

        if (message.chatJid) {
          await client.sendE2EEMessage(message.chatJid, msg);
        } else {
          await client.sendMessage(message.threadId, msg);
        }

        // Báo cáo cho admin (nếu hệ thống có list admin cụ thể)
        // Nhưng do meta-messenger.js bot này không có Global Admin ID config sẵn rõ ràng,
        // ta chỉ thông báo thẳng lên thread là đủ răn đe.
        console.log(
          `[AUTOBAN] Đã auto-ban ${name} (${senderId}) vì: ${insult}`,
        );
        break;
      }
    }
  },
};
