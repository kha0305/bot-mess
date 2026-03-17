import fs from "fs";
import {
  BOT_CONFIG_PATH,
  ensureDataLayout,
  ensureFileDirSync,
} from "./utils/dataPaths.js";

export const PREFIX = "/";
export let unsendEmojis = ["😡", "👎", "🗑️", "❌"];
const configPath = BOT_CONFIG_PATH;
const DEFAULT_ROLES = {
  superADMIN: parseEnvRoleList(process.env.BOT_SUPERADMINS),
  ADMIN: parseEnvRoleList(process.env.BOT_ADMINS),
  NDH: parseEnvRoleList(process.env.BOT_NDH),
};
let botRoles = normalizeRoles(DEFAULT_ROLES);

function parseEnvRoleList(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function normalizeIdList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeRoles(raw = {}) {
  const superADMIN = normalizeIdList(raw.superADMIN || raw.superAdmin || []);
  const adminRaw = normalizeIdList(raw.ADMIN || raw.admin || []);
  const ndhRaw = normalizeIdList(raw.NDH || raw.ndh || []);

  const superSet = new Set(superADMIN);
  const ADMIN = adminRaw.filter((id) => !superSet.has(id));
  const adminSet = new Set(ADMIN);
  const NDH = ndhRaw.filter((id) => !superSet.has(id) && !adminSet.has(id));

  return { superADMIN, ADMIN, NDH };
}

function hasAnyGlobalRole() {
  return (
    botRoles.superADMIN.length > 0 ||
    botRoles.ADMIN.length > 0 ||
    botRoles.NDH.length > 0
  );
}

function normalizeRoleKey(role) {
  const key = String(role || "").trim().toLowerCase();
  if (["super", "superadmin", "sa", "sadmin"].includes(key)) return "superADMIN";
  if (["admin", "ad"].includes(key)) return "ADMIN";
  if (["ndh", "mod", "operator"].includes(key)) return "NDH";
  return "";
}

function getConfigPayload() {
  return {
    unsendEmojis,
    botRoles,
  };
}

function loadConfig() {
  if (!fs.existsSync(configPath)) return;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.unsendEmojis) && parsed.unsendEmojis.length > 0) {
      unsendEmojis = parsed.unsendEmojis;
    }
    if (parsed.botRoles && typeof parsed.botRoles === "object") {
      botRoles = normalizeRoles(parsed.botRoles);
    }
  } catch (e) {
    console.error("[CONFIG] Không thể đọc bot_config.json:", e.message);
  }
}

function saveConfig() {
  try {
    ensureDataLayout();
    ensureFileDirSync(configPath);
    const tmpPath = `${configPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(getConfigPayload(), null, 2), "utf-8");
    fs.renameSync(tmpPath, configPath);
  } catch (e) {
    console.error("[CONFIG] Không thể lưu bot_config.json:", e.message);
  }
}

export function getUnsendEmojis() {
  return unsendEmojis;
}

export function setUnsendEmojis(newEmojis) {
  unsendEmojis = [...new Set(newEmojis.map((i) => String(i).trim()).filter(Boolean))];
  saveConfig();
}

export function getBotRoles() {
  return {
    superADMIN: [...botRoles.superADMIN],
    ADMIN: [...botRoles.ADMIN],
    NDH: [...botRoles.NDH],
  };
}

export function setBotRoles(nextRoles) {
  botRoles = normalizeRoles(nextRoles);
  saveConfig();
  return getBotRoles();
}

export function addBotRole(role, userId) {
  const roleKey = normalizeRoleKey(role);
  const uid = String(userId || "").trim();
  if (!roleKey || !uid) return { changed: false, roles: getBotRoles() };

  const next = getBotRoles();
  if (!next[roleKey].includes(uid)) {
    next[roleKey].push(uid);
  }
  const normalized = normalizeRoles(next);
  const changed = JSON.stringify(normalized) !== JSON.stringify(botRoles);
  botRoles = normalized;
  if (changed) saveConfig();
  return { changed, roles: getBotRoles() };
}

export function removeBotRole(role, userId) {
  const roleKey = normalizeRoleKey(role);
  const uid = String(userId || "").trim();
  if (!roleKey || !uid) return { changed: false, roles: getBotRoles() };

  const next = getBotRoles();
  next[roleKey] = next[roleKey].filter((id) => id !== uid);
  const normalized = normalizeRoles(next);
  const changed = JSON.stringify(normalized) !== JSON.stringify(botRoles);
  botRoles = normalized;
  if (changed) saveConfig();
  return { changed, roles: getBotRoles() };
}

export function isSuperAdmin(userId) {
  return botRoles.superADMIN.includes(String(userId || "").trim());
}

export function isAdmin(userId) {
  const uid = String(userId || "").trim();
  return isSuperAdmin(uid) || botRoles.ADMIN.includes(uid);
}

export function isNdh(userId) {
  const uid = String(userId || "").trim();
  return isAdmin(uid) || botRoles.NDH.includes(uid);
}

export function ensureBootstrapSuperAdmin(userId) {
  const uid = String(userId || "").trim();
  if (!uid || hasAnyGlobalRole()) return false;
  botRoles = normalizeRoles({
    ...botRoles,
    superADMIN: [...botRoles.superADMIN, uid],
  });
  saveConfig();
  return true;
}

export function roleLabel(role) {
  const roleKey = normalizeRoleKey(role);
  if (roleKey === "superADMIN") return "SuperAdmin";
  if (roleKey === "ADMIN") return "Admin";
  if (roleKey === "NDH") return "NDH";
  return "Unknown";
}

loadConfig();
