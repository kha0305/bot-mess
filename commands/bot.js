export default {
  name: "bot",
  aliases: ["ê", "alo", "gọi"],
  execute: async ({ replyBot, message, contentArgs }) => {
    // Nếu có nội dung phía sau chữ "bot" thì vẫn phản ứng
    // Các câu trả lời thân mật ngẫu nhiên
    const replies = [
      "Dạ, bot nghe nè! ❤️",
      "Mình đây, bạn cần giúp gì hơm?",
      "Gọi bot có việc gì á? 🥰",
      "Bot ở đây, có chi mà gọi thân thiết dợ 😘",
      "Dạ vâng, xin nghe! Cần gì nói đi nè.",
      "Kêu tui hoài, có nhớ tui không đó?",
      "Đang rảnh nè, tâm sự xíu không? 👀",
      "Bot đang bận... bận nhớ bạn đó! 😂",
      "Gì dạ? Kêu 1 tiếng nữa là dỗi á nha! 😤",
      "Kêu tui quài, cho 10 cành đi rồi nói chuyện tiếp 💸",
      "Chuyện gì đó? Đang ngủ mà cũng bị kêu dậy 😴",
      "Tớ đây! Sẵn sàng lắng nghe cậu nè 🌻",
      "Bạn vừa gọi một chiếc Bot siêu cấp đáng yêu phải không? ✨",
      "Alo alo, đại bàng gọi chim sẻ nghe rõ trả lời! 🦅",
      "Mệt mỏi ghê á, ngày nào cũng phải rep tin nhắn của mấy người � (đùa thôi hihi)",
      "Nói lẹ đi, tui còn bận đi mần ăn nữa �😤",
      "Có chuyện gì vui kể tui nghe chung dớiiii 🎉",
      "Muốn chơi Tài Xỉu hay nhận tiền Daily thì gõ lệnh nha, gọi tui quài tui hổng biết đâu á 🥴",
      "Kêu ca gì, bao nuôi tui đi rồi tính 💅",
      "Cục cưng ới, có tui ở đây, đừng sợ nha! 🤗",
      "Dạ có thần dân của bạn đây! Xin được phân phó! 👑",
    ];

    // Lấy ngẫu nhiên 1 câu trả lời từ danh sách
    const randomReply = replies[Math.floor(Math.random() * replies.length)];

    await replyBot(randomReply);
  },
};
