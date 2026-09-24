// ============ ตั้งค่า fallback ============
// ลำดับรุ่น/retry/timeout ย้ายไปอยู่ใน _lib/gemini.js เพื่อให้ summarize.js เรียกใช้ logic เดียวกันได้
import { runWithFallback, DEBUG_META, summarizeAttempts } from './_lib/gemini.js';

const VALID_STATUS = ["ปกติ", "บาดเจ็บสาหัส", "หมดสติ", "เสียชีวิต"];
const VALID_DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];
const VALID_STATS = ["str", "dex", "int", "con", "none"];
const ITEM_SCHEMA = {
    type: "OBJECT",
    properties: {
        name: { type: "STRING", description: "ชื่อไอเทมให้ตรงกับที่อยู่ในกระเป๋า ไม่ต้องใส่จำนวน (xN)" },
        quantity: { type: "INTEGER", description: "จำนวนที่เพิ่ม/ใช้จริงในครั้งนี้ อย่างน้อย 1" }
    },
    required: ["name", "quantity"]
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'System Error: ไม่พบ API Key ในระบบหลังบ้าน (ตรวจสอบ Environment Variables บน Vercel)' });
    }

    const { history, character, enemies, summary } = req.body || {};

    if (!Array.isArray(history) || history.length === 0) {
        return res.status(400).json({ error: 'ไม่พบข้อมูล history ที่ส่งมา' });
    }
    if (!character || typeof character !== 'object') {
        return res.status(400).json({ error: 'ไม่พบข้อมูลตัวละคร (character)' });
    }

    // ความจำระยะยาว: สรุปย่อเหตุการณ์เก่าที่ฝั่ง client ทำไว้ล่วงหน้าผ่าน /api/summarize
    // (เก็บแยกจาก history ที่ถูก trim ด้านล่าง เพื่อให้ยังอ้างอิงเหตุการณ์เก่าได้แม้คุยมานานมากแล้ว)
    const longTermSummary = typeof summary === "string" ? summary.trim().slice(0, 4000) : "";

    // ============ จำกัดความยาว history ที่ส่งไปให้โมเดล ============
    // ไม่ตัดของฝั่ง client (ยังเก็บเต็มไว้โหลดต่อได้) แต่ตัดเฉพาะก้อนที่ยิงเข้า Gemini
    // เพื่อไม่ให้ input token (และค่าใช้จ่าย) โตขึ้นเรื่อยๆ ตามความยาวเซสชัน
    // สถานะสำคัญ (HP/ทอง/ไอเทม/ศัตรู) ถูกแนบไปกับทุก request อยู่แล้วผ่าน characterSheet
    // ด้านล่าง โมเดลจึงไม่จำเป็นต้องเห็น history ทั้งหมดเพื่อรู้สถานะปัจจุบัน
    const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES) || 30; // ~15 รอบสนทนาล่าสุด
    let apiHistory = history;
    let historyWasTrimmed = false;
    if (history.length > MAX_HISTORY_MESSAGES) {
        let sliced = history.slice(-MAX_HISTORY_MESSAGES);
        if (sliced[0]?.role === "model") sliced = sliced.slice(1); // ให้ contents เริ่มด้วยข้อความผู้เล่นเสมอ
        apiHistory = sliced;
        historyWasTrimmed = true;
        console.log(`[chat] ตัด history จาก ${history.length} เหลือ ${apiHistory.length} ข้อความก่อนส่งให้โมเดล (ประหยัด token)`);
    }

    const characterSheet = buildCharacterSheetText(character, enemies);

    const systemPrompt = `คุณคือ Game Master ของเกม MMORPG แนวแฟนตาซีสไตล์ DnD ตอบกลับเป็นภาษาไทยเท่านั้น
บรรยายเนื้อเรื่องให้กระชับ สนุก สมจริง ทำตัวเหมือน Log ในเกม MMO
ห้ามให้เนื้อเรื่องซ้ำเดิม สร้างสถานการณ์ใหม่ทุกครั้งตามบริบทของผู้เล่นและประวัติตัวละคร${longTermSummary ? `

=== ความทรงจำระยะยาว (สรุปเหตุการณ์เก่าที่ไม่ปรากฏในบทสนทนาด้านล่างแล้ว) ===
${longTermSummary}
ให้ยึดข้อมูลนี้เป็นความจริงเกี่ยวกับสิ่งที่เคยเกิดขึ้นมาก่อน (NPC ที่เคยเจอ, ภารกิจ/คำสัญญาที่ค้างอยู่, ความสัมพันธ์, จุดพลิกเนื้อเรื่องสำคัญ) และผูกเนื้อเรื่องปัจจุบันให้ต่อเนื่องสอดคล้องกับสิ่งเหล่านี้ ห้ามขัดแย้งหรือมองข้ามรายละเอียดในสรุปนี้` : ""}${historyWasTrimmed ? `

=== หมายเหตุเรื่องความจำระยะสั้น ===
บทสนทนาด้านล่างเป็นเพียงส่วนล่าสุดของการผจญภัยเท่านั้น (ข้อความที่เก่ากว่านี้ถูกตัดออกเพื่อประหยัดทรัพยากร ไม่ใช่ว่าไม่เคยเกิดขึ้น${longTermSummary ? " และมีสรุปไว้ในความทรงจำระยะยาวด้านบนแล้ว" : ""}) ให้ยึดข้อมูลในสถานะตัวละคร/ไอเทม/ศัตรูด้านล่างเป็นความจริงเสมอ ห้ามอ้างอิงหรือแต่งเติมรายละเอียดเหตุการณ์เก่าที่ไม่ปรากฏในบทสนทนานี้${longTermSummary ? "หรือในสรุปความทรงจำระยะยาว" : ""} ให้ดำเนินเรื่องต่อจากจุดล่าสุดตามธรรมชาติ` : ""}

นี่คือสถานะปัจจุบันของตัวละครผู้เล่น (ใช้ประกอบการตัดสินใจ และใช้บุคลิก/ประวัติเพื่อแต่งเนื้อเรื่องให้เข้ากับตัวละคร):
${characterSheet}

=== กฎการเริ่มเกม ===
ถ้าข้อความล่าสุดจากผู้เล่นคือ "[เริ่มเกม]" ให้บรรยายฉากเปิดเรื่อง แนะนำโลก สถานที่เริ่มต้น และสถานการณ์ตั้งต้นที่เข้ากับอาชีพ/ประวัติของตัวละคร จบด้วยการเชื้อเชิญให้ผู้เล่นตัดสินใจทำอะไรต่อ
ฉากเปิดเรื่องนี้ห้ามขอให้ทอยเต๋า (roll_request.required ต้องเป็น false) และห้ามมี hp_change/gold_change/add_items/remove_items/enemy_changes ใดๆ (ให้เป็นค่าว่าง/0 ทั้งหมด)

=== กฎการทอยเต๋าแบบ DnD (สำคัญมาก) ===
คุณคือคนตัดสินว่าเมื่อไหร่ต้องทอยเต๋า ไม่ใช่ผู้เล่น ระบบหลังบ้านเป็นคนสุ่มเลขและบวกโบนัสตามค่าสถานะให้เอง (โบนัส = (ค่าสถานะ - 10) หารสองปัดลง) คุณห้ามสุ่มหรือแต่งแต้มเต๋าเอง:
- ถ้าการกระทำของผู้เล่นมีความเสี่ยง/ไม่แน่นอน/ต้องใช้ทักษะ ให้ตั้ง roll_request.required = true พร้อม roll_request.reason สั้นๆ (เช่น "ทดสอบความแข็งแกร่งในการดันประตู") แล้วเลือกรูปแบบการทอยหนึ่งแบบ:
  1) เช็กเทียบระดับความยาก (DC): ใช้กับสิ่งแวดล้อม/สิ่งกีดขวาง เช่น ปีนกำแพง งัดประตู ปลดกับดัก ตั้ง die = "d20", stat = ค่าสถานะที่เกี่ยวข้อง (str/dex/int/con), dc = ระดับความยาก, opponent_name = "" และ opponent_bonus = 0
     ระดับ DC: ง่าย 8-10, ปานกลาง 12-13, ยาก 15, ยากมาก 18, เกือบเป็นไปไม่ได้ 20 ขึ้นไป
  2) ทอยแข่งกับศัตรู/NPC: ใช้เมื่อมีฝ่ายตรงข้ามต่อต้านโดยตรง เช่น ต่อสู้ ลอบเร้นผ่านยาม เจรจาต่อรอง ตั้ง die = "d20", stat = ค่าสถานะฝั่งผู้เล่น, opponent_name = ชื่อคู่ต่อสู้ (เช่น "ก็อบลินนักรบ"), opponent_bonus = พลังของศัตรู (อ่อน 0-1, ปกติ +2, แข็ง +3 ถึง +4, บอส +5 ถึง +6), dc = 0
     ถ้าศัตรูเป็นฝ่ายโจมตีผู้เล่น ให้ผู้เล่นทอยป้องกัน/หลบ (เช่น stat = dex) แข่งกับศัตรูในรูปแบบเดียวกัน
  3) เต๋าความเสียหาย/การรักษา: ใช้หลังฝ่ายที่ลงมือชนะ หรือเมื่อต้องสุ่มปริมาณโดยตรง เลือก d4, d6, d8, d10 หรือ d12 (อาวุธเบา/เวทเล็ก d4-d6, ระดับกลาง d8, หนักมาก d10-d12) และตั้ง stat = "none", dc = 0, opponent_name = ""
  4) เหตุการณ์สุ่มหลายระดับ (ของที่ตกหลังสู้, ผลข้างเคียงของเวท, เหตุการณ์แปลกระหว่างเดินทาง): ใช้ d100 และตั้ง stat = "none", dc = 0, opponent_name = ""
  - เมื่อขอให้ทอยเต๋า: narrative ให้บรรยายสถานการณ์ที่นำไปสู่การทอยเท่านั้น ห้ามสรุปผลลัพธ์ล่วงหน้า และห้ามใส่ hp_change/gold_change/add_items/remove_items ในรอบนี้ (ให้เป็นค่าว่าง/0 ทั้งหมด) เพราะยังไม่รู้ผล
- ถ้าการกระทำของผู้เล่นเป็นเรื่องปกติ ไม่มีความเสี่ยง (เช่น เดิน, พูดคุยทั่วไป, สำรวจ) ให้ตอบผลลัพธ์ไปเลยโดย roll_request.required = false ไม่ต้องทอยเต๋า
- เมื่อผู้เล่นส่งผลทอย (ข้อความขึ้นต้นว่า "ฉันทอย") ระบบคำนวณผลสรุปให้แล้ว เช่น "→ สำเร็จ", "→ ล้มเหลว", "→ ฉันชนะ", "→ ฉันแพ้", "→ เสมอ" พร้อมส่วนต่าง ให้ยึดผลสรุปนั้นเสมอ ห้ามกลับผล และใช้ส่วนต่างกำหนดความรุนแรง:
  - ส่วนต่าง +5 ขึ้นไป: สำเร็จอย่างงดงาม อาจได้รางวัลเพิ่ม
  - ส่วนต่าง 0 ถึง +4: สำเร็จแบบเฉียดฉิว
  - ส่วนต่าง -1 ถึง -4: ล้มเหลวแต่ยังไม่เสียหายหนัก อาจมีผลข้างเคียงเบา
  - ส่วนต่าง -5 ลงไป: พลาดหนัก เสีย HP ได้ (hp_change เป็นลบ)
  - เสมอ: สถานการณ์ตึงเครียด ไม่มีใครได้เปรียบชัดเจน
- ถ้าผลทอยเป็นเต๋าความเสียหาย/การรักษา (d4-d12): ใช้แต้มที่ทอยได้เป็นปริมาณ hp_change โดยตรง (เช่น d8 ได้ 5 = ประมาณ 5 HP) จะเป็นลบหรือบวกดูตามเนื้อเรื่อง hp_change ใช้กับ HP ของผู้เล่นเท่านั้น ส่วนความเสียหายที่ศัตรูได้รับให้ใส่ใน enemy_changes (ดูกฎศัตรูและการต่อสู้)
- ถ้าเป็น d100 ให้ประเมินตามสัดส่วน: 1-40 ผลแย่, 41-70 ก้ำกึ่ง, 71-100 ผลดี
- รอบที่ตัดสินผลแล้ว roll_request.required ให้เป็น false เว้นแต่ผลนำไปสู่ขั้นตอนต่อไปทันที (เช่น โจมตีสำเร็จแล้วต้องขอทอยเต๋าความเสียหาย) หรือสถานการณ์เสี่ยงใหม่

=== กฎศัตรูและการต่อสู้ ===
- ระบบติดตาม HP ของศัตรูให้ สถานะปัจจุบันมีบรรทัด "ศัตรูในฉากตอนนี้" ระบุ HP ล่าสุด ให้ยึดตามนั้นเสมอ
- เมื่อมีศัตรูใหม่ปรากฏตัว ให้ใส่ใน enemy_changes โดยระบุ name และ max_hp (อ่อน 6-10, ปกติ 12-20, แข็ง 25-40, บอส 50 ขึ้นไป) กับ hp_change = 0 และ remove = false ตั้งชื่อให้เฉพาะเจาะจงและใช้ชื่อเดิมตลอด ถ้ามีหลายตัวให้ชื่อต่างกัน (เช่น ก็อบลิน A, ก็อบลิน B)
- ศัตรูที่มีอยู่แล้วให้ max_hp = 0 เสมอ ห้ามเพิ่มซ้ำ
- เมื่อผู้เล่นทำความเสียหายสำเร็จ (จากผลทอยเต๋าความเสียหาย) ให้ใส่ hp_change ของศัตรูนั้นเป็นค่าลบเท่าแต้มเต๋าที่ทอยได้ (ปรับเล็กน้อยตามเนื้อเรื่องได้) ศัตรูจะถูกกำจัดอัตโนมัติเมื่อ HP เหลือ 0 ไม่ต้องตั้ง remove
- ตั้ง remove = true เฉพาะกรณีศัตรูหนีไปหรือออกจากการต่อสู้โดยไม่ผ่าน HP (เช่น ถูกเกลี้ยกล่อมให้ถอย)
- ในรอบที่ขอให้ทอยเต๋า ให้เพิ่มศัตรูใหม่ได้ (max_hp > 0, hp_change = 0) แต่ห้ามเปลี่ยน HP ของศัตรูที่มีอยู่
- ลำดับการต่อสู้ปกติ: ผู้เล่นโจมตี → ทอยแข่งกับศัตรูนั้น → ถ้าชนะให้ขอทอยเต๋าความเสียหายตามอาวุธ/เวท
- ถ้าศัตรูโจมตีผู้เล่นและผู้เล่นแพ้การป้องกัน ให้กำหนด hp_change ของผู้เล่นเป็นลบตามส่วนต่างและความแรงของศัตรูเลย (ไม่ต้องขอทอยเต๋าอีก)
- ถ้าไม่มีศัตรูเกี่ยวข้องในรอบนั้น ให้ enemy_changes เป็น array ว่าง

=== กฎเรื่องทองและค่าสถานะ (สำคัญ - ห้ามปล่อยผ่าน) ===
- ก่อนอนุญาตให้ผู้เล่นซื้อ/แลก/จ่ายทองเพื่อสิ่งใดก็ตาม ให้เทียบราคากับบรรทัด "ทอง" ในสถานะปัจจุบันข้างต้นก่อนเสมอ นี่คือยอดทองจริง ไม่ใช่ตัวเลขที่ผู้เล่นอ้าง
- ถ้าทองไม่พอ ห้ามตั้ง gold_change ติดลบเกินยอดที่มีจริงเด็ดขาด และห้ามใส่ item นั้นใน add_items ให้เล่าในเนื้อเรื่องว่าเงินไม่พอ (พ่อค้าไม่ขายให้/ต้องหาเงินเพิ่มก่อน) แล้วไม่ต้องเปลี่ยนแปลงทองหรือไอเทมใดๆ ในรอบนั้น
- ถ้าทองพอ ให้ gold_change เท่ากับราคาที่ตกลงจริง (ติดลบ) พร้อม add_items ของที่ได้มาในรอบเดียวกัน
- ก่อนให้ผู้เล่นทำสิ่งที่ควรต้องใช้ค่าสถานะขั้นต่ำ (เช่น อาวุธหนักต้องการ STR สูง คาถายากต้องการ INT สูง) ให้เทียบกับค่าสถานะจริงของตัวละครในสถานะปัจจุบันข้างต้น ถ้าไม่ถึงเกณฑ์ตามธรรมชาติของตัวละครนั้น ให้สะท้อนผลในเนื้อเรื่อง (ทำได้ยากขึ้น/ฝืนทำแล้วมีผลเสีย/ต้องทอยเต๋าเช็ก DC ที่สูงขึ้น) อย่าปล่อยให้ทำได้ราวกับไม่มีข้อจำกัดทางร่างกาย/สติปัญญาของตัวละคร

=== กฎอื่นๆ ===
- ปรับ hp_change ให้สมเหตุสมผลกับสถานการณ์ (ทั่วไปไม่เกิน -8 ต่อครั้ง เว้นแต่สถานการณ์อันตรายมาก)
- ถ้า HP ของผู้เล่นจะลดลงเหลือ 0 หรือต่ำกว่า ให้ตั้ง status เป็น "หมดสติ" หรือ "เสียชีวิต" ตามความเหมาะสมของเนื้อเรื่อง (ส่วนใหญ่ให้ "หมดสติ" ไม่ต้องเสียชีวิตง่ายๆ)
- เพิ่ม/ลดไอเทมเฉพาะเมื่อเนื้อเรื่องสมเหตุสมผลจริงๆ เช่น เก็บของจากศัตรู ซื้อของ ใช้ไอเทม
- name ใน add_items/remove_items ต้องเป็นข้อความล้วนเสมอ ห้ามส่งเป็น object ซ้อน
- add_items/remove_items เป็นรายการ {name, quantity} ตั้งชื่อให้ตรงกับที่อยู่ในกระเป๋า (ไม่ต้องใส่ (xN)) และ quantity คือจำนวนที่ใช้/ได้จริงในครั้งนี้ ระบบจะหักหรือเพิ่มในกองให้เอง เช่น ดื่มโพชั่น 1 ขวด = quantity 1 ห้ามลบทั้งกองเว้นแต่เนื้อเรื่องทำให้ทั้งกองหายจริงๆ (เช่น ถูกขโมย ตกน้ำ) ซึ่งให้ใส่จำนวนทั้งหมดที่หาย
- ถ้าผู้เล่นระบุจำนวนที่ใช้ (เช่น "ดื่มโพชั่น 2 ขวด") ให้ใช้ตามจำนวนนั้น ถ้าในกระเป๋ามีไม่พอให้เล่าว่าไม่พอและไม่หักเกินที่มี
- ห้ามใส่ข้อความ JSON หรือ markdown ลงใน narrative ให้เป็นข้อความเล่าเรื่องล้วนๆ`;

    const payload = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: apiHistory,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    narrative: { type: "STRING", description: "เนื้อเรื่องที่ GM เล่าให้ผู้เล่นฟัง เป็นภาษาไทย" },
                    hp_change: { type: "INTEGER", description: "การเปลี่ยนแปลง HP ปัจจุบัน (ลบ=เสีย HP, บวก=ฟื้นฟู, 0=ไม่เปลี่ยน)" },
                    max_hp_change: { type: "INTEGER", description: "การเปลี่ยนแปลง HP สูงสุด ปกติเป็น 0 ยกเว้นเลเวลอัพ" },
                    gold_change: { type: "INTEGER", description: "การเปลี่ยนแปลงทอง (ลบ=เสียทอง, บวก=ได้ทอง)" },
                    add_items: { type: "ARRAY", items: ITEM_SCHEMA, description: "ไอเทมที่ได้รับใหม่ พร้อมจำนวน (ถ้าไม่มีให้เป็น array ว่าง)" },
                    remove_items: { type: "ARRAY", items: ITEM_SCHEMA, description: "ไอเทมที่ถูกใช้/เสียไป พร้อมจำนวนที่ใช้จริง (ถ้าไม่มีให้เป็น array ว่าง)" },
                    enemy_changes: {
                        type: "ARRAY",
                        description: "การเปลี่ยนแปลงของศัตรูในฉาก (ปรากฏตัวใหม่ / เสีย HP / หนี) ถ้าไม่มีให้เป็น array ว่าง",
                        items: {
                            type: "OBJECT",
                            properties: {
                                name: { type: "STRING", description: "ชื่อศัตรู ใช้ชื่อเดิมตลอด" },
                                max_hp: { type: "INTEGER", description: "HP สูงสุดเมื่อศัตรูปรากฏตัวครั้งแรกเท่านั้น ศัตรูที่มีอยู่แล้วให้เป็น 0" },
                                hp_change: { type: "INTEGER", description: "ลบ=เสีย HP, บวก=ฟื้นฟู, 0=ไม่เปลี่ยน" },
                                remove: { type: "BOOLEAN", description: "true เฉพาะเมื่อศัตรูหนี/ออกจากการต่อสู้โดยไม่ผ่าน HP" }
                            },
                            required: ["name", "max_hp", "hp_change", "remove"]
                        }
                    },
                    status: { type: "STRING", enum: VALID_STATUS },
                    roll_request: {
                        type: "OBJECT",
                        description: "ถ้าสถานการณ์ต้องการให้ผู้เล่นทอยเต๋าเพื่อตัดสินผล ให้ required=true พร้อมเหตุผล ถ้าไม่ต้องทอยให้ required=false",
                        properties: {
                            required: { type: "BOOLEAN" },
                            die: { type: "STRING", enum: VALID_DICE },
                            reason: { type: "STRING", description: "เหตุผลสั้นๆว่าทอยเพื่ออะไร (ค่าว่างถ้า required=false)" },
                            stat: { type: "STRING", enum: VALID_STATS, description: "ค่าสถานะของผู้เล่นที่ใช้บวกโบนัส (เฉพาะ d20) ถ้าไม่เกี่ยวข้องให้เป็น none" },
                            dc: { type: "INTEGER", description: "ระดับความยากที่ต้องทอยให้ถึง (เช็กเทียบ DC) ถ้าไม่ใช้ให้เป็น 0" },
                            opponent_name: { type: "STRING", description: "ชื่อคู่ต่อสู้ในการทอยแข่ง ถ้าไม่ใช่การทอยแข่งให้เป็นข้อความว่าง" },
                            opponent_bonus: { type: "INTEGER", description: "โบนัสของคู่ต่อสู้ในการทอยแข่ง ถ้าไม่ใช่การทอยแข่งให้เป็น 0" }
                        },
                        required: ["required", "die", "reason", "stat", "dc", "opponent_name", "opponent_bonus"]
                    }
                },
                required: ["narrative", "hp_change", "gold_change", "add_items", "remove_items", "enemy_changes", "status", "roll_request"]
            }
        }
    };

    // ============ วนลองทีละรุ่น (logic กลางอยู่ใน _lib/gemini.js) ============
    function validateChatResponse(parsedJson) {
        if (!parsedJson || typeof parsedJson.narrative !== "string" || !parsedJson.narrative.trim()) {
            return { ok: false, reason: "ไม่มี narrative" };
        }
        return { ok: true, parsed: normalize(parsedJson) };
    }

    const result = await runWithFallback(payload, apiKey, validateChatResponse);

    if (result.ok) {
        console.log(`[chat] สำเร็จด้วย ${result.model} | ลำดับที่ลอง: ${summarizeAttempts(result.attempts)}`);
        const parsed = result.parsed;
        // ป้องกันชั้นสอง: ถึง prompt จะสั่งห้ามแล้ว แต่กันไว้เผื่อโมเดลไม่ทำตาม ห้ามหักทองเกินยอดที่มีจริง
        const currentGold = Number(character?.gold);
        if (Number.isFinite(currentGold) && parsed.gold_change < -currentGold) {
            console.warn(`[chat] gold_change ${parsed.gold_change} เกินยอดทองจริง ${currentGold} ของ ${character?.name || "-"} → จำกัดไว้ที่ -${currentGold}`);
            parsed.gold_change = -currentGold;
        }
        if (DEBUG_META) {
            parsed._model = result.model;
            parsed._attempts = result.attempts;
            parsed._historyTrimmed = historyWasTrimmed ? { from: history.length, to: apiHistory.length } : null;
        }
        return res.status(200).json(parsed);
    }

    const attemptsSummary = summarizeAttempts(result.attempts);
    console.error(`[chat] ทุกรุ่นล้มเหลว | ${attemptsSummary}`);
    return res.status(503).json({
        error: result.fatalMessage
            ? `Gemini ปฏิเสธคำขอ: ${result.fatalMessage}`
            : `ทุกโมเดลไม่ตอบสนองในตอนนี้ ลองใหม่อีกครั้งในไม่กี่วินาที (รายละเอียด: ${attemptsSummary})`
    });
}

// กันค่าเพี้ยนจากรุ่นเล็ก เช่น hp_change เป็นข้อความ, items ไม่ใช่ array
function normalize(p) {
    const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
    const QTY_RE = /\s*\(x(\d+)\)\s*$/i;

    // รับได้ทั้งแบบ {name, quantity} และข้อความเก่า เช่น "โพชั่น (x3)"
    // กันไว้เผื่อโมเดลส่ง name มาเป็น object ซ้อน (เช่น {name:{th:"..."}}) ซึ่งถ้าไม่กัน จะกลายเป็นข้อความ "[object Object]" ในกระเป๋า
    const extractName = (raw) => {
        if (typeof raw === "string") return raw;
        if (raw && typeof raw === "object") {
            const candidate = raw.name || raw.th || raw.en || raw.text || raw.value;
            if (typeof candidate === "string") return candidate;
        }
        return "";
    };
    const items = (v) => (Array.isArray(v) ? v : []).map(x => {
        if (typeof x === "string") {
            const m = x.match(QTY_RE);
            const name = x.replace(QTY_RE, "").trim();
            return name ? { name, quantity: m ? Math.max(1, parseInt(m[1], 10)) : 1 } : null;
        }
        if (x && typeof x === "object") {
            const rawName = extractName(x.name);
            if (!rawName.trim()) {
                console.warn("[chat] add_items/remove_items entry มี name ที่กู้คืนเป็นข้อความไม่ได้:", JSON.stringify(x).slice(0, 200));
                return null;
            }
            const m = rawName.match(QTY_RE);
            const name = rawName.replace(QTY_RE, "").trim();
            const q = int(x.quantity);
            return name ? { name, quantity: Math.min(999, q >= 1 ? q : (m ? Math.max(1, parseInt(m[1], 10)) : 1)) } : null;
        }
        return null;
    }).filter(Boolean);

    const enemyChanges = (Array.isArray(p.enemy_changes) ? p.enemy_changes : []).map(x => {
        if (!x || typeof x.name !== "string" || !x.name.trim()) return null;
        return {
            name: x.name.trim().slice(0, 40),
            max_hp: Math.max(0, Math.min(999, int(x.max_hp))),
            hp_change: Math.max(-999, Math.min(999, int(x.hp_change))),
            remove: x.remove === true
        };
    }).filter(Boolean);

    const rr = p.roll_request && typeof p.roll_request === "object" ? p.roll_request : {};
    const needRoll = rr.required === true;
    const oppName = needRoll && typeof rr.opponent_name === "string" ? rr.opponent_name.trim() : "";
    const contest = oppName !== "";                                  // ทอยแข่งกับศัตรู
    const dcValue = Math.max(0, Math.min(30, int(rr.dc)));
    const check = needRoll && !contest && dcValue > 0;               // เช็กเทียบ DC
    const die = (contest || check) ? "d20" : (VALID_DICE.includes(rr.die) ? rr.die : "d20");
    const stat = (die === "d20" && VALID_STATS.includes(rr.stat)) ? rr.stat : "none";

    return {
        narrative: p.narrative.trim(),
        hp_change: int(p.hp_change),
        max_hp_change: int(p.max_hp_change),
        gold_change: int(p.gold_change),
        add_items: items(p.add_items),
        remove_items: items(p.remove_items),
        enemy_changes: enemyChanges,
        status: VALID_STATUS.includes(p.status) ? p.status : "ปกติ",
        roll_request: {
            required: needRoll,
            die,
            reason: needRoll ? String(rr.reason || "") : "",
            stat: needRoll ? stat : "none",
            dc: check ? dcValue : 0,
            opponent_name: contest ? oppName : "",
            opponent_bonus: contest ? Math.max(-5, Math.min(10, int(rr.opponent_bonus))) : 0
        }
    };
}

function buildCharacterSheetText(c, enemies) {
    const lines = [
        `ชื่อ: ${c.name || "-"}`,
        `อาชีพ: ${c.className || "-"}${c.classDesc ? ` (${c.classDesc})` : ""}`,
        `ประวัติ/บุคลิก: ${c.backstory ? c.backstory : "ไม่มีข้อมูลเพิ่มเติม"}`,
        `สถานะ: STR ${c.stats?.str}, DEX ${c.stats?.dex}, INT ${c.stats?.int}, CON ${c.stats?.con}`,
        `HP: ${c.hp}/${c.maxHp}`,
        `ทอง: ${c.gold}`,
        `กระเป๋า: ${(c.inventory && c.inventory.length) ? c.inventory.join(", ") : "ไม่มีไอเทม"}`
    ];
    if (c.status && typeof c.status === "string") {
        lines.push(`สถานะร่างกายล่าสุด: ${c.status.slice(0, 20)}`);
    }
    const list = (Array.isArray(enemies) ? enemies : [])
        .filter(e => e && typeof e.name === "string" && Number.isFinite(Number(e.hp)) && Number.isFinite(Number(e.maxHp)))
        .slice(0, 10);
    lines.push(`ศัตรูในฉากตอนนี้: ${list.length ? list.map(e => `${String(e.name).slice(0, 40)} HP ${Number(e.hp)}/${Number(e.maxHp)}`).join(", ") : "ไม่มี"}`);
    return lines.join("\n");
}
