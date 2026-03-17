export function normalizeId(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

export function extractIdValue(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "bigint") {
    return String(raw).trim();
  }
  if (typeof raw === "object") {
    const candidates = [
      raw.id,
      raw.userId,
      raw.uid,
      raw.fbId,
      raw.actorId,
      raw.targetId,
    ];
    for (const candidate of candidates) {
      if (candidate !== null && candidate !== undefined && String(candidate).trim() !== "") {
        return String(candidate).trim();
      }
    }
  }
  return "";
}

export function normalizeIdList(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map(extractIdValue).filter(Boolean))];
}

export function collectReplyIds(replyObj) {
  if (!replyObj) return [];
  return [
    replyObj.id,
    replyObj.messageId,
    replyObj.messageID,
    replyObj.mid,
    replyObj.msgId,
    replyObj.key?.id,
  ]
    .map(normalizeId)
    .filter(Boolean);
}

export function sameIdSet(a, b) {
  const left = normalizeIdList(a).sort();
  const right = normalizeIdList(b).sort();
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

