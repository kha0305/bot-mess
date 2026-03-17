import { Client, Utils } from "meta-messenger.js";
import { readFileSync, existsSync, writeFileSync } from "fs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getUser, initDb, getThread, updateThread, flushRuntimeData } from "../../db.js";
import {
  PREFIX,
  getUnsendEmojis,
  ensureBootstrapSuperAdmin,
} from "../../config.js";
import { initInteractionDb, addInteraction, flushAllInteraction } from "../../interactionDb.js";
import { getBannedReason } from "../../utils/banStore.js";
import {
  getCommandCategoryKey,
  getCommandPermission,
  getCategoryLabel,
} from "../../utils/commandMeta.js";
import { initCoreBridge } from "../../utils/coreBridge.js";
import {
  COOKIES_PATH,
  DEVICE_PATH,
  E2EE_DEVICE_PATH,
  ensureDataLayout,
  ensureFileDirSync,
} from "../../utils/dataPaths.js";
import {
  runDataBackup,
  startDataBackupScheduler,
  stopDataBackupScheduler,
} from "../../utils/backupManager.js";
import { loadCommandsFromDir, refreshCommandRegistry } from "./commandRegistry.js";
import { createThreadAdminResolver } from "./threadAdminResolver.js";
import { createMessageHandler } from "./messageHandler.js";
import { registerClientEvents } from "./eventRegistrar.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NO_PREFIX_COMMANDS = new Set(["menu", "money"]);
const AUTH_ERROR_PATTERNS = [
  /access token is no longer valid/i,
  /redirected to .*login\.php/i,
  /failed to load inbox/i,
  /user id in initial data is zero/i,
  /xs cookie was deleted/i,
];
const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);
const BOT_DETAILED_LOG = String(process.env.BOT_DETAILED_LOG || "true").toLowerCase() !== "false";
const BOT_TRACE_MAX_TEXT = Math.max(40, Number(process.env.BOT_TRACE_MAX_TEXT || 180));

function readEnvMs(name, fallback, min = 0) {
  const raw = process.env[name];
  const num = Number(raw);
  if (!Number.isFinite(num) || num < min) {
    return fallback;
  }
  return Math.floor(num);
}

const CONNECT_RETRY_MIN_MS = readEnvMs("BOT_CONNECT_RETRY_MIN_MS", 5000, 1000);
const CONNECT_RETRY_MAX_MS = Math.max(
  CONNECT_RETRY_MIN_MS,
  readEnvMs("BOT_CONNECT_RETRY_MAX_MS", 60000, CONNECT_RETRY_MIN_MS),
);
const CONNECTION_CHECK_INTERVAL_MS = Math.max(
  5000,
  readEnvMs("BOT_CONNECTION_CHECK_INTERVAL_MS", 15000, 5000),
);
const DISCONNECT_GRACE_MS = Math.max(
  CONNECTION_CHECK_INTERVAL_MS,
  readEnvMs("BOT_DISCONNECT_GRACE_MS", 30000, CONNECTION_CHECK_INTERVAL_MS),
);
const ALLOWED_LOG_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "none"]);

function resolveClientLogLevel() {
  const raw = String(process.env.BOT_LOG_LEVEL || "error").trim().toLowerCase();
  if (ALLOWED_LOG_LEVELS.has(raw)) {
    return raw;
  }
  return "error";
}

function isAuthCookieError(error) {
  const message = String(error?.message || error || "");
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function isNetworkError(error) {
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  if (NETWORK_ERROR_CODES.has(code)) return true;
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("temporary failure in name resolution") ||
    message.includes("socket hang up") ||
    message.includes("network")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCookiesFromFile(cookiePath) {
  const raw = readFileSync(cookiePath, "utf-8");
  const parsed = parseCookiesAnyFormat(raw);
  const normalized = normalizeCookieValues(parsed);
  const missing = Utils.getMissing(normalized);
  if (missing.length > 0) {
    throw new Error(`File cookies thiếu trường bắt buộc: ${missing.join(", ")}`);
  }
  return normalized;
}

function parseCookiesAnyFormat(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    throw new Error("File cookies rỗng");
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed);
      const converted = convertCookieArrayKeyToName(json);
      return Utils.parseCookies(converted);
    } catch {
      // Fallback: keep default parser behavior for non-JSON cookie formats.
    }
  }

  return Utils.parseCookies(raw);
}

function convertCookieArrayKeyToName(value) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }

    const name = item.name ?? item.key;
    if (typeof name !== "string" || name.length === 0) {
      return item;
    }

    return {
      ...item,
      name,
      value: item.value == null ? "" : String(item.value),
    };
  });
}

function normalizeCookieValues(cookies) {
  const normalized = {};
  for (const [key, value] of Object.entries(cookies || {})) {
    if (typeof value !== "string") {
      normalized[key] = value;
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed.includes("%")) {
      normalized[key] = trimmed;
      continue;
    }

    try {
      normalized[key] = decodeURIComponent(trimmed);
    } catch {
      normalized[key] = trimmed;
    }
  }
  return normalized;
}

function explainAuthFailure(error) {
  const message = String(error?.message || error || "");
  const lower = message.toLowerCase();
  if (lower.includes("xs cookie was deleted")) {
    return "Facebook đã xoá hiệu lực cookie xs của phiên hiện tại.";
  }
  if (lower.includes("user id in initial data is zero")) {
    return "Facebook trả về user id = 0 (thường là phiên chưa được xác thực hợp lệ).";
  }
  if (lower.includes("redirected to") && lower.includes("login.php")) {
    return "Phiên cookie bị chuyển hướng về trang đăng nhập.";
  }
  if (lower.includes("access token is no longer valid")) {
    return "Token phiên trong cookie đã không còn hợp lệ.";
  }
  return null;
}

function writeCookiesToFile(cookiePath, cookiesObject) {
  const payload = JSON.stringify(Utils.toCookieArray(cookiesObject), null, 2);
  ensureFileDirSync(cookiePath);
  const tmpPath = `${cookiePath}.tmp`;
  writeFileSync(tmpPath, payload, "utf-8");
  fs.renameSync(tmpPath, cookiePath);
}

export async function startBot() {
  async function flushRuntimeStores() {
    try {
      await flushRuntimeData();
    } catch (e) {}
    try {
      flushAllInteraction();
    } catch (e) {}
  }

  ensureDataLayout();
  await initDb();
  initInteractionDb();
  if (BOT_DETAILED_LOG) {
    console.log(`[SYSTEM] BOT_DETAILED_LOG=true | BOT_TRACE_MAX_TEXT=${BOT_TRACE_MAX_TEXT}`);
    console.log("[SYSTEM] Đang bật log chi tiết pipeline message/command/reaction.");
  }
  startDataBackupScheduler({ preBackup: flushRuntimeStores });
  await runDataBackup({ reason: "startup", preBackup: flushRuntimeStores });

  const commandsObj = new Map();
  const commandCooldowns = new Map();
  let coreBridge = null;

  const commandsDir = path.resolve(__dirname, "..", "..", "commands");
  await loadCommandsFromDir(commandsObj, commandsDir);

  let commandState = refreshCommandRegistry(commandsObj);

  const cookiePath = COOKIES_PATH;
  if (!existsSync(cookiePath)) {
    console.error("Lỗi: Không tìm thấy file cookies");
    process.exit(1);
  }

  let cookies;
  try {
    cookies = parseCookiesFromFile(cookiePath);
  } catch (error) {
    console.error(`[AUTH] Không thể đọc cookies: ${error?.message || String(error)}`);
    process.exit(1);
  }

  const legacyDevicePath = DEVICE_PATH;
  const deviceDataPath = existsSync(E2EE_DEVICE_PATH) ? E2EE_DEVICE_PATH : legacyDevicePath;
  const options = {
    enableE2EE: true,
    logLevel: resolveClientLogLevel(),
    e2eeMemoryOnly: false,
  };

  if (existsSync(deviceDataPath)) {
    try {
      console.log(`Tìm thấy ${path.basename(deviceDataPath)}, đang load...`);
      options.deviceData = readFileSync(deviceDataPath, "utf-8");
    } catch (e) {
      console.error(`Lỗi đọc ${path.basename(deviceDataPath)}:`, e);
    }
  }

  const client = new Client(cookies, options);

  global.client = client;
  global.client.handleReply = global.client.handleReply || [];
  global.client.handleReaction = global.client.handleReaction || [];
  global.client.commands = commandsObj;
  global.client.events = global.client.events || new Map();

  let shuttingDown = false;
  let reconnecting = false;
  let healthCheckTimer = null;
  let disconnectedSince = 0;

  function logAuthGuidance(error) {
    console.error("[AUTH] Cookie Facebook đã hết hạn hoặc không hợp lệ.");
    const reason = explainAuthFailure(error);
    if (reason) {
      console.error(`[AUTH] Chi tiết: ${reason}`);
    }
    console.error(`[AUTH] Lỗi gốc: ${error?.message || String(error)}`);
    console.error(`[AUTH] Hãy cập nhật lại file: ${cookiePath}`);
    console.error("[AUTH] Cần tối thiểu 2 cookie: c_user và xs (khuyến nghị thêm datr/fr/sb/wd).");
    console.error("[AUTH] Sau khi cập nhật cookies, chạy lại: npm start");
  }

  async function disconnectClientSafe() {
    try {
      if (client.handle) {
        await client.disconnect();
      }
    } catch (disconnectError) {
      console.warn("[SYSTEM] Cleanup kết nối thất bại:", disconnectError?.message || String(disconnectError));
    }
  }

  async function connectWithRetry(reason = "startup") {
    let attempt = 0;
    let delayMs = CONNECT_RETRY_MIN_MS;

    while (!shuttingDown) {
      attempt += 1;
      try {
        if (attempt === 1) {
          console.log(`[SYSTEM] Đang kết nối bot (${reason})...`);
        } else {
          console.log(`[SYSTEM] Đang kết nối lại (${reason}) lần ${attempt}...`);
        }
        await client.connect();
        disconnectedSince = 0;
        if (attempt > 1) {
          console.log(`[SYSTEM] Kết nối lại thành công (${reason}).`);
        }
        return;
      } catch (error) {
        if (isAuthCookieError(error)) {
          throw error;
        }

        const msg = error?.message || String(error);
        const tag = isNetworkError(error) ? "NETWORK" : "SYSTEM";
        const waitMs = Math.min(CONNECT_RETRY_MAX_MS, delayMs);
        console.error(`[${tag}] Kết nối thất bại (${reason}) lần ${attempt}: ${msg}`);
        console.log(`[SYSTEM] Thử lại sau ${Math.ceil(waitMs / 1000)} giây...`);

        await disconnectClientSafe();
        await sleep(waitMs);
        delayMs = Math.min(CONNECT_RETRY_MAX_MS, Math.floor(delayMs * 1.7));
      }
    }
  }

  async function ensureReconnect(reason = "watchdog") {
    if (shuttingDown || reconnecting) return;
    reconnecting = true;
    try {
      await disconnectClientSafe();
      await connectWithRetry(reason);
    } catch (error) {
      if (isAuthCookieError(error)) {
        logAuthGuidance(error);
        await gracefulShutdown("AUTH_ERROR", 1);
        return;
      }
      console.error("[SYSTEM] Reconnect thất bại:", error?.message || String(error));
    } finally {
      reconnecting = false;
    }
  }

  function startConnectionWatchdog() {
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }

    healthCheckTimer = setInterval(() => {
      if (shuttingDown || reconnecting) return;
      if (client.isConnected) {
        disconnectedSince = 0;
        return;
      }

      if (!disconnectedSince) {
        disconnectedSince = Date.now();
        return;
      }

      const downMs = Date.now() - disconnectedSince;
      if (downMs < DISCONNECT_GRACE_MS) return;
      console.warn(`[SYSTEM] Mất kết nối ${Math.ceil(downMs / 1000)}s, đang tự reconnect...`);
      void ensureReconnect("watchdog");
    }, CONNECTION_CHECK_INTERVAL_MS);

    if (typeof healthCheckTimer.unref === "function") {
      healthCheckTimer.unref();
    }
  }

  try {
    coreBridge = await initCoreBridge({
      client,
      commandsObj,
      prefix: PREFIX,
    });
    global.coreBridge = coreBridge;
    if (coreBridge?.loadedCommands?.length) {
      console.log(`[CoreBridge] Đã tích hợp ${coreBridge.loadedCommands.length} command mở rộng.`);
    }
  } catch (e) {
    global.coreBridge = null;
    console.error("[CoreBridge] Lỗi tích hợp:", e);
  }

  commandState = refreshCommandRegistry(commandsObj, global.client);
  const resolveThreadAdminIds = createThreadAdminResolver(client);

  const handleMessage = createMessageHandler({
    client,
    commandsObj,
    getUniqueCommands: () => commandState.uniqueCommands,
    getCommandNames: () => commandState.commandNames,
    coreBridge,
    resolveThreadAdminIds,
    commandCooldowns,
    prefix: PREFIX,
    noPrefixCommands: NO_PREFIX_COMMANDS,
    getUser,
    getThread,
    updateThread,
    addInteraction,
    getBannedReason,
    ensureBootstrapSuperAdmin,
    getCommandCategoryKey,
    getCommandPermission,
    getCategoryLabel,
  });

  registerClientEvents({
    client,
    handleMessage,
    coreBridge,
    getUnsendEmojis,
  });

  client.on("deviceDataChanged", ({ deviceData }) => {
    ensureFileDirSync(deviceDataPath);
    const tmpPath = `${deviceDataPath}.tmp`;
    writeFileSync(tmpPath, deviceData, "utf-8");
    fs.renameSync(tmpPath, deviceDataPath);
    console.log("-> Đã sao lưu bộ chìa khoá Session (Key) vào ổ cứng thành công!");
  });

  client.on("fullyReady", () => {
    console.log("✅ Bot đã load XONG!");
    disconnectedSince = 0;
    try {
      const refreshedCookies = client.getCookies();
      if (refreshedCookies && typeof refreshedCookies === "object") {
        writeCookiesToFile(cookiePath, refreshedCookies);
        console.log("[AUTH] Đã đồng bộ cookies mới từ session hiện tại.");
      }
    } catch (e) {
      console.warn("[AUTH] Không thể đồng bộ cookies mới:", e?.message || String(e));
    }
  });

  client.on("disconnected", (eventData = {}) => {
    if (shuttingDown) return;
    if (!disconnectedSince) {
      disconnectedSince = Date.now();
    }
    const reason = String(eventData?.reason || eventData?.message || "unknown");
    console.warn(`[SYSTEM] Socket disconnected: ${reason}`);
  });

  client.on("reconnected", () => {
    if (shuttingDown) return;
    disconnectedSince = 0;
    console.log("[SYSTEM] Socket đã reconnect.");
  });

  client.on("error", (error) => {
    if (shuttingDown) return;

    if (isAuthCookieError(error)) {
      logAuthGuidance(error);
      void gracefulShutdown("AUTH_ERROR", 1);
      return;
    }

    const message = String(error?.message || error || "");
    if (isNetworkError(error) || /not connected/i.test(message)) {
      console.warn(`[NETWORK] Client error: ${message}`);
      if (!disconnectedSince) {
        disconnectedSince = Date.now();
      }
      if (Date.now() - disconnectedSince >= DISCONNECT_GRACE_MS) {
        void ensureReconnect("client_error");
      }
      return;
    }

    console.error("[SYSTEM] Client error:", message);
  });

  async function gracefulShutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    reconnecting = false;
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }
    console.log(`[SYSTEM] Nhận ${signal}, đang flush dữ liệu và backup...`);
    try {
      await disconnectClientSafe();
      await flushRuntimeStores();
      await stopDataBackupScheduler({ finalBackup: true, preBackup: flushRuntimeStores });
    } catch (e) {
      console.error("[SYSTEM] Lỗi khi shutdown:", e);
    } finally {
      process.exit(exitCode);
    }
  }

  process.once("SIGINT", () => {
    gracefulShutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    gracefulShutdown("SIGTERM");
  });

  try {
    await connectWithRetry("startup");
    startConnectionWatchdog();
  } catch (error) {
    if (isAuthCookieError(error)) {
      logAuthGuidance(error);
    } else {
      console.error("[SYSTEM] Không thể kết nối bot:", error);
    }
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }

    try {
      await flushRuntimeStores();
      await stopDataBackupScheduler({ finalBackup: false, preBackup: flushRuntimeStores });
    } catch (shutdownError) {
      console.warn("[SYSTEM] Lỗi khi shutdown sau connect fail:", shutdownError?.message || String(shutdownError));
    }
    await disconnectClientSafe();

    process.exit(1);
  }
}
