"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

function safeRequire(name) {
  try {
    return require(name);
  } catch (e) {
    return null;
  }
}

const express = safeRequire("express");
const PayOS = safeRequire("@payos/node");
const PAYOS_ENABLED = String(process.env.PAYOS_ENABLED || "false").toLowerCase() === "true";

const DEFAULT_FILE = path.join(process.cwd(), "data", "thueBot.json");
const RENT_FILE = path.join(process.cwd(), "data", "rent_data.json");
const RENT_BAK_FILE = path.join(process.cwd(), "data", "rent_data.bak.json");
const RENT_TMP_FILE = path.join(process.cwd(), "data", "rent_data.tmp.json");
const FILE_TLB =
  typeof global.dataFileThueBot === "string" && global.dataFileThueBot.trim()
    ? global.dataFileThueBot
    : DEFAULT_FILE;
let dbFnsPromise = null;

function ensureStoreFile() {
  fs.mkdirSync(path.dirname(FILE_TLB), { recursive: true });
  if (!fs.existsSync(FILE_TLB)) fs.writeFileSync(FILE_TLB, "[]", "utf8");
}

function loadStore() {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(FILE_TLB, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveStore(data) {
  ensureStoreFile();
  const tmpPath = `${FILE_TLB}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(Array.isArray(data) ? data : [], null, 2), "utf8");
  fs.renameSync(tmpPath, FILE_TLB);
}

function parseJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeThreadRent(threadID, raw) {
  const base = raw && typeof raw === "object" ? raw : {};
  const expireAt = Number(base.expireAt);
  return {
    ...base,
    id: String(base.id || threadID),
    expireAt: Number.isFinite(expireAt) && expireAt > 0 ? Math.trunc(expireAt) : 0,
  };
}

function loadRentStore() {
  const direct = parseJsonSafe(RENT_FILE);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  const backup = parseJsonSafe(RENT_BAK_FILE);
  if (backup && typeof backup === "object" && !Array.isArray(backup)) return backup;
  return {};
}

function saveRentStore(store) {
  fs.mkdirSync(path.dirname(RENT_FILE), { recursive: true });
  if (fs.existsSync(RENT_FILE)) {
    try {
      fs.copyFileSync(RENT_FILE, RENT_BAK_FILE);
    } catch (e) {}
  }
  fs.writeFileSync(RENT_TMP_FILE, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(RENT_TMP_FILE, RENT_FILE);
}

async function resolveDbFns() {
  if (dbFnsPromise !== null) return dbFnsPromise;
  dbFnsPromise = import(pathToFileURL(path.join(process.cwd(), "db.js")).href)
    .then((mod) => {
      if (typeof mod?.getThread === "function" && typeof mod?.updateThread === "function") {
        return { getThread: mod.getThread, updateThread: mod.updateThread };
      }
      return null;
    })
    .catch(() => null);
  return dbFnsPromise;
}

async function extendRentExpireAt(threadID, durationMs, paidAt) {
  const tid = String(threadID || "").trim();
  if (!tid) return { updated: false, expireAt: Math.trunc(paidAt + durationMs) };

  const dbFns = await resolveDbFns();
  if (dbFns?.getThread && dbFns?.updateThread) {
    const current = await dbFns.getThread(tid);
    const currentExpire = Number(current?.expireAt) || 0;
    const base = currentExpire > paidAt ? currentExpire : paidAt;
    const nextExpire = Math.trunc(base + durationMs);
    await dbFns.updateThread(tid, { expireAt: nextExpire });
    return { updated: true, expireAt: nextExpire };
  }

  const store = loadRentStore();
  const current = normalizeThreadRent(tid, store[tid]);
  const previousExpire = Number(current.expireAt) || 0;
  const base = previousExpire > paidAt ? previousExpire : paidAt;
  const nextExpire = Math.trunc(base + durationMs);

  current.expireAt = nextExpire;
  store[tid] = current;
  saveRentStore(store);
  return { updated: true, expireAt: nextExpire };
}

module.exports = ({ api }) => {
  if (!PAYOS_ENABLED) {
    global.payoss = false;
    return;
  }

  if (!express) {
    global.payoss = false;
    console.warn("[PayOS] Thiếu module express, bỏ qua khởi động API thanh toán.");
    return;
  }
  if (!PayOS) {
    global.payoss = false;
    console.warn("[PayOS] Thiếu module @payos/node, bỏ qua khởi động API thanh toán.");
    return;
  }

  const clientId = process.env.PAYOS_CLIENT_ID || "";
  const apiKey = process.env.PAYOS_API_KEY || "";
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY || "";
  if (!clientId || !apiKey || !checksumKey) {
    global.payoss = false;
    console.warn("[PayOS] Thiếu biến môi trường PAYOS_CLIENT_ID / PAYOS_API_KEY / PAYOS_CHECKSUM_KEY, bỏ qua module.");
    return;
  }

  const app = express();
  app.use(express.json());

  global.fileThueBot = FILE_TLB;
  global.thueBotData = loadStore();
  global.PORTS = Number(process.env.PAYOS_PORT || 2000);
  global.localIPSSS =
    Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address || "127.0.0.1";
  global.payoss = true;

  let payosClient;
  try {
    payosClient = new PayOS.PayOS({
      clientId,
      apiKey,
      checksumKey,
    });
  } catch (e) {
    console.error("[PayOS] Khởi tạo client lỗi:", e.message);
    global.payoss = false;
    return;
  }

  app.get("/pay", async (req, res) => {
    try {
      const orderCode = parseInt(req.query.orderCode, 10) || Math.floor(Date.now() / 1000);
      const amount = parseInt(req.query.amount, 10);
      const t_id = req.query.t_id || null;
      if (!amount || !t_id) {
        return res.status(400).json({ error: "Thiếu amount hoặc t_id" });
      }

      const { checkoutUrl } = await payosClient.paymentRequests.create({
        orderCode,
        amount,
        description: req.query.message || "Thanh toán thuê bot",
        returnUrl: `http://${global.localIPSSS}:${global.PORTS}/success?orderCode=${orderCode}`,
        cancelUrl: `http://${global.localIPSSS}:${global.PORTS}/cancel?orderCode=${orderCode}`,
      });

      const item = {
        t_id: String(t_id),
        status: "PENDING",
        orderCode,
        amount,
        createdAt: Date.now(),
      };
      global.thueBotData.push(item);
      saveStore(global.thueBotData);

      return res.json({ checkoutUrl, orderCode });
    } catch (e) {
      console.error("[PayOS] Lỗi tạo link:", e.message);
      return res.status(500).json({ error: "Không thể tạo link thanh toán" });
    }
  });

  setInterval(async () => {
    try {
      const now = Date.now();
      const rentDuration = 30 * 86400 * 1000;
      let changed = false;

      if (!Array.isArray(global.thueBotData)) global.thueBotData = [];

      for (let i = global.thueBotData.length - 1; i >= 0; i -= 1) {
        const item = global.thueBotData[i];
        if (!item || item.status !== "PENDING") continue;

        if (now - Number(item.createdAt || 0) > 600000) {
          global.thueBotData.splice(i, 1);
          changed = true;
          continue;
        }

        let info;
        try {
          info = await payosClient.paymentRequests.get(item.orderCode);
        } catch (e) {
          continue;
        }
        if (!info || !["PAID", "SUCCEEDED"].includes(String(info.status || "").toUpperCase())) continue;

        const paidAt = Date.now();
        let rentSync = { updated: false, expireAt: Math.trunc(paidAt + rentDuration) };
        try {
          rentSync = await extendRentExpireAt(item.t_id, rentDuration, paidAt);
        } catch (e) {
          console.error("[PayOS] Lỗi đồng bộ rent_data:", e.message);
        }

        global.thueBotData[i] = {
          t_id: item.t_id,
          status: "PAID",
          orderCode: item.orderCode,
          amount: item.amount,
          paidAt,
          startDate: paidAt,
          expireDate: rentSync.expireAt,
        };
        changed = true;

        try {
          const body =
            "✅ ĐÃ THANH TOÁN THÀNH CÔNG!\n" +
            `📅 Gói thuê: 30 ngày\n` +
            `🕒 Bắt đầu: ${new Date(paidAt).toLocaleString("vi-VN")}\n` +
            `⏰ Hết hạn: ${new Date(rentSync.expireAt).toLocaleString("vi-VN")}\n` +
            `• Mã đơn: ${info.orderCode}\n` +
            `• Trạng thái: ${info.status}\n` +
            `• Số tiền: ${Number(info.amount || item.amount || 0).toLocaleString("vi-VN")} VNĐ` +
            `\n• Đồng bộ thuê bot: ${rentSync.updated ? "OK" : "Không rõ thread"}`;
          await api.sendMessage(body, item.t_id);
        } catch (e) {
          console.warn("[PayOS] Không gửi được thông báo vào thread", item.t_id, e.message);
        }
      }

      if (changed) saveStore(global.thueBotData);
    } catch (e) {
      console.error("[PayOS] Lỗi vòng lặp kiểm tra:", e.message);
    }
  }, 5000).unref();

  app.listen(global.PORTS, () => {
    console.log(`[PayOS] API thanh toán chạy tại cổng ${global.PORTS}`);
  });
};
