import { updateUser } from "../db.js";

const COOLDOWN_TIME = 300000; // 5 phút

function normalizeId(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

function ensureHandleReplyStore() {
  if (!global.client) global.client = {};
  if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
  return global.client.handleReply;
}

const workList = [
  {
    name: 'Câu cá',
    icon: '😠',
    jobs: [
      ['Bạn vừa bắt được con cá đèn lồng và bán được {money}$'],
      ['Bạn vừa bắt được cá mập và bán được {money}$'],
      ['Bạn vừa bắt được tôm tít và bán được {money}$'],
      ['Bạn vừa bắt được cá ngừ và bán được {money}$'],
      ['Bạn vừa bắt được cá thu và bán được {money}$'],
      ['Bạn vừa bắt được cá koi và bán được {money}$'],
      ['Bạn vừa bắt được cá trê và bán được {money}$'],
      ['Bạn vừa bắt được tôm hùm đất và bán được {money}$'],
    ]
  },
  {
    name: 'Săn thú hoang',
    icon: '❤',
    jobs: [
      ['Bạn bắn được con rắn và bán được {money}$'],
      ['Bạn bắn được con rồng komodo và bán được {money}$'],
      ['Bạn bắn được con bói cá và bán được {money}$'],
      ['Bạn bắn được con gấu nâu và bán được {money}$'],
      ['Bạn bắn được con rắn Anaconda và bán được {money}$'],
      ['Bạn bắn được con huơu và bán được {money}$'],
      ['Bạn bắn được con heo rừng và bán được {money}$'],
      ['Bạn bắn được con sư tử và bán được {money}$'],
    ]
  },
  {
    name: 'Đào đá',
    icon: '😢',
    jobs: [
      ['Bạn đã đào được viên kim cương và bán được {money}$'],
      ['Bạn đã đào được vàng và bán được {money}$'],
      ['Bạn đã đào được quặng sắt và bán được {money}$'],
      ['Bạn đã đào được ngọc lục bảo và bán được {money}$'],
      ['Bạn đã đào được ngọc anh tím và bán được {money}$'],
      ['Bạn đã đào được than đá và bán được {money}$'],
      ['Bạn đã đào được ruby cực hiếm và bán được {money}$'],
    ]
  },
  {
    name: 'Bắn chim',
    icon: '👍',
    jobs: [
      ['Bạn bắn được con chim đen và bán được {money}$'],
      ['Bạn bắn được con đại bàng và bán được {money}$'],
      ['Bạn bắn được con chim én và bán được {money}$'],
      ['Bạn bắn được con chim vành khuyên và bán được {money}$'],
      ['Bạn bắn được con chim cu gáy và bán được {money}$'],
      ['Bạn bắn được con vẹt và bán được {money}$'],
      ['Bạn bắn được con chim sơn ca và bán được {money}$'],
    ]
  }
];

export default {
  name: "work",
  aliases: ["w"],
  execute: async ({ client, message, userData, replyBot }) => {
    const now = Date.now();
    const lastWork = userData.lastWork || 0;

    if (now - lastWork < COOLDOWN_TIME) {
      const timeLeft = COOLDOWN_TIME - (now - lastWork);
      const mins = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((timeLeft % (1000 * 60)) / 1000);
      return await replyBot(`Hãy làm việc sau: ${mins} phút ${secs} giây.`);
    }

    const menuItems = workList.map((w, i) => `[${i + 1}] ${w.name}`).join("\n");
    const replyMsg = await replyBot(
      `[ Công việc - Work ]\n${menuItems}\n\n👉 Reply STT tương ứng để làm việc.`
    );

    const sentMsgId =
      typeof replyMsg === "string"
        ? replyMsg
        : replyMsg
          ? (replyMsg.id || replyMsg.messageID || replyMsg.messageId || replyMsg.key?.id || replyMsg[0]?.id)
          : null;
    
    if (sentMsgId) {
      ensureHandleReplyStore().push({
        name: "work",
        messageID: sentMsgId,
        author: normalizeId(message.senderId),
      });
    }
  },

  handleReply: async ({ client, message, userData, replyBot, handleReply }) => {
    if (normalizeId(message.senderId) !== normalizeId(handleReply.author)) {
      return replyBot("Bạn không phải người dùng lệnh này.");
    }

    const rawChoice = (message.text || "").trim();
    if (!rawChoice) {
      return replyBot("Lựa chọn không hợp lệ. Vui lòng thử lại.");
    }
    const choice = parseInt(rawChoice) - 1;
    if (isNaN(choice) || choice < 0 || choice >= workList.length) {
      return replyBot("Lựa chọn không hợp lệ. Vui lòng thử lại.");
    }

    global.client.handleReply = global.client.handleReply.filter((item) => item.messageID !== handleReply.messageID);

    const workCategory = workList[choice];
    const jobs = workCategory.jobs;
    const randomJob = jobs[Math.floor(Math.random() * jobs.length)][0];
    
    // Random tiền từ 500$ đến 5000$ (cho đỡ lạm phát như bản gốc là 1 triệu)
    const earnAmount = Math.floor(Math.random() * (5000 - 500 + 1)) + 500;
    
    userData.balance += earnAmount;
    userData.lastWork = Date.now();

    await updateUser(userData.id, {
      balance: userData.balance,
      lastWork: userData.lastWork,
    });

    const bodyMsg = randomJob.replace("{money}", earnAmount.toLocaleString("en-US"));
    await replyBot(`💰 ${bodyMsg}`);
  }
};
