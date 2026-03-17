import { updateUser } from "../db.js";

export default {
  name: "daily",
  execute: async ({ userData, replyBot }) => {
    const now = Date.now();
    // 24 tiếng = 86400000 ms
    const cd = 86400000;
    const lastDaily = userData.lastDaily || 0;

    if (now - lastDaily < cd) {
      const timeLeft = cd - (now - lastDaily);
      const hours = Math.floor(timeLeft / (1000 * 60 * 60));
      const mins = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
      return await replyBot(
        `⏰ Bạn đã nhận quà điểm danh rồi. Vui lòng quay lại sau ${hours} giờ ${mins} phút nữa nhé!`,
      );
    }

    userData.balance += 100;
    userData.lastDaily = now;

    await updateUser(userData.id, {
      balance: userData.balance,
      lastDaily: userData.lastDaily,
    });

    await replyBot(
      `🎁 Bạn đã điểm danh thành công và nhận được 100$!\n💰 Số dư hiện tại: ${userData.balance.toLocaleString("en-US")}$`,
    );
  },
};
