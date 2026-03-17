import { PREFIX, isAdmin, isNdh, isSuperAdmin } from "../config.js";
import { getThread, getUser, updateUser } from "../db.js";
import fs from "fs";
import { TX_HISTORY_PATH, ensureDataLayout, ensureFileDirSync } from "../utils/dataPaths.js";

const boards = new Map();
const createCooldowns = new Map();

const RATE = 1;
const BET_MIN = 50;
const CREATE_COOLDOWN_MS = 2 * 60 * 1000;
const BOARD_TIMEOUT_MS = 5 * 60 * 1000;
const AUTO_ROLL_MS = 30 * 1000;
const TX_HISTORY_LIMIT = 15;

const SELECT_LABEL = {
  t: "Tài",
  x: "Xỉu",
};

const UNITS = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
};

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function readTxHistoryStore() {
  try {
    ensureDataLayout();
    ensureFileDirSync(TX_HISTORY_PATH);
    if (!fs.existsSync(TX_HISTORY_PATH)) {
      fs.writeFileSync(TX_HISTORY_PATH, JSON.stringify([], null, 2), "utf-8");
      return [];
    }
    const raw = fs.readFileSync(TX_HISTORY_PATH, "utf-8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(Boolean).slice(-TX_HISTORY_LIMIT);
    }

    // Tương thích file từng được lưu dạng object.
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed._global)) {
        return parsed._global.filter(Boolean).slice(-TX_HISTORY_LIMIT);
      }
      if (Array.isArray(parsed._legacy)) {
        return parsed._legacy.filter(Boolean).slice(-TX_HISTORY_LIMIT);
      }
      const merged = Object.values(parsed)
        .filter(Array.isArray)
        .flat()
        .filter(Boolean)
        .slice(-TX_HISTORY_LIMIT);
      return merged;
    }

    return [];
  } catch (e) {
    console.error("[TX] Lỗi đọc tx_history.json:", e.message);
    return [];
  }
}

function writeTxHistoryStore(store) {
  try {
    ensureDataLayout();
    ensureFileDirSync(TX_HISTORY_PATH);
    const tmpPath = `${TX_HISTORY_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(tmpPath, TX_HISTORY_PATH);
  } catch (e) {
    console.error("[TX] Lỗi lưu tx_history.json:", e.message);
  }
}

function pushTxHistory(threadId, resultChar) {
  const store = readTxHistoryStore();
  void threadId;
  store.push(resultChar);
  if (store.length > TX_HISTORY_LIMIT) {
    store.splice(0, store.length - TX_HISTORY_LIMIT);
  }
  writeTxHistoryStore(store);
  return store;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function normalizeChoice(input) {
  const value = String(input || "").trim().toLowerCase();
  if (["t", "tai", "tài"].includes(value)) return "t";
  if (["x", "xiu", "xỉu"].includes(value)) return "x";
  return null;
}

function parseBetAmount(rawInput, balance) {
  const raw = String(rawInput || "")
    .trim()
    .toLowerCase()
    .replace(/[,._\s]/g, "");

  if (!raw) return null;

  if (["all", "allin"].includes(raw)) {
    return Math.floor(balance);
  }

  if (/^\d+%$/.test(raw)) {
    const percent = Number(raw.slice(0, -1));
    if (!Number.isFinite(percent) || percent <= 0) return null;
    return Math.floor((balance * percent) / 100);
  }

  const match = raw.match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!match) return null;

  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0) return null;

  const unitKey = String(match[2] || "").toLowerCase();
  const multi = unitKey ? UNITS[unitKey] : 1;
  if (!multi) return null;

  return Math.floor(num * multi);
}

async function getDisplayName(client, rawId) {
  const userId = String(rawId);
  try {
    const info = await client.getUserInfo(BigInt(userId));
    if (info?.name) return info.name;
  } catch (e) {}
  return `UID ${userId}`;
}

async function isAdminInThread(client, threadId, senderId) {
  const sid = String(senderId);
  if (isSuperAdmin(sid) || isAdmin(sid) || isNdh(sid)) {
    return true;
  }

  try {
    if (typeof client.getThreadInfo === "function") {
      const info = await client.getThreadInfo(threadId);
      const adminIds = info?.adminIds || [];
      if (adminIds.some((id) => String(id) === sid)) {
        return true;
      }
    }
  } catch (e) {}

  try {
    const threadData = await getThread(threadId);
    const adminIDs = threadData?.adminIDs || [];
    return adminIDs.includes(sid);
  } catch (e) {
    return false;
  }
}

async function sendWithContext(client, context, text, replyToId = null) {
  if (context.isE2EE && context.chatJid) {
    return client.sendE2EEMessage(context.chatJid, text, replyToId ? { replyToId } : undefined);
  }
  return client.sendMessage(context.threadId, text, replyToId ? { replyToId } : undefined);
}

function getThreadKey(rawThreadId) {
  return String(rawThreadId);
}

function clearBoardTimers(board) {
  if (board.expireTimer) {
    clearTimeout(board.expireTimer);
    board.expireTimer = null;
  }
  if (board.autoRollTimer) {
    clearTimeout(board.autoRollTimer);
    board.autoRollTimer = null;
  }
}

function deleteBoard(threadId) {
  const key = String(threadId);
  const board = boards.get(key);
  if (!board) return null;
  clearBoardTimers(board);
  boards.delete(key);
  return board;
}

async function refundAllPlayers(board) {
  const players = [...board.players.values()];
  for (const player of players) {
    const user = await getUser(player.id);
    await updateUser(player.id, { balance: user.balance + player.betAmount });
  }
}

function scheduleBoardExpire(client, board) {
  if (board.expireTimer) {
    clearTimeout(board.expireTimer);
  }

  board.expireTimer = setTimeout(async () => {
    const active = boards.get(board.threadKey);
    if (!active || active.rolling) return;

    if (active.players.size > 0) {
      await refundAllPlayers(active);
    }
    deleteBoard(active.threadKey);
    await sendWithContext(
      client,
      active,
      "⛔ Đã quá 5 phút chưa xổ. Bàn tài xỉu bị huỷ và đã hoàn tiền cho toàn bộ người chơi.",
    );
  }, BOARD_TIMEOUT_MS);
}

async function showBoardInfo(client, board, context, replyToId = null) {
  const players = [...board.players.values()];

  if (players.length === 0) {
    return sendWithContext(
      client,
      context,
      `🎰 [THÔNG TIN BÀN TÀI XỈU]\n` +
        `• Chủ bàn: ${await getDisplayName(client, board.authorId)}\n` +
        `• Tỉ lệ: 1 : ${RATE}\n` +
        `• Hiện chưa có người đặt cược.`,
      replyToId,
    );
  }

  const lines = [];
  for (let i = 0; i < players.length; i += 1) {
    const p = players[i];
    lines.push(
      `${i + 1}. ${await getDisplayName(client, p.id)} | ${SELECT_LABEL[p.select]} | ${formatMoney(p.betAmount)}$`,
    );
  }

  return sendWithContext(
    client,
    context,
    `🎰 [THÔNG TIN BÀN TÀI XỈU]\n` +
      `• Chủ bàn: ${await getDisplayName(client, board.authorId)}\n` +
      `• Tỉ lệ: 1 : ${RATE}\n` +
      `• Tổng người chơi: ${players.length}\n` +
      `${lines.join("\n")}`,
    replyToId,
  );
}

function getDiceResult() {
  const dices = [0, 0, 0].map(() => (Math.random() * 6 + 1) << 0);
  const sum = dices[0] + dices[1] + dices[2];
  const winner = sum > 10 ? "t" : "x";
  return { dices, sum, winner };
}

async function rollBoard(client, board, triggerLabel = "manual") {
  const active = boards.get(board.threadKey);
  if (!active || active.rolling) return;

  if (active.players.size === 0) {
    await sendWithContext(client, active, "❎ Chưa có ai đặt cược để xổ.", null);
    return;
  }

  active.rolling = true;
  if (active.autoRollTimer) {
    clearTimeout(active.autoRollTimer);
    active.autoRollTimer = null;
  }

  await sendWithContext(client, active, "🎲 Bot đang lắc xúc xắc, chờ xíu...");
  await new Promise((resolve) => setTimeout(resolve, 4000));

  const { dices, sum, winner } = getDiceResult();
  const players = [...active.players.values()];
  const winnerPlayers = players.filter((p) => p.select === winner);
  const losePlayers = players.filter((p) => p.select !== winner);
  const newBalances = new Map();

  for (const p of winnerPlayers) {
    const user = await getUser(p.id);
    const payout = p.betAmount * (RATE + 1);
    const nextBalance = user.balance + payout;
    await updateUser(p.id, { balance: nextBalance });
    newBalances.set(p.id, nextBalance);
  }

  for (const p of losePlayers) {
    const user = await getUser(p.id);
    newBalances.set(p.id, user.balance);
  }

  const winnerLines = [];
  for (let i = 0; i < winnerPlayers.length; i += 1) {
    const p = winnerPlayers[i];
    const payout = p.betAmount * (RATE + 1);
    winnerLines.push(
      `${i + 1}. ${await getDisplayName(client, p.id)} | ${SELECT_LABEL[p.select]} | +${formatMoney(payout)}$ | Số dư mới: ${formatMoney(newBalances.get(p.id) || 0)}$`,
    );
  }

  const loseLines = [];
  for (let i = 0; i < losePlayers.length; i += 1) {
    const p = losePlayers[i];
    loseLines.push(
      `${i + 1}. ${await getDisplayName(client, p.id)} | ${SELECT_LABEL[p.select]} | -${formatMoney(p.betAmount)}$ | Số dư mới: ${formatMoney(newBalances.get(p.id) || 0)}$`,
    );
  }

  const history = pushTxHistory(active.threadId, winner === "t" ? "T" : "X");
  const historyText = history.join("-");

  const resultText =
    `[ KẾT QUẢ TÀI XỈU ]\n` +
    `🎲 Xúc xắc: ${dices.join(" | ")} (Tổng: ${sum})\n` +
    `📝 Kết quả: ${SELECT_LABEL[winner]}\n` +
    `🎰 Tỉ lệ ăn: 1 : ${RATE}\n` +
    `⏱️ Cách xổ: ${triggerLabel === "auto" ? "Tự động sau 30s" : "Thủ công"}\n` +
    `📊 Cầu (${TX_HISTORY_LIMIT} ván): [ ${historyText || "-"} ]\n` +
    `────────────\n` +
    `🏆 Người thắng:\n${winnerLines.length > 0 ? winnerLines.join("\n") : "Không có"}\n` +
    `────────────\n` +
    `💸 Người thua:\n${loseLines.length > 0 ? loseLines.join("\n") : "Không có"}`;

  deleteBoard(active.threadKey);
  await sendWithContext(client, active, resultText, null);
}

function scheduleAutoRoll(client, board) {
  if (board.autoRollTimer) clearTimeout(board.autoRollTimer);
  board.autoRollTimer = setTimeout(async () => {
    const active = boards.get(board.threadKey);
    if (!active || active.rolling || active.players.size === 0) return;
    await rollBoard(client, active, "auto");
  }, AUTO_ROLL_MS);
}

async function placeBet({ client, message, type, choice, amountInput }) {
  const threadKey = getThreadKey(message.threadId);
  const board = boards.get(threadKey);
  if (!board) return false;
  if (board.rolling) {
    await sendWithContext(client, board, "❎ Bàn đang xổ, vui lòng chờ kết quả.", message.id);
    return true;
  }

  board.isE2EE = type === "E2EE Message";
  if (message.chatJid) board.chatJid = message.chatJid;

  const user = await getUser(message.senderId);
  const parsedAmount = parseBetAmount(amountInput, user.balance);

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    await sendWithContext(
      client,
      board,
      "❎ Tiền cược không hợp lệ. Hỗ trợ: số thường, allin/all, %, k/m/b.",
      message.id,
    );
    return true;
  }

  if (parsedAmount < BET_MIN) {
    await sendWithContext(client, board, `❎ Cược tối thiểu ${formatMoney(BET_MIN)}$.`, message.id);
    return true;
  }

  const senderId = String(message.senderId);
  const existingPlayer = board.players.get(senderId);
  let nextBalance = user.balance;

  if (existingPlayer) {
    nextBalance += existingPlayer.betAmount;
  }

  if (parsedAmount > nextBalance) {
    await sendWithContext(
      client,
      board,
      `❎ Bạn không đủ tiền. Số dư khả dụng: ${formatMoney(nextBalance)}$.`,
      message.id,
    );
    return true;
  }

  nextBalance -= parsedAmount;
  await updateUser(senderId, { balance: nextBalance });

  board.players.set(senderId, {
    id: senderId,
    select: choice,
    betAmount: parsedAmount,
    updatedAt: Date.now(),
  });

  if (board.players.size === 1) {
    scheduleAutoRoll(client, board);
    await sendWithContext(
      client,
      board,
      `✅ Đặt cược thành công ${SELECT_LABEL[choice]} ${formatMoney(parsedAmount)}$.\n💰 Số dư mới: ${formatMoney(nextBalance)}$.\n⏱️ Nếu chưa xổ thủ công, bàn sẽ tự xổ sau ${formatDuration(AUTO_ROLL_MS)}.`,
      message.id,
    );
  } else {
    await sendWithContext(
      client,
      board,
      existingPlayer
        ? `✅ Đã đổi cược sang ${SELECT_LABEL[choice]} ${formatMoney(parsedAmount)}$.\n💰 Số dư mới: ${formatMoney(nextBalance)}$.`
        : `✅ Đặt cược thành công ${SELECT_LABEL[choice]} ${formatMoney(parsedAmount)}$.\n💰 Số dư mới: ${formatMoney(nextBalance)}$.`,
      message.id,
    );
  }

  return true;
}

async function leaveBoard(client, message, type) {
  const threadKey = getThreadKey(message.threadId);
  const board = boards.get(threadKey);
  if (!board) return false;

  board.isE2EE = type === "E2EE Message";
  if (message.chatJid) board.chatJid = message.chatJid;

  const senderId = String(message.senderId);

  if (senderId === String(board.authorId)) {
    if (board.players.size > 0) {
      await refundAllPlayers(board);
    }
    deleteBoard(threadKey);
    await sendWithContext(
      client,
      board,
      "✅ Chủ bàn đã rời bàn. Bàn tài xỉu bị huỷ và hoàn tiền cho tất cả người chơi.",
      message.id,
    );
    return true;
  }

  const player = board.players.get(senderId);
  if (!player) {
    await sendWithContext(client, board, "❎ Bạn không có trong bàn tài xỉu.", message.id);
    return true;
  }

  const user = await getUser(senderId);
  await updateUser(senderId, { balance: user.balance + player.betAmount });
  board.players.delete(senderId);

  if (board.players.size === 0 && board.autoRollTimer) {
    clearTimeout(board.autoRollTimer);
    board.autoRollTimer = null;
  }

  await sendWithContext(
    client,
    board,
    `✅ Đã rời bàn và hoàn lại ${formatMoney(player.betAmount)}$.`,
    message.id,
  );
  return true;
}

function renderGuide(prefix) {
  return (
    `[ TÀI XỈU NHIỀU NGƯỜI ]\n` +
    `✏️ Tạo bàn: ${prefix}tx create\n` +
    `💸 Cược: tài/xỉu + [số_tiền/allin/%/k/m/b]\n` +
    `🔎 Xem bàn: infotx\n` +
    `🔗 Rời bàn: rời\n` +
    `🎲 Bắt đầu xổ: xổ (chủ bàn hoặc admin)\n` +
    `⏱️ Tự xổ sau 30s kể từ người cược đầu tiên\n` +
    `💵 Đơn vị: k = 1,000 | m = 1,000,000 | b = 1,000,000,000`
  );
}

export default {
  name: "tx",
  aliases: ["taixiu", "txiu"],
  description: "Tài xỉu nhiều người trong nhóm (create/cược/xổ/rời)",
  usages: "create | end | info | roll | leave",
  cooldowns: 1,

  execute: async ({ client, message, type, contentArgs, PREFIX: cmdPrefix, replyBot }) => {
    const prefix = cmdPrefix || PREFIX;
    const threadKey = getThreadKey(message.threadId);
    const threadId = message.threadId;
    const args = String(contentArgs || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const action = String(args[0] || "").toLowerCase();

    if (!action) {
      return replyBot(renderGuide(prefix));
    }

    if (["create", "c", "-c", "start"].includes(action)) {
      if (boards.has(threadKey)) {
        return replyBot("❎ Nhóm đã có bàn tài xỉu rồi.");
      }

      const senderId = String(message.senderId);
      const cooldownUntil = createCooldowns.get(senderId) || 0;
      if (cooldownUntil > Date.now()) {
        const remain = cooldownUntil - Date.now();
        return replyBot(
          `⚠️ Bạn vừa tạo bàn gần đây. Vui lòng chờ ${formatDuration(remain)} rồi thử lại.`,
        );
      }

      createCooldowns.set(senderId, Date.now() + CREATE_COOLDOWN_MS);

      const board = {
        threadKey,
        threadId,
        chatJid: message.chatJid || null,
        isE2EE: type === "E2EE Message",
        authorId: senderId,
        players: new Map(),
        rolling: false,
        createdAt: Date.now(),
        expireTimer: null,
        autoRollTimer: null,
      };

      boards.set(threadKey, board);
      scheduleBoardExpire(client, board);

      return replyBot(
        "✅ Tạo bàn tài xỉu thành công.\n" +
          "📌 Cách cược: tài/xỉu + số_tiền (vd: tài 50k)\n" +
          "📌 Xem bàn: infotx | Rời bàn: rời | Bắt đầu xổ: xổ",
      );
    }

    const board = boards.get(threadKey);
    if (!board) {
      return replyBot(`❎ Nhóm chưa có bàn tài xỉu. Dùng ${prefix}tx create để tạo.`);
    }

    board.isE2EE = type === "E2EE Message";
    if (message.chatJid) board.chatJid = message.chatJid;

    if (["info", "infotx", "status"].includes(action)) {
      await showBoardInfo(client, board, board, message.id);
      return;
    }

    if (["leave", "roi", "rời"].includes(action)) {
      await leaveBoard(client, message, type);
      return;
    }

    if (["roll", "xo", "xổ"].includes(action)) {
      const senderId = String(message.senderId);
      const canControl =
        senderId === String(board.authorId) || (await isAdminInThread(client, threadId, senderId));
      if (!canControl) {
        return replyBot("❎ Chỉ chủ bàn hoặc admin mới có quyền bắt đầu xổ.");
      }
      await rollBoard(client, board, "manual");
      return;
    }

    if (["end", "remove", "stop", "xoa", "xóa"].includes(action)) {
      const senderId = String(message.senderId);
      const canControl =
        senderId === String(board.authorId) || (await isAdminInThread(client, threadId, senderId));
      if (!canControl) {
        return replyBot("❎ Chỉ chủ bàn hoặc admin mới có quyền huỷ bàn.");
      }

      if (board.players.size > 0) {
        await refundAllPlayers(board);
      }
      deleteBoard(threadKey);
      return replyBot("✅ Đã huỷ bàn tài xỉu và hoàn tiền cho người đã cược.");
    }

    return replyBot(renderGuide(prefix));
  },

  handleEvent: async ({ client, message, type, text }) => {
    const threadKey = getThreadKey(message.threadId);
    const board = boards.get(threadKey);
    if (!board) return;

    const content = String(text || "").trim();
    if (!content || content.startsWith(PREFIX)) return;

    const parts = content.split(/\s+/);
    const command = String(parts[0] || "").toLowerCase();

    if (board.rolling) return;

    if (["infotx", "info"].includes(command)) {
      await showBoardInfo(client, board, board, message.id);
      return;
    }

    if (["rời", "roi", "leave"].includes(command)) {
      await leaveBoard(client, message, type);
      return;
    }

    if (["xổ", "xo", "roll"].includes(command)) {
      const senderId = String(message.senderId);
      const canControl =
        senderId === String(board.authorId) || (await isAdminInThread(client, message.threadId, senderId));
      if (!canControl) {
        await sendWithContext(client, board, "❎ Chỉ chủ bàn hoặc admin mới có quyền bắt đầu xổ.", message.id);
        return;
      }
      await rollBoard(client, board, "manual");
      return;
    }

    if (["end", "remove", "xoa", "xóa"].includes(command)) {
      const senderId = String(message.senderId);
      const canControl =
        senderId === String(board.authorId) || (await isAdminInThread(client, message.threadId, senderId));
      if (!canControl) {
        await sendWithContext(client, board, "❎ Chỉ chủ bàn hoặc admin mới có quyền huỷ bàn.", message.id);
        return;
      }
      if (board.players.size > 0) {
        await refundAllPlayers(board);
      }
      deleteBoard(threadKey);
      await sendWithContext(client, board, "✅ Đã huỷ bàn tài xỉu và hoàn tiền cho người đã cược.", message.id);
      return;
    }

    const choice = normalizeChoice(command);
    if (!choice) return;

    const amountInput = parts[1];
    if (!amountInput) return;

    await placeBet({
      client,
      message,
      type,
      choice,
      amountInput,
    });
  },
};
