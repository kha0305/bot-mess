"use strict";

const moment = require("moment-timezone");
let createCanvas = null;
const CHECKTT_CHART_ENABLED = String(process.env.CHECKTT_CHART_ENABLED || "false").toLowerCase() === "true";
if (CHECKTT_CHART_ENABLED) {
    try {
        ({ createCanvas } = require("canvas"));
    } catch (e) {
        try {
            ({ createCanvas } = require("@napi-rs/canvas"));
        } catch {
            console.warn("[checktt] Bật chart nhưng thiếu canvas/@napi-rs/canvas, sẽ gửi text.");
        }
    }
}
const fs = require("fs");
const path = require("path");

module.exports = ({ api, db }) => {
    const { Threads, Membership, Users } = db;
    const TZ = "Asia/Ho_Chi_Minh";

    const WEEK_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const WEEK_LABEL = {
        mon: "Thứ 2",
        tue: "Thứ 3",
        wed: "Thứ 4",
        thu: "Thứ 5",
        fri: "Thứ 6",
        sat: "Thứ 7",
        sun: "Chủ nhật"
    };

    const CACHE_DIR = path.join(__dirname, "cache");

    const ensureCacheDir = () => {
        try { if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true }); }
        catch (e) { console.error("[checktt] tạo cache lỗi:", e); }
    };

    const getName = async (uid) => {
        if (!Users) return String(uid);
        if (typeof Users.getNameUser === "function") {
            try { const name = await Users.getNameUser(uid); if (name) return name; } catch (e) { console.error(e); }
        }
        if (typeof Users.getData === "function") {
            try { const u = await Users.getData(uid); if (u?.name) return u.name; } catch (e) { console.error(e); }
        }
        return String(uid);
    };

    const formatTop = async (list, label, limit = 10) => {
        if (!Array.isArray(list) || !list.length) return [];
        const out = [], medals = ["🥇", "🥈", "🥉"], len = Math.min(list.length, limit);
        out.push(`🏆 Top ${limit} tương tác theo ${label}:`);
        for (let i = 0; i < len; i++) {
            const item = list[i], id = item.senderID || item.userID;
            const name = item.name || (await getName(id));
            out.push(`${medals[i] || `${i + 1}.`} ${name}: ${item.exp}`);
        }
        out.push("");
        return out;
    };

    const buildDayTop = (members, limit = 10) =>
        members.map(m => {
            const tong = m.checktt?.day?.tong || {};
            return { senderID: m.senderID, name: m.name, exp: Number(tong.total || 0) };
        }).filter(x => x.exp > 0).sort((a, b) => b.exp - a.exp).slice(0, limit);

    const buildTotals = (members) => {
        let totalDay = 0, totalMonth = 0, inactiveToday = 0;
        for (const m of members) {
            const ck = m.checktt || {}, d = ck.day?.tong || {}, mo = ck.month?.tong || {};
            const today = Number(d.total || 0);
            totalDay += today;
            totalMonth += Number(mo.total || 0);
            if (!today) inactiveToday++;
        }
        return { totalDay, totalMonth, inactiveToday };
    };

    const buildWeekStats = (members) => {
        const totalsByDay = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
        let totalWeek = 0;
        for (const m of members) {
            const week = m.checktt?.week || {};
            for (const key of WEEK_KEYS) {
                const val = Number(week[key]?.total || 0);
                totalsByDay[key] += val;
                totalWeek += val;
            }
        }
        let bestKey = null, bestVal = 0;
        for (const key of WEEK_KEYS) {
            const v = totalsByDay[key];
            if (v > bestVal) bestVal = v, bestKey = key;
        }
        const bestPercent = totalWeek ? (bestVal / totalWeek) * 100 : 0;
        return { totalWeek, totalsByDay, bestKey, bestVal, bestPercent: Number.isFinite(bestPercent) ? bestPercent : 0 };
    };

    const buildMonthTopMembers = (members, curMonth, limit = 10) =>
        members.map(m => {
            const bucket = m.checktt?.month?.[curMonth] || {};
            return { senderID: m.senderID, name: m.name, exp: Number(bucket.total || 0) };
        }).filter(x => x.exp > 0).sort((a, b) => b.exp - a.exp).slice(0, limit);

    const drawBarChart = ({ labels, values, title, subTitle, highlightIndex = -1, topTitle, topList = [] }) => {
        if (typeof createCanvas !== "function") return null;
        const width = 1000, height = 560;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        const bg = ctx.createLinearGradient(0, 0, 0, height);
        bg.addColorStop(0, "#0f172a");
        bg.addColorStop(0.5, "#020617");
        bg.addColorStop(1, "#111827");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);

        const padding = { top: 70, right: 50, bottom: 80, left: 70 };
        const fullW = width - padding.left - padding.right;
        const chartH = height - padding.top - padding.bottom;

        const leftW = fullW * 0.3;
        const chartW = fullW - leftW - 24;
        const chartX = padding.left + leftW + 24;
        const chartY = padding.top;

        ctx.fillStyle = "rgba(15,23,42,0.85)";
        ctx.fillRect(padding.left - 20, padding.top - 40, fullW + 40, chartH + 80);

        const tGrad = ctx.createLinearGradient(0, 0, width, 0);
        tGrad.addColorStop(0, "#f97316");
        tGrad.addColorStop(0.5, "#eab308");
        tGrad.addColorStop(1, "#22c55e");

        ctx.font = "24px Sans-Serif";
        ctx.textAlign = "center";
        ctx.fillStyle = tGrad;
        ctx.fillText(title, width / 2, 40);

        if (subTitle) {
            ctx.font = "14px Sans-Serif";
            ctx.fillStyle = "#e5e7eb";
            ctx.fillText(subTitle, width / 2, 62);
        }

        ctx.save();
        const panelX = padding.left, panelY = padding.top, panelW = leftW, panelH = chartH;
        const pBg = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY + panelH);
        pBg.addColorStop(0, "rgba(15,23,42,0.95)");
        pBg.addColorStop(1, "rgba(30,64,175,0.95)");
        ctx.fillStyle = pBg;
        ctx.fillRect(panelX, panelY, panelW, panelH);

        ctx.fillStyle = "#fbbf24";
        ctx.font = "16px Sans-Serif";
        ctx.textAlign = "left";
        ctx.fillText(topTitle || "Top 10", panelX + 14, panelY + 26);

        ctx.strokeStyle = "rgba(252,211,77,0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(panelX + 12, panelY + 32);
        ctx.lineTo(panelX + panelW - 12, panelY + 32);
        ctx.stroke();

        ctx.font = "13px Sans-Serif";
        let y = panelY + 52;
        const maxShow = Math.min(10, topList.length);

        for (let i = 0; i < maxShow; i++) {
            const item = topList[i];
            const rank = i + 1;
            const name = item?.name ? String(item.name) : `#${rank}`;
            const exp = typeof item?.exp === "number" ? item.exp : 0;

            if (rank === 1) ctx.fillStyle = "#f97316";
            else if (rank === 2) ctx.fillStyle = "#22c55e";
            else if (rank === 3) ctx.fillStyle = "#38bdf8";
            else ctx.fillStyle = "#e5e7eb";

            const rLabel = rank <= 3 ? `TOP ${rank}` : `${rank}.`;
            ctx.fillText(rLabel, panelX + 14, y);

            ctx.fillStyle = "#e5e7eb";
            const shortName = name.length > 18 ? name.slice(0, 17) + "…" : name;
            ctx.fillText(shortName, panelX + 70, y);

            ctx.fillStyle = "#a5b4fc";
            ctx.textAlign = "right";
            ctx.fillText(String(exp), panelX + panelW - 14, y);
            ctx.textAlign = "left";

            y += 20;
        }

        ctx.restore();

        const maxVal = Math.max(...values, 1);
        const barW = chartW / (values.length * 1.8);
        const gap = barW * 0.8;

        ctx.strokeStyle = "rgba(148,163,184,0.4)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(chartX, chartY);
        ctx.lineTo(chartX, chartY + chartH);
        ctx.lineTo(chartX + chartW, chartY + chartH);
        ctx.stroke();

        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.font = "11px Sans-Serif";
        ctx.fillStyle = "#9ca3af";
        ctx.textAlign = "right";

        const gridCount = 4;
        for (let i = 1; i <= gridCount; i++) {
            const ratio = i / gridCount;
            const yLine = chartY + chartH - chartH * ratio;
            ctx.beginPath();
            ctx.moveTo(chartX, yLine);
            ctx.lineTo(chartX + chartW, yLine);
            ctx.strokeStyle = "rgba(148,163,184,0.25)";
            ctx.stroke();
            ctx.fillText(String(Math.round(maxVal * ratio)), chartX - 8, yLine + 4);
        }
        ctx.setLineDash([]);

        const palette = ["#f97316", "#22c55e", "#38bdf8", "#a855f7", "#eab308", "#f43f5e", "#2dd4bf", "#6366f1", "#facc15", "#fb7185"];
        const points = [];
        ctx.textAlign = "center";
        ctx.font = "12px Sans-Serif";

        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            const x = chartX + i * (barW + gap) + gap;
            const h = (v / maxVal) * (chartH * 0.9);
            const yTop = chartY + chartH - h;

            ctx.fillStyle = palette[i % palette.length];
            ctx.save();
            ctx.shadowColor = "rgba(15,23,42,0.6)";
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 2;
            ctx.fillRect(x, yTop, barW, h);
            ctx.restore();

            ctx.fillStyle = "#e5e7eb";
            ctx.fillText(labels[i], x + barW / 2, chartY + chartH + 18);

            if (v > 0) {
                ctx.fillStyle = "#f9fafb";
                ctx.fillText(String(v), x + barW / 2, yTop - 6);
            }

            points.push({ x: x + barW / 2, y: yTop });
        }

        if (points.length >= 2) {
            ctx.beginPath();
            points.forEach((p, i) => (!i ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.strokeStyle = "#fbbf24";
            ctx.lineWidth = 2.5;
            ctx.stroke();

            for (let i = 0; i < points.length; i++) {
                const p = points[i];
                ctx.beginPath();
                ctx.arc(p.x, p.y, i === highlightIndex ? 5 : 4, 0, Math.PI * 2);
                ctx.fillStyle = i === highlightIndex ? "#f97316" : "#22c55e";
                ctx.fill();
                ctx.strokeStyle = "#0f172a";
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        return canvas;
    };

    const sendChart = async (tid, bodyText, chartTitle, chartSubTitle, labels, values, highlightIndex, topTitle, topList) => {
        try {
            if (typeof createCanvas !== "function") {
                await api.sendMessage(bodyText, tid);
                return;
            }
            ensureCacheDir();
            const canvas = drawBarChart({ labels, values, title: chartTitle, subTitle: chartSubTitle, highlightIndex, topTitle, topList });
            if (!canvas) {
                await api.sendMessage(bodyText, tid);
                return;
            }
            const buffer = canvas.toBuffer("image/png");
            const fileName = `chart_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
            const filePath = path.join(CACHE_DIR, fileName);
            fs.writeFileSync(filePath, buffer);
            await api.sendMessage({ body: bodyText, attachment: fs.createReadStream(filePath) }, tid);
            fs.unlink(filePath, () => { });
        } catch (e) {
            console.error("[checktt] gửi chart lỗi:", e);
        }
    };

    if (!Threads?.getAll || !Membership?.getData) {
        console.error("[checktt] thiếu Threads.getAll hoặc Membership.getData");
        return;
    }

    const hasReset = typeof Membership.resetChecktt === "function";
    const hasTop = typeof Membership.top === "function";
    const hasStreaks = typeof Membership.streaks === "function";

    let lastKey = "";
    let running = false;

    const runJob = async () => {
        const now = moment().tz(TZ);
        const isSunday = now.day() === 0;
        const isLastDay = now.date() === now.daysInMonth();
        const currentMonth = now.month() + 1;

        let threads;
        try { threads = await Threads.getAll(); }
        catch (e) { console.error("[checktt] Threads.getAll lỗi:", e); return; }

        for (const t of threads || []) {
            const tid = String(t.threadID || "");
            if (!tid) continue;

            try {
                const members = await Membership.getData(tid);
                if (!Array.isArray(members) || !members.length) continue;

                if (typeof Membership.updateStreak === "function") {
                    const jobs = [];
                    for (const m of members) {
                        const sid = m.senderID;
                        if (!sid) continue;
                        jobs.push(Membership.updateStreak(tid, sid).catch(e => (console.error(e), null)));
                    }
                    if (jobs.length) await Promise.all(jobs);
                }

                const { totalDay, totalMonth, inactiveToday } = buildTotals(members);

                let streakTop = [];
                if (hasStreaks) {
                    try { streakTop = await Membership.streaks(tid, { limit: 3 }); }
                    catch (e) { console.error(e); }
                }

                const dayLines = [];
                dayLines.push("📊 THỐNG KÊ TƯƠNG TÁC HÔM NAY");
                dayLines.push("");
                const dayTop = buildDayTop(members, 10);
                dayLines.push(...(await formatTop(dayTop, "ngày", 10)));
                dayLines.push("📌 TỔNG QUAN NGÀY");
                dayLines.push(`- Không tương tác hôm nay: ${inactiveToday} người`);
                dayLines.push(`- Tổng điểm hôm nay: ${totalDay}`);
                dayLines.push("");
                dayLines.push('💡 Gợi ý: dùng lệnh "inactive 3" để xem ai không tương tác ≥ 3 ngày.');
                await api.sendMessage(dayLines.join("\n"), tid);

                if (isLastDay) {
                    const monthTop = buildMonthTopMembers(members, currentMonth, 10);
                    const monthLines = [];
                    monthLines.push("📊 THỐNG KÊ TƯƠNG TÁC THÁNG");
                    monthLines.push("");
                    monthLines.push(`- Tổng điểm tháng: ${totalMonth}`);
                    monthLines.push("");
                    monthLines.push(...(await formatTop(monthTop, "tháng", 10)));

                    const labels = monthTop.map((m, idx) => `#${idx + 1}`);
                    const values = monthTop.map(m => m.exp);

                    await sendChart(
                        tid,
                        monthLines.join("\n"),
                        "Biểu đồ top thành viên trong tháng",
                        "Cột thể hiện điểm tương tác theo thứ hạng",
                        labels,
                        values,
                        0,
                        "Top 10 thành viên tháng",
                        monthTop
                    );

                    if (hasReset) await Membership.resetChecktt(tid);
                    continue;
                }

                if (isSunday) {
                    const stats = buildWeekStats(members);
                    const { totalWeek, totalsByDay, bestKey, bestVal, bestPercent } = stats;

                    const weekLines = [];
                    weekLines.push("📊 THỐNG KÊ TƯƠNG TÁC TUẦN");
                    weekLines.push("");
                    weekLines.push(`- Tổng điểm tuần: ${totalWeek}`);

                    if (bestKey) {
                        const lb = WEEK_LABEL[bestKey] || bestKey;
                        weekLines.push(`- Ngày sôi động nhất: ${lb} (${bestVal} điểm · ${bestPercent.toFixed(1)}%)`);
                    }

                    weekLines.push("");
                    weekLines.push("- Phân bố theo ngày:");

                    if (totalWeek > 0) {
                        for (const key of WEEK_KEYS) {
                            const val = totalsByDay[key];
                            if (!val) continue;
                            const p = (val / totalWeek) * 100;
                            weekLines.push(`  • ${WEEK_LABEL[key]}: ${val} (${p.toFixed(1)}%)`);
                        }
                    } else weekLines.push("  • Chưa có tương tác trong tuần.");

                    let topWeek = [];
                    if (hasTop) {
                        try {
                            topWeek = await Membership.top(tid, { by: "total", window: "week", limit: 10 });
                        } catch (e) { console.error(e); }
                    }

                    const labels = WEEK_KEYS.map(k => WEEK_LABEL[k]);
                    const values = WEEK_KEYS.map(k => totalsByDay[k]);
                    const hIndex = bestKey ? WEEK_KEYS.indexOf(bestKey) : -1;

                    await sendChart(
                        tid,
                        weekLines.join("\n"),
                        "Biểu đồ tương tác theo tuần",
                        "Cột là tổng điểm mỗi ngày, đường vàng là xu hướng",
                        labels,
                        values,
                        hIndex,
                        "Top 10 thành viên tuần",
                        topWeek
                    );

                    if (hasReset) await Membership.resetChecktt(tid);
                    continue;
                }

                if (hasReset) await Membership.resetChecktt(tid);
            } catch (e) {
                console.error("[checktt] lỗi thread", tid, e);
            }
        }
    };

    setInterval(async () => {
        try {
            const now = moment().tz(TZ);
            const key = now.format("YYYY-MM-DD");
            if (now.hour() !== 23 || now.minute() !== 59) return;
            if (lastKey === key || running) return;
            lastKey = key;
            running = true;
            await runJob();
        } catch (e) {
            console.error("[checktt] interval lỗi:", e);
        } finally {
            running = false;
        }
    }, 30 * 1000).unref();
};
