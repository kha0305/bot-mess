import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const requireCjs = createRequire(import.meta.url);
const CORE_COMMANDS_DIR = path.join(__dirname, "commands");
const moduleCache = new Map();

function getCoreModule(commandName) {
  const normalized = String(commandName || "").trim().toLowerCase();
  if (!normalized) return null;
  if (moduleCache.has(normalized)) return moduleCache.get(normalized);

  const modulePath = path.join(CORE_COMMANDS_DIR, `${normalized}.cjs`);
  if (!fs.existsSync(modulePath)) return null;

  const mod = requireCjs(modulePath);
  moduleCache.set(normalized, mod);
  return mod;
}

function parseConfigPermission(config = {}, fallback = 0) {
  const value = Number(config.hasPermssion ?? config.hasPermission ?? fallback);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function parseConfigCooldown(config = {}, fallback = 0) {
  const value = Number(config.cooldowns ?? config.cooldown ?? fallback);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function ensureCoreBridge() {
  const bridge = global.coreBridge || null;
  if (!bridge || !bridge.db || !bridge.api || typeof bridge.toCoreEvent !== "function") {
    throw new Error("Core bridge chưa sẵn sàng");
  }
  return bridge;
}

async function buildCoreContext(commandName, runtimeContext = {}) {
  const bridge = ensureCoreBridge();
  const moduleExport = getCoreModule(commandName);
  if (!moduleExport) {
    throw new Error(`Không tìm thấy core command: ${commandName}`);
  }

  const coreEvent = await bridge.toCoreEvent(runtimeContext.message, runtimeContext.threadData || null);
  const parsedArgs =
    Array.isArray(runtimeContext.args) && runtimeContext.args.length > 0
      ? runtimeContext.args
      : String(runtimeContext.contentArgs || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean);

  return {
    bridge,
    moduleExport,
    parsedArgs,
    coreEvent,
  };
}

export function createCoreLegacyCommand(commandName, fallbackMeta = {}) {
  const normalized = String(commandName || "").trim().toLowerCase();
  const moduleExport = getCoreModule(normalized);
  const config = (moduleExport && moduleExport.config && typeof moduleExport.config === "object")
    ? moduleExport.config
    : {};

  const command = {
    name: normalized,
    aliases: Array.isArray(fallbackMeta.aliases) ? fallbackMeta.aliases : [],
    description: String(config.description || fallbackMeta.description || "").trim(),
    usages: String(config.usages || fallbackMeta.usages || "").trim(),
    hasPermssion: parseConfigPermission(config, fallbackMeta.hasPermssion || 0),
    cooldowns: parseConfigCooldown(config, fallbackMeta.cooldowns || 0),
    internalBridge: "core",
    async execute(runtimeContext = {}) {
      const { bridge, moduleExport: mod, parsedArgs, coreEvent } = await buildCoreContext(normalized, runtimeContext);
      if (typeof mod?.run !== "function") {
        throw new Error(`Core command ${normalized} không có run()`);
      }

      return await mod.run({
        api: bridge.api,
        event: coreEvent,
        args: parsedArgs,
        Users: bridge.db.Users,
        Threads: bridge.db.Threads,
        Membership: bridge.db.Membership,
        Currencies: bridge.db.Currencies,
      });
    },
  };

  if (typeof moduleExport?.handleReply === "function") {
    command.handleReply = async (runtimeContext = {}) => {
      const { bridge, moduleExport: mod, coreEvent } = await buildCoreContext(normalized, runtimeContext);
      return await mod.handleReply({
        api: bridge.api,
        event: coreEvent,
        handleReply: runtimeContext.handleReply,
        Users: bridge.db.Users,
        Threads: bridge.db.Threads,
        Membership: bridge.db.Membership,
        Currencies: bridge.db.Currencies,
      });
    };
  }

  if (typeof moduleExport?.handleEvent === "function") {
    command.handleEvent = async (runtimeContext = {}) => {
      const { bridge, moduleExport: mod, coreEvent } = await buildCoreContext(normalized, runtimeContext);
      return await mod.handleEvent({
        api: bridge.api,
        event: coreEvent,
        Users: bridge.db.Users,
        Threads: bridge.db.Threads,
        Membership: bridge.db.Membership,
        Currencies: bridge.db.Currencies,
      });
    };
  }

  return command;
}

