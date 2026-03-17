const moment = require("moment-timezone");
const stringSimilarity = require("string-similarity");

this.config = {
    name: "help",
    version: "2.0.0",
    hasPermssion: 0,
    credits: "DC-Nam • mod by Niio-team • refactor by vtuan",
    description: "Xem danh sách lệnh và info",
    commandCategory: "QUẢN LÝ NHÓM",
    usages: "[tên lệnh|all]",
    cooldowns: 0
};

this.languages = {
    vi: {},
    en: {}
};

this.run = async function ({ api, event, args, Threads }) {
    const { threadID: tid, messageID: mid, senderID: sid } = event;

    const cmds = global.client?.commands;
    if (!cmds || !cmds.size) {
        return api.sendMessage("⚠️ Hệ thống chưa có lệnh nào.", tid, mid);
    }

    const normalizeCommand = (rawCmd) => {
        if (!rawCmd || typeof rawCmd !== "object") return null;
        const cfg = rawCmd.config && typeof rawCmd.config === "object" ? rawCmd.config : {};
        const name = String(cfg.name || rawCmd.name || "").trim().toLowerCase();
        if (!name) return null;

        return {
            name,
            version: cfg.version || rawCmd.version || "1.0.0",
            hasPermssion: Number.isFinite(Number(cfg.hasPermssion))
                ? Number(cfg.hasPermssion)
                : (Number.isFinite(Number(rawCmd.hasPermssion)) ? Number(rawCmd.hasPermssion) : 0),
            commandCategory: cfg.commandCategory || rawCmd.commandCategory || "Khác",
            description: cfg.description || rawCmd.description || "Không có mô tả.",
            usages: cfg.usages || rawCmd.usages || "",
            cooldowns: Number(cfg.cooldowns ?? rawCmd.cooldowns ?? 0) || 0
        };
    };

    const commandList = [];
    const seenNames = new Set();
    for (const cmd of cmds.values()) {
        const normalized = normalizeCommand(cmd);
        if (!normalized) continue;
        if (seenNames.has(normalized.name)) continue;
        seenNames.add(normalized.name);
        commandList.push(normalized);
    }

    if (!commandList.length) {
        return api.sendMessage("⚠️ Hệ thống chưa có lệnh hợp lệ.", tid, mid);
    }

    const cfg = global.config || {};
    const adminCfg = cfg.admins || {};
    const superAdmins = adminCfg.superADMIN || [];
    const admins = adminCfg.ADMIN || [];
    const ndh = adminCfg.NDH || [];

    const sidStr = String(sid);
    const isSuper = superAdmins.map(String).includes(sidStr);
    const isAdmin = isSuper || admins.map(String).includes(sidStr);
    const isNdhs = isAdmin || ndh.map(String).includes(sidStr); // NDH + Admin + Super
    const canSeeAdminCategory = isNdhs; // ai có quyền quản trị bot thì thấy category ADMIN

    // Lấy prefix theo data mới
    const tDataRaw = (await Threads.getData(tid)) || {};
    const tData = tDataRaw.data || {};
    const prefix =
        tData.prefix ||
        cfg.prefix ||
        cfg.PREFIX ||
        "!";

    const type = (args[0] || "").toLowerCase();
    let msg = "";

    // ====== TIME / INFO BOT ======
    let thu = moment.tz("Asia/Ho_Chi_Minh").format("dddd");
    if (thu === "Sunday") thu = "Chủ Nhật";
    else if (thu === "Monday") thu = "Thứ Hai";
    else if (thu === "Tuesday") thu = "Thứ Ba";
    else if (thu === "Wednesday") thu = "Thứ Tư";
    else if (thu === "Thursday") thu = "Thứ Năm";
    else if (thu === "Friday") thu = "Thứ Sáu";
    else if (thu === "Saturday") thu = "Thứ Bảy";

    const time = moment.tz("Asia/Ho_Chi_Minh").format("HH:mm:ss | DD/MM/YYYY");

    const adminBotList = cfg.ADMINBOT || []; // nếu bạn vẫn giữ ADMINBOT thì dùng; không có thì nó là []
    const NameBot = cfg.BOTNAME || "ROOMIE";
    const version = cfg.version || "1.0.0";

    // ================== help all ==================
    if (type === "all") {
        const commandsList = commandList
            .map((cmd, index) => {
                return `${index + 1}. ${cmd.name}\n📝 Mô tả: ${cmd.description || "Không có mô tả."}\n`;
            })
            .join("\n");

        return api.sendMessage(
            `📚 DANH SÁCH TOÀN BỘ LỆNH\n\n${commandsList}\n\n📝 Tổng số lệnh: ${commandList.length}`,
            tid,
            mid
        );
    }

    // ================== help <tên lệnh> ==================
    if (type) {
        // tìm đúng tên
        let command = commandList.find(c => c.name === type) || null;

        if (!command) {
            // gợi ý gần đúng
            const commandName = type;
            const commandValues = commandList.map(c => c.name);
            const checker = stringSimilarity.findBestMatch(commandName, commandValues);

            if (checker.bestMatch.rating >= 0.5) {
                const bestName = checker.bestMatch.target;
                command = commandList.find(c => c.name === bestName) || null;
                msg =
                    `⚠️ Không tìm thấy lệnh '${commandName}' trong hệ thống.\n` +
                    `📌 Lệnh gần giống được tìm thấy: '${bestName}'\n\n`;
            } else {
                return api.sendMessage(
                    `⚠️ Không tìm thấy lệnh '${commandName}' trong hệ thống.`,
                    tid,
                    mid
                );
            }
        }

        const cmd = command || {};
        msg +=
            `[ HƯỚNG DẪN SỬ DỤNG ]\n\n` +
            `📜 Tên lệnh: ${cmd.name}\n` +
            `🕹️ Phiên bản: ${cmd.version || "1.0.0"}\n` +
            `🔑 Quyền hạn: ${TextPr(cmd.hasPermssion)}\n` +
            `🧩 Nhóm: ${cmd.commandCategory || "Khác"}\n` +
            `📝 Mô tả: ${cmd.description || "Không có mô tả."}\n` +
            `📌 Cách dùng: ${cmd.usages || "Không có hướng dẫn."}\n` +
            `⏳ Cooldowns: ${cmd.cooldowns || 0}s`;

        return api.sendMessage(msg, tid, mid);
    }

    // ================== help ==================
    const groups = [];

    // Gom theo commandCategory
    for (const cmd of commandList) {
        const category = cmd.commandCategory || "Khác";
        const nameModule = cmd.name || "unknown";

        let found = groups.find(g => g.cmdCategory === category);
        if (!found) {
            found = { cmdCategory: category, nameModule: [] };
            groups.push(found);
        }
        found.nameModule.push(nameModule);
    }

    // Sort theo số lượng lệnh trong category (giống S())
    groups.sort(S("nameModule"));

    for (const group of groups) {
        const catName = (group.cmdCategory || "Khác").toUpperCase();

        // Ẩn category ADMIN nếu user không phải admin/ndh/super
        if (catName === "ADMIN" && !canSeeAdminCategory) continue;

        msg +=
            `[ ${catName} ]\n` +
            `📝 Tổng lệnh: ${group.nameModule.length} lệnh\n` +
            `${group.nameModule.join(", ")}\n\n`;
    }

    msg +=
        `📝 Tổng số lệnh: ${commandList.length} lệnh\n` +
        `👤 Tổng số admin bot: ${(adminBotList || []).length}\n` +
        `👾 Tên Bot: ${NameBot}\n` +
        `🕹️ Phiên bản: ${version}\n` +
        `⏰ Hôm nay là: ${thu}\n` +
        `⏱️ Thời gian: ${time}\n\n` +
        `${prefix}help <tên lệnh> để xem chi tiết.\n` +
        `${prefix}help all để xem toàn bộ lệnh.`;

    return api.sendMessage(msg, tid, mid);
};

// Sort theo độ dài mảng nameModule (nhiều lệnh lên trên)
function S(k) {
    return function (a, b) {
        const lenA = (a[k] || []).length;
        const lenB = (b[k] || []).length;
        if (lenA > lenB) return -1;
        if (lenA < lenB) return 1;
        return 0;
    };
}

// Map quyền
function TextPr(permission) {
    const p = Number(permission) || 0;
    switch (p) {
        case 0:
            return "Thành viên";
        case 1:
            return "QTV / NDH / Admin";
        case 2:
            return "NDH / Admin";
        case 3:
            return "Admin";
        case 4:
            return "SuperAdmin";
        default:
            return "Không xác định";
    }
}
