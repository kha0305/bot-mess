import { updateUser } from "../db.js";

const COOLDOWN_TIME = 10 * 60 * 1000; // 10 phút

function normalizeId(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

function ensureHandleReplyStore() {
  if (!global.client) global.client = {};
  if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
  return global.client.handleReply;
}

export default {
  name: "cave",
  aliases: ["lambit", "cv"],
  execute: async ({ client, message, userData, replyBot }) => {
    const now = Date.now();
    const lastCave = userData.lastCave || 0;

    if (now - lastCave < COOLDOWN_TIME) {
      const timeLeft = COOLDOWN_TIME - (now - lastCave);
      const hours = Math.floor(timeLeft / (1000 * 60 * 60));
      const mins = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((timeLeft % (1000 * 60)) / 1000);
      return await replyBot(
        `💫 Lồn thì thâm như cái dái chó rồi còn địt nhiều vậy, chờ ${hours} giờ ${mins} phút ${secs} giây nữa để làm tiếp nhé.`,
      );
    }

    const replyMsg = await replyBot(
      "====== CAVE ======\n\n1. Việt Nam 🇻🇳\n2. Trung Quốc 🇨🇳\n3. Nhật Bản 🇯🇵\n4. Thái Lan 🇹🇭\n5. Mỹ 🇺🇸\n6. Campuchia 🇰🇭\n\n💬 Rep tin nhắn này để chọn địa điểm làm cave",
    );

    const sentMsgId =
      typeof replyMsg === "string"
        ? replyMsg
        : replyMsg
          ? replyMsg.id ||
            replyMsg.messageID ||
            replyMsg.messageId ||
            replyMsg.key?.id ||
            replyMsg[0]?.id
          : null;

    if (sentMsgId) {
      ensureHandleReplyStore().push({
        name: "cave",
        messageID: sentMsgId,
        author: normalizeId(message.senderId),
      });
    }
  },

  handleReply: async ({ client, message, userData, replyBot, handleReply }) => {
    // Chỉ người gõ lệnh mới được chọn
    if (normalizeId(message.senderId) !== normalizeId(handleReply.author)) {
      return replyBot("Nó làm cave có phải mày đâu mà rep");
    }

    const choice = (message.text || "").trim();
    if (!choice) {
      return replyBot("Reply từ 1 -> 6 để chọn Quốc Gia");
    }
    if (!["1", "2", "3", "4", "5", "6"].includes(choice)) {
      return replyBot("Reply từ 1 -> 6 để chọn Quốc Gia");
    }

    global.client.handleReply = global.client.handleReply.filter(
      (item) => item.messageID !== handleReply.messageID,
    );

    const randomAmount = Math.random();
    let earnAmount = 0;

    if (randomAmount < 0.4) {
      earnAmount = Math.floor(Math.random() * (400000 - 200000 + 1)) + 200000;
    } else if (randomAmount < 0.7) {
      earnAmount = Math.floor(Math.random() * (600000 - 400000 + 1)) + 400000;
    } else if (randomAmount < 0.9) {
      earnAmount = Math.floor(Math.random() * (800000 - 600000 + 1)) + 600000;
    } else {
      earnAmount = Math.floor(Math.random() * (1000000 - 800000 + 1)) + 800000;
    }

    let country = "";
    switch (choice) {
      case "1":
        country = "Việt Nam";
        break;
      case "2":
        country = "Trung Quốc";
        break;
      case "3":
        country = "Nhật Bản";
        break;
      case "4":
        country = "Thái Lan";
        break;
      case "5":
        country = "Mỹ";
        break;
      case "6":
        country = "Campuchia";
        break;
    }

    const titles = ["gái ngành", "phò", "gái bán hoa", "gái đứng đường"];
    let titleIndex = 3;
    if (randomAmount < 0.4) titleIndex = 0;
    else if (randomAmount < 0.7) titleIndex = 1;
    else if (randomAmount < 0.9) titleIndex = 2;

    const title = titles[titleIndex];

    userData.balance += earnAmount;
    userData.lastCave = Date.now();

    await updateUser(userData.id, {
      balance: userData.balance,
      lastCave: userData.lastCave,
    });

    await replyBot(
      `Bạn vừa làm ${title} ở ${country} và được ${earnAmount.toLocaleString("en-US")}$`,
    );
  },
};
