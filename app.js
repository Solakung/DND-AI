// ========================= ค่าคงที่ =========================
const CHAR_KEY = "solo_mmo_character_v2";
const HISTORY_KEY = "solo_mmo_history_v2";
const POINT_BUY_POOL = 20;
const STAT_MIN = 8;
const STAT_MAX = 18;
const KICKOFF_TEXT = "[เริ่มเกม]";
const PENDING_ROLL_KEY = "solo_mmo_pending_roll_v1";
const ENEMY_KEY = "solo_mmo_enemies_v1";
const SUMMARY_KEY = "solo_mmo_summary_v1";
const SUMMARIZE_CHUNK_SIZE = 20;   // จำนวนข้อความ (ผู้เล่น+GM รวมกัน) ต่อการย่อ 1 ครั้ง ~10 รอบสนทนา
const SUMMARIZE_KEEP_RECENT = 20;  // เก็บข้อความล่าสุดไว้ไม่แตะต้อง อย่างน้อยเท่านี้ ก่อนจะเริ่มย่อของเก่าถัดจากนั้น

const CLASS_PRESETS = [
    {
        id: "warrior", name: "นักรบ (Warrior)",
        stats: { str: 16, dex: 12, int: 8, con: 15 },
        gold: 15,
        inventory: ["⚔️ ดาบเหล็กกล้า (1d8)", "🛡️ โล่ไม้", "🍞 เสบียงแห้ง (x5)"],
        desc: "นักสู้แนวหน้า พละกำลังสูง ทนทาน ถนัดการต่อสู้ประชิดตัว"
    },
    {
        id: "mage", name: "นักเวทย์ (Mage)",
        stats: { str: 8, dex: 12, int: 17, con: 10 },
        gold: 20,
        inventory: ["🪄 ไม้เท้าเวทย์", "📖 หนังสือคาถา", "🧪 โพชั่นมานา (x3)"],
        desc: "ผู้ใช้เวทมนตร์ พลังโจมตีระยะไกลสูง แต่ร่างกายอ่อนแอ"
    },
    {
        id: "rogue", name: "โจร (Rogue)",
        stats: { str: 10, dex: 17, int: 12, con: 11 },
        gold: 25,
        inventory: ["🗡️ มีดสั้นคู่", "🧰 ชุดปลดกับดัก", "☠️ ยาพิษ (x2)"],
        desc: "คล่องแคล่ว ลอบเร้นเก่ง ถนัดโจมตีจุดอ่อนและหลบหลีก"
    },
    {
        id: "cleric", name: "นักบวช (Cleric)",
        stats: { str: 12, dex: 10, int: 13, con: 14 },
        gold: 15,
        inventory: ["🔱 คทาศักดิ์สิทธิ์", "🧪 โพชั่นฟื้นฟู (x5)", "📿 พระคัมภีร์"],
        desc: "ผู้รักษา ใช้พลังศักดิ์สิทธิ์ช่วยเหลือตัวเองและฟื้นฟู HP ได้ดี"
    }
];

// ========================= State =========================
let character = null;
let conversationHistory = [];
let pendingRoll = null; // { required, die, reason, rolled? } - ตั้งค่าเมื่อ AI ขอให้ทอยเต๋า (rolled = แต้มที่ทอยแล้วแต่ยังส่งไม่สำเร็จ)
let enemies = []; // [{ name, hp, maxHp }] ศัตรูที่อยู่ในฉากตอนนี้
let failedRequest = null; // { text, opts } - คำขอปกติ/ฉากเปิดเรื่องที่ส่งไม่สำเร็จ ไว้ให้กดลองใหม่
let summaryText = "";     // สรุปความจำระยะยาวสะสม (รวมของเก่ากับใหม่แล้ว) ส่งแนบไปกับทุก request ของ /api/chat
let summarizedCount = 0;  // จำนวนข้อความเก่าสุดใน conversationHistory ที่ถูกย่อรวมเข้า summaryText ไปแล้ว
let isSummarizing = false; // กันยิง /api/summarize ซ้อนกันหลายครั้งพร้อมกัน

const chatLog = document.getElementById("chat-log");
const inputField = document.getElementById("action-input");

// ========================= แก้ปัญหาคีย์บอร์ดมือถือบังช่องพิมพ์/ปุ่มส่ง =========================
// 100vh/100dvh ปกติจะคำนวณจาก layout viewport ซึ่งบางเบราว์เซอร์ (โดยเฉพาะ iOS Safari รุ่นเก่า)
// ไม่อัปเดตตามพื้นที่ที่มองเห็นจริงหลังคีย์บอร์ดเด้ง เลยตั้ง CSS var --vvh จาก window.visualViewport
// ไว้เป็น fallback ให้ .container/.screen อ้างอิงความสูงที่มองเห็นจริงเสมอ (ดู style.css)
function syncVisualViewportHeight() {
    if (!window.visualViewport) return;
    document.documentElement.style.setProperty("--vvh", `${window.visualViewport.height}px`);
}
if (window.visualViewport) {
    syncVisualViewportHeight();
    window.visualViewport.addEventListener("resize", syncVisualViewportHeight);
    window.visualViewport.addEventListener("scroll", syncVisualViewportHeight);
}

// พอโฟกัสช่องพิมพ์ คีย์บอร์ดมือถือเด้งช้ากว่า layout รีเฟรชเล็กน้อย (โดยเฉพาะ iOS) เลยรอเฟรมสั้นๆ
// แล้วค่อยเลื่อนให้เห็นช่องพิมพ์/ปุ่มส่งแน่ๆ อีกที กันกรณี --vvh อัปเดตไม่ทัน
inputField.addEventListener("focus", () => {
    setTimeout(() => inputField.scrollIntoView({ block: "end", behavior: "smooth" }), 300);
});

// ========================= Init =========================
window.onload = () => {
    renderClassGrid();
    character = loadCharacter();
    if (character) {
        conversationHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
        enemies = loadEnemies();
        const s = loadSummaryState();
        summaryText = s.text;
        summarizedCount = s.count;
        showScreen("game");
        renderCharacterSheet();
        setInputEnabled(false);
        setDiceEnabled(false);
        if (conversationHistory.length === 0) {
            addMessage("system", "[System]: กำลังเชื่อมต่อเข้าสู่โลก...");
            startAdventure();
        } else {
            addMessage("system", "[System]: กำลังโหลดเนื้อเรื่องเดิมต่อ...");
            conversationHistory.forEach(entry => {
                const text = entry.parts?.[0]?.text || "";
                if (entry.role === "user" && text !== KICKOFF_TEXT) addMessage("player", `> ${text}`);
                else if (entry.role === "model") addMessage("gm", safeNarrative(text));
            });
            pendingRoll = loadPendingRoll();
            if (pendingRoll && pendingRoll.required) {
                announceRoll(pendingRoll);
                if (Number.isInteger(pendingRoll.rolled)) {
                    addMessage("system", `[System]: คุณทอยได้ <b>${pendingRoll.rolled}</b> ไปแล้วแต่ยังส่งไม่สำเร็จ กดปุ่มทอยเต๋าเพื่อส่งผลเดิมอีกครั้ง`);
                }
            }
            restoreControls();
        }
    } else {
        showScreen("select");
    }
};

function showScreen(name) {
    document.getElementById("screen-select").style.display = name === "select" ? "flex" : "none";
    document.getElementById("screen-custom").style.display = name === "custom" ? "flex" : "none";
    document.getElementById("screen-game").style.display = name === "game" ? "flex" : "none";
}

// ========================= หน้าเลือกตัวละคร =========================
function renderClassGrid() {
    const grid = document.getElementById("class-grid");
    grid.innerHTML = CLASS_PRESETS.map(c => `
        <div class="class-card" onclick="startPresetCharacter('${c.id}')">
            <h3>${c.name}</h3>
            <div class="class-stats">STR ${c.stats.str} · DEX ${c.stats.dex} · INT ${c.stats.int} · CON ${c.stats.con}</div>
            <div class="class-desc">${c.desc}</div>
        </div>
    `).join("");
}

function startPresetCharacter(classId) {
    const preset = CLASS_PRESETS.find(c => c.id === classId);
    if (!preset) return;
    const name = prompt("ตั้งชื่อตัวละครของคุณ:", "");
    if (!name || !name.trim()) return;

    const maxHp = calcMaxHp(preset.stats.con);
    character = {
        name: name.trim(),
        className: preset.name,
        classDesc: preset.desc,
        backstory: "",
        stats: { ...preset.stats },
        maxHp,
        hp: maxHp,
        gold: preset.gold,
        inventory: [...preset.inventory]
    };
    initGame();
}

// ========================= หน้ากำหนดเอง =========================
let customStats = { str: STAT_MIN, dex: STAT_MIN, int: STAT_MIN, con: STAT_MIN };

function goToCustomScreen() {
    customStats = { str: STAT_MIN, dex: STAT_MIN, int: STAT_MIN, con: STAT_MIN };
    document.getElementById("custom-name").value = "";
    document.getElementById("custom-backstory").value = "";
    renderCustomStats();
    showScreen("custom");
}

function goToSelectScreen() {
    showScreen("select");
}

function renderCustomStats() {
    Object.keys(customStats).forEach(key => {
        document.getElementById(`val-${key}`).textContent = customStats[key];
    });
    const spent = Object.values(customStats).reduce((a, b) => a + (b - STAT_MIN), 0);
    document.getElementById("points-left").textContent = POINT_BUY_POOL - spent;
}

function adjustStat(stat, delta) {
    const spent = Object.values(customStats).reduce((a, b) => a + (b - STAT_MIN), 0);
    const newVal = customStats[stat] + delta;
    if (newVal < STAT_MIN || newVal > STAT_MAX) return;
    if (delta > 0 && spent >= POINT_BUY_POOL) return;
    customStats[stat] = newVal;
    renderCustomStats();
}

function startCustomCharacter() {
    const name = document.getElementById("custom-name").value.trim();
    if (!name) { alert("กรุณาตั้งชื่อตัวละคร"); return; }
    const backstory = document.getElementById("custom-backstory").value.trim();

    const maxHp = calcMaxHp(customStats.con);
    character = {
        name,
        className: "กำหนดเอง (Custom)",
        classDesc: "",
        backstory,
        stats: { ...customStats },
        maxHp,
        hp: maxHp,
        gold: 15,
        inventory: ["🍞 เสบียงแห้ง (x3)"]
    };
    initGame();
}

function calcMaxHp(con) {
    return 20 + (con - 10);
}

// ========================= เริ่มเกม =========================
function initGame() {
    conversationHistory = [];
    pendingRoll = null;
    savePendingRoll();
    enemies = [];
    saveEnemies();
    summaryText = "";
    summarizedCount = 0;
    saveSummaryState();
    saveCharacter();
    saveHistory();
    chatLog.innerHTML = "";
    showScreen("game");
    renderCharacterSheet();
    setInputEnabled(false);
    setDiceEnabled(false);
    addMessage("system", `[System]: กำลังนำ ${character.name} เข้าสู่โลกกว้าง...`);
    startAdventure();
}

// ยิง request แรกให้ AI แต่งฉากเปิดเรื่องเอง แทนข้อความ system ตายตัว
async function startAdventure() {
    await callServer(KICKOFF_TEXT, { hidePlayerBubble: true });
}

function resetGame() {
    if (!confirm("ต้องการเริ่มเกมใหม่และล้างตัวละคร/เนื้อเรื่องเดิมหรือไม่?")) return;
    localStorage.removeItem(CHAR_KEY);
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(PENDING_ROLL_KEY);
    localStorage.removeItem(ENEMY_KEY);
    localStorage.removeItem(SUMMARY_KEY);
    character = null;
    conversationHistory = [];
    pendingRoll = null;
    enemies = [];
    summaryText = "";
    summarizedCount = 0;
    isSummarizing = false;
    failedRequest = null;
    chatLog.innerHTML = "";
    showScreen("select");
}

// ========================= Render ชีทตัวละคร =========================
function renderCharacterSheet() {
    document.getElementById("char-name").textContent = character.name;
    document.getElementById("char-class").textContent = character.className + (character.status ? ` · สถานะ: ${character.status}` : "");

    document.getElementById("stat-str").textContent = character.stats.str;
    document.getElementById("stat-dex").textContent = character.stats.dex;
    document.getElementById("stat-int").textContent = character.stats.int;
    document.getElementById("stat-con").textContent = character.stats.con;

    document.getElementById("hp-text").textContent = `${character.hp} / ${character.maxHp}`;
    const pct = Math.max(0, Math.min(100, (character.hp / character.maxHp) * 100));
    document.getElementById("hp-bar-fill").style.width = `${pct}%`;

    document.getElementById("gold-text").textContent = character.gold;

    // เผื่อมีของเก่าที่หลุดเป็น object ค้างอยู่ใน save เดิม (ก่อนแก้บั๊กนี้) ให้กู้เป็นข้อความแทนที่จะโชว์ [object Object]
    let inventoryFixed = false;
    character.inventory = character.inventory.map(item => {
        if (typeof item === "string") return item;
        const recovered = extractItemName(item);
        if (recovered) { inventoryFixed = true; return recovered; }
        inventoryFixed = true;
        return null;
    }).filter(Boolean);
    if (inventoryFixed) saveCharacter();

    const invEl = document.getElementById("inventory-list");
    invEl.innerHTML = character.inventory.length
        ? character.inventory.map(item => `<div class="item">${item}</div>`).join("")
        : `<div class="item" style="opacity:0.5;">(ไม่มีไอเทม)</div>`;

    renderEnemyPanel();
}

function saveCharacter() { localStorage.setItem(CHAR_KEY, JSON.stringify(character)); }
function loadCharacter() { const raw = localStorage.getItem(CHAR_KEY); return raw ? JSON.parse(raw) : null; }
function saveHistory() { localStorage.setItem(HISTORY_KEY, JSON.stringify(conversationHistory)); }
function savePendingRoll() {
    if (pendingRoll) localStorage.setItem(PENDING_ROLL_KEY, JSON.stringify(pendingRoll));
    else localStorage.removeItem(PENDING_ROLL_KEY);
}
function saveEnemies() { localStorage.setItem(ENEMY_KEY, JSON.stringify(enemies)); }
function loadEnemies() {
    try {
        const raw = localStorage.getItem(ENEMY_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch { return []; }
}
function loadPendingRoll() { const raw = localStorage.getItem(PENDING_ROLL_KEY); return raw ? JSON.parse(raw) : null; }

function loadSummaryState() {
    try {
        const raw = localStorage.getItem(SUMMARY_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed.text === "string" && Number.isInteger(parsed.count)) return parsed;
    } catch { /* ข้อมูลเสีย ใช้ค่าเริ่มต้นแทน */ }
    return { text: "", count: 0 };
}
function saveSummaryState() {
    localStorage.setItem(SUMMARY_KEY, JSON.stringify({ text: summaryText, count: summarizedCount }));
}

// เรียกเบื้องหลังหลัง GM ตอบสำเร็จทุกครั้ง (ไม่บล็อก UI) เพื่อย่อ history ส่วนเก่าที่ยังไม่เคยถูกย่อ
// ให้กลายเป็นความทรงจำระยะยาว (summaryText) เก็บไว้แนบไปกับทุก request แทน history ดิบที่จะถูกตัดทิ้งฝั่งเซิร์ฟเวอร์
// ทำงานแบบ fire-and-forget: ถ้าพลาด/ล้มเหลว จะลองใหม่อัตโนมัติในรอบสนทนาถัดไป (ไม่ขยับ summarizedCount ถ้ายังไม่สำเร็จ)
async function maybeSummarizeOldHistory() {
    if (isSummarizing) return;
    const unsummarized = conversationHistory.length - summarizedCount;
    if (unsummarized < SUMMARIZE_CHUNK_SIZE + SUMMARIZE_KEEP_RECENT) return;

    const chunk = conversationHistory.slice(summarizedCount, summarizedCount + SUMMARIZE_CHUNK_SIZE);
    isSummarizing = true;
    try {
        const response = await fetch('/api/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chunk, previous_summary: summaryText, character })
        });
        let data = null;
        try { data = await response.json(); } catch { data = null; }

        if (data && typeof data.summary === "string" && !data._failed) {
            summaryText = data.summary;
            summarizedCount += chunk.length;
            saveSummaryState();
            console.log(`[summarize] ย่อ history สำเร็จ (${chunk.length} ข้อความ) รวมแล้ว summarizedCount=${summarizedCount}`);
        } else {
            console.warn("[summarize] ย่อ history ไม่สำเร็จ จะลองใหม่ในรอบสนทนาถัดไป", data && data._reason);
        }
    } catch (err) {
        console.warn("[summarize] เรียก /api/summarize ล้มเหลว จะลองใหม่ในรอบสนทนาถัดไป", err.message);
    } finally {
        isSummarizing = false;
    }
}

// ========================= แชท / เกมเพลย์ =========================
function addMessage(type, text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${type}`;
    msgDiv.innerHTML = String(text).replace(/\n/g, '<br>');
    chatLog.appendChild(msgDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
    return msgDiv;
}

function safeNarrative(text) {
    // ป้องกันกรณี history เก่ามี JSON ดิบติดมา (จากเวอร์ชันก่อนหน้า)
    try {
        const parsed = JSON.parse(text);
        return parsed.narrative || text;
    } catch {
        return text;
    }
}

// ---------- เต๋า / โบนัสสถานะ ----------
const STAT_LABEL = { str: "STR", dex: "DEX", int: "INT", con: "CON" };

function getDieSides(die) {
    const sides = parseInt(String(die || "d20").toLowerCase().replace("d", ""), 10);
    return Number.isInteger(sides) && sides >= 2 && sides <= 100 ? sides : 20;
}

// โบนัสแบบ DnD: (ค่าสถานะ - 10) หารสองปัดลง เช่น 16 → +3, 12 → +1, 8 → -1
function statMod(stat) {
    const v = character && character.stats ? character.stats[stat] : undefined;
    return Number.isFinite(v) ? Math.floor((v - 10) / 2) : 0;
}

function signed(n) { return n >= 0 ? `+${n}` : `${n}`; }
function rollSides(sides) { return Math.floor(Math.random() * sides) + 1; }

// คำอธิบายสั้นๆ ต่อท้ายข้อความตอน GM ขอให้ทอย
function rollHint(pr) {
    if (!pr) return "";
    const die = pr.die || "d20";
    const stat = STAT_LABEL[pr.stat];
    const bonusPart = (die === "d20" && stat) ? ` + ${stat}` : "";
    if (pr.opponent_name) return ` (${die}${bonusPart} แข่งกับ ${escapeHtml(pr.opponent_name)})`;
    if (Number(pr.dc) > 0) return ` (${die}${bonusPart} เทียบ DC ${Number(pr.dc)})`;
    return ` (${die}${bonusPart})`;
}

function rollDie() {
    if (character.hp <= 0 || !pendingRoll || !pendingRoll.required) return;

    const die = pendingRoll.die || "d20";
    const sides = getDieSides(die);
    const reason = pendingRoll.reason || "การกระทำล่าสุด";
    const statKey = (die === "d20" && STAT_LABEL[pendingRoll.stat]) ? pendingRoll.stat : null;
    const mod = statKey ? statMod(statKey) : 0;
    const oppName = pendingRoll.opponent_name || "";
    const oppBonus = Number(pendingRoll.opponent_bonus) || 0;
    const dc = Number(pendingRoll.dc) || 0;
    const isRetry = Number.isInteger(pendingRoll.rolled);

    // ทอยครั้งแรก: สุ่มแล้วเก็บไว้ก่อนส่ง (เผื่อเซิร์ฟเวอร์ล่ม/รีเฟรชหน้า) ถ้าเคยทอยแล้วจะใช้แต้มเดิม ห้ามทอยใหม่
    if (!isRetry) {
        pendingRoll.rolled = rollSides(sides);
    }
    if (oppName && !Number.isInteger(pendingRoll.oppRolled)) {
        pendingRoll.oppRolled = rollSides(sides); // ศัตรูทอยด้วยระบบ ไม่ให้ AI แต่งเลขเอง
    }
    savePendingRoll();

    const roll = pendingRoll.rolled;
    const total = roll + mod;
    const modText = statKey ? ` ${signed(mod)} ${STAT_LABEL[statKey]}` : "";
    const prefix = isRetry ? "ส่งผลทอยเดิมอีกครั้ง — " : "";
    let shownText;
    let rollText;

    if (oppName) {
        // ทอยแข่งกับศัตรู/NPC
        const oppRoll = pendingRoll.oppRolled;
        const oppTotal = oppRoll + oppBonus;
        const diff = total - oppTotal;
        const verdict = diff > 0 ? "ฉันชนะ" : diff < 0 ? "ฉันแพ้" : "เสมอ";
        const icon = diff > 0 ? "✅" : diff < 0 ? "❌" : "⚖️";
        const oppModText = oppBonus !== 0 ? ` ${signed(oppBonus)}` : "";
        const safeOpp = escapeHtml(oppName);
        shownText = `[Dice Roll]: ${prefix}คุณ ${die}: ${roll}${modText} = <b>${total}</b> vs ${safeOpp}: ${oppRoll}${oppModText} = <b>${oppTotal}</b> → ${icon} ${verdict}`;
        rollText = `ฉันทอย ${die} ได้ ${roll}${statKey ? ` บวกโบนัส ${STAT_LABEL[statKey]} ${signed(mod)}` : ""} = ${total} ส่วน ${oppName} ทอย ${die} ได้ ${oppRoll} บวกโบนัส ${signed(oppBonus)} = ${oppTotal} → ${verdict} (ส่วนต่าง ${signed(diff)}) สำหรับ: ${reason}`;
    } else if (dc > 0) {
        // เช็กเทียบ DC
        const diff = total - dc;
        const ok = total >= dc;
        const verdict = ok ? "สำเร็จ" : "ล้มเหลว";
        shownText = `[Dice Roll]: ${prefix}คุณ ${die}: ${roll}${modText} = <b>${total}</b> เทียบ DC ${dc} → ${ok ? "✅" : "❌"} ${verdict}`;
        rollText = `ฉันทอย ${die} ได้ ${roll}${statKey ? ` บวกโบนัส ${STAT_LABEL[statKey]} ${signed(mod)}` : ""} = ${total} เทียบ DC ${dc} → ${verdict} (ส่วนต่าง ${signed(diff)}) สำหรับ: ${reason}`;
    } else {
        // ทอยธรรมดา (เต๋าความเสียหาย/การรักษา, d100 ฯลฯ)
        shownText = `[Dice Roll]: ${prefix}คุณทอย ${die} ได้แต้ม <b>${roll}</b>${statKey ? `${modText} = <b>${total}</b>` : "!"}`;
        rollText = `ฉันทอย ${die} ได้แต้ม ${roll}${statKey ? ` บวกโบนัส ${STAT_LABEL[statKey]} ${signed(mod)} = ${total}` : ""} สำหรับ: ${reason}`;
    }

    addMessage("system", shownText);
    // pendingRoll ยังไม่ล้าง จะล้าง/แทนที่ก็ต่อเมื่อ GM ตอบสำเร็จ (ใน callServer)
    callServer(rollText, { isRoll: true });
}

// คงชื่อเดิมไว้ให้ปุ่มใน index.html (onclick="rollD20()") ยังใช้ได้
function rollD20() { rollDie(); }

// ---------- กระเป๋า: ไอเทมแบบมีจำนวน "ชื่อ (xN)" ----------
const QTY_RE = /\s*\(x(\d+)\)\s*$/i;

function parseInvItem(str) {
    const text = String(str);
    const m = text.match(QTY_RE);
    return { base: text.replace(QTY_RE, "").trim(), qty: m ? Math.max(1, parseInt(m[1], 10)) : 1 };
}

// คีย์ไว้เทียบชื่อ: ตัดจำนวนท้ายชื่อและอีโมจิ/สัญลักษณ์หน้าชื่อ
function itemKey(name) {
    return String(name).replace(QTY_RE, "").replace(/^[^\p{L}\p{N}]+/u, "").trim().toLowerCase();
}

function formatInvItem(base, qty, forceQty) {
    return (qty > 1 || forceQty) ? `${base} (x${qty})` : base;
}

// รับได้ทั้ง {name, quantity} และข้อความเก่า
// กันไว้เผื่อ name หลุดมาเป็น object แทนที่จะเป็น string ตรงๆ (จะได้ไม่กลายเป็น "[object Object]" ในกระเป๋า)
function extractItemName(raw) {
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") {
        const candidate = raw.name || raw.th || raw.en || raw.text || raw.value;
        if (typeof candidate === "string") return candidate;
    }
    return "";
}

function toItemEntry(x) {
    if (typeof x === "string") {
        const p = parseInvItem(x);
        return p.base ? { name: p.base, quantity: p.qty } : null;
    }
    if (x && typeof x === "object") {
        const rawName = extractItemName(x.name);
        if (!rawName.trim()) {
            console.warn("[toItemEntry] ได้รับ item ที่ name กู้คืนเป็นข้อความไม่ได้:", x);
            return null;
        }
        const p = parseInvItem(rawName);
        const q = Math.trunc(Number(x.quantity));
        return p.base ? { name: p.base, quantity: q >= 1 ? Math.min(q, 999) : p.qty } : null;
    }
    return null;
}

function findInventoryIndex(key, exactOnly) {
    if (!key) return -1;
    const exact = character.inventory.findIndex(i => itemKey(i) === key);
    if (exact !== -1 || exactOnly) return exact;
    return character.inventory.findIndex(i => {
        const k = itemKey(i);
        return k && (k.includes(key) || key.includes(k));
    });
}

// ใช้/เสียไอเทมตามจำนวนที่ระบุ ไม่ลบทั้งกอง
function removeFromInventory(entry) {
    const idx = findInventoryIndex(itemKey(entry.name), false);
    if (idx === -1) return null;
    const cur = parseInvItem(character.inventory[idx]);
    const used = Math.min(entry.quantity, cur.qty);
    const remaining = cur.qty - used;
    if (remaining > 0) character.inventory[idx] = formatInvItem(cur.base, remaining, true);
    else character.inventory.splice(idx, 1);
    return `➖ ${cur.base}${used > 1 ? ` x${used}` : ""}${remaining > 0 ? ` (เหลือ ${remaining})` : ""}`;
}

// ได้ไอเทมใหม่ ถ้ามีชนิดเดียวกันอยู่แล้วให้รวมกอง
function addToInventory(entry) {
    const idx = findInventoryIndex(itemKey(entry.name), true);
    if (idx !== -1) {
        const cur = parseInvItem(character.inventory[idx]);
        character.inventory[idx] = formatInvItem(cur.base, cur.qty + entry.quantity, true);
    } else {
        character.inventory.push(formatInvItem(entry.name, entry.quantity, false));
    }
    return `➕ ได้รับไอเทม: ${entry.name}${entry.quantity > 1 ? ` x${entry.quantity}` : ""}`;
}

// ---------- แต้มเต๋าที่ต้องการ ----------
// แสดงให้ผู้เล่นรู้ก่อนทอยว่าต้องได้กี่แต้ม (DC หรือแต้มที่ต้องชนะศัตรู)
function rollRequirement(pr) {
    if (!pr) return "";
    const die = pr.die || "d20";
    const sides = getDieSides(die);
    const statKey = (die === "d20" && STAT_LABEL[pr.stat]) ? pr.stat : null;
    const mod = statKey ? statMod(statKey) : 0;
    const modNote = statKey ? ` [โบนัส ${STAT_LABEL[statKey]} ${signed(mod)} รวมให้แล้ว]` : "";
    const chance = (need) => need <= 1 ? 100 : need > sides ? 0 : Math.round(((sides - need + 1) / sides) * 100);
    const describe = (need, goal) => {
        if (need > sides) return `ต้องได้ ${need} แต่ ${die} สูงสุดแค่ ${sides} → เป็นไปไม่ได้`;
        if (need <= 1) return `ทอยได้เท่าไหร่ก็${goal}`;
        return `ต้องทอย ${die} ให้ได้ <b>${need}</b> ขึ้นไปจึงจะ${goal} (โอกาส ~${chance(need)}%)`;
    };

    if (pr.opponent_name && Number.isInteger(pr.oppRolled)) {
        const oppBonus = Number(pr.opponent_bonus) || 0;
        const oppTotal = pr.oppRolled + oppBonus;
        const needWin = oppTotal - mod + 1;
        const needTie = oppTotal - mod;
        const tieNote = (needTie >= 1 && needTie <= sides) ? ` (ได้ ${needTie} พอดี = เสมอ)` : "";
        return `🎯 ${escapeHtml(pr.opponent_name)} ทอยได้ ${pr.oppRolled}${oppBonus ? ` ${signed(oppBonus)}` : ""} = <b>${oppTotal}</b> → ${describe(needWin, "ชนะ")}${modNote}${tieNote}`;
    }

    const dc = Number(pr.dc) || 0;
    if (dc > 0) return `🎯 DC ${dc} → ${describe(dc - mod, "สำเร็จ")}${modNote}`;
    return "";
}

// ประกาศว่า GM ขอให้ทอย พร้อมบอกแต้มที่ต้องการ (ศัตรูทอยก่อนและเปิดเผยแต้มตรงนี้)
function announceRoll(pr) {
    if (!pr) return;
    if (pr.opponent_name && !Number.isInteger(pr.oppRolled)) {
        pr.oppRolled = rollSides(getDieSides(pr.die || "d20"));
        savePendingRoll();
    }
    addMessage("system", `[System]: 🎲 GM ขอให้คุณทอยเต๋าเพื่อ: ${escapeHtml(pr.reason || "ตัดสินผลการกระทำ")}${rollHint(pr)}`);
    const req = rollRequirement(pr);
    if (req) addMessage("system", `[System]: ${req}`);
}

// ---------- ศัตรู ----------
function findEnemyIndex(name) {
    const key = itemKey(name);
    if (!key) return -1;
    const exact = enemies.findIndex(e => itemKey(e.name) === key);
    if (exact !== -1) return exact;
    return enemies.findIndex(e => {
        const k = itemKey(e.name);
        return k && (k.includes(key) || key.includes(k));
    });
}

function applyEnemyChanges(changes, events) {
    changes.forEach(c => {
        if (!c || typeof c.name !== "string" || !c.name.trim()) return;
        const name = c.name.trim();
        const safeName = escapeHtml(name);
        let idx = findEnemyIndex(name);

        if (idx === -1) {
            const maxHp = Math.trunc(Number(c.max_hp));
            if (!(maxHp > 0)) return; // ไม่รู้จักและไม่ได้ประกาศตัวใหม่ → ข้าม
            enemies.push({ name, hp: Math.min(maxHp, 999), maxHp: Math.min(maxHp, 999) });
            idx = enemies.length - 1;
            events.push(`👹 พบศัตรู: ${safeName} (HP ${enemies[idx].hp}/${enemies[idx].maxHp})`);
        }

        const e = enemies[idx];
        const delta = Math.trunc(Number(c.hp_change)) || 0;
        if (delta !== 0) {
            e.hp = Math.max(0, Math.min(e.maxHp, e.hp + delta));
            events.push(delta < 0
                ? `⚔️ ${safeName} เสีย ${Math.abs(delta)} HP (เหลือ ${e.hp}/${e.maxHp})`
                : `💚 ${safeName} ฟื้นฟู ${delta} HP (${e.hp}/${e.maxHp})`);
        }

        if (e.hp <= 0) {
            enemies.splice(idx, 1);
            events.push(`💀 ${safeName} ถูกกำจัดแล้ว`);
        } else if (c.remove === true) {
            enemies.splice(idx, 1);
            events.push(`🏃 ${safeName} ออกจากการต่อสู้`);
        }
    });
    saveEnemies();
}

// รายงานสถานะสั้นๆ หลัง GM ตอบทุกครั้งที่มีศัตรูอยู่ในฉาก
function statusReport() {
    if (!enemies.length) return "";
    const me = `คุณ ${character.hp}/${character.maxHp} HP${character.status && character.status !== "ปกติ" ? ` (${escapeHtml(character.status)})` : ""}`;
    const foes = enemies.map(e => `${escapeHtml(e.name)} ${e.hp}/${e.maxHp}`).join(" | ");
    return `📋 สถานะ: ${me} | ${foes}`;
}

function renderEnemyPanel() {
    let panel = document.getElementById("enemy-panel");
    if (!panel) {
        const anchor = document.querySelector(".gold-wrap");
        if (!anchor) return;
        panel = document.createElement("div");
        panel.id = "enemy-panel";
        anchor.insertAdjacentElement("afterend", panel);
    }
    if (!enemies.length) {
        panel.style.display = "none";
        panel.innerHTML = "";
        return;
    }
    panel.style.cssText = "display:block;margin-bottom:15px;padding:10px;background:#2a1a2a;border:1px solid #6b3a6b;border-radius:6px;";
    panel.innerHTML = `<div style="color:#d4af37;font-size:0.9em;font-weight:bold;margin-bottom:8px;">⚔️ ศัตรูในฉาก</div>` +
        enemies.map(e => {
            const pct = Math.max(0, Math.min(100, (e.hp / e.maxHp) * 100));
            return `<div style="margin-bottom:8px;">` +
                `<div style="display:flex;justify-content:space-between;gap:8px;font-size:0.85em;color:#ccc;margin-bottom:3px;">` +
                `<span style="overflow-wrap:anywhere;">${escapeHtml(e.name)}</span><span>${e.hp} / ${e.maxHp}</span></div>` +
                `<div style="height:8px;background:#111;border:1px solid #555;border-radius:4px;overflow:hidden;">` +
                `<div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#4a1a6b,#8e44ad);"></div></div></div>`;
        }).join("");
}

function handleEnter(event) {
    if (event.key === "Enter") sendAction();
}

function sendAction() {
    if (character.hp <= 0 || (pendingRoll && pendingRoll.required)) return;
    const text = inputField.value.trim();
    if (!text) return;
    failedRequest = null;
    document.querySelectorAll(".retry-btn").forEach(b => b.remove());
    addMessage("player", `> ${text}`);
    inputField.value = "";
    callServer(text);
}

function setInputEnabled(enabled) {
    inputField.disabled = !enabled;
}

function setDiceEnabled(enabled, label, die) {
    const btn = document.querySelector(".dice-btn");
    btn.disabled = !enabled;
    const dieName = String(die || "d20").toUpperCase();
    btn.textContent = enabled ? `🎲 ทอยเต๋า ${dieName}${label ? ` — ${label}` : ""}` : "🎲 รอ GM เรียกให้ทอยเต๋า...";
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

async function callServer(playerText, opts = {}) {
    setInputEnabled(false);
    setDiceEnabled(false);
    const loadingMsg = addMessage("system", "[System]: GM กำลังประมวลผล...");

    conversationHistory.push({ role: "user", parts: [{ text: playerText }] });

    let data = null;
    let errorReason = "";

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: conversationHistory, character, enemies, summary: summaryText })
        });

        try { data = await response.json(); } catch { data = null; } // เช่น Vercel timeout ตอบเป็น HTML/ข้อความ

        if (!data || !data.narrative) {
            errorReason = (data && data.error)
                ? `เซิร์ฟเวอร์ตอบกลับผิดพลาด - ${data.error}`
                : (response.status === 429
                    ? "เซิร์ฟเวอร์ทำงานหนักเกินไป (Rate Limit) กรุณารอสักครู่แล้วลองใหม่"
                    : `เซิร์ฟเวอร์ตอบกลับผิดปกติ (HTTP ${response.status})`);
            data = null;
        }
    } catch (error) {
        errorReason = `การเชื่อมต่อล้มเหลว - ${error.message}`;
        data = null;
    }

    loadingMsg.remove();

    // ----- ล้มเหลว: ถอยสถานะกลับ แล้วเปิดทางให้ลองใหม่โดยไม่เสียแต้มทอย/ข้อความที่พิมพ์ -----
    if (!data) {
        conversationHistory.pop();
        handleFailure(playerText, opts, errorReason);
        return;
    }

    // ----- สำเร็จ -----
    failedRequest = null;
    if (data._model) console.log("[GM model]", data._model, data._attempts); // มีเมื่อเปิด DEBUG_META=1 ฝั่งเซิร์ฟเวอร์

    addMessage("gm", data.narrative);
    conversationHistory.push({ role: "model", parts: [{ text: data.narrative }] });
    saveHistory();
    maybeSummarizeOldHistory(); // ทำงานเบื้องหลัง ไม่ await เพื่อไม่ให้หน่วง UI

    applyStateChanges(data);

    // ตั้งค่า pendingRoll ตามที่ AI ขอมา (ของเก่าที่ทอยแล้วถูกแทนที่/ล้างตรงนี้)
    if (data.roll_request && data.roll_request.required) {
        pendingRoll = data.roll_request;
        announceRoll(pendingRoll);
    } else {
        pendingRoll = null;
    }
    savePendingRoll();
    restoreControls();
}

function handleFailure(playerText, opts, reason) {
    addMessage("system", `[Error]: ${escapeHtml(reason)}`);

    if (opts.isRoll) {
        // pendingRoll (พร้อมแต้มที่ทอยแล้ว) ยังอยู่ → ปุ่มทอยจะส่งแต้มเดิมซ้ำ
        addMessage("system", `[System]: เก็บผลทอย <b>${pendingRoll ? pendingRoll.rolled : "-"}</b> ไว้แล้ว กดปุ่มทอยเต๋าเพื่อส่งอีกครั้ง จะไม่ทอยใหม่`);
    } else {
        failedRequest = { text: playerText, opts };
        addMessage("system", `[System]: ส่งไม่สำเร็จ <button class="retry-btn" onclick="retryFailed()" style="margin-left:8px;padding:4px 10px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:inherit;">🔁 ลองส่งอีกครั้ง</button>`);
    }
    restoreControls();
}

function retryFailed() {
    if (!failedRequest) return;
    const { text, opts } = failedRequest;
    failedRequest = null;
    document.querySelectorAll(".retry-btn").forEach(b => b.remove());
    callServer(text, opts);
}

function restoreControls() {
    if (character.hp <= 0) {
        setInputEnabled(false);
        setDiceEnabled(false);
        return;
    }
    if (failedRequest && failedRequest.opts && failedRequest.opts.hidePlayerBubble) {
        setInputEnabled(false);
        setDiceEnabled(false);
        return;
    }
    if (pendingRoll && pendingRoll.required) {
        setInputEnabled(false);
        setDiceEnabled(true, pendingRoll.reason, pendingRoll.die);
    } else {
        setInputEnabled(true);
        setDiceEnabled(false);
    }
}

function applyStateChanges(data) {
    const events = [];

    if (typeof data.max_hp_change === "number" && data.max_hp_change !== 0) {
        character.maxHp = Math.max(1, character.maxHp + data.max_hp_change);
        events.push(`HP สูงสุด${data.max_hp_change > 0 ? "เพิ่มขึ้น" : "ลดลง"} ${Math.abs(data.max_hp_change)}`);
    }

    if (typeof data.hp_change === "number" && data.hp_change !== 0) {
        character.hp = Math.max(0, Math.min(character.maxHp, character.hp + data.hp_change));
        events.push(data.hp_change < 0 ? `💥 ได้รับความเสียหาย ${Math.abs(data.hp_change)} HP` : `💚 ฟื้นฟู ${data.hp_change} HP`);
    }

    if (typeof data.gold_change === "number" && data.gold_change !== 0) {
        character.gold = Math.max(0, character.gold + data.gold_change);
        events.push(data.gold_change > 0 ? `🪙 ได้รับทอง ${data.gold_change}` : `🪙 เสียทอง ${Math.abs(data.gold_change)}`);
    }

    if (Array.isArray(data.remove_items)) {
        data.remove_items.map(toItemEntry).filter(Boolean).forEach(entry => {
            const msg = removeFromInventory(entry);
            if (msg) events.push(msg);
        });
    }

    if (Array.isArray(data.add_items)) {
        data.add_items.map(toItemEntry).filter(Boolean).forEach(entry => {
            events.push(addToInventory(entry));
        });
    }

    if (typeof data.status === "string" && data.status) {
        character.status = data.status;
    }

    if (Array.isArray(data.enemy_changes)) {
        applyEnemyChanges(data.enemy_changes, events);
    }

    if (events.length > 0) {
        addMessage("event", events.join(" | "));
    }

    const report = statusReport();
    if (report) addMessage("event", report);

    if (character.hp <= 0) {
        const statusText = data.status === "เสียชีวิต" ? "คุณเสียชีวิตแล้ว 💀" : "คุณหมดสติ...";
        addMessage("system", `[System]: ${statusText} กด "เริ่มเกมใหม่" เพื่อผจญภัยรอบใหม่`);
    }

    saveCharacter();
    renderCharacterSheet();
}
