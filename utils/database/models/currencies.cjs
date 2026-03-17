module.exports = function ({ sequelize, Sequelize }) {
    const Currencies = sequelize.define('Currencies', {
        num: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        userID: {
            type: Sequelize.BIGINT,
            unique: true,
            allowNull: false
        },
        money: {
            type: Sequelize.BIGINT,
            allowNull: false,
            defaultValue: 0
        },
        data: {
            type: Sequelize.JSON,
            allowNull: false,
            defaultValue: {}
        }
    });

    return Currencies;
};
