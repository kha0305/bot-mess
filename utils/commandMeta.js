const CATEGORY_LABELS = {
  utility: "Thong Tin & Tien Ich",
  fun: "Tai Chinh & Giai Tri",
  group_admin: "Quan Tri Nhom",
  system: "He Thong",
  admin: "Admin",
};

const COMMAND_META = {
  ai: { category: "utility", permission: 0 },
  autosend: { category: "group_admin", permission: 1 },
  balance: { category: "fun", permission: 0 },
  bot: { category: "utility", permission: 0 },
  cave: { category: "fun", permission: 0 },
  check: { category: "utility", permission: 0 },
  checkrent: { category: "system", permission: 0 },
  choose: { category: "fun", permission: 0 },
  chuiadmin: { category: "group_admin", permission: 1 },
  chuidenchet: { category: "group_admin", permission: 1 },
  chuilientuc: { category: "group_admin", permission: 1 },
  add: { category: "group_admin", permission: 1 },
  daily: { category: "fun", permission: 0 },
  del: { category: "group_admin", permission: 1 },
  dhbc: { category: "fun", permission: 0 },
  dich: { category: "utility", permission: 0 },
  gai: { category: "fun", permission: 0 },
  hi: { category: "utility", permission: 0 },
  info: { category: "utility", permission: 0 },
  box: { category: "utility", permission: 0 },
  help: { category: "utility", permission: 0 },
  load: { category: "system", permission: 3 },
  math: { category: "utility", permission: 0 },
  menu: { category: "utility", permission: 0 },
  pay: { category: "fun", permission: 0 },
  ping: { category: "utility", permission: 0 },
  pinterest: { category: "fun", permission: 0 },
  qtv: { category: "group_admin", permission: 2 },
  qtvonly: { category: "group_admin", permission: 1 },
  rename: { category: "group_admin", permission: 1 },
  rentadd: { category: "system", permission: 1 },
  roll: { category: "fun", permission: 0 },
  setmoney: { category: "group_admin", permission: 2 },
  setunsend: { category: "group_admin", permission: 2 },
  sing: { category: "fun", permission: 0 },
  note: { category: "admin", permission: 3 },
  tx: { category: "fun", permission: 0 },
  uid: { category: "utility", permission: 0 },
  uptime: { category: "utility", permission: 0 },
  upt: { category: "system", permission: 3 },
  db: { category: "system", permission: 2 },
  reset: { category: "system", permission: 3 },
  vd: { category: "fun", permission: 0 },
  video: { category: "fun", permission: 0 },
  vay: { category: "fun", permission: 0 },
  work: { category: "fun", permission: 0 },
  ban: { category: "admin", permission: 1 },
  unban: { category: "admin", permission: 1 },
  admin: { category: "admin", permission: 4 },
};

const CATEGORY_ALIASES = {
  utility: "utility",
  info: "utility",
  tienich: "utility",
  "thongtin": "utility",
  "thong_tin": "utility",
  "thong-tin": "utility",
  fun: "fun",
  game: "fun",
  finance: "fun",
  "taichinh": "fun",
  "giai_tri": "fun",
  "giai-tri": "fun",
  group: "group_admin",
  groupadmin: "group_admin",
  qtri: "group_admin",
  "quantri": "group_admin",
  "quan_tri": "group_admin",
  "quan-tri": "group_admin",
  system: "system",
  sys: "system",
  "hethong": "system",
  "he_thong": "system",
  "he-thong": "system",
  admin: "admin",
};

function normalizeText(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeCommandName(rawName) {
  return normalizeText(rawName);
}

export function normalizeCategoryKey(rawCategory) {
  const key = normalizeText(rawCategory).replace(/[\s_-]+/g, "");
  if (!key) return "";
  return CATEGORY_ALIASES[key] || (CATEGORY_LABELS[key] ? key : "");
}

export function getCommandMeta(rawName) {
  const name = normalizeCommandName(rawName);
  return COMMAND_META[name] || { category: "utility", permission: 0 };
}

export function getCommandCategoryKey(rawName) {
  return getCommandMeta(rawName).category;
}

export function getCommandPermission(rawName, commandObj = null) {
  const explicit = Number(commandObj?.hasPermssion);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
  return Number(getCommandMeta(rawName).permission || 0);
}

export function getCategoryLabel(categoryKey) {
  const key = normalizeCategoryKey(categoryKey) || String(categoryKey || "");
  return CATEGORY_LABELS[key] || String(categoryKey || "Unknown");
}

export function listCategoryKeys() {
  return Object.keys(CATEGORY_LABELS);
}
