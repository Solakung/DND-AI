export default async function handler(req, res) {
    // ป้องกันคนยิง Request ผิดประเภท
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // ดึง API Key จากระบบหลังบ้าน Vercel
    const apiKey = process.env.GEMINI_API_KEY; 

    if (!apiKey) {
        return res.status(500).json({ error: 'System Error: ไม่พบ API Key ในระบบหลังบ้าน' });
    }

    const { history } = req.body;
    
    // ตั้งค่าบุคลิก GM
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

        // เช็คว่ายิง API ถี่เกินไปไหม
        if (googleResponse.status === 429) {
            return res.status(429).json({ error: 'Rate Limit Exceeded' });
        }

        const data = await googleResponse.json();

        if (data.candidates && data.candidates.length > 0) {
            const reply = data.candidates[0].content.parts[0].text;
            res.status(200).json({ reply });
        } else {
            res.status(500).json({ error: 'Invalid response from Google API' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}