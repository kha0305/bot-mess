import {
  getCommandCategoryKey,
  getCategoryLabel,
  getCommandPermission,
  normalizeCommandName,
  listCategoryKeys,
} from "../utils/commandMeta.js";

const MENU_CASE_GROUP = "menu_info_group";
const MENU_CASE_COMMAND = "menu_info_command";
const HEADER_CENTER_WIDTH = 30;

const META_FALLBACK = {
  add: { description: "Thêm admin bot nhanh (reply/tag)", usage: "admin <@tag/reply/id>" },
  admin: {
    description: "Quản lý quyền global của bot",
    usage: "list | them [super|admin|ndh] <@tag/reply/id> | xoa [super|admin|ndh] <@tag/reply/id>",
  },
  ai: { description: "Trò chuyện AI, hỗ trợ vision/web" },
  autosend: { description: "Tự động gửi tin nhắn theo chu kỳ", usage: "start <interval> <duration> <noi_dung> | stop | status" },
  ban: { description: "Cấm user/thread/lệnh/category", usage: "check | cmd <ten> | category <ten> | thread [id] | user <@tag/reply/id>" },
  balance: { description: "Xem số dư hiện tại" },
  bot: { description: "Gọi bot trả lời nhanh" },
  box: { description: "Xem thông tin nhóm chi tiết" },
  cave: { description: "Làm việc 18+ kiếm tiền" },
  check: { description: "Thống kê tương tác nhóm" },
  checkrent: { description: "Xem hạn thuê bot của nhóm" },
  chuiadmin: { description: "Bật/tắt autoban khi chửi admin/bot" },
  chuidenchet: { description: "Spam war đến khi kết thúc" },
  chuilientuc: { description: "Spam war liên tục có thể stop" },
  choose: { description: "Chọn ngẫu nhiên 1 lựa chọn" },
  daily: { description: "Nhận thưởng điểm danh mỗi ngày" },
  db: { description: "Thống kê database", usage: "stats" },
  del: { description: "Xóa admin bot nhanh (reply/tag)", usage: "admin <@tag/reply/id>" },
  dhbc: { description: "Game đuổi hình bắt chữ" },
  dich: { description: "Dịch văn bản bằng AI" },
  gai: { description: "Random ảnh gái xinh" },
  help: { description: "Xem hướng dẫn chi tiết lệnh" },
  hi: { description: "Chào hỏi người dùng" },
  info: { description: "Thông tin tài khoản của bạn" },
  load: { description: "Reload command/event", usage: "<ten> | cmd <ten> | event <ten> | all [cmd|event]" },
  math: { description: "Tính biểu thức toán học nhanh" },
  menu: { description: "Xem danh mục và thông tin lệnh" },
  note: { description: "Xuất/sửa file code qua note", usage: "<ten_file> [url]" },
  pay: { description: "Chuyển tiền cho người khác" },
  ping: { description: "Kiểm tra độ trễ bot" },
  pinterest: { description: "Tìm ảnh theo từ khóa/ảnh reply" },
  qtv: { description: "Quản lý admin bot trong nhóm", usage: "add | del | list" },
  qtvonly: { description: "Chỉ cho QTV bot dùng lệnh" },
  rename: { description: "Đổi tên nhóm chat" },
  rentadd: { description: "Gia hạn thuê bot cho nhóm", usage: "<so_ngay>" },
  reset: { description: "Khởi động lại bot" },
  roll: { description: "Random số hoặc xúc xắc NdM" },
  setmoney: { description: "Admin đặt số dư user", usage: "@tag <so_tien>" },
  setunsend: { description: "Đặt emoji để gỡ tin nhắn", usage: "<emoji1> <emoji2> ..." },
  sing: { description: "Tìm và phát nhạc từ YouTube/link" },
  tx: { description: "Game tài xỉu" },
  uid: { description: "Lấy UID của bạn" },
  unban: { description: "Gỡ cấm user/thread/lệnh/category", usage: "cmd <ten|all> | category <ten|all> | thread [id] | user <@tag/reply/id|all>" },
  upt: { description: "Xem trạng thái bot nâng cao" },
  uptime: { description: "Xem thời gian chạy và tài nguyên bot" },
  vay: { description: "Vay tiền / trả nợ", usage: "<so_tien> | tra <so_tien|all> | status" },
  vd: { description: "Nhận video random theo loại" },
  video: { description: "Tải video YouTube/link", usage: "<từ_khóa|link|video_id>" },
  work: { description: "Làm việc ngẫu nhiên kiếm tiền" },
};

function normalizeText(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatUptime() {
  const sec = Math.max(0, Math.floor(process.uptime()));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getPermissionLabel(level) {
  const p = Number(level) || 0;
  if (p <= 0) return "Member";
  if (p === 1) return "Group admin / NDH / Admin";
  if (p === 2) return "NDH / Admin";
  if (p === 3) return "Admin";
  return "SuperAdmin";
}

function hasPermissionLevel(required, roles = {}) {
  const level = Number(required) || 0;
  if (level <= 0) return true;
  if (level === 1) return !!(roles.isThreadAdmin || roles.isNdh || roles.isAdmin || roles.isSuper);
  if (level === 2) return !!(roles.isNdh || roles.isAdmin || roles.isSuper);
  if (level === 3) return !!(roles.isAdmin || roles.isSuper);
  return !!roles.isSuper;
}

function getRoleLabel(roles = {}) {
  if (roles.isSuper) return "SuperAdmin";
  if (roles.isAdmin) return "Admin";
  if (roles.isNdh) return "NDH";
  if (roles.isThreadAdmin) return "Group admin";
  return "Member";
}

function getDisplayCategoryLabel(categoryKey) {
  const key = String(categoryKey || "").trim().toLowerCase();
  if (key === "utility") return "Thông tin & tiện ích";
  if (key === "fun") return "Tài chính & giải trí";
  if (key === "group_admin") return "Quản trị nhóm";
  if (key === "system") return "Hệ thống";
  if (key === "admin") return "Admin";
  return getCategoryLabel(categoryKey);
}

function renderCenteredTitle(title, width = HEADER_CENTER_WIDTH) {
  const text = String(title || "").trim();
  const len = [...text].length;
  const padLeft = Math.max(0, Math.floor((width - len) / 2));
  return `│ ${" ".repeat(padLeft)}${text}`;
}

function getSentMessageId(result) {
  if (!result || typeof result !== "object") return "";
  return String(result.messageID || result.messageId || result.id || "").trim();
}

function pushHandleReply(payload) {
  if (!global.client) global.client = {};
  if (!Array.isArray(global.client.handleReply)) global.client.handleReply = [];
  global.client.handleReply.push(payload);
}

function buildCommandIndex() {
  const source = global.client?.commands;
  const commands = new Map();
  const lookup = new Map();
  if (!(source instanceof Map)) {
    return { commands, lookup };
  }

  for (const [rawKey, commandObj] of source.entries()) {
    if (!commandObj?.name) continue;
    const canonical = String(commandObj.name).trim().toLowerCase();
    if (!canonical) continue;

    if (!commands.has(canonical)) {
      commands.set(canonical, commandObj);
    }

    const names = [canonical, String(rawKey || "").trim().toLowerCase()];
    if (Array.isArray(commandObj.aliases)) {
      for (const alias of commandObj.aliases) {
        names.push(String(alias || "").trim().toLowerCase());
      }
    }

    for (const token of names) {
      if (!token) continue;
      lookup.set(token, canonical);
      lookup.set(normalizeText(token), canonical);
      lookup.set(normalizeCommandName(token), canonical);
    }
  }

  return { commands, lookup };
}

function getUniqueCommandNames(index) {
  return [...index.commands.keys()].sort((a, b) => a.localeCompare(b, "vi"));
}

function resolveCommandName(index, rawInput) {
  const query = String(rawInput || "").trim().toLowerCase();
  if (!query) return "";
  return (
    index.lookup.get(query) ||
    index.lookup.get(normalizeText(query)) ||
    index.lookup.get(normalizeCommandName(query)) ||
    ""
  );
}

function getCommandMeta(name, commandObj) {
  const normalizedName = String(name || "").trim().toLowerCase();
  const fallback = META_FALLBACK[normalizeCommandName(normalizedName)] || {};
  const description = String(commandObj?.description || fallback.description || "Chưa cập nhật mô tả").trim();
  const usagesRaw = String(commandObj?.usages || fallback.usage || "").trim();
  const permission = Number(getCommandPermission(normalizedName, commandObj) || 0);
  const cooldowns = Number(commandObj?.cooldowns ?? commandObj?.cooldown ?? 0);
  const categoryKey = String(getCommandCategoryKey(normalizedName) || "utility");
  const aliases = Array.isArray(commandObj?.aliases)
    ? commandObj.aliases.map((x) => String(x).trim().toLowerCase()).filter((x) => x && x !== normalizedName)
    : [];

  return {
    name: normalizedName,
    description,
    usagesRaw,
    permission: Number.isFinite(permission) ? Math.max(0, Math.floor(permission)) : 0,
    cooldowns: Number.isFinite(cooldowns) ? Math.max(0, Math.floor(cooldowns)) : 0,
    categoryKey,
    categoryLabel: getDisplayCategoryLabel(categoryKey),
    aliases: [...new Set(aliases)],
  };
}

function buildUsage(prefix, meta) {
  if (!meta.usagesRaw) return `${prefix}${meta.name}`;
  if (meta.usagesRaw.startsWith(prefix)) return meta.usagesRaw;
  if (meta.usagesRaw.toLowerCase().startsWith(meta.name)) return `${prefix}${meta.usagesRaw}`;
  return `${prefix}${meta.name} ${meta.usagesRaw}`;
}

function getVisibleCommandNames(index, roles = {}) {
  return getUniqueCommandNames(index).filter((name) => {
    const cmd = index.commands.get(name);
    const meta = getCommandMeta(name, cmd);
    return hasPermissionLevel(meta.permission, roles);
  });
}

function buildCategoryBlocks(index, names) {
  const orderedKeys = [...listCategoryKeys()];
  const byCategory = new Map();

  for (const key of orderedKeys) {
    byCategory.set(key, []);
  }

  for (const name of names) {
    const cmd = index.commands.get(name);
    const meta = getCommandMeta(name, cmd);
    const key = String(meta.categoryKey || "utility");
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(name);
  }

  const blocks = [];
  for (const key of orderedKeys) {
    const list = byCategory.get(key) || [];
    if (list.length === 0) continue;
    list.sort((a, b) => a.localeCompare(b, "vi"));
    blocks.push({
      key,
      title: String(getDisplayCategoryLabel(key)),
      names: list,
    });
    byCategory.delete(key);
  }

  const extraNames = [...byCategory.values()].flat().sort((a, b) => a.localeCompare(b, "vi"));
  if (extraNames.length > 0) {
    blocks.push({
      key: "other",
      title: "Khác",
      names: extraNames,
    });
  }

  for (let i = 0; i < blocks.length; i += 1) {
    blocks[i].id = String(i + 1);
  }
  return blocks;
}

function suggestCommands(names, keyword, limit = 5) {
  const normalizedKeyword = normalizeCommandName(keyword);
  if (!normalizedKeyword) return names.slice(0, limit);

  const starts = names.filter((name) => normalizeCommandName(name).startsWith(normalizedKeyword));
  if (starts.length >= limit) return starts.slice(0, limit);

  const contains = names.filter(
    (name) =>
      normalizeCommandName(name).includes(normalizedKeyword) &&
      !starts.includes(name),
  );
  return [...starts, ...contains].slice(0, limit);
}

function renderMainMenu({
  blocks,
  visibleCount,
  totalCount,
  prefix,
  threadData,
  roles,
}) {
  const nowText = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const expireAt = Number(threadData?.expireAt || 0);
  const rentText =
    expireAt > Date.now()
      ? `Còn hạn đến ${new Date(expireAt).toLocaleString("vi-VN")}`
      : "Chưa gia hạn / hết hạn";

  let txt = "╭─────────────⭓\n";
  txt += `${renderCenteredTitle("📚 𝗠𝗲𝗻𝘂")}\n`;
  txt += "│─────⭔\n";
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    txt += `│${i + 1}. ${block.title} - ${block.names.length} lệnh\n`;
  }
  txt += "│────────⭔\n";
  txt += `│ ✅ Hiển thị ${visibleCount}/${totalCount} lệnh\n`;
  txt += `│ ↩️ Reply 1-${blocks.length} để mở nhóm\n`;
  txt += `│ 📋 ${prefix}menu all để xem tất cả lệnh\n`;
  txt += `│ 🔎 ${prefix}menu <command> để xem chi tiết\n`;
  txt += "│─────⭔\n";
  txt += `│ ⚙️ Prefix: ${prefix}\n`;
  txt += `│ 👤 Role: ${getRoleLabel(roles)}\n`;
  txt += `│ ⏱️ Uptime: ${formatUptime()}\n`;
  txt += `│ 🕒 Giờ VN: ${nowText}\n`;
  txt += `│ 💳 Rent: ${rentText}\n`;
  txt += "╰─────────────⭓";
  return txt;
}

function renderCategoryMenu({ block, index, prefix }) {
  let txt = "╭─────────────⭓\n";
  txt += `${renderCenteredTitle(`🗂️ 𝗖𝗮𝘁𝗲𝗴𝗼𝗿𝘆: ${block.title}`)}\n`;
  txt += "│─────⭔\n";
  for (let i = 0; i < block.names.length; i += 1) {
    const name = block.names[i];
    const cmd = index.commands.get(name);
    const meta = getCommandMeta(name, cmd);
    txt += `│${i + 1}. ${prefix}${name} | ${meta.description}\n`;
  }
  txt += "│────────⭔\n";
  txt += `│ ↩️ Reply 1-${block.names.length} để xem chi tiết\n`;
  txt += `│ Hoặc gõ ${prefix}menu <command>\n`;
  txt += "╰─────────────⭓";
  return txt;
}

function renderAllCommands({ names, index, prefix }) {
  let txt = "╭─────────────⭓\n";
  txt += `${renderCenteredTitle("🧾 𝗔𝗹𝗹 𝗰𝗼𝗺𝗺𝗮𝗻𝗱𝘀")}\n`;
  txt += "│─────⭔\n";
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const cmd = index.commands.get(name);
    const meta = getCommandMeta(name, cmd);
    txt += `│${i + 1}. ${prefix}${name} | ${meta.description}\n`;
  }
  txt += "│────────⭔\n";
  txt += `│ 📌 Tổng số: ${names.length} lệnh\n`;
  txt += "╰─────────────⭓";
  return txt;
}

function renderCommandInfo({ name, index, prefix }) {
  const cmd = index.commands.get(name);
  if (!cmd) return "";

  const meta = getCommandMeta(name, cmd);
  const aliases = meta.aliases.length
    ? meta.aliases.map((alias) => `${prefix}${alias}`).join(", ")
    : "Không có";

  let txt = "╭─────────────⭓\n";
  txt += `${renderCenteredTitle("ℹ️ 𝗖𝗼𝗺𝗺𝗮𝗻𝗱 𝗶𝗻𝗳𝗼")}\n`;
  txt += "│─────⭔\n";
  txt += `│ 📌 Command: ${prefix}${meta.name}\n`;
  txt += `│ 📝 Mô tả: ${meta.description}\n`;
  txt += `│ 🗂️ Category: ${meta.categoryLabel}\n`;
  txt += `│ 🔐 Permission: ${getPermissionLabel(meta.permission)}\n`;
  txt += `│ ⏳ Cooldown: ${meta.cooldowns}s\n`;
  txt += `│ 📎 Usage: ${buildUsage(prefix, meta)}\n`;
  txt += `│ 🔁 Alias: ${aliases}\n`;
  txt += "│────────⭔\n";
  txt += "╰─────────────⭓";
  return txt;
}

function parseNumericSelection(rawText) {
  const raw = String(rawText || "").trim();
  if (!/^\d+$/.test(raw)) return -1;
  return Number(raw) - 1;
}

export default {
  name: "menu",
  aliases: [],
  description: "Xem danh mục lệnh và thông tin chi tiết",
  usages: "[1|2|3|4|all|ten_lenh]",
  cooldowns: 2,

  execute: async ({
    PREFIX,
    replyBot,
    contentArgs,
    message,
    threadData,
    roles,
  }) => {
    const index = buildCommandIndex();
    if (index.commands.size === 0) {
      await replyBot("⚠️ Chưa load được command nào.");
      return;
    }

    const senderId = String(message?.senderId || "");
    const arg = String(contentArgs || "").trim().toLowerCase().split(/\s+/)[0] || "";
    const visibleNames = getVisibleCommandNames(index, roles);
    const blocks = buildCategoryBlocks(index, visibleNames);

    if (visibleNames.length === 0 || blocks.length === 0) {
      await replyBot("⚠️ Bạn hiện không có lệnh nào khả dụng theo quyền hiện tại.");
      return;
    }

    if (arg === "all" || arg === "a") {
      await replyBot(renderAllCommands({ names: visibleNames, index, prefix: PREFIX }));
      return;
    }

    if (arg) {
      const pickedName = resolveCommandName(index, arg);
      if (pickedName && visibleNames.includes(pickedName)) {
        await replyBot(renderCommandInfo({ name: pickedName, index, prefix: PREFIX }));
        return;
      }

      if (pickedName && !visibleNames.includes(pickedName)) {
        await replyBot("⛔ Bạn chưa đủ quyền để xem/dùng lệnh này.");
        return;
      }

      const pickedIdx = Number(arg);
      if (
        Number.isInteger(pickedIdx) &&
        pickedIdx >= 1 &&
        pickedIdx <= blocks.length
      ) {
        const block = blocks[pickedIdx - 1];
        const sent = await replyBot(renderCategoryMenu({ block, index, prefix: PREFIX }));
        const messageID = getSentMessageId(sent);
        if (messageID) {
          pushHandleReply({
            name: "menu",
            case: MENU_CASE_COMMAND,
            author: senderId,
            data: { names: block.names },
            messageID,
          });
        }
        return;
      }

      const suggestions = suggestCommands(visibleNames, arg);
      if (suggestions.length === 0) {
        await replyBot(`⚠️ Không tìm thấy lệnh "${arg}". Gõ ${PREFIX}menu all để xem toàn bộ.`);
        return;
      }
      await replyBot(
        `⚠️ Không tìm thấy lệnh "${arg}".\n💡 Gợi ý: ${suggestions
          .map((name) => `${PREFIX}${name}`)
          .join(", ")}`,
      );
      return;
    }

    const sent = await replyBot(
      renderMainMenu({
        blocks,
        visibleCount: visibleNames.length,
        totalCount: index.commands.size,
        prefix: PREFIX,
        threadData,
        roles,
      }),
    );

    const messageID = getSentMessageId(sent);
    if (!messageID) return;
    pushHandleReply({
      name: "menu",
      case: MENU_CASE_GROUP,
      author: senderId,
      data: { blocks },
      messageID,
    });
  },

  handleReply: async ({ message, handleReply, replyBot, PREFIX }) => {
    const senderId = String(message?.senderId || "");
    const author = String(handleReply?.author || "");
    if (!author || senderId !== author) {
      await replyBot("⚠️ Menu này không phải của bạn. Hãy gõ menu để mở menu riêng.");
      return;
    }

    const index = buildCommandIndex();
    if (index.commands.size === 0) {
      await replyBot("⚠️ Chưa load được command nào.");
      return;
    }

    const selectedIdx = parseNumericSelection(message?.text);
    if (selectedIdx < 0) {
      await replyBot("⚠️ Vui lòng reply bằng số thứ tự.");
      return;
    }

    if (handleReply.case === MENU_CASE_GROUP) {
      const blocks = Array.isArray(handleReply?.data?.blocks)
        ? handleReply.data.blocks
        : [];
      const block = blocks[selectedIdx];
      if (!block) {
        await replyBot(`⚠️ Số thứ tự không hợp lệ. Vui lòng chọn từ 1 đến ${blocks.length}.`);
        return;
      }

      const sent = await replyBot(renderCategoryMenu({ block, index, prefix: PREFIX }));
      const messageID = getSentMessageId(sent);
      if (messageID) {
        pushHandleReply({
          name: "menu",
          case: MENU_CASE_COMMAND,
          author: senderId,
          data: { names: block.names },
          messageID,
        });
      }
      return;
    }

    if (handleReply.case === MENU_CASE_COMMAND) {
      const names = Array.isArray(handleReply?.data?.names) ? handleReply.data.names : [];
      const selectedName = names[selectedIdx];
      if (!selectedName || !index.commands.has(selectedName)) {
        await replyBot(`⚠️ Số thứ tự không hợp lệ. Vui lòng chọn từ 1 đến ${names.length}.`);
        return;
      }

      await replyBot(renderCommandInfo({ name: selectedName, index, prefix: PREFIX }));
      return;
    }
  },
};
