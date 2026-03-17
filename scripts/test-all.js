import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const ROOT = process.cwd();
const requireCjs = createRequire(import.meta.url);

const TARGET_DIRS = ["commands", "services", "utils", "scripts"];
const ROOT_FILES = ["index.js", "config.js", "db.js", "interactionDb.js", "migrate_apis.js"];
const VALID_EXTS = new Set([".js", ".cjs"]);
const LOAD_SKIP = new Set([
  "index.js",
  "migrate_apis.js",
  "scripts/backup-once.js",
  "scripts/test-all.js",
]);

function toRelative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function walkFiles(dirPath, output = []) {
  if (!fs.existsSync(dirPath)) return output;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, output);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!VALID_EXTS.has(path.extname(entry.name))) continue;
    output.push(path.resolve(fullPath));
  }
  return output;
}

function collectTargetFiles() {
  const found = new Set();

  for (const rootFile of ROOT_FILES) {
    const fullPath = path.resolve(ROOT, rootFile);
    if (fs.existsSync(fullPath)) {
      found.add(fullPath);
    }
  }

  for (const dirName of TARGET_DIRS) {
    const dirPath = path.resolve(ROOT, dirName);
    for (const filePath of walkFiles(dirPath)) {
      found.add(filePath);
    }
  }

  return [...found]
    .filter((filePath) => !toRelative(filePath).startsWith("node_modules/"))
    .sort((a, b) => toRelative(a).localeCompare(toRelative(b)));
}

function runSyntaxCheck(filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  if (result.status === 0) return null;

  return {
    type: "syntax",
    file: toRelative(filePath),
    message: (result.stderr || result.stdout || "Syntax check failed").trim(),
  };
}

async function runLoadCheck(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".cjs") {
      requireCjs(filePath);
    } else {
      await import(pathToFileURL(filePath).href);
    }
    return null;
  } catch (e) {
    const message = e?.stack || e?.message || String(e);
    return {
      type: "load",
      file: toRelative(filePath),
      message: String(message).trim(),
    };
  }
}

async function checkEsmCommands() {
  const commandDir = path.resolve(ROOT, "commands");
  if (!fs.existsSync(commandDir)) return [];

  const failures = [];
  const commandNames = new Map();
  const files = fs
    .readdirSync(commandDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(commandDir, entry.name))
    .sort((a, b) => toRelative(a).localeCompare(toRelative(b)));

  for (const filePath of files) {
    const rel = toRelative(filePath);
    try {
      const mod = await import(pathToFileURL(filePath).href);
      const cmd = mod?.default;
      if (!cmd || typeof cmd !== "object") {
        failures.push({
          type: "contract:esm-command",
          file: rel,
          message: "default export phải là object command",
        });
        continue;
      }

      const name = String(cmd.name || "").trim().toLowerCase();
      if (!name) {
        failures.push({
          type: "contract:esm-command",
          file: rel,
          message: "thiếu `name`",
        });
        continue;
      }

      if (commandNames.has(name)) {
        failures.push({
          type: "contract:esm-command",
          file: rel,
          message: `trùng command name với ${commandNames.get(name)}: ${name}`,
        });
      } else {
        commandNames.set(name, rel);
      }

      const hasHandler =
        typeof cmd.execute === "function" ||
        typeof cmd.handleEvent === "function" ||
        typeof cmd.handleReply === "function";

      if (!hasHandler) {
        failures.push({
          type: "contract:esm-command",
          file: rel,
          message: "thiếu handler (execute/handleEvent/handleReply)",
        });
      }
    } catch (e) {
      failures.push({
        type: "contract:esm-command",
        file: rel,
        message: e?.stack || e?.message || String(e),
      });
    }
  }

  return failures;
}

function checkCoreCommandsCjs() {
  const commandDir = path.resolve(ROOT, "utils", "commands");
  if (!fs.existsSync(commandDir)) return [];

  const failures = [];
  const files = fs
    .readdirSync(commandDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".cjs"))
    .map((entry) => path.join(commandDir, entry.name))
    .sort((a, b) => toRelative(a).localeCompare(toRelative(b)));

  for (const filePath of files) {
    const rel = toRelative(filePath);
    try {
      const mod = requireCjs(filePath);
      const cfg = mod?.config || mod?.default?.config;
      const run = mod?.run || mod?.default?.run;

      if (!cfg || typeof cfg !== "object") {
        failures.push({
          type: "contract:core-command",
          file: rel,
          message: "thiếu config object",
        });
        continue;
      }

      if (!String(cfg.name || "").trim()) {
        failures.push({
          type: "contract:core-command",
          file: rel,
          message: "config.name rỗng",
        });
      }

      if (typeof run !== "function") {
        failures.push({
          type: "contract:core-command",
          file: rel,
          message: "thiếu run()",
        });
      }
    } catch (e) {
      failures.push({
        type: "contract:core-command",
        file: rel,
        message: e?.stack || e?.message || String(e),
      });
    }
  }

  return failures;
}

function printSummary(section, total, failures) {
  const passed = total - failures.length;
  if (failures.length === 0) {
    console.log(`[PASS] ${section}: ${passed}/${total}`);
    return;
  }
  console.log(`[FAIL] ${section}: ${passed}/${total}`);
}

function printFailures(failures) {
  if (failures.length === 0) return;
  console.log("\nChi tiết lỗi:");
  failures.forEach((item, idx) => {
    const firstLine = String(item.message || "").split("\n").find(Boolean) || "Unknown error";
    console.log(`${idx + 1}. [${item.type}] ${item.file}`);
    console.log(`   ${firstLine}`);
  });
}

async function runRuntimeSmokeTests() {
  const failures = [];
  let total = 0;

  const fail = (name, message) => {
    failures.push({
      type: "smoke",
      file: `runtime:${name}`,
      message,
    });
  };

  let createMessageHandler;
  let pingCommand;
  try {
    ({ createMessageHandler } = await import(
      pathToFileURL(path.resolve(ROOT, "services", "bot", "messageHandler.js")).href
    ));
    ({ default: pingCommand } = await import(
      pathToFileURL(path.resolve(ROOT, "commands", "ping.js")).href
    ));
  } catch (e) {
    total = 1;
    fail(
      "bootstrap",
      `Không import được module runtime smoke: ${e?.message || e}`,
    );
    return { total, failures };
  }

  function createSmokeRuntime({ threadOverrides = {}, extraCommands = [] } = {}) {
    const sent = [];
    const threadState = {
      adminIDs: [],
      bannedThread: false,
      qtvOnly: false,
      expireAt: Date.now() + 60 * 60 * 1000,
      ...threadOverrides,
    };

    const commandsObj = new Map();
    commandsObj.set("ping", pingCommand);
    for (const cmd of extraCommands) {
      const name = String(cmd?.name || "").trim().toLowerCase();
      if (name) commandsObj.set(name, cmd);
    }

    const uniqueCommands = [...new Set(commandsObj.values())];
    const commandNames = uniqueCommands
      .map((cmd) => String(cmd?.name || "").trim().toLowerCase())
      .filter(Boolean)
      .sort();

    const client = {
      currentUserId: "999999999",
      async getUserInfo(uid) {
        return { name: `User ${String(uid)}` };
      },
      async sendMessage(threadId, payload, options = {}) {
        const text =
          typeof payload === "string"
            ? payload
            : String(payload?.text || payload?.body || "");
        sent.push({
          threadId: String(threadId),
          text,
          options,
        });
        const id = `smoke_${sent.length}`;
        return { messageId: id, messageID: id };
      },
      async sendE2EEMessage(chatJid, payload, options = {}) {
        const text =
          typeof payload === "string"
            ? payload
            : String(payload?.text || payload?.body || "");
        sent.push({
          threadId: String(chatJid || ""),
          text,
          options,
          e2ee: true,
        });
        const id = `smoke_e2ee_${sent.length}`;
        return { messageId: id, messageID: id };
      },
    };

    const handler = createMessageHandler({
      client,
      commandsObj,
      getUniqueCommands: () => uniqueCommands,
      getCommandNames: () => commandNames,
      coreBridge: null,
      resolveThreadAdminIds: async () => threadState.adminIDs || [],
      commandCooldowns: new Map(),
      prefix: "/",
      noPrefixCommands: new Set(["menu", "money"]),
      getUser: async (uid) => ({ id: String(uid), balance: 0 }),
      getThread: async () => ({ ...threadState }),
      updateThread: async (_threadId, updateFields = {}) => {
        Object.assign(threadState, updateFields || {});
      },
      addInteraction: () => {},
      getBannedReason: () => "",
      ensureBootstrapSuperAdmin: () => false,
      getCommandCategoryKey: () => "utility",
      getCommandPermission: (_commandName, commandObj) =>
        Number(commandObj?.hasPermssion ?? commandObj?.hasPermission ?? 0),
      getCategoryLabel: () => "Utility",
    });

    return {
      sent,
      run: async (text) => {
        await handler(
          {
            id: `msg_${Date.now()}`,
            senderId: "111111111",
            threadId: "222222222",
            text,
            attachments: [],
            mentions: [],
          },
          "Message",
        );
      },
    };
  }

  // Smoke 1: command thực thi được khi còn hạn thuê
  total += 1;
  try {
    const runtime = createSmokeRuntime({
      threadOverrides: { expireAt: Date.now() + 2 * 60 * 60 * 1000 },
    });
    await runtime.run("/ping");
    if (!runtime.sent.some((x) => String(x.text).includes("Pong!"))) {
      fail("execute-ping", "Không thấy phản hồi execute từ lệnh ping.");
    }
  } catch (e) {
    fail("execute-ping", e?.stack || e?.message || String(e));
  }

  // Smoke 2: lệnh sai chính tả có gợi ý
  total += 1;
  try {
    const runtime = createSmokeRuntime({
      threadOverrides: { expireAt: Date.now() + 2 * 60 * 60 * 1000 },
    });
    await runtime.run("/pi");
    const gotSuggestion = runtime.sent.some(
      (x) =>
        String(x.text).includes("Gợi ý") && String(x.text).includes("/ping"),
    );
    if (!gotSuggestion) {
      fail("suggestion", "Không có gợi ý command khi nhập sai tên lệnh.");
    }
  } catch (e) {
    fail("suggestion", e?.stack || e?.message || String(e));
  }

  // Smoke 3: command thường bị chặn khi hết hạn thuê
  total += 1;
  try {
    const runtime = createSmokeRuntime({ threadOverrides: { expireAt: 0 } });
    await runtime.run("/ping");
    const blockedByRent = runtime.sent.some((x) =>
      String(x.text).includes("chưa gia hạn Thuê Bot"),
    );
    if (!blockedByRent) {
      fail("rent-block", "Không chặn command thường khi nhóm đã hết hạn thuê bot.");
    }
  } catch (e) {
    fail("rent-block", e?.stack || e?.message || String(e));
  }

  // Smoke 4: command bypass (checkrent) vẫn chạy dù hết hạn
  total += 1;
  try {
    const runtime = createSmokeRuntime({
      threadOverrides: { expireAt: 0 },
      extraCommands: [
        {
          name: "checkrent",
          async execute({ replyBot }) {
            await replyBot("SMOKE_CHECKRENT_OK");
          },
        },
      ],
    });
    await runtime.run("/checkrent");
    const ok = runtime.sent.some((x) => String(x.text).includes("SMOKE_CHECKRENT_OK"));
    const blocked = runtime.sent.some((x) =>
      String(x.text).includes("chưa gia hạn Thuê Bot"),
    );
    if (!ok || blocked) {
      fail(
        "rent-bypass",
        "Command bypass checkrent không chạy đúng luồng khi hết hạn thuê bot.",
      );
    }
  } catch (e) {
    fail("rent-bypass", e?.stack || e?.message || String(e));
  }

  return { total, failures };
}

async function main() {
  const smokeOnly = process.argv.includes("--smoke-only");
  if (smokeOnly) {
    const smoke = await runRuntimeSmokeTests();
    console.log("== TEST SMOKE ==");
    printSummary("Runtime smoke", smoke.total, smoke.failures);
    printFailures(smoke.failures);
    if (smoke.failures.length > 0) process.exit(1);
    console.log("\nSmoke checks passed.");
    return;
  }

  const files = collectTargetFiles();
  const syntaxFailures = [];
  const loadFailures = [];

  for (const filePath of files) {
    const syntaxError = runSyntaxCheck(filePath);
    if (syntaxError) syntaxFailures.push(syntaxError);
  }

  for (const filePath of files) {
    const rel = toRelative(filePath);
    if (LOAD_SKIP.has(rel)) continue;
    const loadError = await runLoadCheck(filePath);
    if (loadError) loadFailures.push(loadError);
  }

  const esmContractFailures = await checkEsmCommands();
  const coreContractFailures = checkCoreCommandsCjs();
  const smokeResult = await runRuntimeSmokeTests();
  const allFailures = [
    ...syntaxFailures,
    ...loadFailures,
    ...esmContractFailures,
    ...coreContractFailures,
    ...smokeResult.failures,
  ];

  console.log("== TEST ALL ==");
  console.log(`Files scanned: ${files.length}`);
  printSummary("Syntax", files.length, syntaxFailures);
  const loadTargetCount = files.length - [...files].map(toRelative).filter((rel) => LOAD_SKIP.has(rel)).length;
  printSummary("Module load", loadTargetCount, loadFailures);

  const esmCount = fs.existsSync(path.resolve(ROOT, "commands"))
    ? fs.readdirSync(path.resolve(ROOT, "commands")).filter((f) => f.endsWith(".js")).length
    : 0;
  const coreCount = fs.existsSync(path.resolve(ROOT, "utils", "commands"))
    ? fs.readdirSync(path.resolve(ROOT, "utils", "commands")).filter((f) => f.endsWith(".cjs")).length
    : 0;
  printSummary("ESM command contract", esmCount, esmContractFailures);
  printSummary("Core command contract", coreCount, coreContractFailures);
  printSummary("Runtime smoke", smokeResult.total, smokeResult.failures);

  printFailures(allFailures);

  if (allFailures.length > 0) {
    process.exit(1);
  }

  console.log("\nAll checks passed.");
}

await main();
