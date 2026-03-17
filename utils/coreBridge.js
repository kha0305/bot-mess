import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { getBotRoles } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_ROOT = __dirname;
const CORE_COMMANDS_DIR = path.join(CORE_ROOT, "commands");
const CORE_ONLOAD_DIR = path.join(CORE_ROOT, "onload");

const CORE_ONLOAD_FILES = ["upload.cjs", "autoChecktt.cjs", "apiThanhToan.cjs"];
const CORE_SKIP_COMMANDS = new Set([
  "admin",
  "ban",
  "box",
  "check",
  "db",
  "help",
  "load",
  "qtvonly",
  "reset",
  "unban",
  "upt",
  "vd",
]);

function normalizeId(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toBigIntSafe(value) {
  try {
    const normalized = normalizeId(value);
    if (!normalized) return null;
    return BigInt(normalized);
  } catch {
    return null;
  }
}

function normalizeIdList(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((item) => normalizeId(item?.id ?? item)).filter(Boolean))];
}

function normalizeGender(raw) {
  const val = String(raw ?? "").toLowerCase();
  if (["1", "male", "nam"].includes(val)) return "MALE";
  if (["2", "female", "nu", "nữ"].includes(val)) return "FEMALE";
  return "NEUTER";
}

function ensureGlobalRoleConfig(prefix) {
  const roles = getBotRoles();
  const current = global.config && typeof global.config === "object" ? global.config : {};
  global.config = {
    ...current,
    prefix,
    admins: {
      superADMIN: [...roles.superADMIN],
      ADMIN: [...roles.ADMIN],
      NDH: [...roles.NDH],
    },
    BOTNAME: current.BOTNAME || "Bot Core",
    version: current.version || "bridge",
  };
  global.Data = global.Data || {};
}

function parseMentions(message) {
  const output = {};
  const text = String(message?.text || "");
  if (!Array.isArray(message?.mentions)) return output;

  for (const mention of message.mentions) {
    const uid = normalizeId(mention?.userId || mention?.id);
    if (!uid) continue;

    const offset = Number(mention?.offset ?? 0);
    const length = Number(mention?.length ?? 0);
    let tagText = "";
    if (Number.isFinite(offset) && Number.isFinite(length) && length > 0) {
      tagText = text.slice(offset, offset + length).trim();
    }
    output[uid] = tagText || `@${uid}`;
  }
  return output;
}

function toCoreReply(replyTo) {
  if (!replyTo) return null;
  const senderID = normalizeId(replyTo.senderId || replyTo.senderID);
  const messageID = normalizeId(replyTo.messageId || replyTo.messageID || replyTo.id);
  return {
    senderID,
    messageID,
    body: String(replyTo.text || replyTo.body || ""),
    attachments: Array.isArray(replyTo.attachments) ? replyTo.attachments : [],
  };
}

async function streamToBuffer(stream) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function getMimeByExt(filename) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4" || ext === ".mov" || ext === ".mkv") return "video/mp4";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".wav") return "audio/wav";
  return "application/octet-stream";
}

function getSendKind(filename, mimeType) {
  const mt = String(mimeType || "").toLowerCase();
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (mt.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
    return "image";
  }
  if (mt.startsWith("video/") || [".mp4", ".mov", ".mkv"].includes(ext)) {
    return "video";
  }
  if (mt.startsWith("audio/") || [".mp3", ".ogg", ".wav"].includes(ext)) {
    return "audio";
  }
  return "file";
}

function extractAttachmentFbId(raw) {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return BigInt(Math.trunc(raw));
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return BigInt(raw.trim());

  if (Array.isArray(raw)) {
    for (const candidate of raw) {
      const parsed = extractAttachmentFbId(candidate);
      if (parsed) return parsed;
    }
  }

  if (raw && typeof raw === "object") {
    const candidates = [raw.fbId, raw.fbid, raw.id, raw.attachmentFbId, raw.mediaId];
    for (const candidate of candidates) {
      const parsed = extractAttachmentFbId(candidate);
      if (parsed) return parsed;
    }
  }
  return null;
}

async function resolveAttachmentPayload(rawAttachment) {
  if (!rawAttachment) return null;
  if (Buffer.isBuffer(rawAttachment)) {
    return { buffer: rawAttachment, filename: `file_${Date.now()}.bin`, mimeType: "application/octet-stream" };
  }
  if (typeof rawAttachment === "string") {
    if (fs.existsSync(rawAttachment)) {
      const filename = path.basename(rawAttachment);
      return {
        buffer: fs.readFileSync(rawAttachment),
        filename,
        mimeType: getMimeByExt(filename),
      };
    }
    return null;
  }
  if (rawAttachment && typeof rawAttachment === "object") {
    if (Buffer.isBuffer(rawAttachment.data)) {
      const filename = rawAttachment.fileName || rawAttachment.filename || `file_${Date.now()}.bin`;
      return {
        buffer: rawAttachment.data,
        filename,
        mimeType: rawAttachment.mimeType || getMimeByExt(filename),
      };
    }

    if (typeof rawAttachment.path === "string" && fs.existsSync(rawAttachment.path)) {
      const filename = path.basename(rawAttachment.path);
      return {
        buffer: fs.readFileSync(rawAttachment.path),
        filename,
        mimeType: rawAttachment.mimeType || getMimeByExt(filename),
      };
    }

    if (typeof rawAttachment.pipe === "function") {
      const filename = rawAttachment.path ? path.basename(String(rawAttachment.path)) : `file_${Date.now()}.bin`;
      const buffer = await streamToBuffer(rawAttachment);
      return {
        buffer,
        filename,
        mimeType: rawAttachment.mimeType || getMimeByExt(filename),
      };
    }
  }
  return null;
}

function toSendMessageInfo(result) {
  if (!result) return null;
  return {
    ...result,
    messageID: result.messageID || result.messageId || "",
    messageId: result.messageId || result.messageID || "",
  };
}

export async function initCoreBridge({ client, commandsObj, prefix = "/" }) {
  if (!client || !(commandsObj instanceof Map)) return null;
  if (!fs.existsSync(CORE_ROOT) || !fs.existsSync(CORE_COMMANDS_DIR)) {
    console.warn("[CoreBridge] Không tìm thấy thư mục commands trong utils, bỏ qua tích hợp.");
    return null;
  }

  const requireCjs = createRequire(import.meta.url);
  ensureGlobalRoleConfig(prefix);

  global.client = global.client || {};
  global.client.handleReply = global.client.handleReply || [];
  global.client.handleReaction = global.client.handleReaction || [];
  global.client.events = global.client.events || new Map();
  global.Data = global.Data || {};

  let coreDb = null;
  const cachedNames = new Map();

  async function getUserName(uid) {
    const id = normalizeId(uid);
    if (!id) return "Người dùng Facebook";
    if (cachedNames.has(id)) return cachedNames.get(id);

    let resolved = `User ${id}`;
    try {
      const info = await client.getUserInfo(BigInt(id));
      if (info?.name) resolved = info.name;
    } catch {}

    cachedNames.set(id, resolved);
    return resolved;
  }

  async function updateGlobalThreadList() {
    if (!coreDb?.Threads?.getAll) return;
    try {
      const rows = await coreDb.Threads.getAll();
      global.Data.listThreads = (rows || [])
        .map((item) => normalizeId(item.threadID))
        .filter(Boolean);
    } catch {}
  }

  async function listParticipantIds(threadID) {
    const tid = normalizeId(threadID);
    if (!tid || !coreDb?.Membership) return [];
    try {
      if (typeof coreDb.Membership.hasMany === "function") {
        return normalizeIdList(await coreDb.Membership.hasMany(tid));
      }
      if (typeof coreDb.Membership.getData === "function") {
        const rows = await coreDb.Membership.getData(tid);
        return normalizeIdList((rows || []).map((item) => item.senderID));
      }
    } catch {}
    return [];
  }

  async function ensureThreadRecord(threadID, threadData = {}) {
    const tid = normalizeId(threadID);
    if (!tid || !coreDb?.Threads) return;

    let current = null;
    try {
      current = await coreDb.Threads.getData(tid);
    } catch {}

    const currentInfo = current?.threadInfo || {};
    const nextInfo = {
      threadID: tid,
      threadName: currentInfo.threadName || `Thread ${tid}`,
      isGroup: true,
      emoji: currentInfo.emoji ?? null,
      color: currentInfo.color || "",
      adminIDs: normalizeIdList(threadData.adminIDs || currentInfo.adminIDs || []),
      approvalMode: !!currentInfo.approvalMode,
      imageSrc: currentInfo.imageSrc || "",
      inviteLink: currentInfo.inviteLink || { enable: false, link: "" },
      nicknames: currentInfo.nicknames || {},
      userInfo: Array.isArray(currentInfo.userInfo) ? currentInfo.userInfo : [],
    };

    if (!current) {
      await coreDb.Threads.createData(tid, {
        threadInfo: nextInfo,
        data: { createdAt: Date.now() },
      });
      await updateGlobalThreadList();
      return;
    }

    await coreDb.Threads.setData(tid, {
      threadInfo: { ...currentInfo, ...nextInfo },
      data: current.data || {},
    });
  }

  async function ensureUserRecord(userID, nameHint = "") {
    const uid = normalizeId(userID);
    if (!uid || !coreDb?.Users || !coreDb?.Currencies) return;

    const name = nameHint || (await getUserName(uid));
    try {
      const exists = await coreDb.Users.hasData(uid);
      if (!exists) {
        await coreDb.Users.createData({
          [uid]: { name, gender: "NEUTER", data: {} },
        });
      } else {
        const current = await coreDb.Users.getData(uid);
        if (!current?.name || current.name !== name) {
          await coreDb.Users.setData(uid, { name, gender: current?.gender || normalizeGender(current?.gender) });
        }
      }
    } catch {}

    try {
      const cExists = await coreDb.Currencies.hasData(uid);
      if (!cExists) {
        await coreDb.Currencies.createData({
          [uid]: { money: 0, data: {} },
        });
      }
    } catch {}
  }

  async function ensureMembershipRecord(threadID, userID, nameHint = "") {
    const tid = normalizeId(threadID);
    const uid = normalizeId(userID);
    if (!tid || !uid || !coreDb?.Membership) return;

    const name = nameHint || (await getUserName(uid));
    try {
      const has = await coreDb.Membership.hasMember(tid, uid);
      if (!has?.exists) {
        await coreDb.Membership.createData({
          [tid]: {
            [uid]: name,
          },
        });
      } else if (!has.name || has.name !== name) {
        await coreDb.Membership.updateData({
          [tid]: {
            [uid]: { name },
          },
        });
      }
    } catch {}
  }

  async function toCoreEvent(message, threadData = null) {
    const threadID = normalizeId(message?.threadId);
    const senderID = normalizeId(message?.senderId);
    const participantIDs = await listParticipantIds(threadID);

    if (senderID && !participantIDs.includes(senderID)) {
      participantIDs.push(senderID);
    }

    return {
      type: message?.replyTo ? "message_reply" : "message",
      threadID,
      senderID,
      messageID: normalizeId(message?.id),
      body: String(message?.text || ""),
      mentions: parseMentions(message),
      participantIDs,
      attachments: Array.isArray(message?.attachments) ? message.attachments : [],
      messageReply: toCoreReply(message?.replyTo),
      isGroup: true,
      threadData: threadData || undefined,
    };
  }

  async function sendMessageAdapter(payload, threadID, callbackOrReplyTo, replyToMaybe) {
    const threadBigInt = toBigIntSafe(threadID);
    if (!threadBigInt) {
      const err = new Error(`threadID không hợp lệ: ${threadID}`);
      if (typeof callbackOrReplyTo === "function") callbackOrReplyTo(err);
      if (typeof replyToMaybe === "function") replyToMaybe(err);
      throw err;
    }

    const callback = typeof callbackOrReplyTo === "function"
      ? callbackOrReplyTo
      : typeof replyToMaybe === "function"
        ? replyToMaybe
        : null;

    const replyToId = (() => {
      if (typeof callbackOrReplyTo === "string" || typeof callbackOrReplyTo === "number" || typeof callbackOrReplyTo === "bigint") {
        return normalizeId(callbackOrReplyTo);
      }
      if (typeof replyToMaybe === "string" || typeof replyToMaybe === "number" || typeof replyToMaybe === "bigint") {
        return normalizeId(replyToMaybe);
      }
      return "";
    })();

    try {
      let result = null;

      if (typeof payload === "string") {
        result = await client.sendMessage(threadBigInt, {
          text: payload,
          ...(replyToId ? { replyToId } : {}),
        });
      } else if (payload && typeof payload === "object") {
        const body = String(payload.body || payload.text || "");
        const rawAttachments = payload.attachment || payload.attachments || null;
        const attachments = Array.isArray(rawAttachments)
          ? rawAttachments
          : rawAttachments
            ? [rawAttachments]
            : [];

        const attachmentFbIds = attachments
          .map((item) => extractAttachmentFbId(item))
          .filter((item) => item !== null);

        if (attachmentFbIds.length > 0) {
          result = await client.sendMessage(threadBigInt, {
            text: body || " ",
            attachmentFbIds,
            ...(replyToId ? { replyToId } : {}),
          });
        } else if (attachments.length > 0) {
          if (body) {
            result = await client.sendMessage(threadBigInt, {
              text: body,
              ...(replyToId ? { replyToId } : {}),
            });
          }

          for (let i = 0; i < attachments.length; i += 1) {
            const parsed = await resolveAttachmentPayload(attachments[i]);
            if (!parsed) continue;

            const filename = parsed.filename || `file_${Date.now()}.bin`;
            const mimeType = parsed.mimeType || getMimeByExt(filename);
            const sendKind = getSendKind(filename, mimeType);

            if (sendKind === "image" && typeof client.sendImage === "function") {
              result = await client.sendImage(threadBigInt, parsed.buffer, filename, replyToId ? { replyToId } : undefined);
            } else if (sendKind === "video" && typeof client.sendVideo === "function") {
              result = await client.sendVideo(threadBigInt, parsed.buffer, filename, replyToId ? { replyToId } : undefined);
            } else if (sendKind === "audio" && typeof client.sendVoice === "function") {
              result = await client.sendVoice(threadBigInt, parsed.buffer, filename, replyToId ? { replyToId } : undefined);
            } else if (typeof client.sendFile === "function") {
              result = await client.sendFile(
                threadBigInt,
                parsed.buffer,
                filename,
                mimeType,
                replyToId ? { replyToId } : undefined,
              );
            } else {
              result = await client.sendMessage(threadBigInt, {
                text: body || "[Attachment]",
                ...(replyToId ? { replyToId } : {}),
              });
            }
          }
        } else {
          result = await client.sendMessage(threadBigInt, {
            text: body,
            ...(replyToId ? { replyToId } : {}),
          });
        }
      } else {
        result = await client.sendMessage(threadBigInt, {
          text: String(payload ?? ""),
          ...(replyToId ? { replyToId } : {}),
        });
      }

      const info = toSendMessageInfo(result);
      if (callback) callback(null, info);
      return info;
    } catch (error) {
      if (callback) callback(error);
      throw error;
    }
  }

  async function getThreadInfoAdapter(threadID) {
    const tid = normalizeId(threadID);
    if (!tid) return null;

    const participants = await listParticipantIds(tid);
    let threadData = null;
    try {
      threadData = await coreDb?.Threads?.getData(tid);
    } catch {}
    const info = threadData?.threadInfo || {};

    const userInfo = [];
    for (const uid of participants) {
      const name = await getUserName(uid);
      userInfo.push({
        id: uid,
        name,
        gender: 0,
      });
    }

    return {
      ...info,
      threadID: tid,
      threadName: info.threadName || `Thread ${tid}`,
      isGroup: true,
      adminIDs: normalizeIdList(info.adminIDs || []),
      participantIDs: participants,
      userInfo,
    };
  }

  async function getUserInfoAdapter(userID) {
    const uid = normalizeId(userID);
    if (!uid) return {};

    let info = null;
    try {
      info = await client.getUserInfo(BigInt(uid));
    } catch {}

    const userInfo = {
      id: uid,
      name: info?.name || (await getUserName(uid)),
      firstName: info?.firstName || "",
      username: info?.username || "",
      gender: info?.gender || 0,
    };

    return { [uid]: userInfo };
  }

  const coreApi = {
    sendMessage: sendMessageAdapter,
    async getThreadInfo(threadID) {
      return await getThreadInfoAdapter(threadID);
    },
    async getUserInfo(userID) {
      return await getUserInfoAdapter(userID);
    },
    getCurrentUserID() {
      return normalizeId(client.currentUserId);
    },
    async removeUserFromGroup() {
      throw new Error("removeUserFromGroup chưa được hỗ trợ trên meta-messenger.js");
    },
  };

  try {
    const createCoreDb = requireCjs(path.join(CORE_ROOT, "database", "index.cjs"));
    coreDb = createCoreDb({ api: coreApi });
    await coreDb.init();
    await updateGlobalThreadList();
  } catch (error) {
    console.error("[CoreBridge] Không thể khởi tạo Core DB:", error);
    return null;
  }

  async function trackMessage(message, threadData = null, options = {}) {
    const threadID = normalizeId(message?.threadId);
    const senderID = normalizeId(message?.senderId);
    if (!threadID || !senderID) return;

    ensureGlobalRoleConfig(prefix);
    const senderName = await getUserName(senderID);
    await ensureUserRecord(senderID, senderName);
    await ensureThreadRecord(threadID, threadData || {});
    await ensureMembershipRecord(threadID, senderID, senderName);

    try {
      if (!options.skipAddCheck && typeof coreDb?.Membership?.addCheck === "function") {
        await coreDb.Membership.addCheck(threadID, senderID);
      }
    } catch {}
  }

  async function trackReaction(reactionEvent) {
    const threadID = normalizeId(reactionEvent?.threadId);
    const senderID = normalizeId(reactionEvent?.actorId || reactionEvent?.senderId);
    if (!threadID || !senderID) return;

    await ensureUserRecord(senderID);
    await ensureThreadRecord(threadID);
    await ensureMembershipRecord(threadID, senderID);

    try {
      if (typeof coreDb?.Membership?.react === "function") {
        await coreDb.Membership.react(threadID, senderID);
      }
    } catch {}
  }

  async function trackCommand(threadID, senderID) {
    const tid = normalizeId(threadID);
    const sid = normalizeId(senderID);
    if (!tid || !sid) return;
    try {
      if (typeof coreDb?.Membership?.cmd === "function") {
        await coreDb.Membership.cmd(tid, sid);
      }
    } catch {}
  }

  function attachLegacyAliasIfConflict(baseName) {
    const normalized = String(baseName || "").trim().toLowerCase();
    if (!normalized) return { hadConflict: false, legacyAlias: "" };
    if (!commandsObj.has(normalized)) return { hadConflict: false, legacyAlias: "" };

    const existing = commandsObj.get(normalized);
    const legacyAlias = `old_${normalized}`;
    if (!commandsObj.has(legacyAlias)) {
      commandsObj.set(legacyAlias, existing);
      if (existing && Array.isArray(existing.aliases) && !existing.aliases.includes(legacyAlias)) {
        existing.aliases.push(legacyAlias);
      }
    }
    return { hadConflict: true, legacyAlias };
  }

  function resolveCoreModule(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.run === "function" && raw.config) return raw;
    if (raw.default && typeof raw.default.run === "function" && raw.default.config) return raw.default;
    if (typeof raw === "function") return null;
    return raw;
  }

  function createCoreWrapper(moduleExport, filePath, registerName, originalName) {
    const baseConfig = moduleExport.config && typeof moduleExport.config === "object"
      ? { ...moduleExport.config }
      : {};
    baseConfig.name = registerName;

    moduleExport.config = baseConfig;

    const runFn = typeof moduleExport.run === "function" ? moduleExport.run : null;
    const replyFn = typeof moduleExport.handleReply === "function" ? moduleExport.handleReply : null;
    const eventFn = typeof moduleExport.handleEvent === "function" ? moduleExport.handleEvent : null;

    if (!runFn) return null;

    const command = {
      name: registerName,
      aliases: [],
      description: String(baseConfig.description || "").trim(),
      usages: String(baseConfig.usages || "").trim(),
      hasPermssion: Number(baseConfig.hasPermssion || 0),
      cooldowns: Number(baseConfig.cooldowns || 0),
      config: baseConfig,
      internalBridge: "core",
      coreSource: filePath,
      coreOriginalName: originalName,
      execute: async ({ message, args = [], contentArgs = "", threadData = null }) => {
        ensureGlobalRoleConfig(prefix);
        const coreEvent = await toCoreEvent(message, threadData);
        const parsedArgs = Array.isArray(args) && args.length > 0
          ? args
          : String(contentArgs || "").trim().split(/\s+/).filter(Boolean);

        return await runFn.call(moduleExport, {
          api: coreApi,
          event: coreEvent,
          args: parsedArgs,
          Users: coreDb.Users,
          Threads: coreDb.Threads,
          Membership: coreDb.Membership,
          Currencies: coreDb.Currencies,
        });
      },
    };

    if (replyFn) {
      command.handleReply = async ({ message, handleReply, threadData = null }) => {
        ensureGlobalRoleConfig(prefix);
        const coreEvent = await toCoreEvent(message, threadData);
        return await replyFn.call(moduleExport, {
          api: coreApi,
          event: coreEvent,
          handleReply,
          Users: coreDb.Users,
          Threads: coreDb.Threads,
          Membership: coreDb.Membership,
          Currencies: coreDb.Currencies,
        });
      };
    }

    if (eventFn) {
      command.handleEvent = async ({ message, threadData = null }) => {
        ensureGlobalRoleConfig(prefix);
        const coreEvent = await toCoreEvent(message, threadData);
        return await eventFn.call(moduleExport, {
          api: coreApi,
          event: coreEvent,
          Users: coreDb.Users,
          Threads: coreDb.Threads,
          Membership: coreDb.Membership,
          Currencies: coreDb.Currencies,
        });
      };
    }

    return command;
  }

  const loadedCoreCommands = [];
  const commandFiles = fs
    .readdirSync(CORE_COMMANDS_DIR)
    .filter((file) => file.endsWith(".cjs"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of commandFiles) {
    const fullPath = path.join(CORE_COMMANDS_DIR, file);
    try {
      const raw = requireCjs(fullPath);
      const moduleExport = resolveCoreModule(raw);
      const config = moduleExport?.config || null;
      const originalName = String(config?.name || "").trim().toLowerCase();
      if (!originalName) continue;
      if (CORE_SKIP_COMMANDS.has(originalName)) continue;

      const registerName = originalName;
      const { hadConflict } = attachLegacyAliasIfConflict(registerName);
      const wrapped = createCoreWrapper(moduleExport, fullPath, registerName, originalName);
      if (!wrapped) continue;

      const aliasCandidates = new Set();
      aliasCandidates.add(`core_${originalName}`);
      aliasCandidates.add(`r${originalName}`);
      aliasCandidates.add(`r_${originalName}`);
      if (hadConflict) aliasCandidates.add(`new_${originalName}`);

      if (Array.isArray(config?.aliases)) {
        for (const alias of config.aliases) {
          const normalized = String(alias || "").trim().toLowerCase();
          if (normalized && normalized !== registerName) aliasCandidates.add(normalized);
        }
      }

      wrapped.aliases = [];

      commandsObj.set(registerName, wrapped);
      for (const alias of aliasCandidates) {
        if (!alias || alias === registerName) continue;
        if (commandsObj.has(alias)) continue;
        commandsObj.set(alias, wrapped);
        wrapped.aliases.push(alias);
      }

      loadedCoreCommands.push({
        name: registerName,
        originalName,
        source: fullPath,
        replacedExisting: hadConflict,
        aliases: [...wrapped.aliases],
      });
    } catch (error) {
      console.error(`[CoreBridge] Lỗi load command ${file}:`, error);
    }
  }

  for (const onloadFile of CORE_ONLOAD_FILES) {
    const fullPath = path.join(CORE_ONLOAD_DIR, onloadFile);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const onloadModule = requireCjs(fullPath);
      const onloadFn = typeof onloadModule === "function"
        ? onloadModule
        : typeof onloadModule?.default === "function"
          ? onloadModule.default
          : null;
      if (!onloadFn) continue;
      onloadFn({ api: coreApi, db: coreDb });
    } catch (error) {
      console.error(`[CoreBridge] Lỗi khởi chạy onload ${onloadFile}:`, error);
    }
  }

  return {
    db: coreDb,
    api: coreApi,
    loadedCommands: loadedCoreCommands,
    trackMessage,
    trackReaction,
    trackCommand,
    toCoreEvent,
    refreshGlobalConfig: () => ensureGlobalRoleConfig(prefix),
  };
}
