let conversationHistory = [];
const chatLog = document.getElementById("chat-log");
const inputField = document.getElementById("action-input");

window.onload = () => {
    addMessage("system", "[System]: โลกพร้อมแล้ว พิมพ์การกระทำแรกของคุณเพื่อเริ่มเกม...");
    simulateMMO(); 
};

function addMessage(type, text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${type}`;
    msgDiv.innerHTML = text.replace(/\n/g, '<br>');
    chatLog.appendChild(msgDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function rollD20() {
    let roll = Math.floor(Math.random() * 20) + 1;
    addMessage("system", `[Dice Roll]: คุณทอย D20 ได้แต้ม <b>${roll}</b>!`);
    callServer(`ฉันทอยลูกเต๋า D20 ได้แต้ม ${roll} ใช้ผลลัพธ์นี้ตัดสินการกระทำล่าสุดของฉัน`);
}

function handleEnter(event) {
    if (event.key === "Enter") sendAction();
}

function sendAction() {
    const text = inputField.value.trim();
    if (!text) return;

    addMessage("player", `> ${text}`);
    inputField.value = "";
    callServer(text);
}

// ยิงข้อมูลไปที่ไฟล์ Backend (Vercel Serverless) ของเราเอง
async function callServer(playerText) {
    addMessage("system", "[System]: GM กำลังประมวลผล...");

    conversationHistory.push({ role: "user", parts: [{ text: playerText }] });

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: conversationHistory })
        });

        chatLog.removeChild(chatLog.lastChild); // ลบข้อความกำลังประมวลผลออก

        if (response.status === 429) {
            addMessage("system", "[System]: เซิร์ฟเวอร์ทำงานหนักเกินไป (Rate Limit) กรุณารอสักครู่แล้วลองใหม่");
            return;
        }

        const data = await response.json();
        
        if (data.reply) {
            addMessage("gm", data.reply);
            conversationHistory.push({ role: "model", parts: [{ text: data.reply }] });
        } else {
            addMessage("system", "[Error]: เซิร์ฟเวอร์ไม่ตอบสนอง หรือตอบกลับผิดพลาด");
        }
    } catch (error) {
        addMessage("system", `[Error]: การเชื่อมต่อล้มเหลว - ${error.message}`);
    }
}

function simulateMMO() {
    const fakeEvents = [
        "[World] xX_Slayer_Xx: รับคนลงดันเจี้ยนก็อบลิน ขาดฮีล 1 ที่!!",
        "[System] ผู้เล่น 'MageGurl' ได้รับดาบหายากระดับ Epic",
        "[Local] พ่อค้าเร่: ยาฟื้นฟูราคาถูกจ้า แวะดูได้!",
        "[World] DarkLord: ใครเจอพิกัดบอสโลกบ้าง?"
    ];

    setInterval(() => {
        if (Math.random() > 0.5) {
            let randomEvent = fakeEvents[Math.floor(Math.random() * fakeEvents.length)];
            addMessage("mmo-bot", randomEvent);
        }
    }, 20000); 
}