// ============ /api/summarize ============
// รับ "ก้อน" ข้อความเก่า (chunk) + สรุปเดิมที่มีอยู่แล้ว (previous_summary) แล้วให้ Gemini
// รวมทั้งสองอย่างเป็นสรุปฉบับล่าสุดฉบับเดียว (ไม่ใช่แค่สรุปส่วนที่เพิ่ม) เพื่อให้ฝั่ง client
// เก็บสรุปนี้ไว้แนบไปกับทุก request ของ /api/chat เป็น "ความทรงจำระยะยาว" แทน history เดิมที่ถูกตัดทิ้ง
//
// เหตุผลที่แยกเป็น endpoint ต่างหาก (ไม่ทำใน chat.js): งานสรุปไม่จำเป็นต้องรอ/บล็อกการเล่นเกม
// ฝั่ง client เรียกแบบ fire-and-forget เบื้องหลังได้ และถ้าล้มเหลวก็แค่ลองใหม่รอบถัดไปโดยไม่กระทบเนื้อเรื่อง

import { runWithFallback, DEBUG_META, summarizeAttempts } from './_lib/gemini.js';

const MAX_CHUNK_MESSAGES = 40; // กันไว้เผื่อ client ส่งมาเกินขนาดที่ควรจะเป็น
const MAX_SUMMARY_CHARS = 4000; // กันสรุปบวมขึ้นเรื่อยๆ ไม่มีที่สิ้นสุดถ้าเล่นยาวมากๆ

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'System Error: ไม่พบ API Key ในระบบหลังบ้าน (ตรวจสอบ Environment Variables บน Vercel)' });
    }

    const { chunk, previous_summary, character } = req.body || {};

    if (!Array.isArray(chunk) || chunk.length === 0) {
        return res.status(400).json({ error: 'ไม่พบข้อมูล chunk ที่ต้องการสรุป' });
    }

    const trimmedChunk = chunk.slice(0, MAX_CHUNK_MESSAGES);
    const prevSummary = typeof previous_summary === "string" ? previous_summary.trim().slice(0, MAX_SUMMARY_CHARS) : "";

    // แปลง history entries ({role, parts:[{text}]}) เป็น transcript อ่านง่ายให้โมเดลสรุป
    const transcript = trimmedChunk.map(entry => {
        const text = entry?.parts?.[0]?.text || "";
        if (!text || text === "[เริ่มเกม]") return null;
        const speaker = entry.role === "user" ? "ผู้เล่น" : "GM";
        return `${speaker}: ${text}`;
    }).filter(Boolean).join("\n");

    // ไม่มีอะไรให้สรุปจริงๆ (เช่น chunk มีแค่ [เริ่มเกม]) → คืนสรุปเดิมกลับไปเฉยๆ ไม่ต้องยิง Gemini
    if (!transcript.trim()) {
        return res.status(200).json({ summary: prevSummary });
    }

    const charName = (character && typeof character.name === "string" && character.name.trim()) || "ผู้เล่น";

    const systemPrompt = `คุณคือผู้ช่วยสรุปเนื้อเรื่องของเกม MMORPG แนวแฟนตาซีสไตล์ DnD ที่ตัวเอกชื่อ "${charName}"
หน้าที่ของคุณคือย่อบทสนทนาส่วนเก่าให้เหลือเฉพาะข้อมูลที่สำคัญต่อการดำเนินเรื่องต่อในอนาคต เพื่อประหยัดพื้นที่ความจำ โดยไม่ทำให้รายละเอียดสำคัญของเนื้อเรื่องหายไป
${prevSummary ? `
นี่คือสรุปเหตุการณ์ก่อนหน้านี้ที่มีอยู่แล้ว (ให้รวมเข้ากับเหตุการณ์ใหม่ด้านล่างเป็นสรุปฉบับเดียว ไม่ใช่เขียนแยกกันหรือต่อท้ายดื้อๆ):
${prevSummary}
` : ""}
นี่คือบทสนทนาช่วงถัดมาที่ต้องเอามาสรุปเพิ่ม:
${transcript}

กฎการสรุป:
- เขียนเป็นภาษาไทย ความยาวไม่เกินประมาณ 8-10 ประโยค ให้กระชับที่สุดเท่าที่จะรักษาข้อมูลสำคัญไว้ได้
- เก็บเฉพาะข้อมูลที่มีผลต่อเนื้อเรื่องในอนาคต เช่น NPC ที่เคยเจอ (ชื่อ/ความสัมพันธ์/ท่าทีต่อผู้เล่น), สถานที่สำคัญที่เคยไป, ภารกิจหรือคำสัญญาที่ยังค้างอยู่, จุดพลิกเนื้อเรื่องสำคัญ, ศัตรู/กลุ่มที่เป็นปฏิปักษ์กับผู้เล่น
- ห้ามใส่รายละเอียดกลไกเกม เช่น เลข HP/ทอง/ไอเทม/ผลทอยเต๋า เพราะระบบมีข้อมูลสถานะปัจจุบันแยกไว้แม่นยำอยู่แล้ว สนใจแค่ "เรื่องราว" ไม่ใช่ "ตัวเลข"
- เขียนเป็นสรุปความเดียวต่อเนื่องกัน ไม่ต้องแบ่งหัวข้อ ไม่ต้องใช้ markdown หรือ bullet
- ผลลัพธ์ที่ส่งกลับคือสรุปฉบับล่าสุดที่รวมเหตุการณ์เก่ากับใหม่เข้าด้วยกันแล้วทั้งหมด ไม่ใช่แค่ส่วนที่เพิ่มเข้ามาใหม่
- ถ้าเนื้อเรื่องช่วงนี้ไม่มีอะไรสำคัญเพิ่มเติมเลย ให้คงสรุปเดิมไว้เกือบเดิม ไม่ต้องยืดเยื้อเพิ่มโดยไม่จำเป็น`;

    const payload = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: "กรุณาสรุปตามกฎด้านบน ส่งกลับเป็น JSON ตาม schema เท่านั้น" }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    summary: { type: "STRING", description: "สรุปเหตุการณ์ทั้งหมดล่าสุด (รวมของเก่ากับของใหม่แล้ว) เป็นภาษาไทย ไม่เกิน 8-10 ประโยค" }
                },
                required: ["summary"]
            }
        }
    };

    function validateSummaryResponse(parsedJson) {
        if (!parsedJson || typeof parsedJson.summary !== "string" || !parsedJson.summary.trim()) {
            return { ok: false, reason: "ไม่มี summary" };
        }
        return { ok: true, parsed: { summary: parsedJson.summary.trim().slice(0, MAX_SUMMARY_CHARS) } };
    }

    const result = await runWithFallback(payload, apiKey, validateSummaryResponse);

    if (result.ok) {
        console.log(`[summarize] สำเร็จด้วย ${result.model} (${trimmedChunk.length} ข้อความ) | ${summarizeAttempts(result.attempts)}`);
        const out = { summary: result.parsed.summary };
        if (DEBUG_META) {
            out._model = result.model;
            out._attempts = result.attempts;
        }
        return res.status(200).json(out);
    }

    // ล้มเหลว: คืนสรุปเดิมกลับไปเฉยๆ พร้อม _failed=true (ไม่ตอบ error/503) เพื่อไม่ให้กระทบเกมหลัก
    // ฝั่ง client จะเห็น _failed แล้วไม่เลื่อน summarizedCount ไป จะได้ลอง chunk เดิมใหม่ในรอบถัดไปแทน
    const attemptsSummary = summarizeAttempts(result.attempts);
    console.error(`[summarize] ทุกรุ่นล้มเหลว | ${attemptsSummary}`);
    return res.status(200).json({
        summary: prevSummary,
        _failed: true,
        _reason: result.fatalMessage || attemptsSummary
    });
}
