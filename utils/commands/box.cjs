const axios = require("axios");

module.exports.config = {
    name: "box",
    version: "1.4.1",
    hasPermssion: 0,
    credits: "vtuan",
    description: "Xem thông tin box chi tiết",
    commandCategory: "Tiện Ích",
    usages: "box",
    cooldowns: 2
};

const GENDER_MAP = {
    male: { icon: "👨", label: "Nam" },
    female: { icon: "👩", label: "Nữ" },
    unknown: { icon: "❓", label: "LGBT" }
};

const COLOR_MAP = {
    "0": "🔴 Đỏ",
    "1": "🟠 Cam",
    "2": "🟡 Vàng",
    "3": "🟢 Xanh lá",
    "4": "🔵 Xanh dương",
    "5": "🟣 Tím",
    "6": "🟤 Nâu",
    "7": "⚫ Đen",
    "8": "⚪ Trắng"
};

function detectGender(g) {
    const val = String(g ?? "").toLowerCase();
    if (val === "male" || val === "1") return "male";
    if (val === "female" || val === "2") return "female";
    return "unknown";
}

module.exports.run = async function ({ api, event, Threads, Users }) {
    const { threadID, participantIDs } = event;

    const data = await Threads.getData(threadID);
    if (!data || !data.threadInfo) {
        return api.sendMessage("❌ Chưa có dữ liệu trong DB. Hệ thống sẽ tự cập nhật khi có sự kiện.", threadID);
    }

    const t = data.threadInfo;
    const memberIDs = (participantIDs || []).map(String);

    const info = await Threads.getInfo(threadID);
    const userInfoMap = new Map();
    if (info?.userInfo) {
        for (const u of info.userInfo) {
            userInfoMap.set(String(u.id), { name: u.name, gender: u.gender });
        }
    }

    const adminIDs = Array.isArray(t.adminIDs) ? t.adminIDs.map(a => String(a.id || a)) : [];

    async function getName(uid) {
        uid = String(uid);
        const local = userInfoMap.get(uid);
        if (local?.name) return local.name;

        const db = await Users.getData(uid).catch(() => null);
        return db?.name || `User ${uid}`;
    }

    // Count genders concurrently
    const genderCounts = { male: 0, female: 0, unknown: 0 };
    await Promise.all(memberIDs.map(async (uid) => {
        let g = userInfoMap.get(uid)?.gender;
        if (!g) {
            const u = await Users.getData(uid).catch(() => null);
            g = u?.gender;
        }
        const tag = detectGender(g);
        genderCounts[tag]++;
    }));

    const adminNames = await Promise.all(adminIDs.map(id => getName(id)));

    // Link status
    let linkStatus = "❌ Tắt";
    let linkText = "";
    if (t.inviteLink?.enable === true && t.inviteLink?.link) {
        linkStatus = "✅ Bật";
        linkText = `\n🔗 Link: ${t.inviteLink.link}`;
    }

    // Color display
    const colorKey = String(t.color || "0");
    const colorDisplay = COLOR_MAP[colorKey] || `🎨 Tùy chỉnh (${t.color})`;

    // Build message
    const msg =
        `═══════════════════════════════\n` +
        `📦 THÔNG TIN NHÓM\n` +
        `═══════════════════════════════\n\n` +
        `📛 Tên: ${t.threadName || "Không đặt tên"}\n` +
        `🆔 ID: ${threadID}\n` +
        `👥 Tổng thành viên: ${memberIDs.length}\n\n` +
        `🛡️ QUẢN TRỊ VIÊN (${adminIDs.length})\n` +
        (adminIDs.length
            ? adminIDs.map((id, i) => `  ${i + 1}. ${adminNames[i] || id}`).join("\n")
            : "  └ Không có") +
        `\n\n` +
        `🎨 TÙY CHỈNH\n` +
        `  Emoji: ${t.emoji || "❌ Không đặt"}\n` +
        `  Màu: ${colorDisplay}\n` +
        `  Ảnh nhóm: ${t.imageSrc ? "✅ Có" : "❌ Không"}\n\n` +
        `🔗 LINK MỜI\n` +
        `  Trạng thái: ${linkStatus}${linkText}\n\n` +
        `👨👩 THÀNH VIÊN THEO GIỚI TÍNH\n` +
        `  ${GENDER_MAP.male.icon} ${GENDER_MAP.male.label}: ${genderCounts.male}\n` +
        `  ${GENDER_MAP.female.icon} ${GENDER_MAP.female.label}: ${genderCounts.female}\n` +
        `  ${GENDER_MAP.unknown.icon} ${GENDER_MAP.unknown.label}: ${genderCounts.unknown}\n\n` +
        `═══════════════════════════════`;

    // Send with image if available
    const imageUrl = t.imageSrc || "";
    if (imageUrl) {
        try {
            const stream = await axios.get(imageUrl, {
                responseType: "stream",
                timeout: 15000,
                maxRedirects: 5
            });
            return api.sendMessage({ body: msg, attachment: stream.data }, threadID);
        } catch (e) {
            console.error("Lỗi tải ảnh:", e.message);
            return api.sendMessage(msg, threadID);
        }
    }

    return api.sendMessage(msg, threadID);
};