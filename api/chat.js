// ============ ตั้งค่า fallback ============
// ลำดับรุ่น/retry/timeout ย้ายไปอยู่ใน _lib/gemini.js เพื่อให้ summarize.js เรียกใช้ logic เดียวกันได้
import { runWithFallback, DEBUG_META, summarizeAttempts } from './_lib/gemini.js';

// สถานะ "หมดสติ"/"เสียชีวิต" ไม่ได้อยู่ในอำนาจของ AI อีกต่อไป ระบบฝั่ง client จัดการเรื่องนี้เองทั้งหมดผ่าน Death Saving Throw (ดูกฎด้านล่าง)
// status ที่เหลือมีไว้บรรยายอาการเท่านั้น
const VALID_STATUS = ["ปกติ", "บาดเจ็บสาหัส"];
const VALID_DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];
const VALID_ROLL_MODES = ["check", "attack", "damage", "event", "enemy_attack"];
const VALID_ADVANTAGE = ["normal", "advantage", "disadvantage"];
const VALID_STATS = ["str", "dex", "int", "con", "wis", "cha", "none"];
const VALID_REST_TYPES = ["none", "short", "long"];
// รายชื่อ Condition ที่รองรับ (ตาม DnD 5e แบบย่อ) — ไม่กระทบค่าสถานะ (STR/DEX/...) โดยตรง
// มีผลเชิงกลไกผ่านดุลยพินิจ AI ตอนตั้ง roll_request.advantage/disadvantage เท่านั้น (ดูกฎด้านล่าง)
const VALID_CONDITIONS = ["poisoned", "prone", "stunned", "restrained", "frightened", "blinded", "paralyzed"];
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
    // character.spellSlots / character.level / character.xp / character.conditions มาจาก client เช่นเดียวกับ hp/gold เดิม

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
ฉากเปิดเรื่องนี้ห้ามขอให้ทอยเต๋า (roll_request.required ต้องเป็น false) และห้ามมี hp_change/gold_change/add_items/remove_items/enemy_changes/xp_change/spell_slot_change/condition_changes ใดๆ (ให้เป็นค่าว่าง/0 ทั้งหมด, rest_type="none")

=== กฎการทอยเต๋าแบบ DnD (สำคัญมาก) ===
คุณคือคนตัดสินว่าเมื่อไหร่ต้องทอยเต๋า ไม่ใช่ผู้เล่น ระบบหลังบ้านเป็นคนสุ่มเลขและบวกโบนัสตามค่าสถานะให้เอง (โบนัส = (ค่าสถานะ - 10) หารสองปัดลง) คุณห้ามสุ่มหรือแต่งแต้มเต๋าเอง มี 4 โหมด (roll_request.mode) เลือกใช้ให้ตรงสถานการณ์:

1) mode="check" — เช็กเทียบระดับความยาก (DC): ใช้กับสิ่งแวดล้อม/สิ่งกีดขวาง หรือการกระทำทั่วไปที่ไม่ใช่การโจมตีโดยตรง เช่น ปีนกำแพง งัดประตู ปลดกับดัก โน้มน้าวใจ สังเกตการณ์ ตั้ง die="d20", stat=ค่าสถานะที่เกี่ยวข้อง, dc=ระดับความยาก, opponent_name="", target_ac=0
   ระดับ DC: ง่าย 8-10, ปานกลาง 12-13, ยาก 15, ยากมาก 18, เกือบเป็นไปไม่ได้ 20 ขึ้นไป
   แนวทางเลือกค่าสถานะ (มี 6 ค่า): STR=ยกของ/พังประตู/ปีนป่าย, DEX=หลบ/ย่อง/คล่องแคล่ว, INT=วิเคราะห์/ความรู้/เวทอาคม, CON=อดทน/ต้านทานพิษหรือความเหนื่อยล้า, WIS=สังเกตการณ์/สัญชาตญาณ/อ่านเจตนา/เวทธรรมชาติ, CHA=โน้มน้าว/ขู่/หลอกลวง/แสดงตัว

2) mode="attack" — โจมตีเทียบ AC ของเป้าหมาย: ใช้เมื่อผู้เล่นโจมตีศัตรู/NPC โดยตรง (ประชิดตัว ระยะไกล หรือเวทโจมตี) ตั้ง die="d20", stat=ค่าที่ใช้โจมตี (str=อาวุธหนัก, dex=อาวุธเบา/ธนู, int/wis/cha=แล้วแต่รูปแบบเวทของตัวละคร), opponent_name=ชื่อเป้าหมาย, target_ac=ค่า AC ของเป้าหมาย (ดูจาก "ศัตรูในฉากตอนนี้" ด้านล่าง ถ้าเป็น NPC/สิ่งกีดขวางที่ยังไม่มี AC ให้ประเมินเอง 10-16 ตามความแข็งแกร่ง), dc=0
   **สำคัญ: ฝ่ายที่ถูกโจมตีไม่ทอยเต๋าแข่งอีกต่อไป** — นี่คือกลไกจริงของ DnD 5e ระบบเทียบผลรวมของผู้เล่นกับ AC ของเป้าหมายโดยตรงให้อัตโนมัติ
   Natural 20 (ทอย d20 ได้ 20 ดิบ) = โจมตีโดนเสมอและเป็น **คริติคอล** ระบบจะบอกให้ทอยเต๋าความเสียหายต่อทันทีโดยตั้ง dice_count=2 (ดาเมจ 2 เท่า)
   Natural 1 (ทอย d20 ได้ 1 ดิบ) = โจมตีพลาดเสมอไม่ว่า AC เป้าหมายจะต่ำแค่ไหน
   ระบบตัดสินโดน/พลาด/คริติคอลให้อัตโนมัติแล้วในข้อความที่ผู้เล่นส่งกลับมา คุณแค่เล่าเรื่องตามผลนั้น ห้ามกลับผล

3) mode="damage" — เต๋าความเสียหาย/การรักษา: ใช้หลังโจมตีสำเร็จ (รวมคริติคอล) หรือใช้เวทรักษา เลือก die เป็น d4/d6/d8/d10/d12 ตามความหนักของอาวุธ/เวท (เบา d4-d6, กลาง d8, หนักมาก d10-d12) ตั้ง dice_count=1 ตามปกติ หรือ 2 เมื่อรอบก่อนหน้าเป็นคริติคอล ตั้ง stat="none", dc=0, opponent_name="", target_ac=0

4) mode="event" — เหตุการณ์สุ่มหลายระดับ (ของตกหลังสู้, ผลข้างเคียงเวท, เหตุการณ์แปลกระหว่างทาง): ใช้ die="d100" ตั้ง dice_count=1, stat="none", dc=0, opponent_name="", target_ac=0 ประเมินสัดส่วน 1-40 ผลแย่, 41-70 ก้ำกึ่ง, 71-100 ผลดี

advantage/disadvantage (ใช้ได้เฉพาะ mode="check" หรือ "attack"): ตั้ง roll_request.advantage="advantage" เมื่อสถานการณ์เอื้อผู้เล่นชัดเจน (ได้เปรียบภูมิประเทศ, โจมตีศัตรูที่ยังไม่รู้ตัว, สภาพแวดล้อมช่วย) หรือ "disadvantage" เมื่อขัดขวางผู้เล่นชัดเจน (บาดเจ็บสาหัส, มองไม่เห็น, พื้นที่ลำบาก) ปกติให้เป็น "normal"

เมื่อขอให้ทอยเต๋า (roll_request.required=true): narrative บรรยายสถานการณ์ที่นำไปสู่การทอยเท่านั้น ห้ามสรุปผลลัพธ์ล่วงหน้า และห้ามใส่ hp_change/gold_change/add_items/remove_items ในรอบนี้ (ให้เป็นค่าว่าง/0 ทั้งหมด) เพราะยังไม่รู้ผล
ถ้าการกระทำของผู้เล่นเป็นเรื่องปกติ ไม่มีความเสี่ยง (เดิน, พูดคุยทั่วไป, สำรวจที่ไม่มีอันตราย) ให้ตอบผลลัพธ์ไปเลยโดย roll_request.required=false ไม่ต้องทอยเต๋า

เมื่อผู้เล่นส่งผลทอยมา (ข้อความขึ้นต้นด้วย "ฉันทอย") ระบบคำนวณและสรุปผลให้แล้วเสมอ (เช่น "→ สำเร็จ", "→ โจมตีโดน", "→ CRITICAL HIT", "→ โจมตีพลาด", "→ FUMBLE") ให้ยึดผลสรุปนั้นเสมอ ห้ามกลับผลหรือแต่งผลใหม่ ใช้ผลนั้นกำหนดความรุนแรงของเนื้อเรื่อง:
- CRITICAL HIT: บรรยายฉากปะทะรุนแรงเป็นพิเศษ แล้วขอทอยเต๋าความเสียหายต่อทันที (mode="damage", dice_count=2)
- โจมตีโดน/สำเร็จแบบเฉียดฉิว (ส่วนต่าง 0 ถึง +4): สำเร็จแต่ไม่หวือหวา
- ส่วนต่าง +5 ขึ้นไป: สำเร็จอย่างงดงาม อาจได้รางวัลเพิ่ม
- ล้มเหลว/โจมตีพลาด (ส่วนต่าง -1 ถึง -4): ยังไม่เสียหายหนัก อาจมีผลข้างเคียงเบา
- ส่วนต่าง -5 ลงไป หรือ FUMBLE: พลาดหนักเป็นพิเศษ อาจเปิดช่องให้ศัตรูโต้กลับ/เผยตัว/เสียของ
- ถ้าเป็น d100 (event) ให้ประเมินตามสัดส่วนด้านบน
- ถ้าผลทอยเป็นเต๋าความเสียหาย/การรักษา (mode="damage"): ใช้ผลรวมที่ทอยได้เป็น hp_change ของผู้เล่นโดยตรงเมื่อเป็นการรักษาตัวเอง ส่วนความเสียหายที่ศัตรูได้รับจากการโจมตีให้ใส่ใน enemy_changes แทน (ดูกฎศัตรูและการต่อสู้ด้านล่าง)
- รอบที่ตัดสินผลแล้ว roll_request.required ให้เป็น false เว้นแต่ผลนำไปสู่ขั้นตอนต่อไปทันที (เช่น โจมตีโดนแล้วต้องขอทอยเต๋าความเสียหาย) หรือสถานการณ์เสี่ยงใหม่

=== กฎศัตรูและการต่อสู้ ===
- ระบบติดตาม HP/AC/ATK/ดาเมจของศัตรูให้ สถานะปัจจุบันมีบรรทัด "ศัตรูในฉากตอนนี้" ระบุค่าล่าสุดทั้งหมด ให้ยึดตามนั้นเสมอ
- เมื่อมีศัตรูใหม่ปรากฏตัว ให้ใส่ใน enemy_changes โดยระบุ:
  - name: ชื่อเฉพาะเจาะจง ใช้ชื่อเดิมตลอด ถ้ามีหลายตัวให้ชื่อต่างกัน (เช่น ก็อบลิน A, ก็อบลิน B)
  - max_hp (อ่อน 6-10, ปกติ 12-20, แข็ง 25-40, บอส 50 ขึ้นไป) และ ac (อ่อน 10-11, ปกติ 12-14, แข็ง 15-17, บอส 18 ขึ้นไป)
  - atk: โบนัสโจมตีของศัตรู (ตัวเลขบวกกับ d20 ตอนศัตรูโจมตีผู้เล่น) อ่อน +1 ถึง +2, ปกติ +3 ถึง +4, แข็ง +5 ถึง +6, บอส +7 ขึ้นไป
  - dmg_count และ dmg_die: จำนวนลูกเต๋า+ชนิดลูกเต๋าความเสียหายของการโจมตี อ่อน 1d4, ปกติ 1d6 ถึง 1d8, แข็ง 2d6, บอส 2d8 ถึง 3d6
  - hp_change=0 และ remove=false เสมอตอนสร้างใหม่
- ศัตรูที่มีอยู่แล้ว (ไม่ใช่ตอนปรากฏตัวครั้งแรก) ให้ max_hp=0, ac=0, atk=0, dmg_count=0, dmg_die="d4" เสมอ (แปลว่าไม่เปลี่ยนค่าพวกนี้) ห้ามเพิ่มซ้ำ
- เมื่อผู้เล่นโจมตีโดนสำเร็จและทอยเต๋าความเสียหายแล้ว ให้ใส่ hp_change ของศัตรูนั้นเป็นค่าลบเท่าแต้มเต๋าความเสียหายที่ทอยได้ (ปรับเล็กน้อยตามเนื้อเรื่องได้) ศัตรูจะถูกกำจัดอัตโนมัติเมื่อ HP เหลือ 0 ไม่ต้องตั้ง remove
- ตั้ง remove=true เฉพาะกรณีศัตรูหนีไปหรือออกจากการต่อสู้โดยไม่ผ่าน HP (เช่น ถูกเกลี้ยกล่อมให้ถอย)
- ในรอบที่ขอให้ทอยเต๋า ให้เพิ่มศัตรูใหม่ได้ (max_hp>0, ac>0) แต่ห้ามเปลี่ยน HP ของศัตรูที่มีอยู่
- ลำดับการต่อสู้ปกติ: ผู้เล่นโจมตี (mode="attack" เทียบ AC เป้าหมาย) → ถ้าโดนให้ขอทอยเต๋าความเสียหายตามอาวุธ/เวท (mode="damage") → ใส่ hp_change ของศัตรูตามผล
- **ศัตรูโจมตีผู้เล่น (สำคัญ — ตอนนี้ใช้เต๋าจริง ไม่ใช่ดุลยพินิจล้วนๆ อีกต่อไป)**: เมื่อถึงจังหวะที่สมเหตุสมผลให้ศัตรูตัวใดตัวหนึ่งในฉากโจมตีกลับ (เช่น จบเทิร์นผู้เล่นแล้วศัตรูยังไม่ตาย ยังไม่หนี) ให้ตั้ง roll_request.required=true, mode="enemy_attack", opponent_name=ชื่อศัตรูตัวที่โจมตี (ต้องตรงกับชื่อใน "ศัตรูในฉากตอนนี้") ส่วน die/stat/dc/target_ac/dice_count ใส่ค่า default ไปได้ (ระบบไม่ใช้ค่าพวกนี้กับโหมดนี้ เพราะระบบจะทอยเต๋าเองโดยใช้ atk/dmg ของศัตรูตัวนั้นเทียบ AC ผู้เล่นอัตโนมัติ)
  - narrative ในรอบนี้บรรยายแค่ท่าทีที่ศัตรูเตรียมโจมตี ห้ามสรุปผลลัพธ์ล่วงหน้า และห้ามใส่ hp_change ของผู้เล่นในรอบนี้ (ต้องเป็น 0 เพราะยังไม่รู้ผล)
  - เมื่อระบบทอยและคำนวณผลให้แล้ว จะส่งข้อความที่ขึ้นต้นด้วย "[ผลการโจมตีของศัตรู]" กลับมาบอกผลชัดเจน (โดน/พลาด/ดาเมจเท่าไหร่ และหักเลือดผู้เล่นให้แล้ว) ให้บรรยายฉากตามผลนั้นเป๊ะๆ ห้ามกลับผลหรือแต่งใหม่ และตั้ง hp_change=0 เสมอในรอบนี้ (ระบบจัดการ HP ผู้เล่นไปแล้ว) ห้ามตั้ง roll_request ของ mode="enemy_attack" ซ้อนกันสองตัวพร้อมกันในรอบเดียว (ให้ศัตรูโจมตีทีละตัวต่อเทิร์น)
  - ห้ามใช้ mode="enemy_attack" ถ้า HP ผู้เล่นเป็น 0 อยู่แล้ว (กำลัง Death Saving Throw) และไม่จำเป็นต้องให้ศัตรูโจมตีทุกรอบสนทนา ให้ใช้ตามจังหวะเนื้อเรื่องที่สมเหตุสมผลเหมือน DM จริงตัดสินเทิร์นศัตรู
- ถ้าไม่มีศัตรูเกี่ยวข้องในรอบนั้น ให้ enemy_changes เป็น array ว่าง

=== กฎเรื่องทองและค่าสถานะ (สำคัญ - ห้ามปล่อยผ่าน) ===
- ก่อนอนุญาตให้ผู้เล่นซื้อ/แลก/จ่ายทองเพื่อสิ่งใดก็ตาม ให้เทียบราคากับบรรทัด "ทอง" ในสถานะปัจจุบันข้างต้นก่อนเสมอ นี่คือยอดทองจริง ไม่ใช่ตัวเลขที่ผู้เล่นอ้าง
- ถ้าทองไม่พอ ห้ามตั้ง gold_change ติดลบเกินยอดที่มีจริงเด็ดขาด และห้ามใส่ item นั้นใน add_items ให้เล่าในเนื้อเรื่องว่าเงินไม่พอ (พ่อค้าไม่ขายให้/ต้องหาเงินเพิ่มก่อน) แล้วไม่ต้องเปลี่ยนแปลงทองหรือไอเทมใดๆ ในรอบนั้น
- ถ้าทองพอ ให้ gold_change เท่ากับราคาที่ตกลงจริง (ติดลบ) พร้อม add_items ของที่ได้มาในรอบเดียวกัน
- ก่อนให้ผู้เล่นทำสิ่งที่ควรต้องใช้ค่าสถานะขั้นต่ำ (เช่น อาวุธหนักต้องการ STR สูง คาถายากต้องการ INT สูง) ให้เทียบกับค่าสถานะจริงของตัวละครในสถานะปัจจุบันข้างต้น ถ้าไม่ถึงเกณฑ์ตามธรรมชาติของตัวละครนั้น ให้สะท้อนผลในเนื้อเรื่อง (ทำได้ยากขึ้น/ฝืนทำแล้วมีผลเสีย/ต้องทอยเต๋าเช็ก DC ที่สูงขึ้น) อย่าปล่อยให้ทำได้ราวกับไม่มีข้อจำกัดทางร่างกาย/สติปัญญาของตัวละคร

=== กฎเรื่องชีวิต/ความตาย (สำคัญมาก) ===
ระบบหลังบ้านจัดการเรื่องหมดสติ/Death Saving Throw/การเสียชีวิตให้ทั้งหมดโดยอัตโนมัติตามกฎ DnD 5e คุณไม่มีอำนาจตัดสินเองอีกต่อไป:
- ห้ามตั้ง status เป็นอะไรนอกจาก "ปกติ" หรือ "บาดเจ็บสาหัส" เด็ดขาด (ใช้บรรยายอาการเท่านั้น ไม่ใช่ตัวตัดสินเป็น/ตาย)
- ปรับ hp_change ให้สมเหตุสมผลกับสถานการณ์ (ทั่วไปไม่เกิน -8 ต่อครั้ง เว้นแต่สถานการณ์อันตรายมาก) โดยไม่ต้องกังวลว่า HP จะติดลบหรือเหลือ 0 ระบบจะจัดการเข้าสู่โหมด Death Saving Throw ให้เองอัตโนมัติเมื่อ HP เหลือ 0
- **ห้ามตั้ง roll_request.required=true ถ้า HP ปัจจุบันของผู้เล่นเป็น 0** (ดูจากสถานะปัจจุบันด้านล่าง) เพราะผู้เล่นกำลังหมดสติอยู่ ให้ required=false และเล่าเรื่องรอไปก่อนจนกว่าจะมีข้อความ Death Saving Throw เข้ามา
- ถ้าเห็นข้อความ "ฉันทอย Death Saving Throw ... " ในบทสนทนา ระบบสรุปผล (ฟื้นคืนสติ/อาการคงที่/เสียชีวิต) มาให้แล้วเสมอ ให้บรรยายฉากตามผลนั้นเป๊ะๆ และตั้ง hp_change=0 เสมอ (ระบบจัดการ HP ให้แล้ว) พร้อม status="ปกติ" หรือ "บาดเจ็บสาหัส" ตามความเหมาะสม ห้ามใส่ hp_change เพิ่ม
- ความตายทันที (instant death) แบบไม่ผ่าน Death Save ให้ใช้เฉพาะสถานการณ์เนื้อเรื่องที่รุนแรงจริง ๆ เท่านั้น (เช่น ตกลงไปในลาวา กับดักมหันตภัยระดับตำนาน) และต้องระบุใน narrative ให้ชัดเจนว่าเป็นความตายทันที ไม่ใช่กรณีปกติ ให้ใช้อย่างประหยัดมาก

=== กฎการพัก (Rest) ===
ถ้าข้อความผู้เล่นคือ "ฉันขอพักยาวค้างคืนในที่ปลอดภัย (Long Rest)" ให้พิจารณาก่อนว่าสถานการณ์ปลอดภัยจริง (ไม่มีศัตรูในฉาก ไม่ได้อยู่กลางอันตราย) ถ้าปลอดภัย: ให้ hp_change เท่ากับส่วนที่ HP ยังขาดจากเต็ม (ฟื้นเต็ม), ตั้ง rest_type="long" และเล่าว่าเวลาผ่านไปข้ามคืน ถ้าไม่ปลอดภัย: ปฏิเสธด้วยเหตุผลในเนื้อเรื่อง (เช่น ถูกขัดจังหวะ/มีเสียงแปลกๆ) แล้ว hp_change=0 และ rest_type="none"
ถ้าข้อความผู้เล่นคือ "ฉันขอพักสั้นประมาณ 1 ชั่วโมง (Short Rest)" ให้พิจารณาความปลอดภัยเช่นกัน ถ้าปลอดภัย: ขอทอยเต๋าฟื้นฟู mode="damage" เลือก die ตามความแข็งแกร่งของตัวละคร (d6-d8) แล้วใช้ผลทอยเป็น HP ที่ฟื้น (hp_change เป็นบวก) พร้อมตั้ง rest_type="short" ถ้าไม่ปลอดภัยให้ปฏิเสธเช่นกัน (hp_change=0, rest_type="none")
rest_type ใช้บอกระบบว่าพักสำเร็จจริงหรือไม่ (ระบบจะฟื้น Spell Slot ให้อัตโนมัติตาม rest_type: long=คืนเต็ม, short=คืนครึ่งหนึ่ง) ทุกรอบที่ไม่ใช่การพัก ให้ rest_type="none" เสมอ
ห้ามให้พักยาวได้พร่ำเพรื่อเกินไปถ้าเพิ่งพักไปหมาดๆ ให้เล่าเหตุผลตามความสมเหตุสมผลของเนื้อเรื่อง

=== กฎเลเวล/XP/Proficiency Bonus ===
ระบบหลังบ้านคำนวณเลเวลอัพ, Proficiency Bonus, และ HP สูงสุดที่เพิ่มตอนเลเวลอัพให้อัตโนมัติทั้งหมด (ดู "เลเวล/XP" ในสถานะปัจจุบัน) คุณมีหน้าที่แค่ให้รางวัล XP ผ่าน xp_change เท่านั้น ห้ามใช้ max_hp_change เพื่อจำลองการเลเวลอัพเองอีกต่อไป (max_hp_change เก็บไว้ใช้เฉพาะเหตุการณ์เนื้อเรื่องจริงๆ เช่น พรวิเศษถาวร/คำสาป ไม่ใช่การเติบโตของตัวละคร)
- ให้ xp_change เป็นค่าบวกเมื่อผู้เล่นทำสำเร็จสิ่งที่สมควรได้ประสบการณ์ เช่น กำจัดศัตรู (อ่อน 10-20, ปกติ 20-40, แข็ง 50-80, บอส 100-250), ทำภารกิจ/เป้าหมายย่อยสำเร็จ (30-100), ค้นพบสิ่งสำคัญ/แก้ปริศนา (10-30) ปรับตามความยากและเลเวลปัจจุบันของตัวละคร (เลเวลสูงควรได้ XP ต่อภารกิจมากขึ้นตามไปด้วย)
- รอบที่ไม่มีอะไรควรได้ XP (บทสนทนาทั่วไป, เดินสำรวจเฉยๆ) ให้ xp_change=0
- เมื่อเลเวลอัพ ระบบจะแจ้งผลใน event log ของตัวเอง ไม่ต้องพูดถึงตัวเลขกลไกในเนื้อเรื่อง แต่สามารถแต่งฉากเฉลิมฉลอง/บรรยายว่าตัวละครรู้สึกแข็งแกร่งขึ้นได้ถ้าดูจาก event log ว่ามีเลเวลอัพเกิดขึ้นในรอบนั้น

=== กฎ Spell Slot (เฉพาะนักเวทย์/นักบวช) ===
นักเวทย์และนักบวชมี Spell Slot จำนวนจำกัดตามเลเวล (ดูบรรทัด "Spell Slot" ในสถานะปัจจุบัน) ตัวละครอาชีพอื่น/กำหนดเองไม่มีกลไกนี้ (จะไม่มีบรรทัด Spell Slot แสดง = ร่ายเวทได้แบบเนื้อเรื่องอย่างเดียวไม่มีข้อจำกัด)
- คาถา/เวทที่ "มีผลกระทบจริงจังต่อเกม" (โจมตี, รักษา HP ปริมาณมาก, ผลพิเศษเปลี่ยนสถานการณ์) ให้หัก spell_slot_change=-1 ต่อครั้งที่ร่าย ส่วนคาถาเล็กๆ/cantrip ที่เป็นแค่ลูกเล่นเนื้อเรื่อง (จุดไฟเทียน, แสงสว่างเล็กน้อย) ไม่ต้องหัก slot (spell_slot_change=0)
- ก่อนอนุญาตให้ร่ายคาถาที่ต้องใช้ slot ให้เช็ค Spell Slot คงเหลือในสถานะปัจจุบันก่อนเสมอ (เหมือนกฎเรื่องทอง) ถ้าเหลือ 0 ห้ามให้คาถานั้นสำเร็จ ให้เล่าว่าพลังเวทมนตร์ของตัวละครหมดลง ต้องพักฟื้นก่อนถึงจะร่ายเวทหนักๆ ได้อีก และ spell_slot_change=0 ในรอบนั้น
- ห้ามตั้ง spell_slot_change ติดลบเกินยอดที่มีจริง
- Slot จะฟื้นคืนอัตโนมัติจากการพัก (ดูกฎการพักด้านบน) ไม่ต้องจัดการเอง

=== กฎ Conditions (สถานะเฉพาะแบบ DnD) ===
มี Condition ให้ใช้ได้ตามนี้เท่านั้น: poisoned (มึนพิษ), prone (ล้มคว่ำ), stunned (มึนงง), restrained (ถูกจับตรึง), frightened (หวาดกลัว), blinded (ตาบอดชั่วคราว), paralyzed (เป็นอัมพาต)
- Condition ไม่กระทบค่าสถานะ (STR/DEX/...) ของตัวละครโดยตรง เป็นแค่สถานะที่ติดตัวชั่วคราวแล้วมีผลต่อดุลยพินิจของคุณตอนตั้งค่าการทอยเต๋า
- เพิ่ม condition เมื่อเนื้อเรื่องสมเหตุสมผล (โดนพิษ/กับดัก/เวทศัตรู/ถูกสะดุดล้ม ฯลฯ) ผ่าน condition_changes: {name, action:"add"} เอาออกเมื่อหมดฤทธิ์/ถูกรักษา/สถานการณ์คลี่คลายผ่าน {name, action:"remove"} ถ้าไม่มีอะไรเปลี่ยนให้ condition_changes เป็น array ว่าง
- ดูบรรทัด "สถานะเฉพาะ (Conditions)" ในสถานะปัจจุบันเพื่อรู้ว่าตัวละครติดอะไรอยู่ตอนนี้ แล้วปรับ roll_request.advantage ตามกฎคร่าวๆ นี้: poisoned/restrained/blinded → มักให้ disadvantage ต่อการโจมตีหรือเช็กที่เกี่ยวข้อง, frightened → disadvantage ต่อการกระทำที่ต้องเข้าใกล้สิ่งที่กลัว, prone → disadvantage ต่อการโจมตีระยะไกล/เวท (แต่ advantage ให้ศัตรูประชิดตัวที่โจมตีตัวละคร), stunned/paralyzed → ตัวละครทำอะไรไม่ได้เลยในเทิร์นนั้น (ห้าม roll_request.required=true สำหรับการกระทำของผู้เล่น ให้บรรยายว่าขยับตัวไม่ได้แทน)
- ไม่มีระบบนับเวลาสถานะอัตโนมัติ ให้คุณเป็นคนตัดสินเองจากเนื้อเรื่องว่าเมื่อไหร่ควร remove

=== กฎอื่นๆ ===
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
                                ac: { type: "INTEGER", description: "Armor Class เมื่อศัตรูปรากฏตัวครั้งแรกเท่านั้น (อ่อน 10-11, ปกติ 12-14, แข็ง 15-17, บอส 18+) ศัตรูที่มีอยู่แล้วให้เป็น 0 (ไม่เปลี่ยน)" },
                                atk: { type: "INTEGER", description: "โบนัสโจมตีของศัตรูตอนปรากฏตัวครั้งแรกเท่านั้น (บวกกับ d20 ตอนโจมตีผู้เล่น) ศัตรูที่มีอยู่แล้วให้เป็น 0 (ไม่เปลี่ยน)" },
                                dmg_count: { type: "INTEGER", description: "จำนวนลูกเต๋าความเสียหายของศัตรูตอนปรากฏตัวครั้งแรกเท่านั้น (เช่น 2 สำหรับ 2d6) ศัตรูที่มีอยู่แล้วให้เป็น 0 (ไม่เปลี่ยน)" },
                                dmg_die: { type: "STRING", enum: VALID_DICE, description: "ชนิดลูกเต๋าความเสียหายของศัตรูตอนปรากฏตัวครั้งแรกเท่านั้น ศัตรูที่มีอยู่แล้วให้ใส่ค่าใดก็ได้ (ไม่ถูกใช้)" },
                                hp_change: { type: "INTEGER", description: "ลบ=เสีย HP, บวก=ฟื้นฟู, 0=ไม่เปลี่ยน" },
                                remove: { type: "BOOLEAN", description: "true เฉพาะเมื่อศัตรูหนี/ออกจากการต่อสู้โดยไม่ผ่าน HP" }
                            },
                            required: ["name", "max_hp", "ac", "atk", "dmg_count", "dmg_die", "hp_change", "remove"]
                        }
                    },
                    status: { type: "STRING", enum: VALID_STATUS },
                    xp_change: { type: "INTEGER", description: "XP ที่ได้รับเพิ่มในรอบนี้ (0 ถ้าไม่มีอะไรควรได้ XP) ระบบคำนวณเลเวลอัพ/Proficiency Bonus/HP สูงสุดเองจากค่านี้" },
                    spell_slot_change: { type: "INTEGER", description: "การเปลี่ยนแปลง Spell Slot (เฉพาะนักเวทย์/นักบวช) ลบ=ใช้ร่ายเวท, 0=ไม่ใช้ ห้ามติดลบเกินยอดที่มี ตัวละครที่ไม่มี Spell Slot ให้เป็น 0 เสมอ" },
                    rest_type: { type: "STRING", enum: VALID_REST_TYPES, description: "none=ไม่ได้พัก, short=พักสั้นสำเร็จ, long=พักยาวสำเร็จ ใช้ให้ระบบฟื้น Spell Slot ตามกฎการพัก" },
                    condition_changes: {
                        type: "ARRAY",
                        description: "การเพิ่ม/ลบ Condition ของผู้เล่น ถ้าไม่มีให้เป็น array ว่าง",
                        items: {
                            type: "OBJECT",
                            properties: {
                                name: { type: "STRING", enum: VALID_CONDITIONS },
                                action: { type: "STRING", enum: ["add", "remove"] }
                            },
                            required: ["name", "action"]
                        }
                    },
                    roll_request: {
                        type: "OBJECT",
                        description: "ถ้าสถานการณ์ต้องการให้ผู้เล่นทอยเต๋าเพื่อตัดสินผล หรือถึงจังหวะศัตรูโจมตีกลับ ให้ required=true พร้อมรายละเอียด ถ้าไม่ต้องทอยให้ required=false (ทุกฟิลด์ที่เหลือใส่ค่าว่าง/0/none ได้ตามปกติ)",
                        properties: {
                            required: { type: "BOOLEAN" },
                            mode: { type: "STRING", enum: VALID_ROLL_MODES, description: "check=เช็กเทียบ DC, attack=โจมตีเทียบ AC ของเป้าหมาย, damage=ทอยความเสียหาย/การรักษา, event=เหตุการณ์สุ่ม d100, enemy_attack=ศัตรูโจมตีผู้เล่น (ระบบทอยเต๋าเองอัตโนมัติ)" },
                            die: { type: "STRING", enum: VALID_DICE },
                            dice_count: { type: "INTEGER", description: "จำนวนลูกเต๋าที่ทอย ใช้กับ mode=damage เท่านั้น (ปกติ 1 ลูก, คริติคอลให้เป็น 2) โหมดอื่นให้เป็น 1" },
                            reason: { type: "STRING", description: "เหตุผลสั้นๆว่าทอยเพื่ออะไร (ค่าว่างถ้า required=false)" },
                            stat: { type: "STRING", enum: VALID_STATS, description: "ค่าสถานะของผู้เล่นที่ใช้บวกโบนัส (เฉพาะ d20) ถ้าไม่เกี่ยวข้องให้เป็น none" },
                            advantage: { type: "STRING", enum: VALID_ADVANTAGE, description: "ใช้ได้เฉพาะ mode=check หรือ attack ปกติให้เป็น normal" },
                            dc: { type: "INTEGER", description: "ใช้กับ mode=check เท่านั้น ระดับความยากที่ต้องทอยให้ถึง ถ้าไม่ใช้ให้เป็น 0" },
                            opponent_name: { type: "STRING", description: "mode=attack: ชื่อเป้าหมายที่ถูกโจมตี | mode=enemy_attack: ชื่อศัตรูที่กำลังโจมตีผู้เล่น (ต้องตรงกับชื่อใน enemy_changes/สถานะปัจจุบัน) โหมดอื่นให้เป็นข้อความว่าง" },
                            target_ac: { type: "INTEGER", description: "ใช้กับ mode=attack เท่านั้น ค่า AC ของเป้าหมาย ถ้าไม่ใช่ mode=attack ให้เป็น 0" }
                        },
                        required: ["required", "mode", "die", "dice_count", "reason", "stat", "advantage", "dc", "opponent_name", "target_ac"]
                    }
                },
                required: ["narrative", "hp_change", "gold_change", "add_items", "remove_items", "enemy_changes", "status", "xp_change", "spell_slot_change", "rest_type", "condition_changes", "roll_request"]
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
        // ป้องกันชั้นสอง: ห้ามหัก Spell Slot เกินยอดที่มีจริง (เหมือนกฎทอง) ตัวละครที่ไม่มี Spell Slot ห้ามได้รับผลกระทบเลย
        const currentSlots = character?.spellSlots && Number.isFinite(Number(character.spellSlots.current)) ? Number(character.spellSlots.current) : null;
        if (currentSlots === null) {
            if (parsed.spell_slot_change !== 0) {
                console.warn(`[chat] spell_slot_change=${parsed.spell_slot_change} แต่ ${character?.name || "-"} ไม่มี Spell Slot → ตัดทิ้ง`);
                parsed.spell_slot_change = 0;
            }
        } else if (parsed.spell_slot_change < -currentSlots) {
            console.warn(`[chat] spell_slot_change ${parsed.spell_slot_change} เกินยอด Spell Slot จริง ${currentSlots} → จำกัดไว้ที่ -${currentSlots}`);
            parsed.spell_slot_change = -currentSlots;
        }
        // ป้องกันชั้นสอง: ผู้เล่น HP=0 (โหมด Death Saving Throw) เป็นเรื่องที่ระบบ client จัดการเองทั้งหมด
        // ถ้า GM หลุดกฎแล้วยังขอทอยเต๋ามา ให้ตัดทิ้งเพื่อไม่ให้ขัดกับ UI ฝั่ง client
        if (Number(character?.hp) <= 0 && parsed.roll_request.required) {
            console.warn(`[chat] GM ขอ roll_request ทั้งที่ผู้เล่น HP=0 → ตัดทิ้ง (เป็นช่วง Death Saving Throw)`);
            parsed.roll_request = { required: false, mode: "check", die: "d20", dice_count: 1, reason: "", stat: "none", advantage: "normal", dc: 0, opponent_name: "", target_ac: 0 };
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
            ac: Math.max(0, Math.min(30, int(x.ac))),
            atk: Math.max(0, Math.min(20, int(x.atk))),
            dmg_count: Math.max(0, Math.min(4, int(x.dmg_count))),
            dmg_die: VALID_DICE.includes(x.dmg_die) ? x.dmg_die : "d6",
            hp_change: Math.max(-999, Math.min(999, int(x.hp_change))),
            remove: x.remove === true
        };
    }).filter(Boolean);

    const conditionChanges = (Array.isArray(p.condition_changes) ? p.condition_changes : []).map(x => {
        if (!x || !VALID_CONDITIONS.includes(x.name)) return null;
        return { name: x.name, action: x.action === "remove" ? "remove" : "add" };
    }).filter(Boolean);

    const rr = p.roll_request && typeof p.roll_request === "object" ? p.roll_request : {};
    const needRoll = rr.required === true;
    const mode = VALID_ROLL_MODES.includes(rr.mode) ? rr.mode : "check";
    const isAttack = needRoll && mode === "attack";
    const isCheck = needRoll && mode === "check";
    const isDamage = needRoll && mode === "damage";
    const isEnemyAttack = needRoll && mode === "enemy_attack";
    const die = (isAttack || isCheck) ? "d20" : (VALID_DICE.includes(rr.die) ? rr.die : (needRoll ? "d20" : "d20"));
    const stat = (die === "d20" && VALID_STATS.includes(rr.stat)) ? rr.stat : "none";
    const advantage = (die === "d20" && (isAttack || isCheck) && VALID_ADVANTAGE.includes(rr.advantage)) ? rr.advantage : "normal";
    const diceCount = isDamage ? Math.max(1, Math.min(4, int(rr.dice_count) || 1)) : 1;
    const oppName = (isAttack || isEnemyAttack) && typeof rr.opponent_name === "string" ? rr.opponent_name.trim().slice(0, 40) : "";
    const targetAc = isAttack ? Math.max(1, Math.min(30, int(rr.target_ac) || 10)) : 0;
    const dcValue = isCheck ? Math.max(1, Math.min(30, int(rr.dc) || 10)) : 0;

    return {
        narrative: p.narrative.trim(),
        hp_change: int(p.hp_change),
        max_hp_change: int(p.max_hp_change),
        gold_change: int(p.gold_change),
        add_items: items(p.add_items),
        remove_items: items(p.remove_items),
        enemy_changes: enemyChanges,
        status: VALID_STATUS.includes(p.status) ? p.status : "ปกติ",
        xp_change: Math.max(0, Math.min(500, int(p.xp_change))),
        spell_slot_change: Math.max(-10, Math.min(10, int(p.spell_slot_change))),
        rest_type: VALID_REST_TYPES.includes(p.rest_type) ? p.rest_type : "none",
        condition_changes: conditionChanges,
        roll_request: {
            required: needRoll,
            mode: needRoll ? mode : "check",
            die,
            dice_count: diceCount,
            reason: needRoll ? String(rr.reason || "").slice(0, 200) : "",
            stat: needRoll ? stat : "none",
            advantage,
            dc: dcValue,
            opponent_name: oppName,
            target_ac: targetAc
        }
    };
}

// สูตรเดียวกับฝั่ง client: AC = 10 + floor((DEX-10)/2)
function calcAC(dex) {
    const v = Number(dex);
    return Number.isFinite(v) ? 10 + Math.floor((v - 10) / 2) : 10;
}

const CONDITION_LABELS = {
    poisoned: "มึนพิษ", prone: "ล้มคว่ำ", stunned: "มึนงง", restrained: "ถูกจับตรึง",
    frightened: "หวาดกลัว", blinded: "ตาบอดชั่วคราว", paralyzed: "เป็นอัมพาต"
};

function buildCharacterSheetText(c, enemies) {
    const isDying = Number(c.hp) <= 0;
    const level = Number.isFinite(Number(c.level)) ? Number(c.level) : 1;
    const xp = Number.isFinite(Number(c.xp)) ? Number(c.xp) : 0;
    const profBonus = Number.isFinite(Number(c.profBonus)) ? Number(c.profBonus) : 2;
    const lines = [
        `ชื่อ: ${c.name || "-"}`,
        `อาชีพ: ${c.className || "-"}${c.classDesc ? ` (${c.classDesc})` : ""}`,
        `ประวัติ/บุคลิก: ${c.backstory ? c.backstory : "ไม่มีข้อมูลเพิ่มเติม"}`,
        `สถานะ: STR ${c.stats?.str}, DEX ${c.stats?.dex}, INT ${c.stats?.int}, CON ${c.stats?.con}, WIS ${c.stats?.wis}, CHA ${c.stats?.cha}`,
        `AC (Armor Class): ${calcAC(c.stats?.dex)}`,
        `HP: ${c.hp}/${c.maxHp}${isDying ? " (⚠️ HP=0 — กำลังอยู่ในโหมด Death Saving Throw ห้ามขอ roll_request)" : ""}`,
        `เลเวล/XP: เลเวล ${level}, XP ${xp} (Proficiency Bonus +${profBonus}) — ระบบคำนวณเลเวลอัพเองจาก xp_change ที่คุณให้`,
        `ทอง: ${c.gold}`,
        `กระเป๋า: ${(c.inventory && c.inventory.length) ? c.inventory.join(", ") : "ไม่มีไอเทม"}`
    ];
    if (c.spellSlots && typeof c.spellSlots === "object") {
        lines.push(`Spell Slot: ${Number(c.spellSlots.current) || 0}/${Number(c.spellSlots.max) || 0}`);
    }
    const conditions = Array.isArray(c.conditions) ? c.conditions.filter(x => CONDITION_LABELS[x]) : [];
    lines.push(`สถานะเฉพาะ (Conditions): ${conditions.length ? conditions.map(x => `${x} (${CONDITION_LABELS[x]})`).join(", ") : "ไม่มี"}`);
    if (c.status && typeof c.status === "string") {
        lines.push(`สถานะร่างกายล่าสุด: ${c.status.slice(0, 20)}`);
    }
    const list = (Array.isArray(enemies) ? enemies : [])
        .filter(e => e && typeof e.name === "string" && Number.isFinite(Number(e.hp)) && Number.isFinite(Number(e.maxHp)))
        .slice(0, 10);
    lines.push(`ศัตรูในฉากตอนนี้: ${list.length ? list.map(e => `${String(e.name).slice(0, 40)} HP ${Number(e.hp)}/${Number(e.maxHp)} AC ${Number(e.ac) || "?"} ATK ${signedNum(Number(e.atk) || 0)} DMG ${Number(e.dmgCount) || 1}${e.dmgDie || "d6"}`).join(", ") : "ไม่มี"}`);
    return lines.join("\n");
}

function signedNum(n) { return n >= 0 ? `+${n}` : `${n}`; }
