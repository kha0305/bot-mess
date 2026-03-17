// db/index.js
const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

const mUser = require('./models/users.cjs');
const mThread = require('./models/threads.cjs');
const mMember = require('./models/membership.cjs');
const mCurren = require('./models/currencies.cjs');

const cUser = require('./ctrls/Users.cjs');
const cThread = require('./ctrls/Threads.cjs');
const cMember = require('./ctrls/Membership.cjs');
const cCurren = require('./ctrls/Currencies.cjs');

module.exports = ({ api } = {}) => {
    const dataCoreDir = path.resolve(process.cwd(), 'data', 'core');
    const file = path.join(dataCoreDir, 'data.sqlite');
    const legacyFile = path.resolve(__dirname, 'data.sqlite');
    if (!fs.existsSync(dataCoreDir)) fs.mkdirSync(dataCoreDir, { recursive: true });

    if (!fs.existsSync(file) && fs.existsSync(legacyFile)) {
        fs.copyFileSync(legacyFile, file);
        for (const ext of ['-wal', '-shm']) {
            const oldSidecar = `${legacyFile}${ext}`;
            const newSidecar = `${file}${ext}`;
            if (fs.existsSync(oldSidecar)) {
                fs.copyFileSync(oldSidecar, newSidecar);
            }
        }
    }

    console.log('[DB CORE]', file);

    const sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: file,
        logging: false,
        define: { freezeTableName: true, charset: 'utf8', dialectOptions: { collate: 'utf8_general_ci' }, timestamps: true },
        pool: { max: 10, min: 0, idle: 1e4, acquire: 3e4 }
    });

    const User = mUser({ sequelize, Sequelize });
    const Thread = mThread({ sequelize, Sequelize });
    const Member = mMember({ sequelize, Sequelize });
    const Curren = mCurren({ sequelize, Sequelize });
    const models = { User, Thread, Member, Curren };

    async function init() {
        await sequelize.authenticate();
        await sequelize.query('PRAGMA journal_mode=WAL;');
        await sequelize.query('PRAGMA synchronous=NORMAL;');
        await sequelize.query('PRAGMA cache_size=-131072;');
        await sequelize.query('PRAGMA temp_store=MEMORY;');
        await sequelize.query('PRAGMA busy_timeout=15000;');
        await sequelize.query('PRAGMA foreign_keys=ON;');

        const force = String(process.env.FORCE_SYNC).toLowerCase() === 'true';
        const alter = String(process.env.ALTER_SYNC).toLowerCase() === 'true';
        const fallback = String(process.env.FALLBACK_FORCE ?? 'true').toLowerCase() !== 'false';
        const syncAll = (mode) => Promise.all([User.sync(mode), Thread.sync(mode), Member.sync(mode), Curren.sync(mode)]);

        if (force) return syncAll({ force: true });
        if (alter) {
            try { return await syncAll({ alter: true }); }
            catch (e) { if (fallback) return syncAll({ force: true }); throw e; }
        }
        return syncAll({ alter: false });
    }

    const transaction = (fn) => sequelize.transaction(fn);
    const close = () => sequelize.close();

    const Users = cUser({ Users: User, api, sequelize, models });
    const Threads = cThread({ Threads: Thread, api, sequelize, models });
    const Membership = cMember({ Membership: Member, sequelize, models });
    const Currencies = cCurren({ Currencies: Curren, sequelize, models });

    return { init, close, transaction, Users, Threads, Membership, Currencies };
};
