"use strict";

// ===================================================================
// Helpers chung
// ===================================================================

const SLOT_LABELS = {
    dem: "Đêm",
    sang: "Sáng",
    trua: "Trưa",
    chieu: "Chiều",
    toi: "Tối",
    khuya: "Khuya"
};

const SLOT_KEYS = ["dem", "sang", "trua", "chieu", "toi", "khuya"];

const SLOT_ALIASES = {
    dem: ["dem", "đêm"],
    sang: ["sang", "sáng"],
    trua: ["trua", "trưa"],
    chieu: ["chieu", "chiều"],
    toi: ["toi", "tối"],
    khuya: ["khuya"]
};

const WEEKDAY_LABELS = {
    mon: "Thứ Hai",
    tue: "Thứ Ba",
    wed: "Thứ Tư",
    thu: "Thứ Năm",
    fri: "Thứ Sáu",
    sat: "Thứ Bảy",
    sun: "Chủ Nhật"
};

function metricLabel(metric) {
    switch (metric) {
        case "day": return "ngày";
        case "week": return "tuần";
        case "month": return "tháng";
        case "total": return "tổng";
        default: return metric;
    }
}

function extractStatsFromRecord(rec) {
    const ck = rec.checktt || {};
    const day = ck.day && ck.day.tong ? Number(ck.day.tong.msg || 0) : 0;
    const week = ck.week && ck.week.tong ? Number(ck.week.tong.msg || 0) : 0;
    const month = ck.month && ck.month.tong ? Number(ck.month.tong.msg || 0) : 0;
    const total = ck.total ? Number(ck.total.msg || ck.total.total || 0) : 0;

    return { day, week, month, total };
}

async function getThreadStats(Membership, threadID, participantIDs) {
    const rows = await Membership.getData(threadID);
    if (!Array.isArray(rows) || !rows.length) return [];

    const set = new Set((participantIDs || []).map(String));

    return rows
        .filter(r => set.has(String(r.senderID)))
        .map(r => {
            const s = extractStatsFromRecord(r);
            return {
                senderID: String(r.senderID),
                name: r.name,
                history: r.history || {},
                checktt: r.checktt || {},
                day: s.day,
                week: s.week,
                month: s.month,
                total: s.total
            };
        });
}

function formatJoinDuration(history) {
    const now = Date.now();
    const joinTs = history && history.lastJoin ? Number(history.lastJoin) : null;
    if (!joinTs) return "không rõ";

    const diffDays = Math.floor((now - joinTs) / 86400000);
    if (diffDays <= 0) return "hôm nay";
    return diffDays + " ngày";
}

async function isThreadAdmin(Threads, api, threadID, uid) {
    uid = String(uid);

    if (Threads && typeof Threads.isAdmin === "function") {
        try {
            const ok =
                (await Threads.isAdmin(threadID, uid)) ||
                (await Threads.isAdmin(uid, threadID));
            if (ok) return true;
        } catch (_) { }
    }

    try {
        const info = await api.getThreadInfo(threadID);
        const admins = (info.adminIDs || []).map(String);
        return admins.includes(uid);
    } catch (_) {
        return false;
    }
}

function resolveSlotKey(raw) {
    const s = String(raw || "").toLowerCase();
    for (const key of Object.keys(SLOT_ALIASES)) {
        if (SLOT_ALIASES[key].includes(s)) return key;
    }
    return null;
}

// ===================================================================
// Lệnh chính
// ===================================================================

module.exports = {
    config: {
        name: "check",
        version: "1.2.0",
        hasPermssion: 0,
        credits: "vtuan",
        description: "Thống kê hoạt động thành viên trong nhóm",
        commandCategory: "QUẢN LÝ NHÓM",
        usages: "[day|week|month|total|top|rank|all|avg|reset|new|last|inactive|slot|find|vs|info|help]",
        cooldowns: 0
    },

    async run({ api, event, args, Users, Threads, Membership }) {
        const threadID = event.threadID;
        const senderID = event.senderID;
        const mentions = Object.keys(event.mentions || {});
        const replyID = event.messageReply?.senderID;
        let targetID = senderID;

        if (mentions.length > 0) {
            targetID = mentions[0];
        } else if (replyID) {
            targetID = replyID;
        } else if (args[0] && /^\d{6,20}$/.test(args[0])) {
            targetID = args[0];
        }

        const typeRaw = (args[0] || "").toLowerCase();
        const validTypes = [
            "day", "week", "month", "total",
            "top", "rank", "all", "avg",
            "reset", "new", "last", "inactive",
            "slot", "find", "vs", "info", "help"
        ];
        const type = validTypes.includes(typeRaw) ? typeRaw : "";

        // ---------------------------------------------------------------
        // AVG: trung bình nhóm
        // ---------------------------------------------------------------
        if (type === "avg") {
            const members = await getThreadStats(Membership, threadID, event.participantIDs);
            if (!members.length) {
                return api.sendMessage("Nhóm chưa có dữ liệu hoạt động.", threadID);
            }

            const sum = members.reduce((acc, m) => {
                acc.day += m.day;
                acc.week += m.week;
                acc.month += m.month;
                acc.total += m.total;
                return acc;
            }, { day: 0, week: 0, month: 0, total: 0 });

            const n = members.length;
            const avgDay = (sum.day / n).toFixed(1);
            const avgWeek = (sum.week / n).toFixed(1);
            const avgMonth = (sum.month / n).toFixed(1);
            const avgTotal = (sum.total / n).toFixed(1);

            let msg = "";
            msg += "EXP trung bình của nhóm:\n\n";
            msg += "1. Ngày: " + avgDay + "\n";
            msg += "2. Tuần: " + avgWeek + "\n";
            msg += "3. Tháng: " + avgMonth + "\n";
            msg += "4. Tổng: " + avgTotal;

            return api.sendMessage(msg, threadID);
        }

        // ---------------------------------------------------------------
        // NEW: thành viên mới trong N ngày
        // ---------------------------------------------------------------
        if (type === "new") {
            const days = Number(args[1]) || 7;
            const now = Date.now();
            const ms = days * 86400000;

            const rows = await Membership.getData(threadID);
            const set = new Set((event.participantIDs || []).map(String));

            const list = (rows || []).filter(rec => {
                if (!set.has(String(rec.senderID))) return false;
                const h = rec.history || {};
                if (!h.lastJoin) return false;
                return (now - Number(h.lastJoin)) <= ms;
            });

            if (!list.length) {
                return api.sendMessage("Không có thành viên mới trong " + days + " ngày qua.", threadID);
            }

            let msg = "";
            msg += "Thành viên mới trong " + days + " ngày qua:\n\n";

            for (let i = 0; i < list.length; i++) {
                const rec = list[i];
                const name = rec.name || await Users.getNameUser(rec.senderID);
                const joinTime = rec.history?.lastJoin
                    ? new Date(Number(rec.history.lastJoin)).toLocaleString("vi-VN")
                    : "không rõ";
                msg += (i + 1) + ". " + name + " (vào lúc " + joinTime + ")\n";
            }

            return api.sendMessage(msg.trim(), threadID);
        }

        // ---------------------------------------------------------------
        // RANK: hạng EXP tổng của 1 hoặc nhiều người
        // ---------------------------------------------------------------
        if (type === "rank") {
            const listUID = mentions.length > 0 ? mentions : [senderID];
            const members = await getThreadStats(Membership, threadID, event.participantIDs);
            if (!members.length) {
                return api.sendMessage("Nhóm chưa có dữ liệu hoạt động.", threadID);
            }

            members.sort((a, b) => b.total - a.total);

            let msg = "Xếp hạng EXP tổng:\n\n";
            for (let i = 0; i < listUID.length; i++) {
                const uid = listUID[i];
                const idx = members.findIndex(m => m.senderID === String(uid));
                const name = await Users.getNameUser(uid);

                if (idx === -1) {
                    msg += (i + 1) + ". " + name + ": chưa có dữ liệu.\n";
                } else {
                    msg += (i + 1) + ". " + name + ": hạng " + (idx + 1) + "/" + members.length + "\n";
                }
            }

            return api.sendMessage(msg.trim(), threadID);
        }

        // ---------------------------------------------------------------
        // ALL: liệt kê toàn nhóm theo 1 metric (có phân trang + reply)
        // ---------------------------------------------------------------
        if (type === "all") {
            const validMetrics = ["day", "week", "month", "total"];
            const metricRaw = (args[1] || "total").toLowerCase();
            const metric = validMetrics.includes(metricRaw) ? metricRaw : "total";

            const limit = 50;
            const page = 1;

            const members = await getThreadStats(Membership, threadID, event.participantIDs);
            if (!members.length) {
                return api.sendMessage("Nhóm chưa có dữ liệu hoạt động.", threadID);
            }

            members.sort((a, b) => b[metric] - a[metric]);

            const totalPages = Math.ceil(members.length / limit) || 1;
            const start = (page - 1) * limit;
            const end = Math.min(start + limit, members.length);

            let msg = "";
            msg += "Thống kê EXP của toàn nhóm (theo " + metricLabel(metric) + ")\n";
            msg += "Trang " + page + "/" + totalPages + "\n\n";

            for (let i = start; i < end; i++) {
                const u = members[i];
                const name = u.name || await Users.getNameUser(u.senderID);
                msg += (i + 1) + ". " + name +
                    " | Ngày " + u.day +
                    " | Tuần " + u.week +
                    " | Tháng " + u.month +
                    " | Tổng " + u.total + "\n";
            }

            const sum = members.reduce((acc, m) => {
                acc.day += m.day;
                acc.week += m.week;
                acc.month += m.month;
                acc.total += m.total;
                return acc;
            }, { day: 0, week: 0, month: 0, total: 0 });

            const activeCount = members.filter(m => m[metric] > 0).length;
            const metricSum = sum[metric];
            const avgActive = activeCount > 0 ? (metricSum / activeCount).toFixed(1) : 0;
            const positives = members.map(m => m[metric]).filter(v => v > 0);
            const minPositive = positives.length ? Math.min(...positives) : 0;

            msg += "\nTổng quan:\n";
            msg += "1. Thành viên có hoạt động " + metricLabel(metric) + ": " + activeCount + "/" + members.length + "\n";
            msg += "2. Trung bình EXP " + metricLabel(metric) + " (chỉ tính người có hoạt động): " + avgActive + "\n";
            if (positives.length) {
                msg += "3. Mức thấp nhất nhưng vẫn có hoạt động: " + minPositive + "\n";
            }

            msg += "\nTổng nhóm (theo tất cả kỳ):\n";
            msg += "- Ngày: " + sum.day + "\n";
            msg += "- Tuần: " + sum.week + "\n";
            msg += "- Tháng: " + sum.month + "\n";
            msg += "- Tổng: " + sum.total + "\n";

            msg += "\nHướng dẫn (reply vào tin này):\n";
            msg += "- next hoặc next 2  → xem trang tiếp.\n";
            msg += "- kick 1 2          → kick theo số thứ tự.\n";
            msg += "- lọc 10            → kick người có exp " + metricLabel(metric) + " <= 10 (trừ thành viên mới 1 ngày).";

            return api.sendMessage(msg.trim(), threadID, (err, info) => {
                if (err || !info) return;
                if (!global.client) global.client = {};
                if (!global.client.handleReply) global.client.handleReply = [];

                global.client.handleReply.push({
                    name: module.exports.config.name,
                    messageID: info.messageID,
                    type: "checkPage",
                    data: {
                        view: "all",
                        metric,
                        page,
                        limit
                    }
                });
            });
        }

        // ---------------------------------------------------------------
        // TOP: top 10 theo 1 metric
        // ---------------------------------------------------------------
        if (type === "top") {
            const validMetrics = ["day", "week", "month", "total"];
            const metricRaw = (args[1] || "total").toLowerCase();
            const metric = validMetrics.includes(metricRaw) ? metricRaw : "total";

            const members = await getThreadStats(Membership, threadID, event.participantIDs);
            if (!members.length) {
                return api.sendMessage("Nhóm chưa có dữ liệu hoạt động.", threadID);
            }

            members.sort((a, b) => b[metric] - a[metric]);
            const topList = members.slice(0, 10);

            let msg = "";
            msg += "Top EXP " + metricLabel(metric) + " của nhóm:\n\n";
            for (let i = 0; i < topList.length; i++) {
                const u = topList[i];
                const name = u.name || await Users.getNameUser(u.senderID);
                msg += (i + 1) + ". " + name + ": " + u[metric] + "\n";
            }

            return api.sendMessage(msg.trim(), threadID);
        }

        // ---------------------------------------------------------------
        // RESET: reset thống kê theo Membership.resetChecktt
        // ---------------------------------------------------------------
        if (type === "reset") {
            const res = await Membership.resetChecktt(threadID);
            const updated = res && res.members ? res.members : 0;

            let msg = "";
            msg += "Đã reset lại thống kê trong nhóm.\n\n";
            msg += "Số thành viên được cập nhật: " + updated + "\n";
            msg += "- Ngày luôn được reset.\n";
            msg += "- Tuần reset nếu là Chủ nhật.\n";
            msg += "- Tháng reset nếu là ngày đầu tháng.";

            return api.sendMessage(msg, threadID);
        }

        // ---------------------------------------------------------------
        // DAY / WEEK / MONTH / TOTAL: top có phân trang + reply
        // ---------------------------------------------------------------
        if (["day", "week", "month", "total"].includes(type)) {
            const metric = type;
            const limit = 50;
            const page = 1;

            const members = await getThreadStats(Membership, threadID, event.participantIDs);
            if (!members.length) {
                return api.sendMessage("Nhóm chưa có dữ liệu hoạt động.", threadID);
            }

            members.sort((a, b) => b[metric] - a[metric]);

            const totalPages = Math.ceil(members.length / limit) || 1;
            const start = (page - 1) * limit;
            const end = Math.min(start + limit, members.length);

            let msg = "";
            msg += "Top EXP " + metricLabel(metric) + " của nhóm\n";
            msg += "Trang " + page + "/" + totalPages + "\n\n";

            for (let i = start; i < end; i++) {
                const u = members[i];
                const name = u.name || await Users.getNameUser(u.senderID);
                msg += (i + 1) + ". " + name + ": " + u[metric] + "\n";
            }

            const totalExp = members.reduce((sum, u) => sum + u[metric], 0);
            const activeCount = members.filter(m => m[metric] > 0).length;
            const avgActive = activeCount > 0 ? (totalExp / activeCount).toFixed(1) : 0;
            const positives = members.map(m => m[metric]).filter(v => v > 0);
            const minPositive = positives.length ? Math.min(...positives) : 0;

            msg += "\nTổng quan:\n";
            msg += "1. Thành viên có hoạt động " + metricLabel(metric) + ": " + activeCount + "/" + members.length + "\n";
            msg += "2. Trung bình EXP " + metricLabel(metric) + " (chỉ tính người có hoạt động): " + avgActive + "\n";
            if (positives.length) {
                msg += "3. Mức thấp nhất nhưng vẫn có hoạt động: " + minPositive + "\n";
            }

            msg += "\nTổng nhóm " + metricLabel(metric) + ": " + totalExp + " exp.\n";

            msg += "\nHướng dẫn (reply vào tin này):\n";
            msg += "- next hoặc next 2  → xem trang tiếp.\n";
            msg += "- kick 1 2          → kick theo số thứ tự.\n";
            msg += "- lọc 10            → kick người có exp " + metricLabel(metric) + " <= 10 (trừ thành viên mới 1 ngày).";

            return api.sendMessage(msg.trim(), threadID, (err, info) => {
                if (err || !info) return;
                if (!global.client) global.client = {};
                if (!global.client.handleReply) global.client.handleReply = [];

                global.client.handleReply.push({
                    name: module.exports.config.name,
                    messageID: info.messageID,
                    type: "checkPage",
                    data: {
                        view: "top",
                        metric,
                        page,
                        limit
                    }
                });
            });
        }

        // ---------------------------------------------------------------
        // INACTIVE: ai không hoạt động >= N ngày
        // ---------------------------------------------------------------
        if (type === "inactive") {
            const days = Number(args[1]) || 7;
            const list = await Membership.inactive(threadID, days);
            const set = new Set((event.participantIDs || []).map(String));
            const filtered = (list || []).filter(u => set.has(String(u.senderID)));

            if (!filtered.length) {
                return api.sendMessage("Không có thành viên nào không hoạt động trong " + days + " ngày qua.", threadID);
            }

            let msg = "";
            msg += "Thành viên không hoạt động trong " + days + " ngày qua:\n\n";

            for (let i = 0; i < filtered.length; i++) {
                const u = filtered[i];
                const name = u.name || await Users.getNameUser(u.senderID);
                if (u.daysSince == null) {
                    msg += (i + 1) + ". " + name + ": chưa từng hoạt động.\n";
                } else {
                    msg += (i + 1) + ". " + name + ": " + u.daysSince + " ngày trước.\n";
                }
            }

            return api.sendMessage(msg.trim(), threadID);
        }

        // ---------------------------------------------------------------
        // LAST: lần hoạt động cuối của cả nhóm
        // ---------------------------------------------------------------
        if (type === "last") {
            const rows = await Membership.getData(threadID);
            const set = new Set((event.participantIDs || []).map(String));
            const now = Date.now();

            const members = (rows || [])
                .filter(rec => set.has(String(rec.senderID)))
                .map(rec => {
                    const name = rec.name;
                    const h = rec.history || {};
                    const last = h.lastActive ? Number(h.lastActive) : null;
                    let label;
                    let priority;

                    if (!last) {
                        const join = h.lastJoin ? Number(h.lastJoin) : null;
                        if (join && (now - join) < 86400000) {
                            label = "mới tham gia";
                            priority = 2;
                        } else {
                            label = "chưa từng hoạt động";
                            priority = 0;
                        }
                    } else {
                        const diff = now - last;
                        const seconds = Math.floor(diff / 1000);
                        const minutes = Math.floor(seconds / 60);
                        const hours = Math.floor(minutes / 60);
                        const days = Math.floor(hours / 24);

                        if (days > 0) label = days + " ngày trước";
                        else if (hours > 0) label = hours + " giờ trước";
                        else if (minutes > 0) label = minutes + " phút trước";
                        else label = seconds + " giây trước";

                        priority = 1;
                    }

                    return {
                        uid: String(rec.senderID),
                        name,
                        label,
                        last,
                        priority
                    };
                });

            members.sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                return (a.last || 0) - (b.last || 0);
            });

            let msg = "";
            msg += "Thời gian không tương tác của các thành viên:\n\n";
            for (let i = 0; i < members.length; i++) {
                const m = members[i];
                msg += (i + 1) + ". " + (m.name || m.uid) + ": " + m.label + "\n";
            }

            return api.sendMessage(msg.trim(), threadID);
        }

        // ---------------------------------------------------------------
        // SLOT: top theo buổi trong ngày
        // ---------------------------------------------------------------
        if (type === "slot") {
            const rawSlot = args[1];
            const slotKey = resolveSlotKey(rawSlot);
            if (!slotKey) {
                return api.sendMessage(
                    "Cú pháp: check slot [dem|sang|trua|chieu|toi|khuya]\n" +
                    "Ví dụ: check slot sang",
                    threadID
                );
            }

            const limit = Number(args[2]) || 10;
            const set = new Set((event.participantIDs || []).map(String));

            const list = await Membership.topSlot(threadID, slotKey, "msg", limit + 20);
            const filtered = (list || []).filter(u => set.has(String(u.senderID))).slice(0, limit);

            if (!filtered.length) {
                return api.sendMessage(
                    "Chưa có ai gửi tin trong buổi " + SLOT_LABELS[slotKey] + " hôm nay.",
                    threadID
                );
            }

            let msg = "";
            msg += "Top tin nhắn buổi " + SLOT_LABELS[slotKey] + " (hôm nay):\n\n";
            for (let i = 0; i < filtered.length; i++) {
                const u = filtered[i];
                const name = u.name || await Users.getNameUser(u.senderID);
                msg += (i + 1) + ". " + name + ": " + u.exp + " tin nhắn\n";
            }

            return api.sendMessage(msg.trim(), threadID);
        }

        // ---------------------------------------------------------------
        // FIND: tìm theo tên/ID
        // ---------------------------------------------------------------
        if (type === "find") {
            const keyword = args.slice(1).join(" ").trim();
            if (!keyword) {
                return api.sendMessage(
                    "Cú pháp: check find <tên hoặc 1 phần ID>\n" +
                    "Ví dụ: check find anh",
                    threadID
                );
            }

            const set = new Set((event.participantIDs || []).map(String));
            const list = await Membership.find(threadID, keyword);
            const filtered = (list || []).filter(r => set.has(String(r.senderID)));

            if (!filtered.length) {
                return api.sendMessage(
                    "Không tìm thấy thành viên nào khớp với \"" + keyword + "\".",
                    threadID
                );
            }

            let msg = "";
            msg += "Kết quả tìm kiếm \"" + keyword + "\":\n\n";
            for (let i = 0; i < filtered.length; i++) {
                const r = filtered[i];
                const name = r.name || await Users.getNameUser(r.senderID);
                msg += (i + 1) + ". " + name + " – ID: " + r.senderID + "\n";
            }

            return api.sendMessage(msg.trim(), threadID);
        }

        // ---------------------------------------------------------------
        // VS: so sánh nhiều người
        // ---------------------------------------------------------------
        if (type === "vs") {
            const targetsSet = new Set();

            if (mentions.length > 0) {
                for (const id of mentions) targetsSet.add(String(id));
            } else if (replyID) {
                targetsSet.add(String(senderID));
                targetsSet.add(String(replyID));
            } else {
                const idArgs = args.slice(1).filter(a => /^\d{6,20}$/.test(a));
                for (const id of idArgs) targetsSet.add(String(id));
            }

            const targets = Array.from(targetsSet).slice(0, 5);

            if (targets.length < 2) {
                return api.sendMessage(
                    "Cú pháp: \n" +
                    "- check vs @A @B\n" +
                    "- Hoặc reply vào tin nhắn của 1 người, rồi gõ: check vs\n" +
                    "- Có thể so sánh 2–5 người.",
                    threadID
                );
            }

            const members = await getThreadStats(Membership, threadID, event.participantIDs);
            members.sort((a, b) => b.total - a.total);

            let msg = "So sánh hoạt động:\n\n";

            for (let i = 0; i < targets.length; i++) {
                const uid = targets[i];
                const rec = await Membership.getData(threadID, uid);
                if (!rec) {
                    const nameFallback = await Users.getNameUser(uid);
                    msg += (i + 1) + ". " + nameFallback + ": chưa có dữ liệu.\n\n";
                    continue;
                }

                const stats = extractStatsFromRecord(rec);
                const name = rec.name || await Users.getNameUser(uid);
                const history = rec.history || {};
                const now = Date.now();

                let lastMsg = "chưa từng";
                if (history.lastActive) {
                    const diff = now - Number(history.lastActive);
                    const minutes = Math.floor(diff / 60000);
                    if (minutes <= 0) lastMsg = "vừa xong";
                    else lastMsg = minutes + " phút trước";
                }

                const joinDuration = formatJoinDuration(history);
                const idx = members.findIndex(m => m.senderID === String(uid));
                const rankText = idx === -1 ? "chưa xếp hạng" : "hạng " + (idx + 1) + "/" + members.length;

                msg += (i + 1) + ". " + name + "\n";
                msg += "   - EXP ngày: " + stats.day + "\n";
                msg += "   - EXP tuần: " + stats.week + "\n";
                msg += "   - EXP tháng: " + stats.month + "\n";
                msg += "   - EXP tổng: " + stats.total + " (" + rankText + ")\n";
                msg += "   - Hoạt động cuối: " + lastMsg + "\n";
                msg += "   - Đã vào nhóm: " + joinDuration + "\n\n";
            }

            return api.sendMessage(msg.trim(), threadID);
        }

        // ---------------------------------------------------------------
        // INFO: thói quen tương tác 1 người (gọn ≤ 25 dòng)
        // ---------------------------------------------------------------
        if (type === "info") {
            const rec = await Membership.getData(threadID, targetID);
            if (!rec) {
                const name = await Users.getNameUser(targetID);
                return api.sendMessage("❌ Chưa có dữ liệu hoạt động cho " + name + ".", threadID);
            }

            const ck = rec.checktt || {};
            const stats = extractStatsFromRecord(rec);
            const history = rec.history || {};
            const name = rec.name || await Users.getNameUser(targetID);

            const now = Date.now();
            const joinDurationText = formatJoinDuration(history);

            // ====================== 1. HÔM NAY THEO KHUNG GIỜ ======================
            const dayData = ck.day || {};
            let todayTotal = 0;
            let bestSlotKey = null;
            let bestSlotVal = 0;

            for (const key of SLOT_KEYS) {
                const slot = dayData[key] || {};
                const v = Number(slot.msg || 0);
                todayTotal += v;
                if (v > bestSlotVal) {
                    bestSlotVal = v;
                    bestSlotKey = key;
                }
            }

            let bestSlotText = "chưa có dữ liệu hôm nay";
            if (bestSlotKey && bestSlotVal > 0) {
                const percent = todayTotal > 0 ? ((bestSlotVal / todayTotal) * 100).toFixed(1) : 0;
                bestSlotText = `${SLOT_LABELS[bestSlotKey]} (${bestSlotVal} tin, ~${percent}%)`;
            }

            // ====================== 2. TRONG TUẦN (theo thứ) ======================
            const weekData = ck.week || {};
            const weekdayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

            let bestWeekDay = null;
            let bestWeekVal = 0;
            let totalWeek = 0;

            const weekDetail = weekdayKeys.map(key => {
                const w = weekData[key] || {};
                const v = Number(w.msg || 0);
                totalWeek += v;
                if (v > bestWeekVal) {
                    bestWeekVal = v;
                    bestWeekDay = key;
                }
                return { key, val: v };
            });

            let bestWeekDayText = "chưa có dữ liệu tuần này";
            if (bestWeekDay && bestWeekVal > 0) {
                bestWeekDayText = `${WEEKDAY_LABELS[bestWeekDay]} (${bestWeekVal} tin)`;
            }

            // ====================== 3. NHẬN XÉT (KHÔNG DÙNG SEEN) ======================
            const totalMsgAll = stats.total;
            const cmdCount = history.commandUsage?.count ? Number(history.commandUsage.count) : 0;
            const styleLines = [];

            if (totalMsgAll <= 0) {
                styleLines.push("Gần như chưa tương tác trong nhóm.");
            } else {
                if (totalMsgAll >= 5000) styleLines.push("Mức độ tương tác rất cao.");
                else if (totalMsgAll >= 1000) styleLines.push("Tương tác ổn định, khá tích cực.");
                else styleLines.push("Tổng lượng tương tác còn hơi ít.");

                if (cmdCount >= 20) styleLines.push("Dùng lệnh bot thường xuyên.");
                else if (cmdCount === 0) styleLines.push("Gần như không dùng lệnh bot.");

                if (bestSlotKey === "toi" || bestSlotKey === "khuya") styleLines.push("Hay on buổi tối/khuya.");
                else if (bestSlotKey === "sang") styleLines.push("Có xu hướng on buổi sáng.");
                else if (bestSlotKey === "trua" || bestSlotKey === "chieu") styleLines.push("Thường tương tác ban ngày.");

                if (bestWeekDay) {
                    styleLines.push("Ngày hoạt động nhiều nhất: " + WEEKDAY_LABELS[bestWeekDay] + ".");
                }
            }

            // ====================== 4. HOẠT ĐỘNG CUỐI ======================
            let lastActiveText = "chưa từng";
            if (history.lastActive) {
                const diff = now - Number(history.lastActive);
                const minutes = Math.floor(diff / 60000);
                if (minutes <= 0) lastActiveText = "vừa xong";
                else if (minutes < 60) lastActiveText = minutes + " phút trước";
                else {
                    const hours = Math.floor(minutes / 60);
                    if (hours < 24) lastActiveText = hours + " giờ trước";
                    else {
                        const days = Math.floor(hours / 24);
                        lastActiveText = days + " ngày trước";
                    }
                }
            }

            // ====================== 5. GỘP SLOT HÔM NAY THÀNH 1 DÒNG ======================
            const slotSummary = SLOT_KEYS
                .map(k => `${SLOT_LABELS[k]}:${dayData[k]?.msg || 0}`)
                .join(" | ");

            // ====================== 6. FORMAT 15 DÒNG ======================
            let msg = "";

            // 1. Tiêu đề
            msg += "════════ THỐNG KÊ HOẠT ĐỘNG ════════\n"; // 1

            // 2. Tên
            msg += `👤 ${name}\n`; // 2

            // 3. Hôm nay / Tuần / Tháng / Tổng
            msg += `📊 Hôm nay: ${stats.day} | Tuần: ${stats.week} | Tháng: ${stats.month} | Tổng: ${stats.total}\n`; // 3

            // 4. Vào nhóm + lần cuối
            msg += `📅 Vào nhóm: ${joinDurationText} | Lần cuối: ${lastActiveText}\n`; // 4

            // 5. Khung giờ mạnh nhất
            msg += `⏰ Khung giờ mạnh nhất: ${bestSlotText}\n`; // 5

            // 6. Khung giờ hôm nay (gộp 1 dòng)
            msg += `🕒 Hôm nay theo khung giờ: ${slotSummary || "chưa có dữ liệu"}\n`; // 6

            // 7. Header tuần
            msg += "📆 Tuần này (Thứ 2 → Chủ Nhật):\n"; // 7

            // 8–14: Thứ 2 → Chủ nhật, mỗi ngày 1 dòng
            const weekOrder = [
                { key: "mon", label: "• Thứ Hai" },
                { key: "tue", label: "• Thứ Ba" },
                { key: "wed", label: "• Thứ Tư" },
                { key: "thu", label: "• Thứ Năm" },
                { key: "fri", label: "• Thứ Sáu" },
                { key: "sat", label: "• Thứ Bảy" },
                { key: "sun", label: "• Chủ Nhật" }
            ];

            for (const d of weekOrder) {
                const v = Number(weekData[d.key]?.msg || 0);
                msg += `${d.label}: ${v} tin\n`;
            }

            // 15. Nhận xét (gom 1 dòng)
            const review = styleLines.length
                ? styleLines.slice(0, 3).join("; ")
                : "Chưa đủ dữ liệu để nhận xét.";
            msg += `📝 Nhận xét: ${review}`;

            return api.sendMessage(msg.trim(), threadID);
        }

        // ---------------------------------------------------------------
        // HELP
        // ---------------------------------------------------------------
        if (type === "help") {
            let msg = "";
            msg += "Lệnh check - thống kê hoạt động trong nhóm\n\n";

            msg += "1. Cách gọi cơ bản\n";
            msg += "- check            → xem bản thân\n";
            msg += "- check @tag       → xem người được tag\n";
            msg += "- reply \"check\"   → xem người được reply\n\n";

            msg += "2. Thống kê EXP\n";
            msg += "- check day        → top EXP ngày\n";
            msg += "- check week       → top EXP tuần\n";
            msg += "- check month      → top EXP tháng\n";
            msg += "- check total      → top EXP tổng\n";
            msg += "- check top [loại] → top 10 (day/week/month/total)\n";
            msg += "- check all [loại] → xem toàn nhóm (có phân trang)\n";
            msg += "- check avg        → EXP trung bình nhóm\n";
            msg += "- check rank [@tag]→ xếp hạng EXP tổng\n\n";

            msg += "3. Theo buổi trong ngày\n";
            msg += "- check slot [dem|sang|trua|chieu|toi|khuya]\n";
            msg += "  Ví dụ: check slot sang\n\n";

            msg += "4. Tìm kiếm, so sánh, phân tích\n";
            msg += "- check find <tên/ID> → tìm thành viên theo tên hoặc một phần ID\n";
            msg += "- check vs @A @B      → so sánh hoạt động 2–5 người\n";
            msg += "- check info [@tag]   → xem thói quen tương tác của 1 người\n";
            msg += "  (khung giờ hay on, ngày nào trong tuần hay hoạt động, nhận xét kiểu tương tác)\n\n";

            msg += "5. Thành viên\n";
            msg += "- check new [ngày]      → thành viên mới\n";
            msg += "- check last            → lần hoạt động cuối của mọi người\n";
            msg += "- check inactive [ngày] → ai không hoạt động ≥ N ngày\n\n";

            msg += "6. Quản lý thống kê\n";
            msg += "- check reset → reset số liệu theo ngày/tuần/tháng (dựa trên Membership.resetChecktt)\n\n";

            msg += "7. Gợi ý khi dùng bảng có phân trang\n";
            msg += "- reply \"next\" hoặc \"next 2\" để xem các trang sau\n";
            msg += "- reply \"kick 1 2\" để kick theo số thứ tự\n";
            msg += "- reply \"lọc 10\" để kick người có exp thấp (trừ thành viên mới 1 ngày)";

            return api.sendMessage(msg, threadID);
        }

        // ---------------------------------------------------------------
        // MẶC ĐỊNH: xem chi tiết 1 người, có thống kê theo buổi
        // ---------------------------------------------------------------
        const rec = await Membership.getData(threadID, targetID);
        if (!rec) {
            const name = await Users.getNameUser(targetID);
            return api.sendMessage("Chưa có dữ liệu hoạt động cho " + name + ".", threadID);
        }

        const stats = extractStatsFromRecord(rec);
        const name = rec.name || await Users.getNameUser(targetID);
        const history = rec.history || {};
        const ck = rec.checktt || {};
        const now = Date.now();

        let lastMsg = "chưa từng";
        if (history.lastActive) {
            const diff = now - Number(history.lastActive);
            const minutes = Math.floor(diff / 60000);
            if (minutes <= 0) lastMsg = "vừa xong";
            else lastMsg = minutes + " phút trước";
        }

        const joinDuration = formatJoinDuration(history);

        const members = await getThreadStats(Membership, threadID, event.participantIDs);
        members.sort((a, b) => b.total - a.total);
        const topIndex = members.findIndex(m => m.senderID === String(targetID)) + 1;

        let permission;
        const superAdmins = global.config?.admins?.superADMIN || [];
        const admins = global.config?.admins?.ADMIN || [];
        if (superAdmins.includes(targetID)) {
            permission = "Super Admin";
        } else if (admins.includes(targetID)) {
            permission = "Admin";
        } else if (await isThreadAdmin(Threads, api, threadID, targetID)) {
            permission = "Quản trị viên";
        } else {
            permission = "Thành viên";
        }

        let level = "Mới vào";
        const total = stats.total;
        if (total >= 50000) level = "Cao thủ";
        else if (total >= 20000) level = "Chăm chỉ";
        else if (total >= 5000) level = "Tán gẫu thủ";
        else if (total >= 1000) level = "Thành viên mới";

        const day = ck.day || {};
        const slotLines = [];
        for (const key of SLOT_KEYS) {
            const slot = day[key] || {};
            const msgCount = Number(slot.msg || 0);
            slotLines.push("- " + (SLOT_LABELS[key] || key) + ": " + msgCount + " tin nhắn");
        }

        let msg = "";
        msg += "Thông tin thành viên\n\n";
        msg += "1. Tên: " + name + "\n";
        msg += "2. Chức vụ: " + permission + "\n";
        msg += "3. Hoạt động cuối: " + lastMsg + "\n";
        msg += "4. Đã vào nhóm: " + joinDuration + "\n";
        msg += "5. EXP ngày: " + stats.day + "\n";
        msg += "6. EXP tuần: " + stats.week + "\n";
        msg += "7. EXP tháng: " + stats.month + "\n";
        msg += "8. EXP tổng: " + stats.total + "\n";
        if (topIndex > 0) {
            msg += "9. Vị trí EXP tổng: " + topIndex + "/" + members.length + "\n";
        }
        msg += "10. Danh hiệu: " + level + "\n";

        msg += "\nChi tiết số tin nhắn hôm nay theo buổi:\n";
        msg += slotLines.join("\n");

        return api.sendMessage(msg.trim(), threadID);
    },

    async handleEvent({ api, event, Threads, Membership }) {
        const threadID = event.threadID;
        const senderID = event.senderID;

        if (!threadID || !senderID) return;

        const bodyRaw = (event.body || "").trim();
        const hasContent = bodyRaw || (event.attachments && event.attachments.length);
        if (!hasContent) return;

        // 1) Luôn +1 msg
        try {
            await Membership.addCheck(threadID, senderID);
        } catch (e) {
            console.error("[check.handleEvent] lỗi addCheck:", e);
        }

        // Không có text thì khỏi check lệnh
        if (!bodyRaw) return;

        // 2) Lấy prefix (ưu tiên prefix box, rồi mới tới prefix global)
        let prefix = global.config.prefix;

        try {
            let threadPrefix;
            if (Threads && typeof Threads.getData === "function") {
                const tData = await Threads.getData(threadID);
                threadPrefix = tData?.data?.prefix; // KHÔNG dùng || ""
            }

            // Nếu threadPrefix tồn tại (kể cả ""), thì dùng nó
            if (threadPrefix !== undefined) {
                prefix = threadPrefix;
            }

        } catch (e) {
            console.error("[check.handleEvent] lỗi lấy prefix:", e);
            if (global.config) {
                prefix = global.config.prefix;
            } else {
                prefix = "!";
            }
        }

        // Không dùng prefix (null/undefined/empty) → không thống kê lệnh
        if (prefix === null || prefix === undefined || prefix === "") return;

        // 3) Tìm prefix trong body (ở đâu cũng được)
        const idx = bodyRaw.indexOf(prefix);
        if (idx === -1) return; // không chứa prefix → không phải lệnh

        // 4) Tách tên lệnh từ sau prefix
        const content = bodyRaw.slice(idx + prefix.length).trim();
        if (!content) return;

        const cmdName = content.split(/\s+/)[0].toLowerCase();
        if (!cmdName) return;

        // 5) Kiểm tra có phải lệnh hợp lệ trong global.client.commands không
        const cmdMap = global.client && global.client.commands;
        let isValidCommand = false;

        if (cmdMap) {
            if (typeof cmdMap.has === "function") {
                // Map / Collection
                isValidCommand = cmdMap.has(cmdName);
            } else if (typeof cmdMap.get === "function") {
                // một số lib dùng get
                isValidCommand = !!cmdMap.get(cmdName);
            } else {
                // object thường
                isValidCommand = !!cmdMap[cmdName];
            }
        }

        if (!isValidCommand) {
            // không phải lệnh bot → không tính vào commandUsage
            return;
        }

        // 6) Cập nhật cmd + history.commandUsage
        try {
            // +1 cmd trong checktt
            if (typeof Membership.cmd === "function") {
                await Membership.cmd(threadID, senderID);
            }

            const rec = await Membership.getData(threadID, senderID);
            if (!rec) return;

            const history = rec.history || {};
            const now = Date.now();

            const usage = history.commandUsage || {
                count: 0,
                favorites: {},
                lastCommand: null,
                lastTime: null
            };

            // đếm tổng số lần dùng lệnh
            usage.count = (usage.count || 0) + 1;

            // đếm lệnh hay dùng
            const favorites = usage.favorites || {};
            favorites[cmdName] = (favorites[cmdName] || 0) + 1;
            usage.favorites = favorites;

            // lưu tên lệnh cuối cùng (kèm prefix)
            usage.lastCommand = prefix + cmdName;
            usage.lastTime = now;

            history.commandUsage = usage;
            history.lastUseBot = now;

            await Membership.updateData({
                [threadID]: {
                    [senderID]: { history }
                }
            });
        } catch (e) {
            console.error("[check.handleEvent] lỗi thống kê lệnh:", e);
        }
    }


};

// ===================================================================
// handleReply: phân trang, kick, lọc
// ===================================================================

module.exports.handleReply = async ({ api, event, handleReply, Users, Threads, Membership }) => {
    if (handleReply.type !== "checkPage") return;

    const { view, metric, page: currentPage, limit } = handleReply.data;
    const threadID = event.threadID;
    const participants = event.participantIDs || [];
    const body = (event.body || "").trim().toLowerCase();

    const members = await getThreadStats(Membership, threadID, participants);
    if (!members.length) {
        return api.sendMessage("Nhóm không còn dữ liệu hoạt động.", threadID);
    }

    if (!["day", "week", "month", "total"].includes(metric)) {
        return api.sendMessage("Kiểu thống kê không hợp lệ.", threadID);
    }

    members.sort((a, b) => b[metric] - a[metric]);

    // -----------------------------------------------------------
    // KICK THEO INDEX
    // -----------------------------------------------------------
    if (body.startsWith("kick")) {
        const botID = api.getCurrentUserID();
        const isAdmin = await isThreadAdmin(Threads, api, threadID, botID);
        if (!isAdmin) {
            return api.sendMessage("Bot cần quyền quản trị viên để sử dụng chức năng kick.", threadID);
        }

        const indices = body.match(/\d+/g)?.map(n => parseInt(n, 10) - 1).filter(i => i >= 0);
        if (!indices || indices.some(isNaN)) {
            return api.sendMessage("Cú pháp sai. Dùng: kick 1 2 5", threadID);
        }

        const targets = indices.map(i => members[i]).filter(Boolean);
        if (!targets.length) {
            return api.sendMessage("Không tìm thấy thành viên tương ứng với số đã nhập.", threadID);
        }

        const kicked = [];
        for (const t of targets) {
            try {
                await api.removeUserFromGroup(t.senderID, threadID);
                const name = t.name || await Users.getNameUser(t.senderID);
                kicked.push(name);
                await new Promise(r => setTimeout(r, 800));
            } catch (e) {
                console.log("Không thể kick:", e.message);
            }
        }

        if (!kicked.length) {
            return api.sendMessage("Không kick được ai.", threadID);
        }

        let msg = "";
        msg += "Đã kick các thành viên:\n\n";
        for (let i = 0; i < kicked.length; i++) {
            msg += (i + 1) + ". " + kicked[i] + "\n";
        }

        return api.sendMessage(msg.trim(), threadID);
    }

    // -----------------------------------------------------------
    // LỌC EXP THẤP
    // -----------------------------------------------------------
    const filterMatch = body.match(/^lọc\s+(\d+)/);
    if (filterMatch) {
        const botID = api.getCurrentUserID();
        const isAdmin = await isThreadAdmin(Threads, api, threadID, botID);
        if (!isAdmin) {
            return api.sendMessage("Bot cần quyền quản trị viên để sử dụng chức năng lọc.", threadID);
        }

        const expThreshold = parseInt(filterMatch[1], 10);
        const now = Date.now();
        const oneDay = 86400000;

        const toKick = members.filter(u => {
            const h = u.history || {};
            const isNew = h.lastJoin && (now - Number(h.lastJoin)) <= oneDay;
            if (isNew) return false;
            return (u[metric] || 0) <= expThreshold;
        });

        if (!toKick.length) {
            return api.sendMessage("Không có ai đủ điều kiện để kick (exp thấp và không phải thành viên mới).", threadID);
        }

        const kicked = [];
        for (const u of toKick) {
            try {
                await api.removeUserFromGroup(u.senderID, threadID);
                const name = u.name || await Users.getNameUser(u.senderID);
                kicked.push(name);
                await new Promise(r => setTimeout(r, 800));
            } catch (e) {
                console.log("Không thể kick:", e.message);
            }
        }

        let msg = "";
        msg += "Đã kick " + kicked.length + " thành viên có exp " + metricLabel(metric) + " <= " + expThreshold + ":\n\n";
        for (let i = 0; i < kicked.length; i++) {
            msg += (i + 1) + ". " + kicked[i] + "\n";
        }

        return api.sendMessage(msg.trim(), threadID);
    }

    // -----------------------------------------------------------
    // NEXT TRANG
    // -----------------------------------------------------------
    if (body.startsWith("next")) {
        let nextPage = currentPage + 1;
        const match = body.match(/next\s+(\d+)/);
        if (match) nextPage = parseInt(match[1], 10);

        const totalPages = Math.ceil(members.length / limit) || 1;
        if (nextPage < 1 || nextPage > totalPages) {
            return api.sendMessage("Trang không hợp lệ. Nhập số từ 1 đến " + totalPages + ".", threadID);
        }

        const start = (nextPage - 1) * limit;
        const end = Math.min(start + limit, members.length);
        const pageData = members.slice(start, end);

        let msg = "";
        if (view === "all") {
            msg += "Thống kê EXP của toàn nhóm (theo " + metricLabel(metric) + ")\n";
            msg += "Trang " + nextPage + "/" + totalPages + "\n\n";

            for (let i = 0; i < pageData.length; i++) {
                const u = pageData[i];
                const name = u.name || await Users.getNameUser(u.senderID);
                msg += (start + i + 1) + ". " + name +
                    " | Ngày " + u.day +
                    " | Tuần " + u.week +
                    " | Tháng " + u.month +
                    " | Tổng " + u.total + "\n";
            }

            const sum = members.reduce((acc, m) => {
                acc.day += m.day;
                acc.week += m.week;
                acc.month += m.month;
                acc.total += m.total;
                return acc;
            }, { day: 0, week: 0, month: 0, total: 0 });

            const activeCount = members.filter(m => m[metric] > 0).length;
            const metricSum = sum[metric];
            const avgActive = activeCount > 0 ? (metricSum / activeCount).toFixed(1) : 0;
            const positives = members.map(m => m[metric]).filter(v => v > 0);
            const minPositive = positives.length ? Math.min(...positives) : 0;

            msg += "\nTổng quan:\n";
            msg += "1. Thành viên có hoạt động " + metricLabel(metric) + ": " + activeCount + "/" + members.length + "\n";
            msg += "2. Trung bình EXP " + metricLabel(metric) + " (chỉ tính người có hoạt động): " + avgActive + "\n";
            if (positives.length) {
                msg += "3. Mức thấp nhất nhưng vẫn có hoạt động: " + minPositive + "\n";
            }

            msg += "\nTổng nhóm:\n";
            msg += "- Ngày: " + sum.day + "\n";
            msg += "- Tuần: " + sum.week + "\n";
            msg += "- Tháng: " + sum.month + "\n";
            msg += "- Tổng: " + sum.total + "\n";
        } else {
            msg += "Top EXP " + metricLabel(metric) + " của nhóm\n";
            msg += "Trang " + nextPage + "/" + totalPages + "\n\n";

            for (let i = 0; i < pageData.length; i++) {
                const u = pageData[i];
                const name = u.name || await Users.getNameUser(u.senderID);
                msg += (start + i + 1) + ". " + name + ": " + u[metric] + "\n";
            }

            const totalExp = members.reduce((sum, u) => sum + u[metric], 0);
            const activeCount = members.filter(m => m[metric] > 0).length;
            const avgActive = activeCount > 0 ? (totalExp / activeCount).toFixed(1) : 0;
            const positives = members.map(m => m[metric]).filter(v => v > 0);
            const minPositive = positives.length ? Math.min(...positives) : 0;

            msg += "\nTổng quan:\n";
            msg += "1. Thành viên có hoạt động " + metricLabel(metric) + ": " + activeCount + "/" + members.length + "\n";
            msg += "2. Trung bình EXP " + metricLabel(metric) + " (chỉ tính người có hoạt động): " + avgActive + "\n";
            if (positives.length) {
                msg += "3. Mức thấp nhất nhưng vẫn có hoạt động: " + minPositive + "\n";
            }

            msg += "\nTổng nhóm " + metricLabel(metric) + ": " + totalExp + " exp.\n";
        }

        msg += "\nHướng dẫn (reply tiếp):\n";
        msg += "- next hoặc next 2  → xem các trang sau.\n";
        msg += "- kick 1 2          → kick theo số thứ tự.\n";
        msg += "- lọc 10            → kick người có exp " + metricLabel(metric) + " thấp (trừ thành viên mới 1 ngày).";

        return api.sendMessage(msg.trim(), threadID, (err, info) => {
            if (err || !info) return;
            if (!global.client) global.client = {};
            if (!global.client.handleReply) global.client.handleReply = [];

            global.client.handleReply.push({
                name: module.exports.config.name,
                messageID: info.messageID,
                type: "checkPage",
                data: { view, metric, page: nextPage, limit }
            });
        });
    }
};
