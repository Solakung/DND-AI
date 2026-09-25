// ========================= ค่าคงที่ =========================
const CHAR_KEY = "solo_mmo_character_v2";
const HISTORY_KEY = "solo_mmo_history_v2";
const POINT_BUY_POOL = 30; // เดิม 20 แต้มสำหรับ 4 สถานะ ตอนนี้เพิ่ม WIS/CHA เป็น 6 สถานะ ปรับพูลตามสัดส่วนเดิม (เฉลี่ยสถานะละ 5 แต้มเท่าเดิม)
const STAT_MIN = 8;
const STAT_MAX = 18;
const KICKOFF_TEXT = "[เริ่มเกม]";
const PENDING_ROLL_KEY = "solo_mmo_pending_roll_v1";
const ENEMY_KEY = "solo_mmo_enemies_v1";
const SUMMARY_KEY = "solo_mmo_summary_v1";
const SUMMARIZE_CHUNK_SIZE = 20;   // จำนวนข้อความ (ผู้เล่น+GM รวมกัน) ต่อการย่อ 1 ครั้ง ~10 รอบสนทนา
const SUMMARIZE_KEEP_RECENT = 20;  // เก็บข้อความล่าสุดไว้ไม่แตะต้อง อย่างน้อยเท่านี้ ก่อนจะเริ่มย่อของเก่าถัดจากนั้น

// ========================= เลเวล / XP / Spell Slot / Conditions =========================
// ตารางค่านี้เป็นสูตรแบบย่อของเกมนี้เอง ไม่ใช่ตัวเลขจริงจากคู่มือ DnD 5e (เลข XP จริงในคัมภีร์ใหญ่กว่านี้มาก)
// ทำให้เบาและเลเวลอัพได้ถี่พอสำหรับเกมแชทสั้นๆ ระบบคำนวณทุกอย่างฝั่ง client เอง ไม่พึ่ง AI
const MAX_LEVEL = 20;
const XP_THRESHOLDS = [0, 0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700, 3300, 4000, 4700, 5500, 6400, 7400, 8500, 9700, 11000, 12400];
function xpForLevel(lvl) { return XP_THRESHOLDS[Math.max(1, Math.min(MAX_LEVEL, lvl))]; }
function profBonusForLevel(lvl) {
    if (lvl >= 17) return 6;
    if (lvl >= 13) return 5;
    if (lvl >= 9) return 4;
    if (lvl >= 5) return 3;
    return 2;
}
// จำนวน Spell Slot รวม (ไม่แบ่งระดับคาถาแบบ 5e จริง เพื่อความง่าย) โตตามเลเวล
function spellSlotMaxForLevel(lvl) { return 2 + Math.floor((lvl - 1) / 2); }

const CONDITION_LIST = {
    poisoned: { label: "มึนพิษ", effect: "Disadvantage ต่อการโจมตี/เช็กหลายอย่าง" },
    prone: { label: "ล้มคว่ำ", effect: "Disadvantage โจมตีระยะไกล/เวท, ศัตรูประชิดตัวได้เปรียบ" },
    stunned: { label: "มึนงง", effect: "ทำอะไรไม่ได้ชั่วคราว" },
    restrained: { label: "ถูกจับตรึง", effect: "Disadvantage โจมตี/DEX check, ศัตรูได้เปรียบ" },
    frightened: { label: "หวาดกลัว", effect: "Disadvantage เมื่อต้องเข้าใกล้สิ่งที่กลัว" },
    blinded: { label: "ตาบอดชั่วคราว", effect: "Disadvantage โจมตี, ศัตรูได้เปรียบ" },
    paralyzed: { label: "เป็นอัมพาต", effect: "ทำอะไรไม่ได้เลยชั่วคราว" }
};

const CLASS_PRESETS = [
    {
        id: "warrior", name: "นักรบ (Warrior)",
        stats: { str: 16, dex: 12, int: 8, con: 15, wis: 10, cha: 11 },
        gold: 15, hitDie: 10, caster: false,
        inventory: ["⚔️ ดาบเหล็กกล้า (1d8)", "🛡️ โล่ไม้", "🍞 เสบียงแห้ง (x5)"],
        desc: "นักสู้แนวหน้า พละกำลังสูง ทนทาน ถนัดการต่อสู้ประชิดตัว"
    },
    {
        id: "mage", name: "นักเวทย์ (Mage)",
        stats: { str: 8, dex: 12, int: 17, con: 10, wis: 12, cha: 9 },
        gold: 20, hitDie: 6, caster: true,
        inventory: ["🪄 ไม้เท้าเวทย์", "📖 หนังสือคาถา"],
        desc: "ผู้ใช้เวทมนตร์ พลังโจมตีระยะไกลสูง แต่ร่างกายอ่อนแอ (ร่ายเวทหนักๆ ใช้ Spell Slot)"
    },
    {
        id: "rogue", name: "โจร (Rogue)",
        stats: { str: 10, dex: 17, int: 12, con: 11, wis: 10, cha: 13 },
        gold: 25, hitDie: 8, caster: false,
        inventory: ["🗡️ มีดสั้นคู่", "🧰 ชุดปลดกับดัก", "☠️ ยาพิษ (x2)"],
        desc: "คล่องแคล่ว ลอบเร้นเก่ง ถนัดโจมตีจุดอ่อนและหลบหลีก"
    },
    {
        id: "cleric", name: "นักบวช (Cleric)",
        stats: { str: 12, dex: 10, int: 13, con: 14, wis: 16, cha: 11 },
        gold: 15, hitDie: 8, caster: true,
        inventory: ["🔱 คทาศักดิ์สิทธิ์", "📿 พระคัมภีร์"],
        desc: "ผู้รักษา ใช้พลังศักดิ์สิทธิ์ช่วยเหลือตัวเองและฟื้นฟู HP ได้ดี (WIS สูงช่วยเวทรักษา/สังเกตการณ์ ร่ายเวทหนักๆ ใช้ Spell Slot)"
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
        normalizeCharacterShape();
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
                if (Array.isArray(pendingRoll.rolled) && pendingRoll.rolled.length) {
                    addMessage("system", `[System]: คุณทอยได้ <b>${pendingRoll.rolled.join("+")}</b> ไปแล้วแต่ยังส่งไม่สำเร็จ กดปุ่มทอยเต๋าเพื่อส่งผลเดิมอีกครั้ง`);
                }
            }
            restoreControls();
            if (pendingRoll && pendingRoll.mode === "enemy_attack") setTimeout(performEnemyAttack, 900);
        }
    } else {
        showScreen("select");
    }
};

// เผื่อโหลดตัวละครเก่าที่เซฟไว้ก่อนเพิ่มระบบ WIS/CHA/AC/Death Saving Throw ให้เติมฟิลด์ที่ขาดแทนที่จะพัง
function normalizeCharacterShape() {
    if (!character || !character.stats) return;
    if (typeof character.stats.wis !== "number") character.stats.wis = 10;
    if (typeof character.stats.cha !== "number") character.stats.cha = 10;
    if (typeof character.dying !== "boolean") character.dying = false;
    if (!character.deathSaves || typeof character.deathSaves.success !== "number") {
        character.deathSaves = { success: 0, fail: 0 };
    }
    // เซฟเก่าก่อนเพิ่มระบบเลเวล/XP/Spell Slot/Conditions — เติมค่าเริ่มต้นให้แทนที่จะพัง
    if (typeof character.level !== "number") character.level = 1;
    if (typeof character.xp !== "number") character.xp = 0;
    if (typeof character.profBonus !== "number") character.profBonus = profBonusForLevel(character.level);
    if (typeof character.hitDie !== "number") character.hitDie = 8;
    if (character.spellSlots !== null && (typeof character.spellSlots !== "object" || typeof character.spellSlots.max !== "number")) {
        // เดาว่าเคยเป็นสายเวทย์หรือไม่จากชื่ออาชีพ เผื่อเซฟเก่าไม่มีข้อมูลนี้เลย
        const looksLikeCaster = /เวทย์|บวช|mage|cleric/i.test(character.className || "");
        character.spellSlots = looksLikeCaster ? { max: spellSlotMaxForLevel(character.level), current: spellSlotMaxForLevel(character.level) } : null;
    }
    if (!Array.isArray(character.conditions)) character.conditions = [];
    // เวอร์ชันเก่าอาจมี status เป็น "หมดสติ"/"เสียชีวิต" ค้างอยู่ (ระบบใหม่คุม dying/deathSaves แยกต่างหากแล้ว)
    if ((character.status === "เสียชีวิต" || character.status === "หมดสติ") && !character.dying && character.hp > 0) {
        character.status = "ปกติ";
    }
}

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
            <div class="class-stats">STR ${c.stats.str} · DEX ${c.stats.dex} · INT ${c.stats.int} · CON ${c.stats.con} · WIS ${c.stats.wis} · CHA ${c.stats.cha}</div>
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
    const slotMax = preset.caster ? spellSlotMaxForLevel(1) : 0;
    character = {
        name: name.trim(),
        className: preset.name,
        classDesc: preset.desc,
        backstory: "",
        stats: { ...preset.stats },
        maxHp,
        hp: maxHp,
        gold: preset.gold,
        inventory: [...preset.inventory],
        dying: false,                        // true เมื่อ HP=0 และกำลังทอย Death Saving Throw (ดู performDeathSave)
        deathSaves: { success: 0, fail: 0 },
        level: 1, xp: 0, profBonus: profBonusForLevel(1), hitDie: preset.hitDie,
        spellSlots: preset.caster ? { max: slotMax, current: slotMax } : null,
        conditions: []
    };
    initGame();
}

// ========================= หน้ากำหนดเอง =========================
let customStats = { str: STAT_MIN, dex: STAT_MIN, int: STAT_MIN, con: STAT_MIN, wis: STAT_MIN, cha: STAT_MIN };

function goToCustomScreen() {
    customStats = { str: STAT_MIN, dex: STAT_MIN, int: STAT_MIN, con: STAT_MIN, wis: STAT_MIN, cha: STAT_MIN };
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
        inventory: ["🍞 เสบียงแห้ง (x3)"],
        dying: false,
        deathSaves: { success: 0, fail: 0 },
        level: 1, xp: 0, profBonus: profBonusForLevel(1), hitDie: 8,
        spellSlots: null, // ตัวละครกำหนดเองไม่มีกลไก Spell Slot ในเวอร์ชันนี้ (ร่ายเวทได้แบบเนื้อเรื่องอย่างเดียว ถ้ามี)
        conditions: []
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
    document.getElementById("stat-wis").textContent = character.stats.wis;
    document.getElementById("stat-cha").textContent = character.stats.cha;

    document.getElementById("hp-text").textContent = `${character.hp} / ${character.maxHp}`;
    const pct = Math.max(0, Math.min(100, (character.hp / character.maxHp) * 100));
    document.getElementById("hp-bar-fill").style.width = `${pct}%`;

    document.getElementById("gold-text").textContent = character.gold;
    document.getElementById("ac-text").textContent = characterAC();
    renderDeathSavePanel();

    document.getElementById("level-text").textContent = character.level;
    document.getElementById("prof-text").textContent = signed(character.profBonus);
    const nextXp = xpForLevel(character.level + 1);
    const prevXp = xpForLevel(character.level);
    document.getElementById("xp-text").textContent = character.level >= MAX_LEVEL
        ? `${character.xp} XP (เลเวลสูงสุดแล้ว)`
        : `${character.xp} / ${nextXp} XP`;
    const xpPct = character.level >= MAX_LEVEL ? 100 : Math.max(0, Math.min(100, ((character.xp - prevXp) / (nextXp - prevXp)) * 100));
    document.getElementById("xp-bar-fill").style.width = `${xpPct}%`;

    renderSpellSlotPanel();
    renderConditionList();

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
const STAT_LABEL = { str: "STR", dex: "DEX", int: "INT", con: "CON", wis: "WIS", cha: "CHA" };

function getDieSides(die) {
    const sides = parseInt(String(die || "d20").toLowerCase().replace("d", ""), 10);
    return Number.isInteger(sides) && sides >= 2 && sides <= 100 ? sides : 20;
}

// โบนัสแบบ DnD: (ค่าสถานะ - 10) หารสองปัดลง เช่น 16 → +3, 12 → +1, 8 → -1
function statMod(stat) {
    const v = character && character.stats ? character.stats[stat] : undefined;
    return Number.isFinite(v) ? Math.floor((v - 10) / 2) : 0;
}

// AC แบบ DnD 5e พื้นฐาน: 10 + โบนัส DEX (ยังไม่รองรับเกราะ/ไอเทมเพิ่ม AC ในเวอร์ชันนี้)
function characterAC() { return 10 + statMod("dex"); }

// โบนัสรวมของผู้เล่นสำหรับทอย d20 (check/attack): ค่าสถานะ + Proficiency Bonus ตามเลเวล
// (เวอร์ชันย่อ: บวก Proficiency Bonus ให้ทุกการทอย ไม่แยกทักษะที่ถนัด/ไม่ถนัดแบบ 5e เต็มรูปแบบ)
function effectiveMod(statKey) {
    const base = statMod(statKey);
    const prof = character && Number.isFinite(character.profBonus) ? character.profBonus : 0;
    return base + prof;
}

function signed(n) { return n >= 0 ? `+${n}` : `${n}`; }
function rollSides(sides) { return Math.floor(Math.random() * sides) + 1; }

// คำอธิบายสั้นๆ ต่อท้ายข้อความตอน GM ขอให้ทอย
function rollHint(pr) {
    if (!pr) return "";
    const die = pr.die || "d20";
    const stat = STAT_LABEL[pr.stat];
    const bonusPart = (die === "d20" && stat) ? ` + ${stat}` : "";
    const advPart = pr.advantage === "advantage" ? " [Advantage]" : pr.advantage === "disadvantage" ? " [Disadvantage]" : "";
    if (pr.mode === "attack") return ` (${die}${bonusPart}${advPart} โจมตี ${escapeHtml(pr.opponent_name || "เป้าหมาย")})`;
    if (pr.mode === "check" && Number(pr.dc) > 0) return ` (${die}${bonusPart}${advPart} เทียบ DC ${Number(pr.dc)})`;
    return ` (${die}${bonusPart}${advPart})`;
}

function rollDie() {
    if (character.hp <= 0 || character.dying || !pendingRoll || !pendingRoll.required || pendingRoll.mode === "enemy_attack") return;

    const die = pendingRoll.die || "d20";
    const sides = getDieSides(die);
    const mode = pendingRoll.mode || "check"; // "check" | "attack" | "damage" | "event"
    const reason = pendingRoll.reason || "การกระทำล่าสุด";
    const statKey = (die === "d20" && STAT_LABEL[pendingRoll.stat]) ? pendingRoll.stat : null;
    const mod = statKey ? effectiveMod(statKey) : 0;
    const advantageMode = (die === "d20" && (mode === "check" || mode === "attack") && (pendingRoll.advantage === "advantage" || pendingRoll.advantage === "disadvantage"))
        ? pendingRoll.advantage : "normal";
    const diceCount = mode === "damage" ? Math.max(1, Math.min(4, Number(pendingRoll.dice_count) || 1)) : 1;
    const isRetry = Array.isArray(pendingRoll.rolled) && pendingRoll.rolled.length > 0;

    // ทอยครั้งแรก: สุ่มแล้วเก็บไว้ก่อนส่ง (เผื่อเซิร์ฟเวอร์ล่ม/รีเฟรชหน้า) ถ้าเคยทอยแล้วจะใช้แต้มเดิม ห้ามทอยใหม่
    if (!isRetry) {
        if (advantageMode !== "normal") {
            const a = rollSides(sides), b = rollSides(sides);
            pendingRoll.rolled = [advantageMode === "advantage" ? Math.max(a, b) : Math.min(a, b)];
            pendingRoll.rolledRaw = [a, b]; // เก็บทั้งคู่ไว้โชว์ เพื่อความโปร่งใส
        } else {
            pendingRoll.rolled = Array.from({ length: diceCount }, () => rollSides(sides));
        }
    }
    savePendingRoll();

    const rolls = pendingRoll.rolled;
    const rollSum = rolls.reduce((a, b) => a + b, 0);
    const natRoll = (die === "d20" && rolls.length === 1) ? rolls[0] : null; // เช็ค natural 20/1 เฉพาะทอย d20 เดี่ยว
    const total = rollSum + mod;
    const modText = statKey ? ` ${signed(mod)} ${STAT_LABEL[statKey]}+PB` : "";
    const prefix = isRetry ? "ส่งผลทอยเดิมอีกครั้ง — " : "";
    const advNote = advantageMode !== "normal"
        ? ` [${advantageMode === "advantage" ? "Advantage" : "Disadvantage"}: ${pendingRoll.rolledRaw ? pendingRoll.rolledRaw.join(", ") : rolls[0]} → ใช้ ${rolls[0]}]`
        : "";
    const advTextForServer = advantageMode !== "normal" ? ` (${advantageMode})` : "";
    const diceListText = rolls.length > 1 ? ` (${rolls.join("+")})` : "";

    let shownText, rollText;

    if (mode === "attack") {
        const targetAc = Number(pendingRoll.target_ac) || 0;
        const targetName = pendingRoll.opponent_name || "เป้าหมาย";
        const safeTarget = escapeHtml(targetName);
        const isCrit = natRoll === 20;
        const isFumble = natRoll === 1;
        const hit = isCrit || (!isFumble && total >= targetAc);
        const verdict = isCrit ? "โจมตีคริติคอล! 💥" : isFumble ? "พลาดสุดๆ (Fumble)" : hit ? "โจมตีโดน" : "โจมตีพลาด";
        const icon = isCrit ? "🎯💥" : isFumble ? "💢" : hit ? "✅" : "❌";
        shownText = `[Dice Roll]: ${prefix}คุณโจมตี ${die}: ${rolls[0]}${modText} = <b>${total}</b>${advNote} เทียบ AC ${safeTarget} (${targetAc}) → ${icon} ${verdict}`;
        const serverVerdict = isCrit ? "CRITICAL HIT (natural 20 — โจมตีโดนเสมอและเป็นคริติคอล ต้องขอทอยเต๋าความเสียหายต่อทันทีแบบ dice_count=2)"
            : isFumble ? "FUMBLE (natural 1 — พลาดเสมอไม่ว่า AC จะต่ำแค่ไหน)"
            : hit ? "โจมตีโดน" : "โจมตีพลาด";
        rollText = `ฉันทอยโจมตี ${die} ได้ ${rolls[0]}${statKey ? ` บวกโบนัส ${STAT_LABEL[statKey]} ${signed(mod)}` : ""} = ${total}${advTextForServer} เทียบ AC ของ ${targetName} (${targetAc}) → ${serverVerdict} สำหรับ: ${reason}`;
    } else if (mode === "check") {
        const dc = Number(pendingRoll.dc) || 0;
        const diff = total - dc;
        const ok = total >= dc;
        const verdict = ok ? "สำเร็จ" : "ล้มเหลว";
        shownText = `[Dice Roll]: ${prefix}คุณ ${die}: ${rolls[0]}${modText} = <b>${total}</b>${advNote} เทียบ DC ${dc} → ${ok ? "✅" : "❌"} ${verdict}`;
        rollText = `ฉันทอย ${die} ได้ ${rolls[0]}${statKey ? ` บวกโบนัส ${STAT_LABEL[statKey]} ${signed(mod)}` : ""} = ${total}${advTextForServer} เทียบ DC ${dc} → ${verdict} (ส่วนต่าง ${signed(diff)}) สำหรับ: ${reason}`;
    } else {
        // damage / event: ทอยธรรมดา อาจมีหลายลูก (เช่น คริติคอล dice_count=2)
        const label = diceCount > 1 ? `${diceCount}${die}` : die;
        shownText = `[Dice Roll]: ${prefix}คุณทอย ${label} ได้แต้ม <b>${rollSum}</b>${diceListText}${statKey ? `${modText} = <b>${total}</b>` : ""}`;
        rollText = `ฉันทอย ${label} ได้แต้ม ${rollSum}${diceListText}${statKey ? ` บวกโบนัส ${STAT_LABEL[statKey]} ${signed(mod)} = ${total}` : ""} สำหรับ: ${reason}`;
    }

    addMessage("system", shownText);
    // pendingRoll ยังไม่ล้าง จะล้าง/แทนที่ก็ต่อเมื่อ GM ตอบสำเร็จ (ใน callServer)
    callServer(rollText, { isRoll: true });
}

// ปุ่มทอยเต๋าในเกมมีสองบทบาท: ทอยตามที่ GM ขอตามปกติ หรือทอย Death Saving Throw ถ้ากำลังหมดสติอยู่
function rollD20() {
    if (character.dying) { performDeathSave(); return; }
    rollDie();
}

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
// แสดงให้ผู้เล่นรู้ก่อนทอยว่าต้องได้กี่แต้ม (DC หรือ AC ของเป้าหมาย)
function rollRequirement(pr) {
    if (!pr) return "";
    const die = pr.die || "d20";
    const sides = getDieSides(die);
    const statKey = (die === "d20" && STAT_LABEL[pr.stat]) ? pr.stat : null;
    const mod = statKey ? effectiveMod(statKey) : 0;
    const modNote = statKey ? ` [โบนัส ${STAT_LABEL[statKey]}+Proficiency ${signed(mod)} รวมให้แล้ว]` : "";
    const chance = (need) => need <= 1 ? 100 : need > sides ? 0 : Math.round(((sides - need + 1) / sides) * 100);
    const describe = (need, goal) => {
        if (need > sides) return `ต้องได้ ${need} แต่ ${die} สูงสุดแค่ ${sides} → เป็นไปไม่ได้ (เว้นแต่ Natural 20)`;
        if (need <= 1) return `ทอยได้เท่าไหร่ก็${goal}`;
        return `ต้องทอย ${die} ให้ได้ <b>${need}</b> ขึ้นไปจึงจะ${goal} (โอกาส ~${chance(need)}%)`;
    };

    if (pr.mode === "attack") {
        const ac = Number(pr.target_ac) || 0;
        if (ac > 0) return `🎯 AC เป้าหมาย (${escapeHtml(pr.opponent_name || "เป้าหมาย")}): ${ac} → ${describe(ac - mod, "โจมตีโดน")}${modNote} (Natural 20 โดนเสมอ+คริติคอล, Natural 1 พลาดเสมอ)`;
        return "";
    }
    if (pr.mode === "check") {
        const dc = Number(pr.dc) || 0;
        if (dc > 0) return `🎯 DC ${dc} → ${describe(dc - mod, "สำเร็จ")}${modNote}`;
    }
    return "";
}

// ประกาศว่า GM ขอให้ทอย พร้อมบอกแต้มที่ต้องการ
function announceRoll(pr) {
    if (!pr) return;
    if (pr.mode === "enemy_attack") {
        addMessage("system", `[System]: ⚔️ ${escapeHtml(pr.opponent_name || "ศัตรู")} กำลังจะโจมตีคุณ... (ระบบทอยเต๋าให้อัตโนมัติ)`);
        return;
    }
    addMessage("system", `[System]: 🎲 GM ขอให้คุณทอยเต๋าเพื่อ: ${escapeHtml(pr.reason || "ตัดสินผลการกระทำ")}${rollHint(pr)}`);
    const req = rollRequirement(pr);
    if (req) addMessage("system", `[System]: ${req}`);
}

// ---------- Death Saving Throw (HP=0) ----------
// กฎ DnD 5e แบบง่าย: ทอย d20 ไม่บวกโบนัสใดๆ, 1=ล้มเหลว 2 ครั้ง, 2-9=ล้มเหลว 1 ครั้ง, 10-19=สำเร็จ 1 ครั้ง, 20=ฟื้นทันทีด้วย HP 1
// สำเร็จครบ 3 = อาการคงที่ (เกมเดี่ยวไม่มีเพื่อนร่วมทีมมาปลุก จึงให้ฟื้นด้วย HP 1 ไปเลยเพื่อไม่ให้เกมค้าง)
// ล้มเหลวครบ 3 = เสียชีวิต
// ทอยที่ยังไม่ถึงจุดจบ (ไม่ครบ 3 ทั้งสองฝั่ง) ไม่ส่งไปให้ GM เพื่อประหยัด token — แจ้งแค่ในแชทฝั่งเดียว
function performDeathSave() {
    if (!character.dying) return;
    const roll = rollSides(20);
    let resultText = "";
    let outcomeForServer = "";

    if (roll === 20) {
        character.dying = false;
        character.deathSaves = { success: 0, fail: 0 };
        character.hp = 1;
        character.status = "บาดเจ็บสาหัส";
        resultText = `[Death Save]: ทอยได้ <b>20</b> (Natural 20)! 💫 ฟื้นคืนสติทันทีด้วย HP 1`;
        outcomeForServer = `ฉันทอย Death Saving Throw ได้ 20 ดิบ (Natural 20) → ฟื้นคืนสติทันทีด้วย HP 1 กรุณาบรรยายฉากที่ฉันลืมตาตื่นขึ้นมา (ห้ามใส่ hp_change ใดๆ เพิ่ม เพราะระบบจัดการ HP ให้แล้ว)`;
    } else if (roll === 1) {
        character.deathSaves.fail = Math.min(3, character.deathSaves.fail + 2);
        resultText = `[Death Save]: ทอยได้ <b>1</b> (Natural 1) 💀 นับเป็นล้มเหลว 2 ครั้ง!`;
    } else if (roll >= 10) {
        character.deathSaves.success = Math.min(3, character.deathSaves.success + 1);
        resultText = `[Death Save]: ทอยได้ <b>${roll}</b> → ✅ สำเร็จ (${character.deathSaves.success}/3)`;
    } else {
        character.deathSaves.fail = Math.min(3, character.deathSaves.fail + 1);
        resultText = `[Death Save]: ทอยได้ <b>${roll}</b> → ❌ ล้มเหลว (${character.deathSaves.fail}/3)`;
    }

    addMessage("system", resultText);

    if (roll !== 20) {
        if (character.deathSaves.fail >= 3) {
            character.dying = false;
            character.status = "เสียชีวิต";
            addMessage("system", `[System]: 💀 ล้มเหลว Death Save ครบ 3 ครั้ง — ${escapeHtml(character.name)} เสียชีวิตแล้ว กด "เริ่มเกมใหม่" เพื่อผจญภัยรอบใหม่`);
            outcomeForServer = `ฉันทอย Death Saving Throw ล้มเหลวครบ 3 ครั้งแล้ว ตัวละครเสียชีวิต กรุณาบรรยายฉากจบชีวิตแบบสมเหตุสมผลสั้นๆ (ห้ามใส่ hp_change ใดๆ เพิ่ม เพราะระบบจัดการให้แล้ว)`;
        } else if (character.deathSaves.success >= 3) {
            character.dying = false;
            character.deathSaves = { success: 0, fail: 0 };
            character.hp = 1;
            character.status = "บาดเจ็บสาหัส";
            addMessage("system", `[System]: 🩹 อาการคงที่แล้ว (สำเร็จครบ 3 ครั้ง) — ฟื้นคืนสติด้วย HP 1`);
            outcomeForServer = `ฉันทอย Death Saving Throw สำเร็จครบ 3 ครั้ง อาการคงที่และฟื้นคืนสติด้วย HP 1 กรุณาบรรยายฉากที่ฉันฟื้นขึ้นมาแบบอ่อนแรง (ห้ามใส่ hp_change ใดๆ เพิ่ม เพราะระบบจัดการให้แล้ว)`;
        } else {
            // ยังไม่จบ ต้องทอยต่อในเทิร์นถัดไป ไม่ต้องแจ้ง GM ทุกครั้งเพื่อประหยัด token
            saveCharacter();
            renderCharacterSheet();
            return;
        }
    }

    saveCharacter();
    renderCharacterSheet();
    callServer(outcomeForServer, { isDeathSave: true });
}

// ---------- ศัตรูโจมตีผู้เล่น (เต๋าจริง ระบบทอยเองอัตโนมัติ ไม่ต้องกดปุ่ม) ----------
// ทำงานคล้าย performDeathSave(): "ระบบ" เป็นคนตัดสินผลลัพธ์ด้วยเต๋าจริงเทียบ AC ผู้เล่น
// แล้วค่อยแจ้ง GM ให้บรรยายฉากตามผลที่ตายตัวแล้ว (ไม่ใช่ให้ AI เดา hp_change เองแบบเดิม)
function performEnemyAttack() {
    if (!pendingRoll || pendingRoll.mode !== "enemy_attack" || !pendingRoll.required) return;
    if (character.hp <= 0 || character.dying) { pendingRoll = null; savePendingRoll(); restoreControls(); return; }

    const rawName = pendingRoll.opponent_name || "ศัตรู";
    const idx = findEnemyIndex(rawName);
    const enemy = idx !== -1 ? enemies[idx] : null;
    const enemyName = enemy ? enemy.name : rawName;
    const safeName = escapeHtml(enemyName);
    const atk = enemy ? (Number(enemy.atk) || 0) : 2;
    const dmgDie = enemy && enemy.dmgDie ? enemy.dmgDie : "d6";
    const dmgCount = enemy && enemy.dmgCount ? Number(enemy.dmgCount) : 1;

    const ac = characterAC();
    const roll = rollSides(20);
    const isCrit = roll === 20;
    const isFumble = roll === 1;
    const total = roll + atk;
    const hit = isCrit || (!isFumble && total >= ac);

    let dmgTotal = 0;
    const events = [];
    if (hit) {
        const sides = getDieSides(dmgDie);
        const rollCount = isCrit ? dmgCount * 2 : dmgCount;
        dmgTotal = Array.from({ length: rollCount }, () => rollSides(sides)).reduce((a, b) => a + b, 0);
        applyHpDelta(-dmgTotal, events);
    }

    const verdict = isCrit ? "คริติคอล! 💥" : isFumble ? "พลาดสุดๆ (Fumble)" : hit ? "โจมตีโดน" : "โจมตีพลาด";
    const icon = isCrit ? "🎯💥" : isFumble ? "💢" : hit ? "✅" : "❌";
    addMessage("system", `[Enemy Roll]: ${safeName} ทอยโจมตี d20: ${roll}${signed(atk)} = <b>${total}</b> เทียบ AC ของคุณ (${ac}) → ${icon} ${verdict}${hit ? ` (ดาเมจ ${dmgTotal})` : ""}`);
    if (events.length) addMessage("event", events.join(" | "));

    const outcomeForServer = hit
        ? `[ผลการโจมตีของศัตรู] ${enemyName} ทอยโจมตีได้ ${total} (d20 ${roll}${signed(atk)}) เทียบ AC ผู้เล่น (${ac}) → โจมตีโดน${isCrit ? "แบบคริติคอล" : ""} ดาเมจ ${dmgTotal} HP (ระบบหัก HP ผู้เล่นให้แล้ว) กรุณาบรรยายฉากตามผลนี้เท่านั้น ห้ามใส่ hp_change เพิ่ม (ต้องเป็น 0 เสมอ)`
        : `[ผลการโจมตีของศัตรู] ${enemyName} ทอยโจมตีได้ ${total} (d20 ${roll}${signed(atk)}) เทียบ AC ผู้เล่น (${ac}) → โจมตีพลาด กรุณาบรรยายฉากตามผลนี้เท่านั้น ห้ามใส่ hp_change เพิ่ม (ต้องเป็น 0 เสมอ)`;

    announceDyingOrDeath();
    pendingRoll = null;
    savePendingRoll();
    saveCharacter();
    renderCharacterSheet();

    callServer(outcomeForServer, { isEnemyAttack: true, hidePlayerBubble: true });
}

function renderDeathSavePanel() {
    const panel = document.getElementById("death-save-panel");
    if (!panel) return;
    if (!character.dying) { panel.style.display = "none"; panel.innerHTML = ""; return; }
    const pip = (filled, cls) => `<div class="ds-pip ${filled ? cls : ""}"></div>`;
    const successPips = Array.from({ length: 3 }, (_, i) => pip(i < character.deathSaves.success, "filled-success")).join("");
    const failPips = Array.from({ length: 3 }, (_, i) => pip(i < character.deathSaves.fail, "filled-fail")).join("");
    panel.style.display = "block";
    panel.innerHTML = `
        <div class="ds-title">💀 กำลังจะตาย — กดปุ่มทอยเต๋าเพื่อ Death Saving Throw</div>
        <div class="ds-row"><span>สำเร็จ</span><div class="ds-pips">${successPips}</div></div>
        <div class="ds-row"><span>ล้มเหลว</span><div class="ds-pips">${failPips}</div></div>
    `;
}

// ---------- Spell Slot ----------
function renderSpellSlotPanel() {
    let panel = document.getElementById("spell-slot-panel");
    if (!panel) {
        const anchor = document.querySelector(".gold-wrap");
        if (!anchor) return;
        panel = document.createElement("div");
        panel.id = "spell-slot-panel";
        panel.className = "spell-slot-wrap";
        anchor.insertAdjacentElement("afterend", panel);
    }
    if (!character.spellSlots) {
        panel.style.display = "none";
        panel.innerHTML = "";
        return;
    }
    panel.style.display = "block";
    const pips = Array.from({ length: character.spellSlots.max }, (_, i) =>
        `<div class="slot-pip${i < character.spellSlots.current ? " filled" : ""}"></div>`
    ).join("");
    panel.innerHTML = `<div style="color:#d4af37;font-size:0.85em;font-weight:bold;">🔮 Spell Slot ${character.spellSlots.current}/${character.spellSlots.max}</div><div class="spell-slot-pips">${pips}</div>`;
}

// ---------- Conditions ----------
function renderConditionList() {
    let panel = document.getElementById("condition-panel");
    if (!panel) {
        const anchor = document.getElementById("spell-slot-panel") || document.querySelector(".gold-wrap");
        if (!anchor) return;
        panel = document.createElement("div");
        panel.id = "condition-panel";
        panel.className = "condition-list";
        anchor.insertAdjacentElement("afterend", panel);
    }
    if (!character.conditions || !character.conditions.length) {
        panel.innerHTML = "";
        return;
    }
    panel.innerHTML = character.conditions.map(name => {
        const info = CONDITION_LIST[name];
        if (!info) return "";
        return `<span class="condition-badge" title="${escapeHtml(info.effect)}">${escapeHtml(info.label)}</span>`;
    }).join("");
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
            const ac = Math.max(5, Math.min(30, Math.trunc(Number(c.ac)) || 12));
            const atk = Math.max(0, Math.trunc(Number(c.atk)) || 2);
            const dmgCount = Math.max(1, Math.trunc(Number(c.dmg_count)) || 1);
            const dmgDie = c.dmg_die || "d6";
            enemies.push({ name, hp: Math.min(maxHp, 999), maxHp: Math.min(maxHp, 999), ac, atk, dmgCount, dmgDie });
            idx = enemies.length - 1;
            events.push(`👹 พบศัตรู: ${safeName} (HP ${enemies[idx].hp}/${enemies[idx].maxHp}, AC ${ac}, ATK ${signed(atk)}, DMG ${dmgCount}${dmgDie})`);
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

// ---------- Conditions (poisoned/prone/stunned/...) ----------
// ไม่แตะค่าสถานะ (STR/DEX/...) เลย เก็บแค่รายชื่อสถานะที่ติดตัวอยู่ ให้ AI ใช้ประกอบดุลยพินิจ advantage/disadvantage
function applyConditionChanges(changes, events) {
    changes.forEach(c => {
        if (!c || !CONDITION_LIST[c.name]) return;
        const info = CONDITION_LIST[c.name];
        const has = character.conditions.includes(c.name);
        if (c.action === "add" && !has) {
            character.conditions.push(c.name);
            events.push(`⚠️ ติดสถานะ: ${info.label}`);
        } else if (c.action === "remove" && has) {
            character.conditions = character.conditions.filter(x => x !== c.name);
            events.push(`✅ หายจากสถานะ: ${info.label}`);
        }
    });
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
        const anchor = document.getElementById("condition-panel") || document.getElementById("spell-slot-panel") || document.querySelector(".gold-wrap");
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
                `<span style="overflow-wrap:anywhere;">${escapeHtml(e.name)} <span style="opacity:0.7;">(AC ${e.ac ?? "?"} · ATK ${signed(Number(e.atk) || 0)} · DMG ${Number(e.dmgCount) || 1}${e.dmgDie || "d6"})</span></span><span>${e.hp} / ${e.maxHp}</span></div>` +
                `<div style="height:8px;background:#111;border:1px solid #555;border-radius:4px;overflow:hidden;">` +
                `<div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#4a1a6b,#8e44ad);"></div></div></div>`;
        }).join("");
}

function handleEnter(event) {
    if (event.key === "Enter") sendAction();
}

function sendAction() {
    if (character.hp <= 0 || character.dying || (pendingRoll && pendingRoll.required)) return;
    const text = inputField.value.trim();
    if (!text) return;
    failedRequest = null;
    document.querySelectorAll(".retry-btn").forEach(b => b.remove());
    addMessage("player", `> ${text}`);
    inputField.value = "";
    callServer(text);
}

// ปุ่มพักสั้น/พักยาว — ส่งข้อความคงที่ (ให้ GM จับคู่กับกฎการพักที่กำหนดไว้ใน system prompt ได้แน่นอน)
function requestRest(kind) {
    if (character.hp <= 0 || character.dying || (pendingRoll && pendingRoll.required)) return;
    const text = kind === "long"
        ? "ฉันขอพักยาวค้างคืนในที่ปลอดภัย (Long Rest)"
        : "ฉันขอพักสั้นประมาณ 1 ชั่วโมง (Short Rest)";
    failedRequest = null;
    document.querySelectorAll(".retry-btn").forEach(b => b.remove());
    addMessage("player", `> ${text}`);
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

function setRestEnabled(enabled) {
    const shortBtn = document.getElementById("short-rest-btn");
    const longBtn = document.getElementById("long-rest-btn");
    if (shortBtn) shortBtn.disabled = !enabled;
    if (longBtn) longBtn.disabled = !enabled;
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

    // mode="enemy_attack" ไม่ใช่การกระทำของผู้เล่น ระบบทอยเต๋าให้เองทันทีโดยไม่ต้องรอกดปุ่ม
    if (pendingRoll && pendingRoll.mode === "enemy_attack") {
        setTimeout(performEnemyAttack, 900);
    }
}

function handleFailure(playerText, opts, reason) {
    addMessage("system", `[Error]: ${escapeHtml(reason)}`);

    if (opts.isRoll) {
        // pendingRoll (พร้อมแต้มที่ทอยแล้ว) ยังอยู่ → ปุ่มทอยจะส่งแต้มเดิมซ้ำ
        addMessage("system", `[System]: เก็บผลทอย <b>${pendingRoll && Array.isArray(pendingRoll.rolled) ? pendingRoll.rolled.join("+") : "-"}</b> ไว้แล้ว กดปุ่มทอยเต๋าเพื่อส่งอีกครั้ง จะไม่ทอยใหม่`);
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
    if (character.dying) {
        // หมดสติ กำลังทอย Death Saving Throw: ปุ่มทอยเต๋าใช้ได้เสมอ (ไม่ต้องรอ GM ขอ) ส่วนช่องพิมพ์/ปุ่มพักปิดหมด
        setInputEnabled(false);
        setRestEnabled(false);
        const btn = document.querySelector(".dice-btn");
        btn.disabled = false;
        btn.textContent = "☠️ ทอย Death Saving Throw (d20)";
        return;
    }
    if (character.hp <= 0) {
        // ตายแล้วจริงๆ (ผ่าน Death Save จนครบแล้ว) หรือ state เก่าก่อนอัปเดตระบบนี้
        setInputEnabled(false);
        setDiceEnabled(false);
        setRestEnabled(false);
        return;
    }
    if (failedRequest && failedRequest.opts && failedRequest.opts.hidePlayerBubble) {
        setInputEnabled(false);
        setDiceEnabled(false);
        setRestEnabled(false);
        return;
    }
    if (pendingRoll && pendingRoll.required && pendingRoll.mode === "enemy_attack") {
        // ศัตรูกำลังจะโจมตี — ระบบทอยเต๋าให้เองอัตโนมัติ ไม่ใช่หน้าที่ผู้เล่น จึงไม่เปิดปุ่มทอยเต๋า
        setInputEnabled(false);
        setDiceEnabled(false);
        setRestEnabled(false);
    } else if (pendingRoll && pendingRoll.required) {
        setInputEnabled(false);
        setDiceEnabled(true, pendingRoll.reason, pendingRoll.die);
        setRestEnabled(false);
    } else {
        setInputEnabled(true);
        setDiceEnabled(false);
        setRestEnabled(enemies.length === 0); // พักได้เฉพาะตอนไม่มีศัตรูอยู่ในฉาก
    }
}

// เดิมโค้ดนี้ฝังอยู่ใน applyStateChanges() เดี่ยวๆ แยกออกมาเป็นฟังก์ชันกลาง เพื่อให้ performEnemyAttack()
// (ศัตรูโจมตีผู้เล่นด้วยเต๋าจริง) เรียกใช้ตรรกะ HP/Death Save ชุดเดียวกันได้โดยไม่ก็อปโค้ด
function applyHpDelta(delta, events) {
    if (character.dying) {
        // โดนซ้ำตอนหมดสติ (HP=0 อยู่แล้ว): 5e นับเป็นล้มเหลว Death Save อัตโนมัติ 1 ครั้ง แทนที่จะลด HP ต่อ (ไม่มี HP ติดลบ)
        if (delta < 0) {
            character.deathSaves.fail = Math.min(3, character.deathSaves.fail + 1);
            events.push(`💥 โดนโจมตีซ้ำตอนหมดสติ → นับเป็นล้มเหลว Death Save อัตโนมัติ 1 ครั้ง (${character.deathSaves.fail}/3)`);
            if (character.deathSaves.fail >= 3) {
                character.dying = false;
                character.status = "เสียชีวิต";
                events.push(`💀 ล้มเหลว Death Save ครบ 3 ครั้ง — เสียชีวิต`);
            }
        } else {
            // มีการรักษาระหว่างหมดสติ (โพชั่น/เวทรักษาจาก GM) → ฟื้นคืนสติทันที
            character.dying = false;
            character.deathSaves = { success: 0, fail: 0 };
            character.hp = Math.max(1, Math.min(character.maxHp, delta));
            character.status = "บาดเจ็บสาหัส";
            events.push(`💚 ได้รับการรักษาระหว่างหมดสติ ฟื้นคืนสติด้วย HP ${character.hp}`);
        }
    } else {
        const wasAboveZero = character.hp > 0;
        character.hp = Math.max(0, Math.min(character.maxHp, character.hp + delta));
        events.push(delta < 0 ? `💥 ได้รับความเสียหาย ${Math.abs(delta)} HP` : `💚 ฟื้นฟู ${delta} HP`);

        if (wasAboveZero && character.hp <= 0) {
            // เพิ่งร่วงลง 0 HP เป็นครั้งแรก → เข้าสู่โหมด Death Saving Throw ตามกฎ 5e (ระบบตัดสินเอง ไม่ใช่ AI)
            character.dying = true;
            character.deathSaves = { success: 0, fail: 0 };
            events.push(`💀 HP เหลือ 0 — หมดสติและกำลังจะตาย! ต้องทอย Death Saving Throw`);
        }
    }
}

function announceDyingOrDeath() {
    if (character.dying) {
        addMessage("system", `[System]: 🎲 กดปุ่ม "Death Saving Throw" เพื่อทอยเต๋าตัดสินชะตา (สำเร็จ 3 ครั้ง = รอด, ล้มเหลว 3 ครั้ง = เสียชีวิต, Natural 20 = ฟื้นทันที)`);
    } else if (character.hp <= 0) {
        addMessage("system", `[System]: คุณเสียชีวิตแล้ว 💀 กด "เริ่มเกมใหม่" เพื่อผจญภัยรอบใหม่`);
    }
}

// เลเวลอัพ: คำนวณเองทั้งหมดฝั่ง client (ไม่พึ่ง AI สุ่มค่า max_hp_change มั่วๆ อีกต่อไป)
// HP ที่เพิ่มต่อเลเวลใช้สูตรค่าเฉลี่ยของ hit die + โบนัส CON (deterministic ไม่ทอยเต๋า กันผู้เล่นซวย)
function levelUp(events) {
    character.level += 1;
    character.profBonus = profBonusForLevel(character.level);
    const hpGain = Math.max(1, Math.floor(character.hitDie / 2) + 1 + statMod("con"));
    character.maxHp += hpGain;
    character.hp = Math.min(character.maxHp, character.hp + hpGain); // เลเวลอัพฟื้น HP ส่วนที่ได้เพิ่มมาไปด้วย
    let slotNote = "";
    if (character.spellSlots) {
        const newMax = spellSlotMaxForLevel(character.level);
        const diff = newMax - character.spellSlots.max;
        if (diff > 0) {
            character.spellSlots.max = newMax;
            character.spellSlots.current = Math.min(newMax, character.spellSlots.current + diff);
            slotNote = `, Spell Slot สูงสุด +${diff}`;
        }
    }
    events.push(`🌟 เลเวลอัพ! ตอนนี้เลเวล ${character.level} (Proficiency Bonus +${character.profBonus}, HP สูงสุด +${hpGain}${slotNote})`);
}

function applyStateChanges(data) {
    const events = [];

    if (typeof data.max_hp_change === "number" && data.max_hp_change !== 0) {
        character.maxHp = Math.max(1, character.maxHp + data.max_hp_change);
        events.push(`HP สูงสุด${data.max_hp_change > 0 ? "เพิ่มขึ้น" : "ลดลง"} ${Math.abs(data.max_hp_change)}`);
    }

    if (typeof data.hp_change === "number" && data.hp_change !== 0) {
        applyHpDelta(data.hp_change, events);
    }

    if (typeof data.gold_change === "number" && data.gold_change !== 0) {
        character.gold = Math.max(0, character.gold + data.gold_change);
        events.push(data.gold_change > 0 ? `🪙 ได้รับทอง ${data.gold_change}` : `🪙 เสียทอง ${Math.abs(data.gold_change)}`);
    }

    if (typeof data.xp_change === "number" && data.xp_change > 0) {
        character.xp += data.xp_change;
        events.push(`✨ ได้รับ XP ${data.xp_change} (สะสม ${character.xp})`);
        while (character.level < MAX_LEVEL && character.xp >= xpForLevel(character.level + 1)) {
            levelUp(events);
        }
    }

    if (character.spellSlots && typeof data.spell_slot_change === "number" && data.spell_slot_change !== 0) {
        character.spellSlots.current = Math.max(0, Math.min(character.spellSlots.max, character.spellSlots.current + data.spell_slot_change));
        events.push(data.spell_slot_change < 0
            ? `🔮 ใช้ Spell Slot ${Math.abs(data.spell_slot_change)} (เหลือ ${character.spellSlots.current}/${character.spellSlots.max})`
            : `🔮 ได้ Spell Slot คืน ${data.spell_slot_change} (${character.spellSlots.current}/${character.spellSlots.max})`);
    }

    // ฟื้น Spell Slot อัตโนมัติตามชนิดการพักที่ GM ยืนยันว่าสำเร็จ (long=เต็ม, short=ครึ่งหนึ่งปัดขึ้น)
    if (character.spellSlots && (data.rest_type === "long" || data.rest_type === "short")) {
        const before = character.spellSlots.current;
        if (data.rest_type === "long") {
            character.spellSlots.current = character.spellSlots.max;
        } else {
            character.spellSlots.current = Math.min(character.spellSlots.max, character.spellSlots.current + Math.ceil(character.spellSlots.max / 2));
        }
        if (character.spellSlots.current > before) {
            events.push(`🔮 ฟื้น Spell Slot จากการพัก (${before} → ${character.spellSlots.current}/${character.spellSlots.max})`);
        }
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

    if (Array.isArray(data.condition_changes)) {
        applyConditionChanges(data.condition_changes, events);
    }

    if (events.length > 0) {
        addMessage("event", events.join(" | "));
    }

    const report = statusReport();
    if (report) addMessage("event", report);

    announceDyingOrDeath();

    saveCharacter();
    renderCharacterSheet();
}
