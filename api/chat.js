export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY; 

    if (!apiKey) {
        return res.status(500).json({ error: 'System Error: ไม่พบ API Key ในระบบหลังบ้าน' });
    }

    const { history } = req.body;
    
    const systemPrompt = "คุณคือ Game Master ของเกม MMORPG แนวแฟนตาซี บรรยายเนื้อเรื่องให้กระชับ สนุก โต้ตอบกับการกระทำหรือผลการทอยเต๋าของผู้เล่น ทำตัวเหมือน Log ในเกม MMO โดยตอบกลับเป็นภาษาไทย";

    const payload = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: history
    };

    try {
        const googleResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await googleResponse.json();

        // 1. ดักจับ Error จากฝั่ง Google โดยตรง
        if (!googleResponse.ok || data.error) {
            const realError = data.error?.message || JSON.stringify(data);
            return res.status(500).json({ error: `Google Reject: ${realError}` });
        }

        // 2. เช็คว่ามีเนื้อความส่งกลับมาปกติหรือไม่
        if (data.candidates && data.candidates.length > 0) {
            const reply = data.candidates[0].content.parts[0].text;
            res.status(200).json({ reply });
        } else {
            // 3. กรณีโดน Google เซ็นเซอร์เนื้อหา (Safety Filter)
            res.status(500).json({ error: `Safety Filter บล็อกข้อความ: ${JSON.stringify(data)}` });
        }
    } catch (error) {
        res.status(500).json({ error: `System Crash: ${error.message}` });
    }
}
