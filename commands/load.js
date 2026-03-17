import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMMANDS_DIR = __dirname;

function normalizeName(raw) {
  return String(raw || "").trim().toLowerCase();
}

function listCommandFiles() {
  return fs
    .readdirSync(COMMANDS_DIR)
    .filter((file) => file.endsWith(".js"))
    .sort((a, b) => a.localeCompare(b));
}

async function importCommand(filePath) {
  const href = `${pathToFileURL(filePath).href}?v=${Date.now()}`;
  const mod = await import(href);
  const cmd = mod?.default;
  if (!cmd || typeof cmd !== "object") {
    throw new Error("Module không export default command object");
  }

  const name = normalizeName(cmd.name);
  if (!name) {
    throw new Error("Command thiếu name");
  }

  const aliases = Array.isArray(cmd.aliases)
    ? [...new Set(cmd.aliases.map((item) => normalizeName(item)).filter(Boolean).filter((item) => item !== name))]
    : [];
  cmd.name = name;
  cmd.aliases = aliases;
  return cmd;
}

function removeCommandFromMap(commandsMap, targetName) {
  const normalized = normalizeName(targetName);
  for (const [key, value] of [...commandsMap.entries()]) {
    const keyName = normalizeName(key);
    const valueName = normalizeName(value?.name);
    if (keyName === normalized || valueName === normalized) {
      commandsMap.delete(key);
    }
  }
}

function registerCommand(commandsMap, cmd) {
  removeCommandFromMap(commandsMap, cmd.name);
  commandsMap.set(cmd.name, cmd);
  for (const alias of cmd.aliases || []) {
    if (!commandsMap.has(alias)) {
      commandsMap.set(alias, cmd);
    }
  }
}

async function resolveCommandFile(rawName) {
  const normalized = normalizeName(rawName);
  if (!normalized) return "";

  const direct = path.join(COMMANDS_DIR, normalized.endsWith(".js") ? normalized : `${normalized}.js`);
  if (fs.existsSync(direct)) {
    return direct;
  }

  const files = listCommandFiles();
  for (const file of files) {
    const abs = path.join(COMMANDS_DIR, file);
    try {
      const cmd = await importCommand(abs);
      if (normalizeName(cmd.name) === normalized) {
        return abs;
      }
    } catch {}
  }
  return "";
}

async function reloadOne(rawName, commandsMap) {
  const file = await resolveCommandFile(rawName);
  if (!file) {
    return { ok: false, reason: `Không tìm thấy command "${rawName}" trong thư mục commands/` };
  }

  const cmd = await importCommand(file);
  registerCommand(commandsMap, cmd);
  return {
    ok: true,
    name: cmd.name,
    file: path.relative(process.cwd(), file),
    aliases: cmd.aliases || [],
  };
}

async function reloadAll(commandsMap) {
  const files = listCommandFiles();
  const ok = [];
  const fail = [];

  for (const file of files) {
    const abs = path.join(COMMANDS_DIR, file);
    try {
      const cmd = await importCommand(abs);
      registerCommand(commandsMap, cmd);
      ok.push({ file, name: cmd.name });
    } catch (error) {
      fail.push({ file, reason: String(error?.message || error) });
    }
  }

  return { ok, fail, total: files.length };
}

export default {
  name: "load",
  aliases: ["reload"],
  description: "Reload command runtime (ESM)",
  usages: "load <ten_lenh> | load cmd <ten_lenh> | load all",
  hasPermssion: 3,
  cooldowns: 0,

  execute: async ({ contentArgs, replyBot }) => {
    const args = String(contentArgs || "").trim().split(/\s+/).filter(Boolean);
    const commandsMap = global.client?.commands;
    if (!(commandsMap instanceof Map)) {
      await replyBot("❌ Command store chưa sẵn sàng.");
      return;
    }

    if (!args.length) {
      await replyBot("Dùng:\n• load <tên_lệnh>\n• load cmd <tên_lệnh>\n• load all");
      return;
    }

    const a0 = normalizeName(args[0]);
    if (a0 === "event" || (a0 === "all" && normalizeName(args[1]) === "event")) {
      await replyBot("⚠️ Phiên bản bot này không có module event riêng để load.");
      return;
    }

    if (a0 === "all") {
      const startedAt = Date.now();
      const res = await reloadAll(commandsMap);
      console.log(
        `[LOAD] Reload all commands: ${res.ok.length} ok, ${res.fail.length} lỗi, ${Date.now() - startedAt}ms`,
      );

      if (res.fail.length > 0) {
        const top = res.fail
          .slice(0, 5)
          .map((item) => `${item.file}: ${item.reason}`)
          .join("\n");
        await replyBot(
          `⚠️ Reload all xong: ${res.ok.length} OK, ${res.fail.length} lỗi.\n${top}\nXem console để biết thêm.`,
        );
        return;
      }

      await replyBot(`✅ Reload all thành công ${res.ok.length}/${res.total} command.`);
      return;
    }

    const rawName = a0 === "cmd" ? args.slice(1).join(" ").trim() : args.join(" ").trim();
    if (!rawName) {
      await replyBot("⚠️ Thiếu tên command. Ví dụ: load reset");
      return;
    }

    try {
      const startedAt = Date.now();
      const result = await reloadOne(rawName, commandsMap);
      if (!result.ok) {
        await replyBot(`❌ ${result.reason}`);
        return;
      }

      const aliasText = result.aliases.length > 0 ? `\nAlias: ${result.aliases.join(", ")}` : "";
      await replyBot(
        `✅ Reload OK: ${result.name} (${Date.now() - startedAt}ms)\nFile: ${result.file}${aliasText}`,
      );
    } catch (error) {
      await replyBot(`❌ Lỗi reload: ${String(error?.message || error)}`);
    }
  },
};
