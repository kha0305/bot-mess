module.exports = function ({ Membership, sequelize }) {
    const { Op, QueryTypes } = require('sequelize');

    const parseMaybeJSON = (value, fallback) => {
        if (value === null || value === undefined) return fallback;
        if (typeof value === "object") return value;
        if (typeof value !== "string") return fallback;
        const text = value.trim();
        if (!text) return fallback;
        try { return JSON.parse(text); } catch { return fallback; }
    };

    const normalizeMemberRow = (row) => {
        if (!row || typeof row !== "object") return row;
        return {
            ...row,
            threadID: String(row.threadID ?? ""),
            senderID: String(row.senderID ?? ""),
            checktt: parseMaybeJSON(row.checktt, row.checktt ?? {}),
            history: parseMaybeJSON(row.history, row.history ?? {}),
            bank: parseMaybeJSON(row.bank, row.bank ?? {}),
            data: parseMaybeJSON(row.data, row.data ?? [])
        };
    };

    // ===== helpers  =====
    const DAY_KEYS = ['dem', 'sang', 'trua', 'chieu', 'toi', 'khuya', 'tong'];
    const WEEK_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'tong'];
    const weekdayKey = (d) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()];
    const nowDate = () => new Date();
    const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
    const sameCalendarDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const isoWeekNumber = (d) => { const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dn = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() + 4 - dn); const ys = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1)); return Math.ceil((((dt - ys) / 86400000) + 1) / 7) };
    const sameISOWeek = (a, b) => isoWeekNumber(a) === isoWeekNumber(b) && a.getFullYear() === b.getFullYear();
    const daysBetween = (a, b) => Math.floor(Math.abs(new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
    const ensureSlot = (o, k) => (o[k] ??= { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 });
    const zeroDayStruct = (day) => { for (const k of DAY_KEYS) day[k] = { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 }; };
    const zeroWeekStruct = (week) => { for (const k of WEEK_KEYS) week[k] = { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 }; };
    const zeroMonthStruct = (month) => { for (let m = 1; m <= 12; m++) month[m] = { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 }; month.tong = { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 }; };

    const SLOT_KEYS = ['dem', 'sang', 'trua', 'chieu', 'toi', 'khuya'];
    const getSlotByHour = (h) => h < 5 ? 'dem' : h < 11 ? 'sang' : h < 13 ? 'trua' : h < 17 ? 'chieu' : h < 21 ? 'toi' : 'khuya';

    function _toLocalDateKey(d, tzOffsetMin = 420) {
        const ms = d.getTime() + tzOffsetMin * 60000;
        const ld = new Date(ms);
        const y = ld.getUTCFullYear();
        const m = String(ld.getUTCMonth() + 1).padStart(2, '0');
        const day = String(ld.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    function _yesterdayKeyOf(dateKey) {
        const [y, m, d] = dateKey.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        dt.setUTCDate(dt.getUTCDate() - 1);
        const yy = dt.getUTCFullYear();
        const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(dt.getUTCDate()).padStart(2, '0');
        return `${yy}-${mm}-${dd}`;
    }

    async function createData(data) {
        const Member = Membership;
        const checkttDefault = Member.rawAttributes.checktt.defaultValue;
        const historyDefault = Member.rawAttributes.history.defaultValue;
        const bankDefault = Member.rawAttributes.bank.defaultValue;
        const results = [];

        for (const threadID of Object.keys(data)) {
            const membersObj = data[threadID];
            for (const senderID of Object.keys(membersObj)) {
                const name = membersObj[senderID];

                let rec = await Member.findOne({ where: { threadID, senderID } });
                if (!rec) {
                    rec = await Member.create({
                        threadID, senderID, name,
                        checktt: deepClone(checkttDefault),
                        history: deepClone(historyDefault),
                        bank: deepClone(bankDefault),
                        data: []
                    });
                } else if (typeof name === 'string' && name && rec.name !== name) {
                    rec.name = name;
                }

                const now = nowDate();
                const checktt = rec.checktt ? deepClone(rec.checktt) : deepClone(checkttDefault);
                const prev = checktt.lastUpdate ? new Date(checktt.lastUpdate) : null;

                if (prev) {
                    const diffDays = daysBetween(now, prev);
                    const sameDay = sameCalendarDay(now, prev);
                    const sameWeek = sameISOWeek(now, prev);
                    const monthChanged = (now.getMonth() !== prev.getMonth()) || (now.getFullYear() !== prev.getFullYear());
                    const weekdayChanged = weekdayKey(now) !== weekdayKey(prev);

                    if (!sameDay || diffDays >= 1) zeroDayStruct(checktt.day);
                    if (!sameWeek || diffDays >= 7) zeroWeekStruct(checktt.week);
                    else if (weekdayChanged) {
                        const order = WEEK_KEYS.slice(0, 7);
                        const prevKey = weekdayKey(prev), todayKey = weekdayKey(now);
                        let idxStart = order.indexOf(prevKey);
                        for (let i = 0; i < 7; i++) { const idx = (idxStart + 1 + i) % 7; const key = order[idx]; checktt.week[key] = { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 }; if (key === todayKey) break; }
                    }
                    if (monthChanged || diffDays >= 30) zeroMonthStruct(checktt.month);
                    if (diffDays >= 30) checktt.total = { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 };
                }

                checktt.lastUpdate = now.toISOString();

                const history = rec.history ? deepClone(rec.history) : deepClone(historyDefault);
                history.lastJoin = now.getTime();
                history.joinCount = (history.joinCount || 0) + 1;
                history.lastActive = null;
                if (rec.checktt?.lastUpdate) {
                    const diff = daysBetween(now, new Date(rec.checktt.lastUpdate));
                    if (diff >= 1) history.streak = 0;
                } else history.streak = 0;

                rec.checktt = checktt;
                rec.history = history;
                await rec.save();

                results.push({ threadID, senderID, name: rec.name, status: 'ok', lastUpdate: rec.checktt.lastUpdate });
            }
        }
        return results;
    }

    const deepMerge = (a, b) => {
        if (!a || typeof a !== 'object' || Array.isArray(a)) return b;
        const r = { ...a };
        for (const k of Object.keys(b)) {
            const v = b[k];
            r[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? deepMerge(r[k], v) : v;
        }
        return r;
    };

    async function updateData(data) {
        const jobs = [];
        for (const t of Object.keys(data)) for (const s of Object.keys(data[t])) jobs.push({ threadID: t, senderID: s, updates: data[t][s] });
        if (!jobs.length) return [];

        const rows = await Membership.findAll({ where: { [Op.or]: jobs.map(j => ({ threadID: j.threadID, senderID: j.senderID })) } });
        const map = new Map(rows.map(r => [`${r.threadID}::${r.senderID}`, r]));
        const promises = []; const out = [];

        for (const j of jobs) {
            const key = `${j.threadID}::${j.senderID}`;
            const rec = map.get(key);
            if (!rec) { out.push({ threadID: j.threadID, senderID: j.senderID, status: 'not_found' }); continue; }

            for (const f of Object.keys(j.updates)) {
                const v = j.updates[f];
                if (f === 'data') rec.data = Array.isArray(v) ? ([...(Array.isArray(rec.data) ? rec.data : []), ...v]) : v;
                else if (f === 'checktt' || f === 'history' || f === 'bank') rec[f] = deepMerge(rec[f], v);
                else rec[f] = v;
            }
            promises.push(rec.save());
            out.push({ threadID: j.threadID, senderID: j.senderID, status: 'updated' });
        }
        await Promise.all(promises);
        return out;
    }

    async function deleteData(obj) {
        const out = [];
        for (const t of Object.keys(obj || {})) {
            const v = obj[t];
            if (v && typeof v === 'object' && Object.keys(v).length) {
                const ids = Object.keys(v);
                const count = await Membership.destroy({ where: { threadID: t, senderID: { [Op.in]: ids } } });
                out.push({ threadID: t, scope: 'members', count });
            } else {
                const count = await Membership.destroy({ where: { threadID: t } });
                out.push({ threadID: t, scope: 'thread', count });
            }
        }
        return out;
    }

    async function addCheck(threadID, senderID) {
        const rec = await Membership.findOne({ where: { threadID, senderID } });
        if (!rec) return { threadID, senderID, status: 'not_found' };

        const now = nowDate();
        const buoi = getSlotByHour(now.getHours());
        const thu = weekdayKey(now);
        const thang = now.getMonth() + 1;

        const ck = rec.checktt ? deepClone(rec.checktt) : { day: {}, week: {}, month: {}, total: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 } };
        ck.day ??= {}; ck.week ??= {}; ck.month ??= {}; ck.total ??= { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 };
        ensureSlot(ck.day, buoi); ensureSlot(ck.day, 'tong');
        ensureSlot(ck.week, thu); ensureSlot(ck.week, 'tong');
        ensureSlot(ck.month, thang); ensureSlot(ck.month, 'tong');

        ck.day[buoi].msg++; ck.day[buoi].total++;
        ck.day.tong.msg++; ck.day.tong.total++;
        ck.week[thu].msg++; ck.week[thu].total++;
        ck.week.tong.msg++; ck.week.tong.total++;
        ck.month[thang].msg++; ck.month[thang].total++;
        ck.month.tong.msg++; ck.month.tong.total++;
        ck.total.msg++; ck.total.total++;

        ck.lastUpdate = now.toISOString();

        const hist = rec.history ? deepClone(rec.history) : {};
        hist.lastActive = now.getTime();

        await updateData({ [threadID]: { [senderID]: { checktt: ck, history: hist } } });

        return { threadID, senderID, buoi, thu, thang, status: 'updated' };
    }


    async function getData(threadID, senderID) {
        if (!threadID) throw new Error('threadID is required');
        if (sequelize) {
            if (senderID) {
                const rows = await sequelize.query(
                    "SELECT id, CAST(threadID AS TEXT) AS threadID, CAST(senderID AS TEXT) AS senderID, name, checktt, history, bank, data, createdAt, updatedAt FROM Member WHERE threadID = :threadID AND senderID = :senderID LIMIT 1",
                    {
                        replacements: { threadID: String(threadID), senderID: String(senderID) },
                        type: QueryTypes.SELECT
                    }
                );
                return rows && rows.length ? normalizeMemberRow(rows[0]) : null;
            }

            const rows = await sequelize.query(
                "SELECT id, CAST(threadID AS TEXT) AS threadID, CAST(senderID AS TEXT) AS senderID, name, checktt, history, bank, data, createdAt, updatedAt FROM Member WHERE threadID = :threadID ORDER BY senderID ASC",
                {
                    replacements: { threadID: String(threadID) },
                    type: QueryTypes.SELECT
                }
            );
            return rows.map(normalizeMemberRow);
        }

        if (senderID) {
            const rec = await Membership.findOne({ where: { threadID, senderID } });
            return rec ? rec.toJSON() : null;
        }
        const rows = await Membership.findAll({ where: { threadID }, order: [['senderID', 'ASC']] });
        return rows.map(r => r.toJSON());
    }

    async function resetChecktt(threadID) {
        if (!threadID) throw new Error('threadID required');
        const rows = await Membership.findAll({ where: { threadID } });
        if (!rows.length) return { threadID, status: 'no_members' };

        const now = nowDate();
        const isSunday = weekdayKey(now) === 'sun';
        const isFirstDay = now.getDate() === 1;

        const payload = { [threadID]: {} };
        for (const rec of rows) {
            const ck = deepClone(rec.checktt || {});
            ck.day ??= {}; ck.week ??= {}; ck.month ??= {}; ck.total ??= { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 };
            zeroDayStruct(ck.day);
            if (isSunday) zeroWeekStruct(ck.week);
            if (isFirstDay) zeroMonthStruct(ck.month);
            ck.lastUpdate = now.toISOString();
            payload[threadID][rec.senderID] = { checktt: ck };
        }
        const res = await updateData(payload);
        const updated = res.filter(x => x.status === 'updated').length;
        return { threadID, members: updated, isSunday, isFirstDay, status: 'reset_done' };
    }

    // ================== BỔ SUNG YÊU CẦU ==================

    // bump 1 chỉ số theo slot/thu/tháng + cập nhật lastActive
    async function _bump(threadID, senderID, field) {
        const rec = await Membership.findOne({ where: { threadID, senderID } });
        if (!rec) return { threadID, senderID, status: 'not_found' };

        const now = nowDate();
        const buoi = getSlotByHour(now.getHours());
        const thu = weekdayKey(now);
        const thang = now.getMonth() + 1;

        const ck = rec.checktt ? deepClone(rec.checktt) : {
            day: {}, week: {}, month: {}, total: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 }
        };
        ck.day ??= {}; ck.week ??= {}; ck.month ??= {};
        ck.total ??= { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 };
        ensureSlot(ck.day, buoi); ensureSlot(ck.day, 'tong');
        ensureSlot(ck.week, thu); ensureSlot(ck.week, 'tong');
        ensureSlot(ck.month, thang); ensureSlot(ck.month, 'tong');

        // chỉ tăng total nếu là msg
        const inc = (bucket) => {
            bucket[field] = (bucket[field] || 0) + 1;
            if (field === 'msg') bucket.total = (bucket.total || 0) + 1;
        };

        // tăng theo từng lớp
        inc(ck.day[buoi]);
        inc(ck.day.tong);
        inc(ck.week[thu]);
        inc(ck.week.tong);
        inc(ck.month[thang]);
        inc(ck.month.tong);

        // tổng tích lũy toàn thời gian
        ck.total[field] = (ck.total[field] || 0) + 1;
        if (field === 'msg') ck.total.total = (ck.total.total || 0) + 1;

        ck.lastUpdate = now.toISOString();

        const hist = rec.history ? deepClone(rec.history) : {};
        hist.lastActive = now.getTime();

        const payload = { [threadID]: { [senderID]: { checktt: ck, history: hist } } };
        const r = await updateData(payload);
        return { threadID, senderID, field, buoi, thu, thang, status: r[0]?.status || 'updated' };
    }



    // 1) / cmd / seen / react
    async function cmd(threadID, senderID) { return _bump(threadID, senderID, 'cmd'); }
    async function seen(threadID, senderID) { return _bump(threadID, senderID, 'seen'); }
    async function react(threadID, senderID) { return _bump(threadID, senderID, 'react'); }

    // 2) leave
    async function leave(threadID, senderID) {
        const rec = await Membership.findOne({ where: { threadID, senderID } });
        if (!rec) return { threadID, senderID, status: 'not_found' };

        const now = nowDate();
        const ts = now.getTime();

        const hist = rec.history ? deepClone(rec.history) : {};
        hist.lastLeave = ts;
        hist.leaveCount = (hist.leaveCount || 0) + 1;

        // leaveHis: mảng timestamp các lần rời nhóm
        const arr = Array.isArray(hist.leaveHis) ? hist.leaveHis : [];
        arr.push(ts);

        // (tuỳ chọn) giới hạn dung lượng lịch sử, giữ N lần gần nhất
        // const MAX_LEAVE_HIS = 200;
        // if (arr.length > MAX_LEAVE_HIS) hist.leaveHis = arr.slice(-MAX_LEAVE_HIS);
        // else hist.leaveHis = arr;

        hist.leaveHis = arr;

        const payload = { [threadID]: { [senderID]: { history: hist } } };
        const r = await updateData(payload);
        return { threadID, senderID, status: r[0]?.status || 'updated' };
    }

    // 3) top — xếp hạng theo by ('msg'|'cmd'|'seen'|'react'|'total'), window ('week'|'month'|'all')
    async function top(threadID, opts = {}) {
        const { by = 'total', limit = 10, window = 'week' } = opts;
        const rows = await Membership.findAll({ where: { threadID } });
        const scored = rows.map(r => {
            const ck = r.checktt || {};
            let base;
            if (window === 'all') base = ck.total || {};
            else if (window === 'month') base = (ck.month && ck.month.tong) || {};
            else base = (ck.week && ck.week.tong) || {}; // default week
            const exp = Number((base && base[by]) || 0);
            return { senderID: r.senderID, name: r.name, exp, window };
        });
        scored.sort((a, b) => b.exp - a.exp);
        return scored.slice(0, limit);
    }

    // 4) topSlot — top theo 1 buổi nhất định (mặc định theo 'msg' của ngày hiện tại)
    async function topSlot(threadID, slot, by = 'msg', limit = 10) {
        if (!SLOT_KEYS.includes(slot)) throw new Error('slot không hợp lệ');
        const rows = await Membership.findAll({ where: { threadID } });
        const scored = rows.map(r => {
            const ck = r.checktt || {};
            const base = (ck.day && ck.day[slot]) || {};
            const val = Number(base[by] || 0);
            return { senderID: r.senderID, name: r.name, exp: val };
        });
        scored.sort((a, b) => b.exp - a.exp);
        return scored.slice(0, limit);
    }

    // 5) streaks — top theo streak hiện tại (tie-break bằng bestStreak)
    async function streaks(threadID, opts = {}) {
        const { limit = 10 } = opts;
        const rows = await Membership.findAll({ where: { threadID } });
        const out = rows.map(r => {
            const h = r.history || {};
            return { senderID: r.senderID, name: r.name, streak: Number(h.streak || 0), best: Number(h.bestStreak || 0) };
        });
        out.sort((a, b) => (b.streak - a.streak) || (b.best - a.best));
        return out.slice(0, limit);
    }

    // 6) inactive — liệt kê người không hoạt động ≥ N ngày
    async function inactive(threadID, days) {
        const rows = await Membership.findAll({ where: { threadID } });
        const now = nowDate().getTime();
        const ms = Number(days) * 86400000;
        const out = [];
        for (const r of rows) {
            const la = r.history?.lastActive;
            if (!la || (now - la) >= ms) {
                const daysSince = la ? Math.floor((now - la) / 86400000) : null;
                out.push({ senderID: r.senderID, name: r.name, lastActive: la || null, daysSince });
            }
        }
        // người lâu nhất không hoạt động lên đầu
        out.sort((a, b) => {
            if (a.lastActive == null && b.lastActive == null) return 0;
            if (a.lastActive == null) return -1;
            if (b.lastActive == null) return 1;
            return a.lastActive - b.lastActive;
        });
        return out;
    }

    // 7) find — tìm theo tên (case-insensitive) hoặc chứa trong senderID
    async function find(threadID, keyword) {
        if (!keyword) return [];
        const rows = await Membership.findAll({ where: { threadID } });
        const kw = String(keyword).toLowerCase();
        return rows
            .filter(r => (r.name || '').toLowerCase().includes(kw) || String(r.senderID).includes(kw))
            .map(r => ({ senderID: r.senderID, name: r.name }));
    }

    async function updateStreak(threadID, senderID) {
        const rec = await Membership.findOne({ where: { threadID, senderID } });
        if (!rec) return { threadID, senderID, status: 'not_found' };

        const ck = rec.checktt || {};
        const week = ck.week || {};
        const hist = rec.history ? deepClone(rec.history) : {};

        const now = nowDate();
        const today = weekdayKey(now);
        const order = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const prevDay = order[(order.indexOf(today) - 1 + 7) % 7];

        const yesterday = week[prevDay];
        const hadActivity = yesterday && yesterday.msg > 0;

        let streak = Number(hist.streak || 0);
        let streakHis = Number(hist.streakHis || 0);

        if (hadActivity) streak += 1;
        else streak = 1;

        if (streak > streakHis) streakHis = streak;

        hist.streak = streak;
        hist.streakHis = streakHis;
        hist.lastActive = now.getTime();

        await updateData({ [threadID]: { [senderID]: { history: hist } } });

        return { threadID, senderID, prevDay, hadActivity, streak, streakHis, status: 'updated' };
    }

    async function hasMember(threadID, senderID) {
        if (!threadID || !senderID) throw new Error('threadID và senderID là bắt buộc');
        const rec = await Membership.findOne({ where: { threadID, senderID } });
        if (!rec) return { exists: false, threadID, senderID };
        return { exists: true, threadID, senderID, name: rec.name, lastActive: rec.history?.lastActive || null };
    }


    // async function hasMany(threadID, ids = []) {
    //     try {
    //         if (!threadID || !Array.isArray(ids) || ids.length === 0) return [];
    //         const tID = typeof threadID === 'number' ? threadID : Number(threadID);
    //         const clean = [...new Set(ids.filter(Boolean))];
    //         const toNum = v => (typeof v === 'number' ? v : Number(v));
    //         const cleanNum = clean.map(toNum).filter(n => Number.isFinite(n));
    //         if (cleanNum.length === 0) return [];
    //         const BATCH = 500;
    //         const hit = new Set();

    //         for (let i = 0; i < cleanNum.length; i += BATCH) {
    //             const slice = cleanNum.slice(i, i + BATCH);
    //             const rows = await Membership.findAll({
    //                 attributes: ['senderID'],
    //                 where: { threadID: tID, senderID: { [Op.in]: slice } },
    //                 raw: true
    //             });
    //             console.log(rows)
    //             for (const r of rows) hit.add(String(r.senderID)); 
    //         }
    //         return [...hit];
    //     } catch (e) {
    //         console.error('[Membership.hasMany] lỗi:', e.message);
    //         return [];
    //     }
    // }

    async function hasMany(threadID) {
        try {
            if (sequelize) {
                const rows = await sequelize.query(
                    "SELECT CAST(senderID AS TEXT) AS senderID FROM Member WHERE threadID = :threadID",
                    {
                        replacements: { threadID: String(threadID) },
                        type: QueryTypes.SELECT
                    }
                );
                return rows.map(r => String(r.senderID || "")).filter(Boolean);
            }

            const tID = (threadID);
            const rows = await Membership.findAll({
                where: { threadID: tID },
                attributes: ['senderID'],
                raw: true
            });
            const result = rows.map(r => String(r.senderID)); // chuẩn dạng string
            return result;
        } catch (e) {
            console.error("[Membership.hasMany] lỗi:", e);
            return [];
        }
    }





    return {
        createData,   // {threadID: {senderID: name}} → khởi tạo dữ liệu member (tự tạo nếu chưa có)
        updateData,   // {threadID: {senderID: {field: value}}} → cập nhật thủ công field bất kỳ
        deleteData,   // {threadID: {senderID: true}} hoặc {threadID: true} → xóa 1 người / cả nhóm
        addCheck,     // (threadID, senderID) → +1 tin nhắn (msg) + thống kê ngày/tuần/tháng
        getData,      // (threadID, [senderID]) → lấy dữ liệu 1 người hoặc toàn nhóm
        resetChecktt, // (threadID) → reset theo ngày/tuần/tháng (0 hóa thống kê cũ)
        hasMember,   // (threadID, senderID) → kiểm tra thành viên có trong nhóm không
        hasMany,     // (threadID, [senderID]) → kiểm tra nhiều thành viên có trong nhóm không

        cmd,          // (threadID, senderID) → +1 lệnh
        seen,         // (threadID, senderID) → +1 lượt xem
        react,        // (threadID, senderID) → +1 phản ứng
        leave,        // (threadID, senderID) → ghi rời nhóm, +1 leaveCount
        top,          // (threadID, {by='total',window='week',limit=10}) → BXH theo kỳ & loại
        topSlot,      // (threadID, slot, by='msg', limit=10) → top theo buổi (đêm/sáng/trưa/...)
        updateStreak, // (threadID, senderID, [now]) → cập nhật streak
        streaks,      // (threadID, {limit=10}) → top chuỗi ngày hoạt động liên tục
        inactive,     // (threadID, days) → liệt kê ai không hoạt động ≥ N ngày
        find          // (threadID, keyword) → tìm theo tên hoặc 1 phần senderID
    };

};
