import fs from "fs";
import path from "path";

export const ROOT_DIR = path.resolve(process.cwd());
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const BACKUP_DIR = path.join(DATA_DIR, "backups");
export const CHECKTT_DIR = path.join(DATA_DIR, "checktt");
export const CORE_DATA_DIR = path.join(DATA_DIR, "core");

export const MAIN_DB_PATH = path.join(DATA_DIR, "database.sqlite");
export const CORE_DB_PATH = path.join(CORE_DATA_DIR, "data.sqlite");

export const RENT_DATA_PATH = path.join(DATA_DIR, "rent_data.json");
export const RENT_DATA_BAK_PATH = path.join(DATA_DIR, "rent_data.bak.json");
export const RENT_DATA_TMP_PATH = path.join(DATA_DIR, "rent_data.tmp.json");

export const USERS_MIRROR_PATH = path.join(DATA_DIR, "users.json");
export const USERS_MIRROR_BAK_PATH = path.join(DATA_DIR, "users.bak.json");
export const USERS_MIRROR_TMP_PATH = path.join(DATA_DIR, "users.tmp.json");
export const USERS_OLD_ARCHIVE_PATH = path.join(DATA_DIR, "users_old.json");

export const BOT_CONFIG_PATH = path.join(DATA_DIR, "bot_config.json");
export const BANNED_PATH = path.join(DATA_DIR, "banned.json");
export const TX_HISTORY_PATH = path.join(DATA_DIR, "tx_history.json");
export const THUE_BOT_PATH = path.join(DATA_DIR, "thueBot.json");
export const COOKIES_PATH = path.join(DATA_DIR, "cookies.json");
export const DEVICE_PATH = path.join(DATA_DIR, "device.json");
export const E2EE_DEVICE_PATH = path.join(DATA_DIR, "e2ee_device.json");

export function resolveDataPath(...parts) {
  return path.join(DATA_DIR, ...parts);
}

export function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function ensureFileDirSync(filePath) {
  ensureDirSync(path.dirname(path.resolve(filePath)));
}

export function ensureDataLayout() {
  ensureDirSync(DATA_DIR);
  ensureDirSync(BACKUP_DIR);
  ensureDirSync(CHECKTT_DIR);
  ensureDirSync(CORE_DATA_DIR);
}

