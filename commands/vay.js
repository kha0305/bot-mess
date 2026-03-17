import { updateUser } from "../db.js";

const MIN_LOAN = 100;
const MAX_LOAN = 1000000000;
const INTEREST_RATE = 0.1; // 10%
const LOAN_COOLDOWN_MS = 10 * 60 * 1000; // 1 giờ

const UNITS = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
};

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function parseMoneyInput(rawInput, currentBalance = 0) {
  const raw = String(rawInput || "")
    .trim()
    .toLowerCase()
    .replace(/[,._\s]/g, "");
  if (!raw) return null;

  if (["all", "allin"].includes(raw)) {
    return Math.max(0, Math.floor(currentBalance));
  }

  const match = raw.match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!match) return null;

  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = String(match[2] || "").toLowerCase();
  const multi = unit ? UNITS[unit] : 1;
  return Math.floor(num * multi);
}

function buildUsage(prefix) {
  return (
    `💳 Cú pháp vay tiền:\n` +
    `• ${prefix}vay <số_tiền>\n` +
    `• ${prefix}vay tra <số_tiền|all>\n` +
    `• ${prefix}vay status\n\n` +
    `Ví dụ:\n` +
    `• ${prefix}vay 5000\n` +
    `• ${prefix}vay tra all`
  );
}

export default {
  name: "vay",
  aliases: ["loan", "no"],
  description: "Vay tiền, trả nợ và xem dư nợ",
  usages: "<số_tiền> | tra <số_tiền|all> | status",
  cooldowns: 2,

  execute: async ({ userData, contentArgs, PREFIX, replyBot }) => {
    const now = Date.now();
    const debt = Math.max(0, Number(userData.debt || 0));
    const balance = Math.max(0, Number(userData.balance || 0));
    const lastLoanAt = Math.max(0, Number(userData.lastLoanAt || 0));

    const raw = String(contentArgs || "").trim();
    if (!raw) {
      if (debt > 0) {
        return await replyBot(
          `💳 Bạn đang có khoản nợ: ${formatMoney(debt)}$.\n` +
            `💰 Số dư hiện tại: ${formatMoney(balance)}$.\n` +
            `Dùng ${PREFIX}vay tra <số_tiền|all> để trả nợ.`,
        );
      }
      return await replyBot(buildUsage(PREFIX));
    }

    const parts = raw.split(/\s+/).filter(Boolean);
    const sub = String(parts[0] || "").toLowerCase();

    if (["status", "info", "check"].includes(sub)) {
      if (debt <= 0) {
        return await replyBot(
          `✅ Bạn không có khoản nợ nào.\n💰 Số dư hiện tại: ${formatMoney(balance)}$.`,
        );
      }
      return await replyBot(
        `📌 DƯ NỢ HIỆN TẠI\n` +
          `• Nợ còn lại: ${formatMoney(debt)}$\n` +
          `• Số dư ví: ${formatMoney(balance)}$\n` +
          `• Trả nợ: ${PREFIX}vay tra <số_tiền|all>`,
      );
    }

    if (["tra", "pay", "repay"].includes(sub)) {
      if (debt <= 0) {
        return await replyBot("✅ Bạn không có nợ để trả.");
      }

      const amountInput = parts[1] || "";
      if (!amountInput) {
        return await replyBot(`⚠️ Cú pháp: ${PREFIX}vay tra <số_tiền|all>`);
      }

      let payAmount = parseMoneyInput(amountInput, balance);
      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        return await replyBot("⚠️ Số tiền trả nợ không hợp lệ.");
      }

      if (payAmount > balance) {
        return await replyBot(
          `❎ Bạn không đủ tiền để trả khoản đó.\n💰 Số dư hiện tại: ${formatMoney(balance)}$.`,
        );
      }

      payAmount = Math.min(payAmount, debt);
      const nextDebt = debt - payAmount;
      const nextBalance = balance - payAmount;

      await updateUser(userData.id, {
        debt: nextDebt,
        balance: nextBalance,
      });

      if (nextDebt <= 0) {
        return await replyBot(
          `✅ Bạn đã trả hết nợ!\n` +
            `• Đã trả: ${formatMoney(payAmount)}$\n` +
            `• Số dư mới: ${formatMoney(nextBalance)}$`,
        );
      }

      return await replyBot(
        `✅ Trả nợ thành công.\n` +
          `• Đã trả: ${formatMoney(payAmount)}$\n` +
          `• Nợ còn lại: ${formatMoney(nextDebt)}$\n` +
          `• Số dư mới: ${formatMoney(nextBalance)}$`,
      );
    }

    // Mặc định hiểu là /vay <số_tiền>
    if (debt > 0) {
      return await replyBot(
        `❎ Bạn còn nợ ${formatMoney(debt)}$ nên chưa thể vay thêm.\n` +
          `Dùng ${PREFIX}vay tra <số_tiền|all> để trả nợ trước.`,
      );
    }

    const cooldownLeft = LOAN_COOLDOWN_MS - (now - lastLoanAt);
    if (lastLoanAt > 0 && cooldownLeft > 0) {
      return await replyBot(
        `⏱️ Bạn vừa vay gần đây. Vui lòng chờ ${formatDuration(cooldownLeft)} để vay tiếp.`,
      );
    }

    const loanAmount = parseMoneyInput(raw, balance);
    if (!Number.isFinite(loanAmount) || loanAmount <= 0) {
      return await replyBot(buildUsage(PREFIX));
    }

    if (loanAmount < MIN_LOAN) {
      return await replyBot(
        `⚠️ Số tiền vay tối thiểu là ${formatMoney(MIN_LOAN)}$.`,
      );
    }
    if (loanAmount > MAX_LOAN) {
      return await replyBot(
        `⚠️ Số tiền vay tối đa mỗi lần là ${formatMoney(MAX_LOAN)}$.`,
      );
    }

    const totalDebt = Math.ceil(loanAmount * (1 + INTEREST_RATE));
    const nextBalance = balance + loanAmount;

    await updateUser(userData.id, {
      balance: nextBalance,
      debt: totalDebt,
      lastLoanAt: now,
    });

    return await replyBot(
      `✅ Vay thành công ${formatMoney(loanAmount)}$.\n` +
        `📌 Lãi suất: ${Math.round(INTEREST_RATE * 100)}%\n` +
        `💳 Tổng nợ cần trả: ${formatMoney(totalDebt)}$\n` +
        `💰 Số dư mới: ${formatMoney(nextBalance)}$\n` +
        `Trả nợ: ${PREFIX}vay tra <số_tiền|all>`,
    );
  },
};
