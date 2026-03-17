"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = process.cwd();
const CORE_ROOT = path.resolve(__dirname, "..");
const DIR_CMDS = path.join(CORE_ROOT, "commands");
const DIR_EVENTS = path.join(CORE_ROOT, "events");

const existsDir = (d) => fs.existsSync(d) && fs.statSync(d).isDirectory();
const listJs = (d) =>
    existsDir(d)
        ? fs.readdirSync(d).filter((f) => f.endsWith(".js") || f.endsWith(".cjs")).map((f) => path.join(d, f))
        : [];
const allFiles = () => [...listJs(DIR_CMDS), ...listJs(DIR_EVENTS)];
const rel = (p) => path.relative(ROOT, p);


function fileKind(file) {
    const norm = path.normalize(file);
    const ev = path.normalize(DIR_EVENTS) + path.sep;
    const cm = path.normalize(DIR_CMDS) + path.sep;
    if (norm.startsWith(ev)) return "event";
    if (norm.startsWith(cm)) return "cmd";
    return "cmd";
}

function parseMissingPkg(err) {
    if (!err || err.code !== "MODULE_NOT_FOUND") return null;
    const msg = String(err.message || "");
    const m = msg.match(/Cannot find module '([^']+)'/);
    if (!m) return null;
    const name = m[1];
    if (!name) return null;
    if (name.startsWith(".") || name.startsWith("/") || name.includes("\\") || name.includes(path.sep)) return null;
    return name;
}

function installPkg(pkg) {
    try {
        execSync(`npm i ${pkg} --no-save`, { cwd: ROOT, stdio: "inherit" });
        return true;
    } catch {
        return false;
    }
}

function safeRequireFresh(file) {
    const id = require.resolve(file);
    if (require.cache[id]) delete require.cache[id];
    try {
        return require(file);
    } catch (e) {
        const pkg = parseMissingPkg(e);
        if (!pkg) throw e;
        const ok = installPkg(pkg);
        if (!ok) throw e;
        if (require.cache[id]) delete require.cache[id];
        return require(file);
    }
}

function clearHandleReplyByName(name) {
    const target = String(name || "").toLowerCase();
    global.client.handleReply = global.client.handleReply.filter(
        (x) => String(x?.name || "").toLowerCase() !== target
    );
}

function clearByName(name, kind) {
    const map = kind === "event" ? global.client.events : global.client.commands;
    if (map.has(name)) map.delete(name);
    clearHandleReplyByName(name);
}

function clearByFile(file, kind) {
    const map = kind === "event" ? global.client.events : global.client.commands;
    const abs = path.resolve(file);
    const removed = [];
    for (const [name, mod] of map.entries()) {
        const mf = mod && mod.__file ? path.resolve(String(mod.__file)) : "";
        if (mf && mf === abs) {
            map.delete(name);
            clearHandleReplyByName(name);
            removed.push(name);
        }
    }
    return removed;
}

function reloadOne(file) {
    const kind = fileKind(file);
    const abs = path.resolve(file);

    const removed = clearByFile(abs, kind);

    const mod = safeRequireFresh(abs);
    const name = String(mod?.config?.name || "").trim();
    if (!name) return { ok: false, kind, file: abs, name: null, reason: "missing config.name" };

    clearByName(name, kind);

    mod.__file = abs;

    const map = kind === "event" ? global.client.events : global.client.commands;
    map.set(name, mod);

    return { ok: true, kind, file: abs, name, removed };
}

function findByFileName(name, kind) {
    const raw = String(name || "").trim();
    const lower = raw.toLowerCase();
    const bases = lower.endsWith(".js") || lower.endsWith(".cjs")
        ? [raw]
        : [`${raw}.cjs`, `${raw}.js`];
    const dirs = kind === "event" ? [DIR_EVENTS] : kind === "cmd" ? [DIR_CMDS] : [DIR_CMDS, DIR_EVENTS];
    for (const d of dirs) {
        for (const base of bases) {
            const f = path.join(d, base);
            if (fs.existsSync(f)) return f;
        }
    }
    return null;
}

function readConfigNameFromFile(file) {
    try {
        const s = fs.readFileSync(file, "utf8");
        const rx = /(?:module\.exports|exports|this)\.config\s*=\s*{[\s\S]*?\bname\s*:\s*["'`]([^"'`]+)["'`]/i;
        const m = s.match(rx);
        if (!m) return null;
        return String(m[1] || "").trim() || null;
    } catch {
        return null;
    }
}

function findByConfigName(name, kind) {
    const target = String(name || "").toLowerCase();
    if (!target) return null;
    const files = kind === "event" ? listJs(DIR_EVENTS) : kind === "cmd" ? listJs(DIR_CMDS) : allFiles();
    for (const f of files) {
        const n = readConfigNameFromFile(f);
        if (n && n.toLowerCase() === target) return f;
    }
    return null;
}

function findModuleFile(name, kind = "") {
    const k = kind === "cmd" ? "cmd" : kind === "event" ? "event" : "";
    return findByFileName(name, k) || findByConfigName(name, k);
}

async function reloadAll(kind = "") {
    const k = kind === "cmd" ? "cmd" : kind === "event" ? "event" : "";
    const files = k === "cmd" ? listJs(DIR_CMDS) : k === "event" ? listJs(DIR_EVENTS) : allFiles();

    const ok = [];
    const fail = [];

    console.log(`\n[${new Date().toLocaleTimeString()}] Reload ${k || "ALL"} (${files.length} file):`);

    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const t = Date.now();
        try {
            const r = reloadOne(f);
            if (!r.ok) {
                console.log(`${i + 1}. ERR  [${r.kind}] ${path.basename(f)} (${rel(f)}) ${r.reason || ""}`);
                fail.push({ file: f, reason: r.reason || "unknown" });
            } else {
                const renameInfo = r.removed && r.removed.length ? ` removed: ${r.removed.join(", ")}` : "";
                console.log(`${i + 1}. OK   [${r.kind}] ${r.name} (${rel(f)}) +${Date.now() - t}ms${renameInfo}`);
                ok.push(r.name);
            }
        } catch (e) {
            console.log(`${i + 1}. ERR  [${fileKind(f)}] ${path.basename(f)} (${rel(f)})`);
            console.log(`   ${e.name}: ${e.message}\n   ${String(e.stack || "").split("\n")[1] || ""}`);
            fail.push({ file: f, reason: `${e.name || "Error"}: ${e.message || e}` });
        }
    }

    console.log(`Hoàn tất: ${ok.length} ok, ${fail.length} lỗi\n`);
    return { ok, fail, total: files.length };
}

module.exports.config = {
    name: "load",
    hasPermssion: 3,
    credits: "vtuann",
    description: "Reload modules",
    commandCategory: "ADMIN",
    usages: "load <tên> | load cmd <tên> | load event <tên> | load all [cmd|event]",
    cooldowns: 0
};

module.exports.run = async ({ api, event, args }) => {
    const { threadID, messageID } = event;

    if (!args[0]) {
        return api.sendMessage(
            "Dùng:\n" +
            "• load <tên_lệnh>\n" +
            "• load cmd <tên>\n" +
            "• load event <tên>\n" +
            "• load all [cmd|event]",
            threadID,
            messageID
        );
    }

    const a0 = String(args[0] || "").toLowerCase();

    if (a0 === "all") {
        const scope = String(args[1] || "").toLowerCase();
        const kind = scope === "cmd" ? "cmd" : scope === "event" ? "event" : "";
        const res = await reloadAll(kind);
        return api.sendMessage(
            `✅ Đã reload ${kind || "tất cả"}: ${res.ok.length} ok, ${res.fail.length} lỗi. Xem console.`,
            threadID,
            messageID
        );
    }

    let kind = "";
    let name = "";

    if (a0 === "cmd" || a0 === "event") {
        kind = a0;
        name = args.slice(1).join(" ").trim();
    } else {
        kind = "";
        name = args.join(" ").trim();
    }

    if (!name) return api.sendMessage("Thiếu tên module. Ví dụ: load loc", threadID, messageID);

    const file = findModuleFile(name, kind === "cmd" ? "cmd" : kind === "event" ? "event" : "");
    if (!file) return api.sendMessage(`Không tìm thấy "${name}" trong commands/events.`, threadID, messageID);

    const t = Date.now();
    try {
        const r = reloadOne(file);
        if (!r.ok) return api.sendMessage(`Lỗi: module thiếu config.name (${rel(file)})`, threadID, messageID);

        const removed = r.removed && r.removed.length ? `\n🗑️ Đã huỷ tên cũ: ${r.removed.join(", ")}` : "";
        console.log(`[${new Date().toLocaleTimeString()}] Reload OK [${r.kind}] ${r.name} (${rel(file)}) +${Date.now() - t}ms`);
        return api.sendMessage(`✅ Reload OK: [${r.kind}] ${r.name} (${Date.now() - t}ms)${removed}`, threadID, messageID);
    } catch (e) {
        console.log(`[${new Date().toLocaleTimeString()}] Lỗi reload ${rel(file)}:\n${e.stack || e}`);
        return api.sendMessage(`❌ Lỗi khi tải lại: ${e.message}`, threadID, messageID);
    }
};
