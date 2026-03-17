import axios from "axios";

const PINTEREST_WEB = "https://www.pinterest.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

function extractPwsData(html) {
  const match = String(html || "").match(
    /<script[^>]*id="__PWS_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function pickImageUrl(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item === "string") return item;

  const images = item.images || {};
  const preferred = ["orig", "736x", "564x", "474x", "236x", "170x"];
  for (const key of preferred) {
    const url = images[key]?.url;
    if (url) return url;
  }
  return item.image_url || item.url || item.image || "";
}

async function searchPinterestByKeyword(keyword, limit = 30) {
  const query = String(keyword || "").trim();
  if (!query) return [];

  const sourcePath = `/search/pins/?q=${encodeURIComponent(query)}`;
  const searchPageUrl = `${PINTEREST_WEB}${sourcePath}`;

  const pageRes = await axios.get(searchPageUrl, {
    headers: {
      "user-agent": UA,
      referer: `${PINTEREST_WEB}/`,
    },
    timeout: 20000,
  });

  const pwsData = extractPwsData(pageRes.data);
  const appVersion = pwsData?.appVersion || "";
  const handlerId = pwsData?.initialHandlerId || "";
  if (!appVersion || !handlerId) {
    throw new Error("Không lấy được token Pinterest");
  }

  const data = {
    options: {
      isPrefetch: false,
      query,
      scope: "pins",
      no_fetch_context_on_resource: false,
    },
    context: {},
  };

  const apiUrl =
    `${PINTEREST_WEB}/resource/BaseSearchResource/get/?source_url=${encodeURIComponent(sourcePath)}` +
    `&data=${encodeURIComponent(JSON.stringify(data))}`;

  const res = await axios.get(apiUrl, {
    headers: {
      "user-agent": UA,
      "x-requested-with": "XMLHttpRequest",
      "x-pinterest-appstate": "active",
      "x-app-version": appVersion,
      "x-pinterest-pws-handler": handlerId,
      "x-pinterest-source-url": sourcePath,
      referer: `${PINTEREST_WEB}/`,
    },
    timeout: 20000,
  });

  const items = res.data?.resource_response?.data?.results || [];
  const urls = items.map(pickImageUrl).filter(Boolean);
  return [...new Set(urls)].slice(0, limit);
}

async function searchPinterestByKeywordFallback(keyword) {
  const url = `https://api.satoru.click/api/pinterest?search=${encodeURIComponent(keyword)}`;
  const res = await axios.get(url, { timeout: 15000 });
  if (!res.data?.data || !Array.isArray(res.data.data)) return [];
  return res.data.data.filter(Boolean);
}

export default {
  name: "pinterest",
  aliases: ["pin", "anh"],
  execute: async ({ client, message, type, contentArgs, PREFIX, replyBot }) => {
    let isImageSearch = false;

    // Kiểm tra nếu người dùng đang Reply một cái ảnh
    const replyMsg = message.replyTo;
    let imageUrl = null;

    if (replyMsg && replyMsg.attachments && replyMsg.attachments.length > 0) {
      // Có thể là e2ee image lighweight hoặc link m.me/...
      const attach = replyMsg.attachments[0];
      if (attach.url) {
        imageUrl = attach.url;
      }
    }

    if (imageUrl) {
      isImageSearch = true;
    } else if (contentArgs) {
    } else {
      return await replyBot(
        `⚠️ Cú pháp: ${PREFIX}pinterest <từ khóa tìm kiếm>\nVí dụ: ${PREFIX}pinterest aesthetic sunset\n\n📌 Nếu bạn có ảnh muốn tìm nguồn đồ hoặc tương tự, hãy Reply (Trả lời) tấm ảnh đó với câu lệnh: ${PREFIX}pinterest`,
      );
    }

    // Thông báo đang tìm kiếm (Tránh Bot im lặng lâu khi fetch API)
    if (isImageSearch) {
      await replyBot(
        `🔄 Đang tìm kiếm các ảnh tương tự từ Pinterest dựa theo bức ảnh bạn cung cấp...`,
      );
    } else {
      await replyBot(
        `🔄 Đang tìm kiếm ảnh cho "${contentArgs}" trên Pinterest. Vui lòng đợi...`,
      );
    }

    try {
      let imageUrls = [];
      if (isImageSearch) {
        // Pinterest reverse image public endpoint rất dễ đổi/chặn.
        // Hiện tạm fallback về API cũ nếu còn hoạt động.
        try {
          const reverseUrl = `https://api.satoru.click/api/pinterest/search?limit=20&image_url=${encodeURIComponent(imageUrl)}`;
          const res = await axios.get(reverseUrl, { timeout: 15000 });
          const list = res.data?.data || [];
          imageUrls = list.map((item) => pickImageUrl(item)).filter(Boolean);
        } catch (e) {
          imageUrls = [];
        }

        if (imageUrls.length === 0) {
          return await replyBot(
            "❌ Tìm bằng ảnh hiện đang lỗi nguồn. Bạn hãy thử tìm theo từ khóa: /pin <từ_khóa>",
          );
        }
      } else {
        try {
          imageUrls = await searchPinterestByKeyword(contentArgs, 30);
        } catch (officialErr) {
          // fallback nhẹ nếu Pinterest đổi API nội bộ
          try {
            imageUrls = await searchPinterestByKeywordFallback(contentArgs);
          } catch (fallbackErr) {
            imageUrls = [];
          }
        }

        if (imageUrls.length === 0) {
          return await replyBot(
            "❌ Không tìm thấy bức ảnh nào phù hợp với từ khóa của bạn.",
          );
        }
      }

      imageUrls = imageUrls.filter((u) => u !== "");

      if (imageUrls.length === 0) {
        return await replyBot(
          "❌ Rất tiếc, định dạng trả về từ API không chứa mảng ảnh rỗng rỗng.",
        );
      }

      // Lấy ngẫu nhiên từ 1 đến 6 ảnh để tránh spam
      const maxImages = Math.min(imageUrls.length, 6);
      const shuffled = imageUrls.sort(() => 0.5 - Math.random());
      const selectedImages = shuffled.slice(0, maxImages);

      await replyBot(
        `✅ Tìm thấy ${imageUrls.length} kết quả! Đang tải xuống ${maxImages} ảnh ngẫu nhiên cho bạn...`,
      );

      // Tải và Gửi từng ảnh
      for (let i = 0; i < selectedImages.length; i++) {
        const url = selectedImages[i];
        try {
          const imgRes = await axios({
            url: url,
            method: "GET",
            responseType: "arraybuffer",
          });
          const buffer = Buffer.from(imgRes.data);

          if (type === "E2EE Message" && message.chatJid) {
            await client.sendE2EEImage(message.chatJid, buffer, "image/jpeg", {
              caption: `Ảnh ${i + 1}/${maxImages}`,
            });
          } else {
            await client.sendImage(message.threadId, buffer, "image.jpg", {
              caption: `Ảnh ${i + 1}/${maxImages}`,
            });
          }
        } catch (downloadErr) {
          console.error("Lỗi tải/gửi 1 ảnh:", downloadErr.message);
        }
      }
    } catch (error) {
      console.error("[Pinterest API Lỗi]", error.message);
      await replyBot(
        "❌ Đã xảy ra lỗi khi tìm kiếm hoặc tải ảnh từ Pinterest. Máy chủ hoặc url ảnh FB Messenger có thể bị thiết lập quyền riêng tư.",
      );
    }
  },
};
