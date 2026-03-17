import { isSuperAdmin, isAdmin, isNdh } from "../../config.js";
import { normalizeIdList } from "./idUtils.js";

export function normalizeLowerList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
}

export function normalizeThreadBanConfig(threadData = {}) {
  const banned = (threadData && typeof threadData.banned === "object" && threadData.banned) || {};
  return {
    commands: normalizeLowerList(banned.commands || []),
    categories: normalizeLowerList(banned.categories || []),
  };
}

export function getPermissionLabel(permissionLevel) {
  const level = Number(permissionLevel) || 0;
  if (level === 0) return "Thanh vien";
  if (level === 1) return "QTV nhom / NDH / Admin";
  if (level === 2) return "NDH / Admin";
  if (level === 3) return "Admin";
  if (level === 4) return "SuperAdmin";
  return "Khong xac dinh";
}

export function resolveRoleState(senderId, threadAdminIds = []) {
  const sid = String(senderId || "");
  const threadAdminSet = new Set(normalizeIdList(threadAdminIds).map(String));
  const isSuper = isSuperAdmin(sid);
  const isBotAdmin = isAdmin(sid);
  const isOperator = isNdh(sid);
  const isThreadAdmin = threadAdminSet.has(sid);
  return {
    isSuper,
    isAdmin: isBotAdmin,
    isNdh: isOperator,
    isThreadAdmin,
  };
}

export function hasPermissionLevel(requiredPermission, roleState) {
  const level = Number(requiredPermission) || 0;
  if (level <= 0) return true;
  if (level === 1) {
    return (
      roleState.isThreadAdmin ||
      roleState.isNdh ||
      roleState.isAdmin ||
      roleState.isSuper
    );
  }
  if (level === 2) return roleState.isNdh || roleState.isAdmin || roleState.isSuper;
  if (level === 3) return roleState.isAdmin || roleState.isSuper;
  if (level >= 4) return roleState.isSuper;
  return false;
}

export function getCommandCooldownSeconds(command) {
  const raw = Number(command?.cooldowns ?? command?.cooldown ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

export function formatRemainingCooldown(ms) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

