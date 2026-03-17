"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const BASE_DIR = path.join(__dirname, "..");
const STORE = path.join(BASE_DIR, "cache", "video", "uploads.json");
const SRC = {
    anime: path.join(BASE_DIR, "cache", "video", "api.json"),
    girl: path.join(BASE_DIR, "cache", "video", "vdgai.json"),
    trai: path.join(BASE_DIR, "cache", "video", "trai.json")
};

function ensure() {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    if (!fs.existsSync(STORE)) fs.writeFileSync(STORE, "{}", "utf-8");
}
function read() {
    ensure();
    try {
        const s = fs.readFileSync(STORE, "utf-8");
        return s.trim() ? JSON.parse(s) : {};
    } catch {
        return {};
    }
}
function write(o) {
    ensure();
    fs.writeFileSync(STORE, JSON.stringify(o, null, 2), "utf-8");
}
function botID(api) {
    try {
        return String(api.getCurrentUserID?.() || global.botID || "unknown");
    } catch {
        return "unknown";
    }
}
function getA(id, t) {
    const st = read();
    if (!st[id]) st[id] = { anime: [], girl: [], trai: [] };
    if (!Array.isArray(st[id][t])) st[id][t] = [];
    return st[id][t];
}
function setA(id, t, a) {
    const st = read();
    if (!st[id]) st[id] = { anime: [], girl: [], trai: [] };
    st[id][t] = Array.isArray(a) ? a : [];
    write(st);
}
function makeArr(api) {
    const id = botID(api);
    const st = read();
    if (!st[id]) {
        st[id] = { anime: [], girl: [], trai: [] };
        write(st);
    }
    const muts = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse"]);
    return (t) =>
        new Proxy(
            {},
            {
                get(_, p) {
                    const a = getA(id, t);
                    if (p === "length") return a.length;
                    if (/^[0-9]+$/.test(String(p))) return a[Number(p)];
                    if (muts.has(p)) {
                        return (...args) => {
                            const c = getA(id, t);
                            const r = Array.prototype[p].apply(c, args);
                            setA(id, t, c);
                            return r;
                        };
                    }
                    if (p === "toArray") return () => getA(id, t).slice();
                    if (p === Symbol.iterator) {
                        const ss = getA(id, t).slice();
                        return function* () {
                            for (const x of ss) yield x;
                        };
                    }
                    return undefined;
                },
                set(_, p, v) {
                    if (p === "length") {
                        const c = getA(id, t);
                        c.length = v;
                        setA(id, t, c);
                        return true;
                    }
                    if (/^[0-9]+$/.test(String(p))) {
                        const c = getA(id, t);
                        c[Number(p)] = v;
                        setA(id, t, c);
                        return true;
                    }
                    return false;
                },
                getPrototypeOf() {
                    return Array.prototype;
                }
            }
        );
}

const stream = async (url) => {
    const r = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Referer: "https://imgur.com/" },
        responseType: "stream"
    });
    return r.data;
};

const upload = async (url, api) => {
    try {
        const form = { upload_1024: await stream(url) };
        const r = await api.postFormData("https://upload.facebook.com/ajax/mercury/upload.php", form);
        const d = JSON.parse(String(r.body || "").replace("for (;;);", ""));
        return Object.entries(d?.payload?.metadata?.[0] || {})[0];
    } catch {
        return null;
    }
};

module.exports = ({ api }) => {
    const make = makeArr(api);
    global.anime = make("anime");
    global.girl = make("girl");
    global.trai = make("trai");

    const src = {
        anime: JSON.parse(fs.readFileSync(SRC.anime, "utf-8")),
        girl: JSON.parse(fs.readFileSync(SRC.girl, "utf-8")),
        trai: JSON.parse(fs.readFileSync(SRC.trai, "utf-8"))
    };

    ["anime", "girl", "trai"].forEach((t, i) => {
        const sKey = `status${i + 1}`;
        const tKey = `Vtuancuti${i + 1}`;
        const a = global[t];
        if (!global[tKey]) {
            global[tKey] = setInterval(async () => {
                if (global[sKey] || a.length > 5) return;
                global[sKey] = true;
                const list = src[t];
                const jobs = Array.from({ length: 3 }, async () => {
                    try {
                        if (!Array.isArray(list) || !list.length) return null;
                        const url = list[Math.floor(Math.random() * list.length)];
                        return await upload(url, api);
                    } catch {
                        return null;
                    }
                });
                const up = await Promise.all(jobs);
                a.push(...up.filter(Boolean));
                global[sKey] = false;
            }, 3000);
        }
    });
};
