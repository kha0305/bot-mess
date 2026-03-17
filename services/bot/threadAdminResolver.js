import { normalizeIdList } from "./idUtils.js";

const DEFAULT_TTL_MS = 60_000;

export function createThreadAdminResolver(client, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const cache = new Map();

  return async function resolveThreadAdminIds(threadId, fallbackAdminIds = []) {
    const threadKey = String(threadId);
    const now = Date.now();
    const fallbackIds = normalizeIdList(fallbackAdminIds);
    const cached = cache.get(threadKey);
    if (cached && now - cached.at < ttlMs) {
      // Không được để cache cũ ghi đè danh sách bot admin mới thêm.
      const mergedCached = normalizeIdList([...(cached.ids || []), ...fallbackIds]);
      if (mergedCached.length !== (cached.ids || []).length) {
        cache.set(threadKey, { ids: mergedCached, at: now });
      }
      return mergedCached;
    }

    let resolved = fallbackIds;
    try {
      if (typeof client.getThreadInfo === "function") {
        const info = await client.getThreadInfo(threadId);
        const realAdmins = normalizeIdList(info?.adminIds || []);
        if (realAdmins.length > 0) {
          // Gộp admin thật + admin bot đã cấu hình trong DB.
          resolved = normalizeIdList([...fallbackIds, ...realAdmins]);
        }
      }
    } catch (e) {}

    cache.set(threadKey, { ids: resolved, at: now });
    return resolved;
  };
}
