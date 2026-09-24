// ========================= ค่าคงที่ร่วม (fallback หลายโมเดล / retry) =========================
// แยกออกมาจาก chat.js เดิม เพื่อให้ summarize.js เรียกใช้ logic เดียวกันได้ ไม่ต้องก็อปวาง

export const MODELS = (process.env.GEMINI_MODELS || "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3-flash,gemini-2.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite")
    .split(",").map(s => s.trim()).filter(Boolean);

export const TRIES_PER_MODEL = Number(process.env.TRIES_PER_MODEL) || 2;          // ลองซ้ำรุ่นเดิมกี่ครั้งเมื่อเป็นปัญหาชั่วคราว
export const PER_TRY_TIMEOUT_MS = Number(process.env.PER_TRY_TIMEOUT_MS) || 20000; // เวลารอสูงสุดต่อ 1 ครั้ง
export const TIME_BUDGET_MS = Number(process.env.TIME_BUDGET_MS) || 45000;         // เวลารวมสูงสุดก่อนยอมแพ้ (ต้องน้อยกว่า maxDuration ของ Vercel)
export const DEBUG_META = process.env.DEBUG_META === "1";                          // ถ้า "1" จะแนบ _model / _attempts กลับไปใน response

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function summarizeAttempts(attempts) {
    return attempts.map(a => `${a.model}#${a.attempt}:${a.result}`).join(" → ");
}

// เรียก Gemini 1 รุ่น 1 ครั้ง แล้วจัดประเภทผลลัพธ์ให้ runWithFallback ตัดสินใจต่อ
// validate(parsedJson) ต้อง return { ok, parsed?, reason? } — แต่ละ endpoint (chat / summarize) ตรวจรูปแบบคำตอบของตัวเองได้ต่างกัน
export async function tryModel(model, payload, apiKey, validate) {
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

    let parsedJson;
    try {
        parsedJson = JSON.parse(rawText);
    } catch {
        return { ok: false, status: 200, retrySame: true, reason: "JSON ไม่ถูกต้อง" };
    }

    const result = validate(parsedJson);
    if (!result.ok) {
        return { ok: false, status: 200, retrySame: true, reason: result.reason || "รูปแบบคำตอบไม่ถูกต้อง" };
    }
    return { ok: true, status: 200, parsed: result.parsed };
}

// วนลองทีละรุ่นจนกว่าจะสำเร็จ หรือหมดตัวเลือก/เวลา
// validate(parsedJson) -> { ok, parsed?, reason? }
export async function runWithFallback(payload, apiKey, validate) {
    const attempts = [];
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
            const outcome = await tryModel(model, payload, apiKey, validate);
            const ms = Date.now() - t0;
            attempts.push({ model, attempt, status: outcome.status, result: outcome.ok ? "ok" : outcome.reason, ms });

            if (outcome.ok) {
                return { ok: true, model, attempts, parsed: outcome.parsed };
            }

            if (outcome.fatal) {          // เช่น API key ผิด ลองรุ่นอื่นก็ไม่ช่วย
                fatalMessage = outcome.reason;
                break outer;
            }
            if (!outcome.retrySame) break; // ข้ามไปรุ่นถัดไปทันที
            await sleep(600 * attempt);    // รอสักครู่แล้วลองรุ่นเดิมอีกรอบ
        }
    }

    return { ok: false, attempts, fatalMessage };
}
