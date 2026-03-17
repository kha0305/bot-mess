import axios from "axios";

function removeVietnameseTones(str) {
    str = str.replace(/à|á|ạ|ả|ã|â|ă|ằ|ắ|ặ|ẳ|ẵ|â|ầ|ấ|ậ|ẩ|ẫ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ/g, "A");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    str = str.toLowerCase();
    return str;
}

export default {
  name: "dhbc",
  aliases: ["duoihinhbatchu", "game"],
  execute: async ({ client, message, type, replyBot }) => {
    try {
      const waitMsg = await replyBot("🎮 Đang khởi tạo màn chơi Đuổi Hình Bắt Chữ, vui lòng đợi...");
      let data, img1Res, img2Res;
      let success = false;
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      };

      for (let i = 0; i < 5; i++) {
        try {
          const res = await axios.get("https://dungkon.lol/game/dhbcv2?apikey=dungkon_4p343b");
          data = res.data?.dataGame;
          if (!data) continue;

          img1Res = await axios.get(data.link1, { responseType: "arraybuffer", headers, timeout: 10000 });
          img2Res = await axios.get(data.link2, { responseType: "arraybuffer", headers, timeout: 10000 });
          success = true;
          break; // Thoát vòng lặp nếu tải ảnh thành công
        } catch (err) {
          console.log(`[DHBC] Tải ảnh lỗi (Thử lại lần ${i + 1}/5):`, err.message);
        }
      }

      if (!success) {
         try {
           if (waitMsg && waitMsg.id) await client.unsendMessage(waitMsg.id);
         } catch(e) {}
         return replyBot("❌ API đang có lỗi ảnh hàng loạt, vui lòng thử lại sau.");
      }

      const buffer1 = Buffer.from(img1Res.data);
      const buffer2 = Buffer.from(img2Res.data);
      
      const isE2EE = (type === "E2EE Message" && message.chatJid);
      const targetId = isE2EE ? message.chatJid : message.threadId;

      const replyText = `🎮 ĐUỔI HÌNH BẮT CHỮ 🎮\n🤖 Hãy suy luận từ khóa từ 2 bức ảnh (hoặc Reply tin nhắn dưới).\n📋 Số ký tự: ${data.sokitu}\n💡 Gợi ý: ${data.suggestions}\n\n👉 Reply tin nhắn này kèm kết quả của bạn!`;
      
      try {
        if (waitMsg && waitMsg.id) {
          await client.unsendMessage(waitMsg.id);
        }
      } catch (e) {}

      let sentMsg;
      if (isE2EE) {
        sentMsg = await client.sendE2EEMessage(targetId, replyText, { replyToId: message.id });
        await client.sendE2EEImage(targetId, buffer1, "img1.jpg");
        await client.sendE2EEImage(targetId, buffer2, "img2.jpg");
      } else {
        sentMsg = await client.sendMessage(targetId, replyText, { replyToId: message.id });
        await client.sendImage(targetId, buffer1, "img1.jpg");
        await client.sendImage(targetId, buffer2, "img2.jpg");
      }

      const sentMsgId = typeof sentMsg === "string" ? sentMsg : (sentMsg ? (sentMsg.id || sentMsg.messageID || sentMsg.messageId || sentMsg.key?.id || sentMsg[0]?.id) : null);
      
      if (sentMsgId) {
        global.client.handleReply.push({
          name: "dhbc",
          messageID: sentMsgId,
          tukhoa: data.tukhoa
        });
      } else {
          console.log("[DHBC DEBUG] Không lấy được messageID", sentMsg);
      }
    } catch (e) {
      console.error(e);
      await replyBot("❌ Đã xảy ra lỗi khi tạo trò chơi.");
    }
  },
  
  handleReply: async ({ client, message, replyBot, handleReply }) => {
    const inputText = (message.text || "").trim();
    if (!inputText) {
      return replyBot("❌ Bạn cần reply bằng chữ để trả lời.");
    }

    const ans = removeVietnameseTones(inputText);
    const correct = removeVietnameseTones(handleReply.tukhoa.trim());
    
    if (ans === correct || ans === removeVietnameseTones(handleReply.tukhoa.trim().replace(/\s+/g, ''))) {
      global.client.handleReply = global.client.handleReply.filter(item => item.messageID !== handleReply.messageID);
      return replyBot(`🎉 CHÍNH XÁC! Chúc mừng bạn đã giải đúng.\n✅ Đáp án là: ${handleReply.tukhoa.toUpperCase()}`);
    } else {
      return replyBot(`❌ Sai rồi! Thử lại nhé.`);
    }
  }
};
