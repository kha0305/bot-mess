import { getThread, updateThread } from "../db.js";

export default {
  name: "qtv",
  aliases: ["adminbox", "quanly"],
  execute: async ({ client, message, contentArgs, PREFIX, replyBot, roles }) => {
    const threadId = message.threadId;
    const threadData = await getThread(threadId);
    const canGlobalManage = !!(roles?.isNdh || roles?.isAdmin || roles?.isSuper);

    // Mặc định tạo danh sách admin ảo cho bot nếu chưa có
    let adminIDs = threadData.adminIDs || [];

    // Tự động thêm người dùng đầu tiên gọi lệnh (nếu danh sách trống) làm QTV nhóm mặc định
    if (adminIDs.length === 0) {
      // Để tránh ai đó vô tình add, ta vẫn cho phép, nhưng có thể cải thiện bằng cách kiểm tra chủ bot sau này.
    } else {
      // Chỉ cho phép admin hiện tại gọi lệnh (nếu đã có admin)
      if (!adminIDs.includes(String(message.senderId)) && !canGlobalManage) {
        return await replyBot(
          "❌ Tính năng này chỉ dành cho Quản Trị Viên (Bot) của nhóm!",
        );
      }
    }

    const args = String(contentArgs || "").trim().split(/\s+/).filter(Boolean);
    const command = args[0] ? args[0].toLowerCase() : "";

    let targetId = null;

    if (Array.isArray(message.mentions) && message.mentions.length > 0) {
      const first = message.mentions[0];
      targetId = first?.userId || first?.id || null;
    } else if (message.replyTo && message.replyTo.senderId) {
      targetId = message.replyTo.senderId;
    } else if (args[1]) {
      targetId = args[1]; // Thử lấy ID bằng chuỗi truyền vào
    }

    // Danh sách toàn bộ quản trị viên
    if (command === "list" || command === "all") {
      if (adminIDs.length === 0) {
        return await replyBot(
          "⚠️ Nhóm này hiện chưa có dòng cấu hình Quản Trị Viên Bot nào.",
        );
      }

      await replyBot("🔄 Đang tải dữ liệu tên quản trị viên, vui lòng đợi...");

      const listNames = await Promise.all(
        adminIDs.map(async (id, index) => {
          try {
            const info = await client.getUserInfo(BigInt(id));
            if (info && info.name)
              return `${index + 1}. ${info.name} (UID: ${id})`;
          } catch (e) {}
          return `${index + 1}. Người Dùng Ẩn (UID: ${id})`;
        }),
      );

      return await replyBot(
        `📌 DANH SÁCH QUẢN TRỊ VIÊN BOX:\n\n${listNames.join("\n")}`,
      );
    }

    if (!targetId && command !== "list" && command !== "all") {
      return await replyBot(
        `⚠️ Cú pháp: ${PREFIX}qtv [add|del|list] [@Tag hoặc Reply tin nhắn]\nVí dụ: ${PREFIX}qtv add @Tên`,
      );
    }

    targetId = String(targetId);

    // Lấy tên của mục tiêu
    let targetName = targetId;
    try {
      const info = await client.getUserInfo(BigInt(targetId));
      if (info && info.name) targetName = info.name;
    } catch (e) {}

    if (command === "add") {
      if (adminIDs.includes(targetId)) {
        return await replyBot(
          `⚠️ Người dùng ${targetName} đã là Quản trị viên Bot của nhóm rồi!`,
        );
      }

      adminIDs.push(targetId);

      // Nếu người thêm là người đầu tiên (khi mảng trống)
      if (!adminIDs.includes(String(message.senderId))) {
        adminIDs.push(String(message.senderId));
      }

      // Xóa các ID trùng lặp (nếu có)
      adminIDs = [...new Set(adminIDs)];

      await updateThread(threadId, { adminIDs: adminIDs });
      return await replyBot(
        `✅ Đã THÊM thành công quyền Quản Trị Viên Bot cho:\n👤 ${targetName}\n📌 Nhóm hiện có ${adminIDs.length} Quản Trị Viên.`,
      );
    } else if (command === "del" || command === "remove") {
      if (!adminIDs.includes(targetId)) {
        return await replyBot(
          `⚠️ Người dùng ${targetName} không nằm trong danh sách Quản trị viên Bot của nhóm!`,
        );
      }

      adminIDs = adminIDs.filter((id) => id !== targetId);
      await updateThread(threadId, { adminIDs: adminIDs });
      return await replyBot(
        `✅ Đã XOÁ quyền Quản Trị Viên Bot của:\n👤 ${targetName}\n📌 Nhóm còn ${adminIDs.length} Quản Trị Viên.`,
      );
    } else {
      return await replyBot(
        `⚠️ Cú pháp không hợp lệ. Hãy sử dụng ${PREFIX}qtv [add|del] [@Tag]`,
      );
    }
  },
};
