// ============ ตั้งค่า fallback ============
// ลำดับรุ่น: ลองตัวแรกก่อน ถ้าไม่ได้ค่อยไปตัวถัดไป
// เปลี่ยนได้ผ่าน Environment Variable GEMINI_MODELS (คั่นด้วยเครื่องหมายจุลภาค) โดยไม่ต้องแก้โค้ด
const MODELS = (process.env.GEMINI_MODELS || "gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite")
    .split(",").map(s => s.trim()).filter(Boolean);

const TRIES_PER_MODEL = Number(process.env.TRIES_PER_MODEL) || 2;          // ลองซ้ำรุ่นเดิมกี่ครั้งเมื่อเป็นปัญหาชั่วคราว
const PER_TRY_TIMEOUT_MS = Number(process.env.PER_TRY_TIMEOUT_MS) || 20000; // เวลารอสูงสุดต่อ 1 ครั้ง
const TIME_BUDGET_MS = Number(process.env.TIME_BUDGET_MS) || 45000;         // เวลารวมสูงสุดก่อนยอมแพ้ (ต้องน้อยกว่า maxDuration ของ Vercel)
const DEBUG_META = process.env.DEBUG_META === "1";                          // ถ้า "1" จะแนบ _model / _attempts กลับไปใน response

const VALID_STATUS = ["ปกติ", "บาดเจ็บสาหัส", "หมดสติ", "เสียชีวิต"];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
                    status: { type: "STRING", enum: VALID_STATUS },
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

    // ============ วนลองทีละรุ่น ============
    const attempts = [];          // บันทึกทุกครั้งที่ลอง ไว้ตรวจสอบย้อนหลัง
    const startedAt = Date.now();
    let fatalMessage = null;

    outer:
    for (const model of MODELS) {
        for (let attempt = 1; attempt <= TRIES_PER_MODEL; attempt++) {
            if (Date.now() - startedAt > TIME_BUDGET_MS) {
                attempts.push({ model, attempt, result: "หมดเวลารวม (TIME_BUDGET)", ms: 0 });
                break outer;
            }

            const t0 = Date.now();
            const outcome = await tryModel(model, payload, apiKey);
            const ms = Date.now() - t0;
            attempts.push({ model, attempt, status: outcome.status, result: outcome.ok ? "ok" : outcome.reason, ms });

            if (outcome.ok) {
                console.log(`[chat] สำเร็จด้วย ${model} (ครั้งที่ ${attempt}, ${ms}ms) | ลำดับที่ลอง: ${summarize(attempts)}`);
                const result = outcome.parsed;
                if (DEBUG_META) {
                    result._model = model;
                    result._attempts = attempts;
                }
                return res.status(200).json(result);
            }

            console.warn(`[chat] ล้มเหลว ${model} ครั้งที่ ${attempt}: ${outcome.reason} (${ms}ms)`);

            if (outcome.fatal) {          // เช่น API key ผิด ลองรุ่นอื่นก็ไม่ช่วย
                fatalMessage = outcome.reason;
                break outer;
            }
            if (!outcome.retrySame) break; // ข้ามไปรุ่นถัดไปทันที
            await sleep(600 * attempt);    // รอสักครู่แล้วลองรุ่นเดิมอีกรอบ
        }
    }

    const summary = summarize(attempts);
    console.error(`[chat] ทุกรุ่นล้มเหลว | ${summary}`);
    return res.status(503).json({
        error: fatalMessage
            ? `Gemini ปฏิเสธคำขอ: ${fatalMessage}`
            : `ทุกโมเดลไม่ตอบสนองในตอนนี้ ลองใหม่อีกครั้งในไม่กี่วินาที (รายละเอียด: ${summary})`
    });
}

// เรียก 1 รุ่น 1 ครั้ง แล้วจัดประเภทผลลัพธ์ให้ลูปข้างบนตัดสินใจ
async function tryModel(model, payload, apiKey) {
    let response;
    try {
        response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, // ส่ง key ทาง header ไม่ให้หลุดลง log ผ่าน URL
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(PER_TRY_TIMEOUT_MS)
            }
        );
    } catch (e) {
        const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
        return { ok: false, retrySame: true, reason: timedOut ? "timeout" : `network: ${e.message}` };
    }

    let data;
    try {
        data = await response.json();
    } catch {
        return { ok: false, status: response.status, retrySame: response.status >= 500, reason: `HTTP ${response.status} (อ่าน body ไม่ได้)` };
    }

    if (!response.ok || data.error) {
        const status = response.status;
        const msg = data.error?.message || JSON.stringify(data).slice(0, 200);
        if (status === 401 || status === 403) {
            return { ok: false, status, fatal: true, reason: `HTTP ${status}: ${msg}` };
        }
        // 500/503/504 = ฝั่ง Google โอเวอร์โหลดชั่วคราว → ลองรุ่นเดิมซ้ำ
        // 429 (โควตา) / 404 (รุ่นถูกถอด) / 400 อื่นๆ → ข้ามไปรุ่นถัดไป
        const retrySame = status === 500 || status === 503 || status === 504;
        return { ok: false, status, retrySame, reason: `HTTP ${status}: ${msg}` };
    }

    // รวมเฉพาะส่วนที่เป็นคำตอบจริง (ตัดส่วน thought ของโมเดลที่คิดก่อนตอบ)
    const parts = data.candidates?.[0]?.content?.parts || [];
    const rawText = parts.filter(p => p.text && !p.thought).map(p => p.text).join("");

    if (!rawText) {
        const block = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || "ไม่ทราบสาเหตุ";
        return { ok: false, status: 200, retrySame: false, reason: `คำตอบว่าง/ถูกบล็อก (${block})` };
    }

    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        return { ok: false, status: 200, retrySame: true, reason: "JSON ไม่ถูกต้อง" };
    }

    if (!parsed || typeof parsed.narrative !== "string" || !parsed.narrative.trim()) {
        return { ok: false, status: 200, retrySame: true, reason: "ไม่มี narrative" };
    }

    return { ok: true, status: 200, parsed: normalize(parsed) };
}

// กันค่าเพี้ยนจากรุ่นเล็ก เช่น hp_change เป็นข้อความ, items ไม่ใช่ array
function normalize(p) {
    const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
    const arr = (v) => (Array.isArray(v) ? v.filter(x => typeof x === "string" && x.trim()) : []);
    const rr = p.roll_request && typeof p.roll_request === "object" ? p.roll_request : {};
    const needRoll = rr.required === true;
    return {
        narrative: p.narrative.trim(),
        hp_change: int(p.hp_change),
        max_hp_change: int(p.max_hp_change),
        gold_change: int(p.gold_change),
        add_items: arr(p.add_items),
        remove_items: arr(p.remove_items),
        status: VALID_STATUS.includes(p.status) ? p.status : "ปกติ",
        roll_request: {
            required: needRoll,
            die: "d20",
            reason: needRoll ? String(rr.reason || "") : ""
        }
    };
}

function summarize(attempts) {
    return attempts.map(a => `${a.model}#${a.attempt}:${a.result}`).join(" → ");
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
