module.exports = function ({ api, Users }) {
    async function getInfo(id) {
        try {
            return (await api.getUserInfo(id))[id];
        } catch (e) {
            return false;
        }
    }

    async function getNameUser(id) {
        try {
            const data = await this.getData(String(id));
            if (data && data.name && data.name.trim())
                return data.name;
            return "Người dùng Facebook";
        } catch (e) {
            return "Người dùng Facebook";
        }
    }


    async function getUserFull(id) {
        var resolveFunc = function () { };
        var rejectFunc = function () { };
        var returnPromise = new Promise(function (resolve, reject) {
            resolveFunc = resolve;
            rejectFunc = reject;
        });
        try {
            api.httpGet(`https://graph.facebook.com/${id}?fields=name,email,about,birthday,gender,hometown,link,location,quotes,relationship_status,significant_other,username,subscribers.limit(0),website&access_token=${global.account.accessToken}`, (e, i) => {
                if (e) return rejectFunc(e);
                var t = JSON.parse(i);
                var dataUser = {
                    error: 0,
                    author: 'D-Jukie',
                    data: {
                        name: t.name || null,
                        username: t.username || null,
                        uid: t.id || null,
                        about: t.about || null,
                        follow: t.subscribers.summary.total_count || 0,
                        birthday: t.birthday || null,
                        gender: t.gender,
                        hometown: t.hometown || null,
                        link: t.link || null,
                        location: t.location || null,
                        relationship_status: t.relationship_status || null,
                        love: t.significant_other || null,
                        quotes: t.quotes || null,
                        website: t.website || null,
                        imgavt: `https://graph.facebook.com/${t.id}/picture?height=1500&width=1500&access_token=6628568379%7Cc1e620fa708a1d5696fb991c1bde5662`
                    }
                };
                return resolveFunc(dataUser);
            });
            return returnPromise;
        } catch (error) {
            return resolveFunc({
                error: 1,
                author: 'J-JRT',
                data: {}
            });
        }
    }

    async function getAll(...data) {
        var where, attributes;
        for (const i of data) {
            if (typeof i != 'object') throw new Error("Cần một đối tượng hoặc mảng.");
            if (Array.isArray(i)) attributes = i;
            else where = i;
        }
        try {
            return (await Users.findAll({ where, attributes })).map(e => e.get({ plain: true }));
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    async function getData(userID) {
        try {
            const data = await Users.findOne({ where: { userID } });
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
            (await Users.findOne({ where: { userID } })).update(options);
            return true;
        } catch (error) {
            try {
                await this.createData(userID, options);
            } catch (error) {
                console.error(error);
                throw new Error(error);
            }
        }
    }

    async function delData(userID) {
        try {
            (await Users.findOne({ where: { userID } })).destroy();
            return true;
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    async function createData(users = {}) {
        if (typeof users !== "object" || Array.isArray(users))
            throw new Error("Cần một object { userID: defaults }");

        const ids = Object.keys(users);
        if (!ids.length) return false;

        try {
            const existed = await Users.findAll({
                attributes: ["userID"],
                where: { userID: ids },
                raw: true
            });
            const existSet = new Set(existed.map(e => e.userID));

            const newRecords = [];
            for (const id of ids) {
                if (!existSet.has(id)) newRecords.push({ userID: id, ...users[id] });
            }

            if (newRecords.length > 0) {
                await Users.bulkCreate(newRecords, { ignoreDuplicates: true });
            }

            return newRecords.length;
        } catch (e) {
            console.error("Users.createData error:", e.message);
            return 0;
        }
    }

    async function hasData(userID) {
        try {
            const count = await Users.count({ where: { userID } });
            return count > 0;
        } catch (error) {
            console.error(error);
            throw new Error(error);
        }
    }

    async function hasMany(ids = []) {
        try {
            if (!Array.isArray(ids) || ids.length === 0) return [];

            const cleanIds = [...new Set(ids.filter(Boolean).map(String))];
            if (cleanIds.length === 0) return [];

            const found = await Users.findAll({
                attributes: ['userID'],
                where: { userID: cleanIds },
                raw: true
            });

            return found.length ? found.map(r => r.userID + '') : [];
        } catch (err) {
            console.error(`[Users.hasMany] Lỗi khi truy vấn: ${err.message}`);
            return [];
        }
    }


    return {
        getInfo,
        getNameUser,
        getAll,
        getData,
        setData,
        delData,
        createData,
        getUserFull,
        hasData,
        hasMany
    };
};
