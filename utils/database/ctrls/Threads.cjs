module.exports = function ({ api, Threads, sequelize }) {
    const { QueryTypes } = require('sequelize');

    const parseMaybeJSON = (value, fallback) => {
        if (value === null || value === undefined) return fallback;
        if (typeof value === "object") return value;
        if (typeof value !== "string") return fallback;
        const text = value.trim();
        if (!text) return fallback;
        try { return JSON.parse(text); } catch { return fallback; }
    };

    const normalizeThreadRow = (row) => {
        if (!row || typeof row !== "object") return row;
        return {
            ...row,
            threadID: String(row.threadID ?? ""),
            threadInfo: parseMaybeJSON(row.threadInfo, row.threadInfo ?? {}),
            data: parseMaybeJSON(row.data, row.data ?? {})
        };
    };

    async function getAll(...data) {
        var where, attributes;
        for (const i of data) {
            if (typeof i != 'object') throw new Error("Cần một đối tượng hoặc mảng.");
            if (Array.isArray(i)) attributes = i;
            else where = i;
        }
        try {
            if (sequelize && !attributes) {
                const replacements = {};
                let sql = "SELECT num, CAST(threadID AS TEXT) AS threadID, threadInfo, data, createdAt, updatedAt FROM Threads";
                if (where && typeof where === "object" && Object.keys(where).length > 0) {
                    const cond = [];
                    if (where.threadID !== undefined && where.threadID !== null) {
                        cond.push("threadID = :threadID");
                        replacements.threadID = String(where.threadID);
                    }
                    if (cond.length > 0) {
                        sql += ` WHERE ${cond.join(" AND ")}`;
                    }
                }
                sql += " ORDER BY num ASC";
                const rows = await sequelize.query(sql, {
                    replacements,
                    type: QueryTypes.SELECT
                });
                return rows.map(normalizeThreadRow);
            }
            return (await Threads.findAll({ where, attributes })).map(e => e.get({ plain: true }));
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    async function getData(threadID) {
        try {
            if (sequelize) {
                const rows = await sequelize.query(
                    "SELECT num, CAST(threadID AS TEXT) AS threadID, threadInfo, data, createdAt, updatedAt FROM Threads WHERE threadID = :threadID LIMIT 1",
                    {
                        replacements: { threadID: String(threadID) },
                        type: QueryTypes.SELECT
                    }
                );
                if (!rows || rows.length === 0) return false;
                return normalizeThreadRow(rows[0]);
            }
            const data = await Threads.findOne({ where: { threadID } });
            if (data) return data.get({ plain: true });
            else return false;
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    async function getInfo(threadID) {
        try {
            const result = await api.getThreadInfo(threadID);
            return result;
        } catch (error) {
            console.log(error);
            throw new Error(error);
        }
    }

    async function setData(threadID, options = {}) {
        if (typeof options != 'object' && !Array.isArray(options)) throw new Error("Cần một đối tượng.");
        try {
            (await Threads.findOne({ where: { threadID } })).update(options);
            return true;
        } catch (error) {
            try {
                await this.createData(threadID, options);
            } catch (error) {
                console.error(error);
                throw new Error(error);
            }
        }
    }

    async function delData(threadID) {
        try {
            const record = await Threads.findOne({ where: { threadID } });
            if (!record) {
                console.log(`Không tìm thấy dữ liệu cho threadID: ${threadID}`);
                return false;
            }
            await record.destroy();
            console.log(`Đã xóa dữ liệu cho threadID: ${threadID}`);
            return true;
        } catch (error) {
            console.error(`Lỗi khi xóa dữ liệu cho threadID: ${threadID}`, error);
            throw new Error(`Không thể xóa dữ liệu cho threadID: ${threadID}`);
        }
    }


    async function createData(threadID, defaults = {}) {
        if (typeof defaults != 'object' && !Array.isArray(defaults)) throw new Error("Cần một đối tượng.");
        try {
            await Threads.findOrCreate({ where: { threadID }, defaults });
            return true;
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    return {
        getInfo,
        getAll,
        getData,
        setData,
        delData,
        createData
    };
};
