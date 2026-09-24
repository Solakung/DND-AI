// ========================= ค่าคงที่ =========================
const CHAR_KEY = "solo_mmo_character_v2";
const HISTORY_KEY = "solo_mmo_history_v2";
const POINT_BUY_POOL = 20;
const STAT_MIN = 8;
const STAT_MAX = 18;
const KICKOFF_TEXT = "[เริ่มเกม]";
const PENDING_ROLL_KEY = "solo_mmo_pending_roll_v1";

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
let failedRequest = null; // { text, opts } - คำขอปกติ/ฉากเปิดเรื่องที่ส่งไม่สำเร็จ ไว้ให้กดลองใหม่

const chatLog = document.getElementById("chat-log");
const inputField = document.getElementById("action-input");

// ========================= Init =========================
window.onload = () => {
    renderClassGrid();
    character = loadCharacter();
    if (character) {
        conversationHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
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
                addMessage("system", `[System]: 🎲 GM ขอให้คุณทอยเต๋าเพื่อ: ${pendingRoll.reason || "ตัดสินผลการกระทำ"}`);
                if (Number.isInteger(pendingRoll.rolled)) {
                    addMessage("system", `[System]: คุณทอยได้ <b>${pendingRoll.rolled}</b> ไปแล้วแต่ยังส่งไม่สำเร็จ กดปุ่มทอยเต๋าเพื่อส่งผลเดิมอีกครั้ง`);
                }
            }
            restoreControls();
        }
        simulateMMO();
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
    saveCharacter();
    saveHistory();
    chatLog.innerHTML = "";
    showScreen("game");
    renderCharacterSheet();
    setInputEnabled(false);
    setDiceEnabled(false);
    addMessage("system", `[System]: กำลังนำ ${character.name} เข้าสู่โลกกว้าง...`);
    startAdventure();
    simulateMMO();
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
    character = null;
    conversationHistory = [];
    pendingRoll = null;
    failedRequest = null;
    chatLog.innerHTML = "";
    showScreen("select");
}

// ========================= Render ชีทตัวละคร =========================
function renderCharacterSheet() {
    document.getElementById("char-name").textContent = character.name;
    document.getElementById("char-class").textContent = character.className;

    document.getElementById("stat-str").textContent = character.stats.str;
    document.getElementById("stat-dex").textContent = character.stats.dex;
    document.getElementById("stat-int").textContent = character.stats.int;
    document.getElementById("stat-con").textContent = character.stats.con;

    document.getElementById("hp-text").textContent = `${character.hp} / ${character.maxHp}`;
    const pct = Math.max(0, Math.min(100, (character.hp / character.maxHp) * 100));
    document.getElementById("hp-bar-fill").style.width = `${pct}%`;

    document.getElementById("gold-text").textContent = character.gold;

    const invEl = document.getElementById("inventory-list");
    invEl.innerHTML = character.inventory.length
        ? character.inventory.map(item => `<div class="item">${item}</div>`).join("")
        : `<div class="item" style="opacity:0.5;">(ไม่มีไอเทม)</div>`;
}

function saveCharacter() { localStorage.setItem(CHAR_KEY, JSON.stringify(character)); }
function loadCharacter() { const raw = localStorage.getItem(CHAR_KEY); return raw ? JSON.parse(raw) : null; }
function saveHistory() { localStorage.setItem(HISTORY_KEY, JSON.stringify(conversationHistory)); }
function savePendingRoll() {
    if (pendingRoll) localStorage.setItem(PENDING_ROLL_KEY, JSON.stringify(pendingRoll));
    else localStorage.removeItem(PENDING_ROLL_KEY);
}
function loadPendingRoll() { const raw = localStorage.getItem(PENDING_ROLL_KEY); return raw ? JSON.parse(raw) : null; }

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

function rollD20() {
    if (character.hp <= 0 || !pendingRoll || !pendingRoll.required) return;
    const die = pendingRoll.die || "d20";
    let roll;

    if (Number.isInteger(pendingRoll.rolled)) {
        // เคยทอยไปแล้วแต่ส่งให้ GM ไม่สำเร็จ → ส่งแต้มเดิม ห้ามทอยใหม่
        roll = pendingRoll.rolled;
        addMessage("system", `[Dice Roll]: ส่งผลทอยเดิมอีกครั้ง ${die} แต้ม <b>${roll}</b>`);
    } else {
        roll = Math.floor(Math.random() * 20) + 1;
        pendingRoll.rolled = roll;
        savePendingRoll(); // เก็บแต้มไว้ก่อนส่ง เผื่อเซิร์ฟเวอร์ล่มหรือผู้เล่นรีเฟรชหน้า
        addMessage("system", `[Dice Roll]: คุณทอย ${die} ได้แต้ม <b>${roll}</b>!`);
    }

    const reason = pendingRoll.reason || "การกระทำล่าสุด";
    const rollText = `ฉันทอย ${die} ได้แต้ม ${roll} สำหรับ: ${reason}`;
    // pendingRoll ยังไม่ล้าง จะล้าง/แทนที่ก็ต่อเมื่อ GM ตอบสำเร็จ (ใน callServer)
    callServer(rollText, { isRoll: true });
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

function setDiceEnabled(enabled, label) {
    const btn = document.querySelector(".dice-btn");
    btn.disabled = !enabled;
    btn.textContent = enabled ? `🎲 ทอยเต๋า D20${label ? ` — ${label}` : ""}` : "🎲 รอ GM เรียกให้ทอยเต๋า...";
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
            body: JSON.stringify({ history: conversationHistory, character })
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

    applyStateChanges(data);

    // ตั้งค่า pendingRoll ตามที่ AI ขอมา (ของเก่าที่ทอยแล้วถูกแทนที่/ล้างตรงนี้)
    if (data.roll_request && data.roll_request.required) {
        pendingRoll = data.roll_request;
        addMessage("system", `[System]: 🎲 GM ขอให้คุณทอยเต๋าเพื่อ: ${pendingRoll.reason || "ตัดสินผลการกระทำ"}`);
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
        setDiceEnabled(true, pendingRoll.reason);
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
        data.remove_items.forEach(item => {
            const idx = character.inventory.findIndex(i => i.includes(item) || item.includes(i));
            if (idx !== -1) {
                events.push(`➖ ${character.inventory[idx]}`);
                character.inventory.splice(idx, 1);
            }
        });
    }

    if (Array.isArray(data.add_items)) {
        data.add_items.forEach(item => {
            character.inventory.push(item);
            events.push(`➕ ได้รับไอเทม: ${item}`);
        });
    }

    if (events.length > 0) {
        addMessage("event", events.join(" | "));
    }

    if (character.hp <= 0) {
        const statusText = data.status === "เสียชีวิต" ? "คุณเสียชีวิตแล้ว 💀" : "คุณหมดสติ...";
        addMessage("system", `[System]: ${statusText} กด "เริ่มเกมใหม่" เพื่อผจญภัยรอบใหม่`);
    }

    saveCharacter();
    renderCharacterSheet();
}

function simulateMMO() {
    const fakeEvents = [
        "[World] xX_Slayer_Xx: รับคนลงดันเจี้ยนก็อบลิน ขาดฮีล 1 ที่!!",
        "[System] ผู้เล่น 'MageGurl' ได้รับดาบหายากระดับ Epic",
        "[Local] พ่อค้าเร่: ยาฟื้นฟูราคาถูกจ้า แวะดูได้!",
        "[World] DarkLord: ใครเจอพิกัดบอสโลกบ้าง?"
    ];

    setInterval(() => {
        if (character && character.hp > 0 && Math.random() > 0.5) {
            let randomEvent = fakeEvents[Math.floor(Math.random() * fakeEvents.length)];
            addMessage("mmo-bot", randomEvent);
        }
    }, 20000);
}
