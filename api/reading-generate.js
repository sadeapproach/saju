// api/reading-generate.js
// 입력: { pillars, elements, type?, locale? }
// 출력: { ok:true, output:{ title, bullets[3], forecastOneLiner, actions[1], cards{...} } }
// 특징: CORS/OPTIONS 처리, OpenAI 호출, JSON만 안전 추출, 폴백 제공

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // 필요 시 특정 도메인으로 제한
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// 모델이 설명/코드블록을 섞어 보내도 첫 JSON만 뽑아내기
function extractFirstJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```[\s\S]*?```/g, s => s.replace(/```/g, ''));
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

module.exports = async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok:false, error:'Use POST' });
  }

  const { pillars, elements, type = 'summary', locale = 'en-US' } = req.body || {};
  if (!pillars || !elements) {
    return res.status(400).json({ ok:false, error:'Missing pillars/elements' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ ok:false, error:'OPENAI_API_KEY not set' });
  }

  // 톤/금지 규칙 + 출력 스키마
  const systemPrompt = `
You are a Four Pillars (Saju) analyst for English speakers.
- Be concise, supportive, culturally neutral (about 8th-grade reading).
- Avoid fatalistic claims and medical/legal/financial advice.
Return ONLY valid JSON in exactly:
{
  "title": string,
  "bullets": [string, string, string],
  "forecastOneLiner": string,
  "actions": [string],
  "cards": { "badge": string, "share": { "headline": string, "sub": string } }
}
`;

  const userPrompt = `
Locale: ${locale}
Type: ${type}
Pillars: ${JSON.stringify(pillars)}
Elements: ${JSON.stringify(elements)}
Rules:
- "bullets" each ≤ 14 words
- "forecastOneLiner" ≤ 18 words
- "actions"[0] imperative, ≤ 12 words
- Use "may", "tend to", "consider" (no guarantees)
`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ ok:false, error:'openai_error', detail:data });
    }

    const raw = data?.choices?.[0]?.message?.content || '';
    const parsed = extractFirstJSON(raw);

    if (!parsed || !parsed.title || !Array.isArray(parsed.bullets)) {
      // 파싱이 애매하면 안전 폴백 제공
      return res.status(200).json({
        ok: true,
        fallback: true,
        output: {
          title: "Grounded drive with warm creativity",
          bullets: [
            "You value steady progress and clear commitments.",
            "Collaboration sparks your best ideas.",
            "Guard energy when tasks pile up."
          ],
          forecastOneLiner: "Today favors consistent steps over bold leaps.",
          actions: ["Finish one overdue task now."],
          cards: { badge: "Balanced • Wood‑Fire tilt", share: { headline: "Your Element Map", sub: "Wood rising • Fire steady" } }
        },
        raw
      });
    }

    return res.status(200).json({ ok:true, output: parsed, raw });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'reading_failed', message:e?.message });
  }
};
