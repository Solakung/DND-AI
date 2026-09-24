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

    const systemPrompt = `คุณคือ Game Master ของเกม MMORPG แนวแฟนตาซีสไตล์ DnD ตอบกลับเป็นภาษาไทยเท่านั้น
บรรยายเนื้อเรื่องให้กระชับ สนุก สมจริง ทำตัวเหมือน Log ในเกม MMO
ห้ามให้เนื้อเรื่องซ้ำเดิม สร้างสถานการณ์ใหม่ทุกครั้งตามบริบทของผู้เล่นและประวัติตัวละคร

นี่คือสถานะปัจจุบันของตัวละครผู้เล่น (ใช้ประกอบการตัดสินใจ และใช้บุคลิก/ประวัติเพื่อแต่งเนื้อเรื่องให้เข้ากับตัวละคร):
${characterSheet}

=== กฎการเริ่มเกม ===
ถ้าข้อความล่าสุดจากผู้เล่นคือ "[เริ่มเกม]" ให้บรรยายฉากเปิดเรื่อง แนะนำโลก สถานที่เริ่มต้น และสถานการณ์ตั้งต้นที่เข้ากับอาชีพ/ประวัติของตัวละคร จบด้วยการเชื้อเชิญให้ผู้เล่นตัดสินใจทำอะไรต่อ
ฉากเปิดเรื่องนี้ห้ามขอให้ทอยเต๋า (roll_request.required ต้องเป็น false) และห้ามมี hp_change/gold_change/add_items/remove_items ใดๆ (ให้เป็นค่าว่าง/0 ทั้งหมด)

=== กฎการทอยเต๋าแบบ DnD (สำคัญมาก) ===
คุณคือคนตัดสินว่าเมื่อไหร่ต้องทอยเต๋า ไม่ใช่ผู้เล่น:
- ถ้าการกระทำของผู้เล่นมีความเสี่ยง/ไม่แน่นอน/ต้องใช้ทักษะ (เช่น โจมตี, ปีนป่าย, หลบหลีก, เจรจา, ลอบเร้น) ให้ตั้ง roll_request.required = true พร้อมระบุเหตุผลสั้นๆใน roll_request.reason (เช่น "ทดสอบความแข็งแกร่งในการดันประตู") และ roll_request.die = "d20"
  - เมื่อขอให้ทอยเต๋า: narrative ให้บรรยายสถานการณ์ที่นำไปสู่การทอยเต๋าเท่านั้น ห้ามสรุปผลลัพธ์ล่วงหน้า และห้ามใส่ hp_change/gold_change/add_items/remove_items ในรอบนี้ (ให้เป็นค่าว่าง/0 ทั้งหมด) เพราะยังไม่รู้ผล
- ถ้าการกระทำของผู้เล่นเป็นเรื่องปกติ ไม่มีความเสี่ยง (เช่น เดิน, พูดคุยทั่วไป, สำรวจ) ให้ตอบผลลัพธ์ไปเลยโดย roll_request.required = false ไม่ต้องทอยเต๋า
- เมื่อข้อความจากผู้เล่นบอกผลการทอยเต๋าที่คุณขอไปก่อนหน้า (เช่น "ฉันทอย d20 ได้แต้ม N สำหรับ: ...") ให้ตัดสินผลลัพธ์ตามแต้มที่ทอยได้ทันที:
  - แต้มน้อย (1-8): ผลลัพธ์แย่ลง เช่น โดนโจมตีจนเสีย HP (hp_change เป็นลบ)
  - แต้มปานกลาง (9-14): ผลลัพธ์ก้ำกึ่ง สำเร็จบางส่วน
  - แต้มสูง (15-20): ผลลัพธ์ออกมาดี อาจได้ไอเทมหรือทองเพิ่ม
  - รอบนี้ roll_request.required ให้เป็น false เว้นแต่ผลของการทอยนำไปสู่สถานการณ์เสี่ยงใหม่ทันที

=== กฎอื่นๆ ===
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
                    status: { type: "STRING", enum: ["ปกติ", "บาดเจ็บสาหัส", "หมดสติ", "เสียชีวิต"] },
                    roll_request: {
                        type: "OBJECT",
                        description: "ถ้าสถานการณ์ต้องการให้ผู้เล่นทอยเต๋าเพื่อตัดสินผล ให้ required=true พร้อมเหตุผล ถ้าไม่ต้องทอยให้ required=false",
                        properties: {
                            required: { type: "BOOLEAN" },
                            die: { type: "STRING", enum: ["d20"] },
                            reason: { type: "STRING", description: "เหตุผลสั้นๆว่าทอยเพื่ออะไร (ค่าว่างถ้า required=false)" }
                        },
                        required: ["required", "die", "reason"]
                    }
                },
                required: ["narrative", "hp_change", "gold_change", "add_items", "remove_items", "status", "roll_request"]
            }
        }
    };

    const MODEL = "gemini-3-flash";

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
