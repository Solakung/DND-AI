export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'System Error: ไม่พบ API Key ในระบบหลังบ้าน (ตรวจสอบ Environment Variables บน Vercel)' });
    }

    const { history, character } = req.body || {};

    if (!Array.isArray(history) || history.length === 0) {
        return res.status(400).json({ error: 'ไม่พบข้อมูล history ที่ส่งมา' });
    }
    if (!character || typeof character !== 'object') {
        return res.status(400).json({ error: 'ไม่พบข้อมูลตัวละคร (character)' });
    }

    const characterSheet = buildCharacterSheetText(character);

    const systemPrompt = `คุณคือ Game Master ของเกม MMORPG แนวแฟนตาซี ตอบกลับเป็นภาษาไทยเท่านั้น
บรรยายเนื้อเรื่องให้กระชับ สนุก สมจริง โต้ตอบกับการกระทำหรือผลการทอยเต๋าของผู้เล่น ทำตัวเหมือน Log ในเกม MMO
ห้ามให้เนื้อเรื่องซ้ำเดิม สร้างสถานการณ์ใหม่ทุกครั้งตามบริบทของผู้เล่นและประวัติตัวละคร

นี่คือสถานะปัจจุบันของตัวละครผู้เล่น (ใช้ประกอบการตัดสินใจ และใช้บุคลิก/ประวัติเพื่อแต่งเนื้อเรื่องให้เข้ากับตัวละคร):
${characterSheet}

กฎการตัดสินผล:
- ถ้าผู้เล่นทอยเต๋าได้น้อย (1-8) หรือทำการกระทำเสี่ยงแล้วพลาด ให้ผลลัพธ์แย่ลง เช่น โดนโจมตีจนเสีย HP (ใส่ค่าลบใน hp_change)
- ถ้าทอยได้สูง (15-20) หรือวางแผนดี ให้ผลลัพธ์ออกมาดี อาจได้ไอเทมหรือทองเพิ่ม
- ปรับ hp_change ให้สมเหตุสมผลกับสถานการณ์ (ทั่วไปไม่เกิน -8 ต่อครั้ง เว้นแต่สถานการณ์อันตรายมาก)
- ถ้า HP ของผู้เล่นจะลดลงเหลือ 0 หรือต่ำกว่า ให้ตั้ง status เป็น "หมดสติ" หรือ "เสียชีวิต" ตามความเหมาะสมของเนื้อเรื่อง (ส่วนใหญ่ให้ "หมดสติ" ไม่ต้องเสียชีวิตง่ายๆ)
- เพิ่ม/ลดไอเทมเฉพาะเมื่อเนื้อเรื่องสมเหตุสมผลจริงๆ เช่น เก็บของจากศัตรู ซื้อของ ใช้ไอเทมหมด
- ห้ามใส่ข้อความ JSON หรือ markdown ลงใน narrative ให้เป็นข้อความเล่าเรื่องล้วนๆ`;

    const payload = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: history,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    narrative: { type: "STRING", description: "เนื้อเรื่องที่ GM เล่าให้ผู้เล่นฟัง เป็นภาษาไทย" },
                    hp_change: { type: "INTEGER", description: "การเปลี่ยนแปลง HP ปัจจุบัน (ลบ=เสีย HP, บวก=ฟื้นฟู, 0=ไม่เปลี่ยน)" },
                    max_hp_change: { type: "INTEGER", description: "การเปลี่ยนแปลง HP สูงสุด ปกติเป็น 0 ยกเว้นเลเวลอัพ" },
                    gold_change: { type: "INTEGER", description: "การเปลี่ยนแปลงทอง (ลบ=เสียทอง, บวก=ได้ทอง)" },
                    add_items: { type: "ARRAY", items: { type: "STRING" }, description: "รายการไอเทมที่ได้รับใหม่ (ถ้าไม่มีให้เป็น array ว่าง)" },
                    remove_items: { type: "ARRAY", items: { type: "STRING" }, description: "รายการไอเทมที่ถูกใช้/เสียไป (ถ้าไม่มีให้เป็น array ว่าง)" },
                    status: { type: "STRING", enum: ["ปกติ", "บาดเจ็บสาหัส", "หมดสติ", "เสียชีวิต"] }
                },
                required: ["narrative", "hp_change", "gold_change", "add_items", "remove_items", "status"]
            }
        }
    };

    const MODEL = "gemini-2.5-flash";

    try {
        const googleResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        );

        const data = await googleResponse.json();

        if (!googleResponse.ok || data.error) {
            const realError = data.error?.message || JSON.stringify(data);
            console.error("Gemini API error:", realError);
            return res.status(500).json({ error: `Google Reject: ${realError}` });
        }

        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) {
            console.error("Unexpected Gemini response:", JSON.stringify(data));
            return res.status(500).json({ error: `Safety Filter บล็อกข้อความ หรือรูปแบบคำตอบผิดปกติ: ${JSON.stringify(data)}` });
        }

        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch (e) {
            console.error("JSON parse failed:", rawText);
            return res.status(500).json({ error: 'AI ตอบกลับมาไม่เป็น JSON ที่ถูกต้อง ลองใหม่อีกครั้ง' });
        }

        if (!parsed.narrative) {
            return res.status(500).json({ error: 'AI ไม่ได้ส่งเนื้อเรื่องกลับมา (narrative ว่าง)' });
        }

        return res.status(200).json(parsed);
    } catch (error) {
        console.error("System crash:", error);
        return res.status(500).json({ error: `System Crash: ${error.message}` });
    }
}

function buildCharacterSheetText(c) {
    const lines = [
        `ชื่อ: ${c.name || "-"}`,
        `อาชีพ: ${c.className || "-"}${c.classDesc ? ` (${c.classDesc})` : ""}`,
        `ประวัติ/บุคลิก: ${c.backstory ? c.backstory : "ไม่มีข้อมูลเพิ่มเติม"}`,
        `สถานะ: STR ${c.stats?.str}, DEX ${c.stats?.dex}, INT ${c.stats?.int}, CON ${c.stats?.con}`,
        `HP: ${c.hp}/${c.maxHp}`,
        `ทอง: ${c.gold}`,
        `กระเป๋า: ${(c.inventory && c.inventory.length) ? c.inventory.join(", ") : "ไม่มีไอเทม"}`
    ];
    return lines.join("\n");
}
