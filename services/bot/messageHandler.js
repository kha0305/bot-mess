import { suggestCommands } from "./commandRegistry.js";
import {
  getCommandCooldownSeconds,
  formatRemainingCooldown,
  normalizeThreadBanConfig,
  resolveRoleState,
  hasPermissionLevel,
  getPermissionLabel,
} from "./permissionUtils.js";
import { collectReplyIds, normalizeId, sameIdSet } from "./idUtils.js";

const RENT_BYPASS_COMMANDS = new Set(["rentadd", "checkrent", "admin", "ban", "unban"]);
const ADMIN_ONLY_BYPASS_COMMANDS = new Set(["admin", "checkrent"]);
const VERBOSE_MESSAGE_LOG = String(process.env.BOT_VERBOSE_MESSAGE_LOG || "").toLowerCase() === "true";
const RESOLVE_SENDER_NAME_LOG = String(process.env.BOT_LOG_RESOLVE_SENDER_NAME || "").toLowerCase() === "true";
const BOT_DETAILED_LOG = String(process.env.BOT_DETAILED_LOG || "true").toLowerCase() !== "false";
const BOT_TRACE_MAX_TEXT = Math.max(40, Number(process.env.BOT_TRACE_MAX_TEXT || 180));
const SENDER_NAME_CACHE_TTL_MS = 10 * 60 * 1000;
const AUTO_VIDEO_TIMEOUT_MS = Math.max(3000, Number(process.env.BOT_AUTO_VIDEO_TIMEOUT_MS || 15000));
const AUTO_VIDEO_MAX_BYTES = Math.max(
  5 * 1024 * 1024,
  Number(process.env.BOT_AUTO_VIDEO_MAX_BYTES || 35 * 1024 * 1024),
);

function trimForLog(raw, maxLen = BOT_TRACE_MAX_TEXT) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function stringifyForLog(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return trimForLog(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const sample = value.slice(0, 6).map((item) => stringifyForLog(item));
    return `[${sample.join(", ")}${value.length > 6 ? ", ..." : ""}]`;
  }
  try {
    return trimForLog(JSON.stringify(value));
  } catch {
    return trimForLog(String(value));
  }
}

function traceLog(stage, details = {}) {
  if (!BOT_DETAILED_LOG) return;
  const pairs = Object.entries(details).map(([key, value]) => `${key}=${stringifyForLog(value)}`);
  const extra = pairs.length > 0 ? ` | ${pairs.join(" | ")}` : "";
  console.log(`[BOT TRACE] ${stage}${extra}`);
}

function roleLabel(roleState = {}) {
  if (roleState.isSuper) return "super";
  if (roleState.isAdmin) return "admin";
  if (roleState.isNdh) return "ndh";
  if (roleState.isThreadAdmin) return "thread_admin";
  return "member";
}

async function executeCommandCompat(commandToExec, runtimeContext = {}, coreBridge = null) {
  if (typeof commandToExec?.execute === "function") {
    return await commandToExec.execute(runtimeContext);
  }

  if (typeof commandToExec?.run === "function") {
    if (!coreBridge || !coreBridge.api || !coreBridge.db || typeof coreBridge.toCoreEvent !== "function") {
      throw new Error("Legacy command cần coreBridge để chạy (thiếu execute).");
    }

    const coreEvent = await coreBridge.toCoreEvent(runtimeContext.message, runtimeContext.threadData || null);
    return await commandToExec.run({
      api: coreBridge.api,
      event: coreEvent,
      args: Array.isArray(runtimeContext.args) ? runtimeContext.args : [],
      Users: coreBridge.db.Users,
      Threads: coreBridge.db.Threads,
      Membership: coreBridge.db.Membership,
      Currencies: coreBridge.db.Currencies,
    });
  }

  throw new Error("Command không có execute/run.");
}

export function createMessageHandler({
  client,
  commandsObj,
  getUniqueCommands,
  getCommandNames,
  coreBridge,
  resolveThreadAdminIds,
  commandCooldowns,
  prefix,
  noPrefixCommands,
  getUser,
  getThread,
  updateThread,
  addInteraction,
  getBannedReason,
  ensureBootstrapSuperAdmin,
  getCommandCategoryKey,
  getCommandPermission,
  getCategoryLabel,
}) {
  const senderNameCache = new Map();

  async function resolveSenderLabel(senderId) {
    const uid = String(senderId || "").trim();
    if (!uid) return "Unknown";
    if (!RESOLVE_SENDER_NAME_LOG) return uid;

    const cached = senderNameCache.get(uid);
    if (cached && Date.now() - cached.at < SENDER_NAME_CACHE_TTL_MS) {
      return `${cached.name} (${uid})`;
    }

    try {
      const info = await client.getUserInfo(BigInt(uid));
      const name = String(info?.name || "").trim();
      if (name) {
        senderNameCache.set(uid, { name, at: Date.now() });
        if (senderNameCache.size > 500) {
          const firstKey = senderNameCache.keys().next().value;
          if (firstKey) senderNameCache.delete(firstKey);
        }
        return `${name} (${uid})`;
      }
    } catch {}

    return uid;
  }

  return async function handleMessage(message, type) {
    if (message.senderId == client.currentUserId) return;

    const bootstrappedSuperAdmin = ensureBootstrapSuperAdmin(message.senderId);
    if (bootstrappedSuperAdmin) {
      console.log(`[ROLE] Đã bootstrap SuperAdmin đầu tiên: ${message.senderId}`);
    }

    const text = message.text?.trim() || "";
    traceLog("message.received", {
      type,
      messageId: message?.id || "",
      threadId: message?.threadId || message?.chatJid || "",
      senderId: message?.senderId || "",
      hasPrefix: text.startsWith(prefix),
      isReply: !!message.replyTo,
      text,
    });

    if (VERBOSE_MESSAGE_LOG) {
      console.log(`[BOT Debug] Có một cái tin nhảy vào đây này. Content = ${text}`);
    }

    if (text) {
      const senderLabel = await resolveSenderLabel(message.senderId);
      console.log(`[${type}] Nhận "${text}" từ ${senderLabel}`);
    }

    if (message.threadId) {
      addInteraction(message.threadId, message.senderId);
    }

    if (coreBridge) {
      try {
        await coreBridge.trackMessage(message, null, { skipAddCheck: true });
      } catch (e) {}
    }

    const replyBot = async (replyText) => {
      if (type === "E2EE Message" && message.chatJid) {
        return await client.sendE2EEMessage(message.chatJid, replyText, {
          replyToId: message.id,
        });
      }
      return await client.sendMessage(message.threadId, replyText, {
        replyToId: message.id,
      });
    };

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex);
    if (urls?.length) {
      traceLog("message.urls.detected", { count: urls.length, urls });
    }

    if (urls) {
      for (const url of urls) {
        if (
          url.includes("tiktok.com") ||
          url.includes("facebook.com") ||
          url.includes("fb.watch")
        ) {
          try {
            let videoUrl = null;
            console.log(`[BOT] Phát hiện link video chia sẻ: ${url}`);
            traceLog("autovideo.start", { sourceUrl: url });
            const axios = (await import("axios")).default;

            if (url.includes("tiktok.com")) {
              const res = await axios.get("https://www.tikwm.com/api/", {
                params: { url },
              });
              if (res.data?.data?.play) {
                videoUrl = res.data.data.play;
              }
            } else if (url.includes("facebook.com") || url.includes("fb.watch")) {
              const fbScrapper = await import("fb-downloader-scrapper");
              const res = await fbScrapper.getFbVideoInfo(url);
              if (res?.hd || res?.sd) {
                videoUrl = res.hd || res.sd;
              }
            }

            if (videoUrl) {
              traceLog("autovideo.resolved", { sourceUrl: url, mediaUrl: videoUrl });
              const headRes = await axios.head(videoUrl, { timeout: AUTO_VIDEO_TIMEOUT_MS }).catch(() => null);
              const contentLength = Number(headRes?.headers?.["content-length"] || 0);
              if (contentLength > AUTO_VIDEO_MAX_BYTES) {
                console.warn(
                  `[BOT] Bỏ qua auto-video vì quá nặng: ${(contentLength / 1024 / 1024).toFixed(2)}MB`,
                );
                traceLog("autovideo.skip.large_file", {
                  sourceUrl: url,
                  sizeMB: (contentLength / 1024 / 1024).toFixed(2),
                  limitMB: (AUTO_VIDEO_MAX_BYTES / 1024 / 1024).toFixed(2),
                });
                continue;
              }

              const response = await axios({
                url: videoUrl,
                method: "GET",
                responseType: "arraybuffer",
                timeout: AUTO_VIDEO_TIMEOUT_MS,
                maxContentLength: AUTO_VIDEO_MAX_BYTES,
                maxBodyLength: AUTO_VIDEO_MAX_BYTES,
              });
              const buffer = Buffer.from(response.data);
              if (type === "E2EE Message" && message.chatJid) {
                await client.sendE2EEVideo(message.chatJid, buffer, "video.mp4");
              } else {
                await client.sendVideo(message.threadId, buffer, "video.mp4");
              }
              traceLog("autovideo.sent", {
                sourceUrl: url,
                mediaUrl: videoUrl,
                sizeBytes: buffer.length,
                mode: type === "E2EE Message" ? "e2ee" : "normal",
              });
            } else {
              traceLog("autovideo.not_found", { sourceUrl: url });
            }
          } catch (e) {
            console.error("[BOT] Lỗi tải/gửi video:", e.message);
            traceLog("autovideo.error", {
              sourceUrl: url,
              code: e?.code || e?.cause?.code || "",
              message: e?.message || String(e),
            });
          }
        }
      }
    }

    let command = "";
    let contentArgs = "";
    let parsedArgs = [];

    if (message.replyTo && !text.startsWith(prefix)) {
      const replyIds = collectReplyIds(message.replyTo);
      traceLog("reply.scan", {
        replyToIds: replyIds,
        storeSize: Array.isArray(global.client.handleReply) ? global.client.handleReply.length : 0,
      });
      const replyData = (global.client.handleReply || []).find((item) => {
        const itemIds = [
          item.messageID,
          item.messageId,
          item.msgId,
          item.id,
        ]
          .map(normalizeId)
          .filter(Boolean);
        return itemIds.some((id) => replyIds.includes(id));
      });

      if (replyData) {
        traceLog("reply.matched", {
          command: replyData?.name || "",
          author: replyData?.author || "",
          replyType: replyData?.type || "",
        });
        const cmd = commandsObj.get(replyData.name);
        if (cmd && typeof cmd.handleReply === "function") {
          try {
            const replyUserData = await getUser(message.senderId);
            await cmd.handleReply({
              client,
              message,
              type,
              text,
              PREFIX: prefix,
              replyBot,
              handleReply: replyData,
              userData: replyUserData,
              contentArgs: text,
              args: text ? text.split(/\s+/).filter(Boolean) : [],
            });
            traceLog("reply.executed", { command: replyData?.name || "" });
            return;
          } catch (err) {
            console.error("Lỗi chạy handleReply:", err);
            traceLog("reply.error", {
              command: replyData?.name || "",
              message: err?.message || String(err),
            });
          }
        }
      }

      if (message.replyTo.senderId === client.currentUserId && !replyData) {
        const quickInput = text.toLowerCase();
        const isMenuMsg =
          !!message.replyTo.text &&
          (message.replyTo.text.includes("─────⭔") ||
            message.replyTo.text.toLowerCase().includes("danh mục menu") ||
            message.replyTo.text.toLowerCase().includes("danh muc menu"));
        if (isMenuMsg && ["1", "2", "3", "4", "all", "a"].includes(quickInput)) {
          command = "menu";
          contentArgs = quickInput;
          traceLog("command.quick_menu", { value: quickInput });
        }
      }
    }

    for (const cmd of getUniqueCommands()) {
      if (typeof cmd.handleEvent === "function") {
        try {
          await cmd.handleEvent({ client, message, type, text });
        } catch (err) {
          console.error("Lỗi chạy handleEvent:", err);
          traceLog("handleEvent.error", {
            command: cmd?.name || "",
            message: err?.message || String(err),
          });
        }
      }
    }

    const hasPrefix = text.startsWith(prefix);
    if (command === "") {
      const textTarget = hasPrefix ? text.slice(prefix.length).trim() : text.trim();
      const parts = textTarget ? textTarget.split(/\s+/) : [];
      const tempCmd = (parts.shift() || "").toLowerCase();

      if (commandsObj.has(tempCmd)) {
        if (hasPrefix || noPrefixCommands.has(tempCmd)) {
          command = tempCmd;
          parsedArgs = parts;
          traceLog("command.parsed", {
            command,
            hasPrefix,
            noPrefixAllowed: noPrefixCommands.has(tempCmd),
            argsCount: parsedArgs.length,
          });
        } else {
          traceLog("command.skip.no_prefix", { command: tempCmd });
          return;
        }
      } else if (hasPrefix) {
        command = tempCmd;
        parsedArgs = parts;
        traceLog("command.unknown.prefixed", { command, argsCount: parsedArgs.length });
      } else {
        traceLog("command.skip.not_command", { text });
        return;
      }
    }

    if (!command && hasPrefix) {
      traceLog("command.empty", { text });
      await replyBot(`⚠️ Bạn chưa nhập tên lệnh. Gõ ${prefix}menu để xem danh sách.`);
      return;
    }

    if (!(command === "ai" && !hasPrefix)) {
      const parsedContentArgs = parsedArgs.join(" ").trim();
      if (parsedContentArgs) {
        contentArgs = parsedContentArgs;
      }
    }

    if (hasPrefix && command && !commandsObj.has(command)) {
      const hints = suggestCommands(getCommandNames(), command);
      traceLog("command.not_found", { command, hints });
      if (hints.length > 0) {
        await replyBot(
          `⚠️ Lệnh [${command}] không tồn tại.\nGợi ý: ${hints.map((item) => `${prefix}${item}`).join(", ")}`,
        );
      } else {
        await replyBot(`⚠️ Lệnh [${command}] không tồn tại. Gõ ${prefix}menu để xem danh sách lệnh nha.`);
      }
      return;
    }

    try {
      const commandToExec = commandsObj.get(command);
      if (!commandToExec) {
        traceLog("command.resolve.fail", { command });
        if (hasPrefix) {
          await replyBot(`⚠️ Lệnh [${command}] không tồn tại. Gõ ${prefix}menu để xem danh sách lệnh nha.`);
        }
        return;
      }

      const userData = await getUser(message.senderId);
      const threadData = await getThread(message.threadId);
      const resolvedAdminIDs = await resolveThreadAdminIds(message.threadId, threadData.adminIDs || []);

      if (!sameIdSet(threadData.adminIDs || [], resolvedAdminIDs)) {
        threadData.adminIDs = resolvedAdminIDs;
        await updateThread(message.threadId, { adminIDs: resolvedAdminIDs });
      } else {
        threadData.adminIDs = resolvedAdminIDs;
      }

      if (coreBridge) {
        try {
          await coreBridge.trackMessage(message, { adminIDs: resolvedAdminIDs }, { skipAddCheck: true });
        } catch (e) {}
      }

      const roleState = resolveRoleState(message.senderId, resolvedAdminIDs);
      const commandName = String(commandToExec.name || command).toLowerCase();
      const commandCategoryKey = String(getCommandCategoryKey(commandName) || "").toLowerCase();
      const isCoreBridgeCommand =
        commandToExec?.internalBridge === "core" && !!commandToExec?.coreSource;
      const requiredPermission = isCoreBridgeCommand
        ? 0
        : getCommandPermission(commandName, commandToExec);
      const threadBanConfig = normalizeThreadBanConfig(threadData);
      traceLog("command.authorized.check_start", {
        command: commandName,
        senderId: message.senderId,
        threadId: message.threadId,
        role: roleLabel(roleState),
        permissionRequired: requiredPermission,
        category: commandCategoryKey || "unknown",
        isCoreBridgeCommand,
      });

      const banReason = getBannedReason(message.senderId);
      if (banReason && !roleState.isSuper) {
        traceLog("command.blocked.user_banned", {
          command: commandName,
          senderId: message.senderId,
          reason: banReason,
        });
        await replyBot(`[ CẢNH BÁO ]\nBạn đã bị cấm sử dụng bot vì lý do: ${banReason}.`);
        return;
      }

      if (threadData.bannedThread && !roleState.isSuper && commandName !== "unban") {
        traceLog("command.blocked.thread_banned", {
          command: commandName,
          threadId: message.threadId,
        });
        await replyBot("🚫 Nhóm này đang bị khóa bot. Liên hệ quản trị để được gỡ.");
        return;
      }

      if (!roleState.isSuper) {
        if (threadBanConfig.commands.includes(commandName)) {
          traceLog("command.blocked.by_thread_command_ban", {
            command: commandName,
            threadId: message.threadId,
          });
          await replyBot(`🚫 Lệnh ${prefix}${commandName} đang bị cấm trong nhóm này.`);
          return;
        }
        if (
          commandCategoryKey &&
          threadBanConfig.categories.includes(commandCategoryKey)
        ) {
          traceLog("command.blocked.by_thread_category_ban", {
            command: commandName,
            category: commandCategoryKey,
            threadId: message.threadId,
          });
          await replyBot(
            `🚫 Nhóm lệnh ${getCategoryLabel(commandCategoryKey)} đang bị cấm trong nhóm này.`,
          );
          return;
        }
      }

      if (!hasPermissionLevel(requiredPermission, roleState)) {
        traceLog("command.blocked.permission", {
          command: commandName,
          role: roleLabel(roleState),
          requiredPermission,
        });
        await replyBot(
          `⛔ Bạn chưa đủ quyền cho lệnh này.\nYêu cầu: ${getPermissionLabel(requiredPermission)}.`,
        );
        return;
      }

      const isRented = threadData.expireAt > Date.now();
      if (!isRented && !roleState.isSuper && !RENT_BYPASS_COMMANDS.has(commandName)) {
        traceLog("command.blocked.rent_expired", {
          command: commandName,
          threadId: message.threadId,
          expireAt: threadData.expireAt || 0,
        });
        await replyBot(`⚠️ Nhóm này chưa gia hạn Thuê Bot hoặc Đã Hết Hạn. Vui lòng liên hệ Admin đóng tiền và dùng lệnh ${prefix}rentadd <số ngày> để gia hạn nhé!`);
        return;
      }

      const isQtvOnly = !!threadData.qtvOnly;
      const adminIDs = threadData.adminIDs || [];

      if (isQtvOnly && commandToExec && commandToExec.name !== "checkrent") {
        const canBypassQtvOnly =
          adminIDs.includes(String(message.senderId)) ||
          roleState.isNdh ||
          roleState.isAdmin ||
          roleState.isSuper;

        if (!canBypassQtvOnly) {
          traceLog("command.blocked.qtv_only", {
            command: commandName,
            senderId: message.senderId,
            threadId: message.threadId,
          });
          await replyBot("⚠️ Nhóm đang BẬT chế độ QTVONLY. Chỉ Quản Trị Viên (Bot) mới có quyền sử dụng Bot lúc này!");
          return;
        }
      }

      const isAdminOnly = !!threadData.adminOnly;
      if (
        isAdminOnly &&
        !roleState.isNdh &&
        !roleState.isAdmin &&
        !roleState.isSuper &&
        !ADMIN_ONLY_BYPASS_COMMANDS.has(commandName)
      ) {
        traceLog("command.blocked.admin_only", {
          command: commandName,
          senderId: message.senderId,
          threadId: message.threadId,
        });
        await replyBot("⚠️ Nhóm đang BẬT chế độ ADMIN ONLY. Chỉ NDH/Admin/Super mới có quyền dùng bot.");
        return;
      }

      const cooldownSeconds = getCommandCooldownSeconds(commandToExec);
      const cooldownKey = `${message.senderId}:${commandToExec.name}`;
      const now = Date.now();

      if (cooldownSeconds > 0) {
        const lastUsed = commandCooldowns.get(cooldownKey) || 0;
        const remainingMs = cooldownSeconds * 1000 - (now - lastUsed);
        if (remainingMs > 0) {
          traceLog("command.blocked.cooldown", {
            command: commandName,
            senderId: message.senderId,
            remainingMs,
          });
          await replyBot(
            `⏱️ Lệnh ${prefix}${commandToExec.name} đang cooldown. Vui lòng chờ ${formatRemainingCooldown(remainingMs)}.`,
          );
          return;
        }
        commandCooldowns.set(cooldownKey, now);
      }

      try {
        const executeStartedAt = Date.now();
        traceLog("command.execute.start", {
          command: commandName,
          senderId: message.senderId,
          threadId: message.threadId,
          args: contentArgs,
        });
        await executeCommandCompat(commandToExec, {
          client,
          message,
          type,
          contentArgs,
          args: contentArgs ? contentArgs.split(/\s+/).filter(Boolean) : [],
          PREFIX: prefix,
          replyBot,
          userData,
          threadData,
          roles: roleState,
          commandMeta: {
            category: commandCategoryKey,
            categoryLabel: getCategoryLabel(commandCategoryKey),
            permission: requiredPermission,
          },
        }, coreBridge);
        traceLog("command.execute.success", {
          command: commandName,
          durationMs: Date.now() - executeStartedAt,
        });
      } catch (commandError) {
        if (cooldownSeconds > 0) {
          commandCooldowns.delete(cooldownKey);
        }
        traceLog("command.execute.error", {
          command: commandName,
          message: commandError?.message || String(commandError),
        });
        throw commandError;
      }
    } catch (error) {
      console.error("Lỗi thực thi lệnh:", error);
      traceLog("command.pipeline.error", {
        command,
        message: error?.message || String(error),
      });
      const errorMsg = String(error?.message || "Không rõ lỗi").trim();
      if (command && typeof replyBot === "function") {
        try {
          await replyBot(`❌ Lệnh ${prefix}${command} lỗi: ${errorMsg}`);
        } catch {}
      }
    }
  };
}
