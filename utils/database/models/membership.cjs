module.exports = function ({ sequelize, Sequelize }) {
    const Member = sequelize.define('Member', {
        threadID: {
            type: Sequelize.BIGINT,
            allowNull: false
        },
        senderID: {
            type: Sequelize.BIGINT,
            allowNull: false
        },
        name: {
            type: Sequelize.STRING,
            defaultValue: null
        },
        checktt: {
            type: Sequelize.JSON,
            defaultValue: {
                day: {
                    dem: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    sang: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    trua: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    chieu: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    toi: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    khuya: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    tong: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                },
                week: {
                    mon: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    tue: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    wed: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    thu: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    fri: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    sat: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    sun: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    tong: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 }
                },
                month: {
                    1: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    2: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    3: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    4: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    5: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    6: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    7: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    8: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    9: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    10: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    11: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    12: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                    tong: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 }
                },
                total: { msg: 0, cmd: 0, seen: 0, react: 0, total: 0 },
                lastUpdate: null
            }
        },
        history: {
            type: Sequelize.JSON,
            defaultValue: {
                seenMess: {
                    total: 0,
                    data: { dem: [], sang: [], chieu: [], toi: [], khuya: [] }
                },
                commandUsage: {
                    count: 0,
                    favorites: {},
                    lastCommand: null,
                    lastTime: null
                },
                lastJoin: null,
                firstJoin: null,
                leaveCount: 0,
                joinCount: 0,
                leaveHis: [],
                lastActive: null,
                lastUseBot: null,
                streak: 0,
                streakHis: 0
            }
        },
        bank: {
            type: Sequelize.JSON,
            defaultValue: {
                balance: 0,
                status: "active",
                history: []
            }
        },
        data: {
            type: Sequelize.JSON,
            defaultValue: []
        }
    }, {
        indexes: [
            {
                unique: true,
                fields: ['threadID', 'senderID']
            }
        ]
    });

    return Member;
};