module.exports.config = {
    name: "vd",
    version: "2.0.0",
    hasPermssion: 0,
    credits: "Niio-team (Vtuan) đã cướp cre của DC-nam",
    description: "Gửi video supper víp",
    commandCategory: "QUẢN LÝ NHÓM",
    usages: "",
    cooldowns: 0
};

module.exports.run = async function ({ api, event, args }) {
    const send = async msg => {
        while (true) {
            const result = await new Promise(resolve =>
                api.sendMessage(msg, event.threadID, (err, res) => resolve({ err, res }), event.messageID)
            );
            if (!result.err) return result.res;
            await new Promise(r => setTimeout(r, 100));
        }
    };
    const videoTypes = {
        anime: global.anime,
        gái: global.girl,
        trai: global.trai
    };
    send({
        body: videoTypes[args[0]] ? `Video ${args[0].charAt(0).toUpperCase() + args[0].slice(1)}` : 'Vui lòng nhập "anime", "gái", hoặc "trai" để nhận video tương ứng.',
        attachment: videoTypes[args[0]] ? videoTypes[args[0]].splice(0, 1) : []
    });
};
