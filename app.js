// ========================= ค่าคงที่ =========================
const CHAR_KEY = "solo_mmo_character_v2";
const HISTORY_KEY = "solo_mmo_history_v2";
const POINT_BUY_POOL = 20;
const STAT_MIN = 8;
const STAT_MAX = 18;

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
        if (conversationHistory.length === 0) {
            addMessage("system", "[System]: โลกพร้อมแล้ว พิมพ์การกระทำแรกของคุณเพื่อเริ่มเกม...");
        } else {
            addMessage("system", "[System]: กำลังโหลดเนื้อเรื่องเดิมต่อ...");
            conversationHistory.forEach(entry => {
                const text = entry.parts?.[0]?.text || "";
                if (entry.role === "user") addMessage("player", `> ${text}`);
                else addMessage("gm", safeNarrative(text));
            });
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
    saveCharacter();
    saveHistory();
    chatLog.innerHTML = "";
    showScreen("game");
    renderCharacterSheet();
    addMessage("system", `[System]: ยินดีต้อนรับ ${character.name} นักผจญภัย${character.className} สู่โลกกว้าง พิมพ์การกระทำแรกของคุณเพื่อเริ่มเกม...`);
    simulateMMO();
}

function resetGame() {
    if (!confirm("ต้องการเริ่มเกมใหม่และล้างตัวละคร/เนื้อเรื่องเดิมหรือไม่?")) return;
    localStorage.removeItem(CHAR_KEY);
    localStorage.removeItem(HISTORY_KEY);
    character = null;
    conversationHistory = [];
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
    if (character.hp <= 0) return;
    let roll = Math.floor(Math.random() * 20) + 1;
    addMessage("system", `[Dice Roll]: คุณทอย D20 ได้แต้ม <b>${roll}</b>!`);
    callServer(`ฉันทอยลูกเต๋า D20 ได้แต้ม ${roll} ใช้ผลลัพธ์นี้ตัดสินการกระทำล่าสุดของฉัน`);
}

function handleEnter(event) {
    if (event.key === "Enter") sendAction();
}

function sendAction() {
    if (character.hp <= 0) return;
    const text = inputField.value.trim();
    if (!text) return;
    addMessage("player", `> ${text}`);
    inputField.value = "";
    callServer(text);
}

function setInputEnabled(enabled) {
    inputField.disabled = !enabled;
    document.querySelector(".dice-btn").disabled = !enabled;
}

async function callServer(playerText) {
    setInputEnabled(false);
    const loadingMsg = addMessage("system", "[System]: GM กำลังประมวลผล...");

    conversationHistory.push({ role: "user", parts: [{ text: playerText }] });

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: conversationHistory, character })
        });

        loadingMsg.remove();

        if (response.status === 429) {
            addMessage("system", "[System]: เซิร์ฟเวอร์ทำงานหนักเกินไป (Rate Limit) กรุณารอสักครู่แล้วลองใหม่");
            conversationHistory.pop();
            setInputEnabled(true);
            return;
        }

        const data = await response.json();

        if (!data.narrative) {
            addMessage("system", `[Error]: เซิร์ฟเวอร์ตอบกลับผิดพลาด - ${data.error || "ไม่ทราบสาเหตุ"}`);
            conversationHistory.pop();
            setInputEnabled(true);
            return;
        }

        addMessage("gm", data.narrative);
        conversationHistory.push({ role: "model", parts: [{ text: data.narrative }] });
        saveHistory();

        applyStateChanges(data);
        setInputEnabled(character.hp > 0);
    } catch (error) {
        loadingMsg.remove();
        addMessage("system", `[Error]: การเชื่อมต่อล้มเหลว - ${error.message}`);
        conversationHistory.pop();
        setInputEnabled(true);
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
