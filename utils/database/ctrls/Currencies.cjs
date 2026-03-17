module.exports = function ({ Currencies }) {
    async function getAll(...data) {
        var where, attributes;
        for (const i of data) {
            if (typeof i != 'object') throw new Error("Cần một đối tượng hoặc mảng.");
            if (Array.isArray(i)) attributes = i;
            else where = i;
        }
        try {
            return (await Currencies.findAll({ where, attributes })).map(e => e.get({ plain: true }));
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    async function getData(userID) {
        try {
            const data = await Currencies.findOne({ where: { userID } });
            if (data) return data.get({ plain: true });
            else return false;
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    async function setData(userID, options = {}) {
        if (typeof options != 'object' && !Array.isArray(options)) throw new Error("Cần một đối tượng.");
        try {
            const user = await Currencies.findOne({ where: { userID } });
            if (user) {
                await user.update(options);
                return true;
            }
            throw new Error("Người dùng không tồn tại.");
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    async function delData(userID) {
        try {
            const user = await Currencies.findOne({ where: { userID } });
            if (user) {
                await user.destroy();
                return true;
            }
            throw new Error("Người dùng không tồn tại.");
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    async function createData(currencies = {}) {
        if (typeof currencies !== "object" || Array.isArray(currencies))
            throw new Error("Cần một object { userID: defaults }");

        const ids = Object.keys(currencies);
        if (!ids.length) return false;

        try {
            const existed = await Currencies.findAll({
                attributes: ["userID"],
                where: { userID: ids },
                raw: true
            });
            const existSet = new Set(existed.map(e => e.userID));

            const newRecords = [];
            for (const id of ids) {
                if (!existSet.has(id)) newRecords.push({ userID: id, ...currencies[id] });
            }

            if (newRecords.length > 0) {
                await Currencies.bulkCreate(newRecords, { ignoreDuplicates: true });
            }

            return newRecords.length;
        } catch (e) {
            console.error("Currencies.createData error:", e.message);
            return 0;
        }
    }

    async function increaseMoney(userID, money) {
        if (typeof money != 'number' || isNaN(money) || money <= 0) throw new Error("Cần một số dương.");
        try {
            const data = await getData(userID);
            if (!data) throw new Error("Người dùng không tồn tại.");
            const balance = Number(data.money); 
            await setData(userID, { money: balance + money });
            return true;
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    async function decreaseMoney(userID, money) {
        if (typeof money != 'number' || isNaN(money) || money <= 0) throw new Error("Cần một số dương.");
        try {
            const data = await getData(userID);
            if (!data) throw new Error("Người dùng không tồn tại.");
            let balance = Number(data.money);
            if (balance < money) return false;
            await setData(userID, { money: balance - money });
            return true;
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    async function hasData(userID) {
        try {
            return (await Currencies.count({ where: { userID } })) > 0;
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    async function hasMany(ids = []) {
        if (!Array.isArray(ids) || ids.length === 0) return [];
        const found = await Currencies.findAll({
            attributes: ['userID'],
            where: { userID: ids }
        });
        return found.map(r => String(r.userID));
    }


    return {
        getAll,
        getData,
        setData,
        delData,
        createData,
        increaseMoney,
        decreaseMoney,
        hasData,
        hasMany
    };
};
