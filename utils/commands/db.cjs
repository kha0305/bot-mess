"use strict";

async function getDataModel(m) {
    if (!m) return null;
    try {
        if (typeof m.getAll === "function") return await m.getAll();
        if (typeof m.findAll === "function") {
            const rows = await m.findAll();
            return rows.map(r => (r.toJSON ? r.toJSON() : r));
        }
    } catch { }
    return null;
}

const count = d =>
    Array.isArray(d) ? d.length :
        (d && typeof d === "object") ? Object.keys(d).length : 0;

function size(d) {
    try { return Buffer.byteLength(JSON.stringify(d || null), "utf8"); }
    catch { return 0; }
}

function fmt(b) {
    if (b < 1024) return b + "B";
    const kb = b / 1024; if (kb < 1024) return kb.toFixed(1) + "KB";
    const mb = kb / 1024; if (mb < 1024) return mb.toFixed(2) + "MB";
    return (mb / 1024).toFixed(2) + "GB";
}

module.exports.config = {
    name: "db",
    version: "1.8.0",
    hasPermssion: 2,
    credits: "vtuan",
    description: "Thống kê database",
    commandCategory: "ADMIN",
    usages: "db stats",
    cooldowns: 3
};

module.exports.run = async function ({
    api,
    event,
    args,
    Threads,
    Users,
    Membership,
    Currencies
}) {
    const threadID = event.threadID;
    if ((args[0] || "").toLowerCase() !== "stats")
        return api.sendMessage("Dùng: db stats", threadID);

    const models = { Threads, Users, Membership, Currencies };
    const lines = [];
    let totalCount = 0, totalBytes = 0;

    for (const [name, model] of Object.entries(models)) {
        if (!model) continue;

        if (name === "Membership") {
            if (!Threads || typeof Threads.getAll !== "function" || typeof Membership.getData !== "function") {
                lines.push(name + ": không thống kê được");
                continue;
            }
            let c = 0, b = 0;
            const allThreads = await Threads.getAll();
            for (const t of allThreads || []) {
                const tid = String(t.threadID || "");
                if (!tid) continue;
                const arr = await Membership.getData(tid).catch(() => null);
                if (Array.isArray(arr)) {
                    c += arr.length;
                    b += size(arr);
                }
            }
            lines.push(`${name}: ${c} · ${fmt(b)}`);
            totalCount += c; totalBytes += b;
            continue;
        }

        const data = await getDataModel(model);
        if (!data) {
            lines.push(name + ": không thống kê được");
            continue;
        }
        const c = count(data);
        const b = size(data);
        lines.push(`${name}: ${c} · ${fmt(b)}`);
        totalCount += c; totalBytes += b;
    }

    lines.push("");
    lines.push(`Tổng: ${totalCount} · ${fmt(totalBytes)}`);

    return api.sendMessage(lines.join("\n"), threadID);
};
