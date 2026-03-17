const activeThreads = new Set();

export default {
  name: "chuilientuc",
  aliases: ["spamlt"],
  execute: async ({ client, message, contentArgs, PREFIX, replyBot }) => {
    const args = contentArgs.split(/\s+/);

    if (args.length > 0 && args[0].toLowerCase() === "stop") {
      if (activeThreads.has(message.threadId)) {
        activeThreads.delete(message.threadId);
        return await replyBot("✅ Đã dừng hoạt động của lệnh chửi liên tục.");
      } else {
        return await replyBot(
          "⚠️ Lệnh chửi liên tục không hoạt động trong nhóm này.",
        );
      }
    }

    let targetId = null;
    let targetName = "";

    if (message.mentions && message.mentions.length > 0) {
      targetId = message.mentions[0].userId;
    } else if (message.replyTo && message.replyTo.senderId) {
      targetId = message.replyTo.senderId;
    } else if (args[0]) {
      targetId = args[0];
    }

    if (!targetId) {
      return await replyBot(
        "⚠️ Cần phải tag 1 người, reply tin nhắn hoặc nhập ID người bạn muốn chửi",
      );
    }

    try {
      const info = await client.getUserInfo(BigInt(targetId));
      if (info && info.name) targetName = info.name;
    } catch (e) {}

    activeThreads.add(message.threadId);

    const messages = [
      "Ngóng tai mà nghe bố mày chửi nè !",
      "Đ!t con mẹ mày",
      "Địt cái lồn mẹ mày chết chưa hả thằng lồn",
      "Bố mày địt mẹ mày luôn đấy con chó",
      "Địt vỡ đầu gối, địt thối màng trinh",
      "Địt bất thình lình",
      "Địt kiểu ảo tưởng, địt hướng mặt trời",
      "Địt chơi địt bời, địt ra kiểu mới",
      "Địt tới địt lui, địt búi cả đầu",
      "Địt đâu cũng chết, địt bết cả lồn",
      "Địt kiểu ngang kiểu dọc, kiểu không cần khoa học",
      "Cũng chọc thủng lồn cái con đĩ mẹ mày",
      "Cái thằng dâm cha chém chú, bóp vú chị dâu",
      "Cạo đầu em nhỏ bắn bỏ em trai, kì lồn em gái",
      "Đái ỉa ra sông như công xỉa cánh",
      "Như đánh chó hoang, đập đầu chó thiến",
      "Bú lồn chim sẻ, bẻ lồn chim ri",
      "Kì lồn chim cắt mà đút lồn vào chim trâu",
      "Địt cái lồn mẹ mày thấy mày chết chưa hả con chó ăn cứt",
      "Đi với Phật thì mặc áo cà sa, đi với ma thì mặc áo giấy",
      "Tao mệt rồi không chửi nữa",
      "Nào up lyric thì chửi tiếp nha con súc vật",
      "Xin chào và hẹn gặp lại",
      "Gut Bai ",
    ];

    let i = 0;
    const sendSpam = async () => {
      while (i < messages.length && activeThreads.has(message.threadId)) {
        try {
          let textMsg = messages[i] + (targetName ? ` ${targetName}` : "");
          if (message.chatJid) {
            await client.sendE2EEMessage(message.chatJid, textMsg);
          } else {
            await client.sendMessage(message.threadId, textMsg);
          }
        } catch (err) {
          console.error("Lỗi gửi war:", err);
        }
        i++;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      if (activeThreads.has(message.threadId)) {
        activeThreads.delete(message.threadId);
        let endMsg = `✅ Đã spam liên tục xong!`;
        if (message.chatJid) {
          await client.sendE2EEMessage(message.chatJid, endMsg);
        } else {
          await client.sendMessage(message.threadId, endMsg);
        }
      }
    };

    sendSpam();
  },
};
