import fs from 'fs';

function extractArray(content, varNameRegex) {
    const lines = content.split('\n');
    let inArray = false;
    let items = [];
    for (const line of lines) {
        if (!inArray) {
            if (varNameRegex.test(line)) {
                inArray = true;
            }
        }
        
        if (inArray) {
            const match = line.match(/"(http.*?)"/);
            if (match) {
                items.push(match[1]);
            }
            if (line.includes('];') || line.includes('] ;')) {
                break;
            }
        }
    }
    return items;
}

const duContent = fs.readFileSync('temp_repo/modules/commands/dú.js', 'utf8');
const duUrls = extractArray(duContent, /var link = \[|let link = \[/);

const lonContent = fs.readFileSync('temp_repo/modules/commands/lồn.js', 'utf8');
const lonUrls = extractArray(lonContent, /var link = \[|let link = \[/);

const gaiJson = JSON.parse(fs.readFileSync('temp_repo/includes/datajson/gaivip.json', 'utf8'));
const gaiUrls = gaiJson; 

function createCommandCode(name, alias, urls, replyMessage) {
    return `import axios from "axios";

const links = ${JSON.stringify(urls)};

export default {
  name: "${name}",
  aliases: ["${alias}"],
  execute: async ({ client, message, type, replyBot }) => {
    try {
        const randomUrl = links[Math.floor(Math.random() * links.length)];
        const res = await axios({
            url: randomUrl,
            method: 'GET',
            responseType: 'arraybuffer'
        });
        const buffer = Buffer.from(res.data);
        const fileName = \`${name}-\${Date.now()}.jpg\`;
        
        const isE2EE = (type === "E2EE Message" && message.chatJid);
        const targetId = isE2EE ? message.chatJid : message.threadId;

        if (isE2EE) {
            await client.sendE2EEMessage(targetId, "${replyMessage}", { replyToId: message.id });
            await client.sendE2EEImage(targetId, buffer, fileName);
        } else {
            await client.sendMessage(targetId, "${replyMessage}", { replyToId: message.id });
            await client.sendImage(targetId, buffer, fileName);
        }
    } catch (e) {
        console.error("Lỗi khi tải ảnh ${name}:", e);
        await replyBot("❌ Lỗi khi tải ảnh, vui lòng thử lại sau!");
    }
  }
};
`;
}

fs.writeFileSync('commands/dú.js', createCommandCode('dú', 'du', duUrls, 'Ảnh của bạn đây!'));
fs.writeFileSync('commands/lồn.js', createCommandCode('lồn', 'lon', lonUrls, 'Nội dung 18+ của bạn đây!'));

const gaiCode = `import axios from "axios";

const links = ${JSON.stringify(gaiUrls)};

export default {
  name: "gái",
  aliases: ["gai"],
  execute: async ({ client, message, type, replyBot }) => {
    try {
        const randomUrl = links[Math.floor(Math.random() * links.length)];
        const res = await axios({
            url: randomUrl,
            method: 'GET',
            responseType: 'arraybuffer'
        });
        const buffer = Buffer.from(res.data);
        const fileName = \`gai-\${Date.now()}.jpg\`;
        
        const isE2EE = (type === "E2EE Message" && message.chatJid);
        const targetId = isE2EE ? message.chatJid : message.threadId;

        if (isE2EE) {
            await client.sendE2EEMessage(targetId, "Ảnh girl xinh của bạn đây!", { replyToId: message.id });
            await client.sendE2EEImage(targetId, buffer, fileName);
        } else {
            await client.sendMessage(targetId, "Ảnh girl xinh của bạn đây!", { replyToId: message.id });
            await client.sendImage(targetId, buffer, fileName);
        }
    } catch (e) {
        console.error("Lỗi khi tải ảnh gái:", e);
        await replyBot("❌ Lỗi khi tải ảnh, vui lòng thử lại sau!");
    }
  }
};
`;
fs.writeFileSync('commands/gái.js', gaiCode);

console.log("Migration complete!");
