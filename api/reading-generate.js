// /api/reading-generate.js
export const config = { runtime: 'nodejs' };

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const API_KEY = process.env.OPENAI_API_KEY;

function parseBody(req) {
  try {
    if (req.body && typeof req.body === 'object') return req.body;
    const txt = req.body || '';
    return txt ? JSON.parse(txt) : {};
  } catch {
    return {};
  }
}

function tryParseJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  // ```json ... ``` 감싼 경우
  const m = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (m) {
    try { return JSON.parse(m[1]); } catch {}
  }
  return null;
}

async function callOpenAI(messages, json = true) {
  if (!API_KEY) {
    return { error: 'Missing OPENAI_API_KEY' };
  }
  const payload = {
    model: MODEL,
    temperature: 0.7,
    messages,
    ...(json ? { response_format: { type: 'json_object' } } : {})
  };

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const txt = await r.text();
  if (!r.ok) return { error: `OpenAI ${r.status}`, raw: txt };

  let content = '';
  try { content = JSON.parse(txt).choices[0].message.content; }
  catch { content = txt; }

  return { content, raw: txt };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' }); return;
  }

  const { pillars, elements, tenGods, interactions, locale = 'en-US', length = 'long', maxBullets = 6 } = parseBody(req);

  // 안전 가드
  if (!pillars || !elements) {
    res.status(400).json({ ok: false, error: 'Missing pillars/elements' }); return;
  }

  const sys = `
You are "Mellow Guide", a warm, practical Saju/Bazi explainer for non‑experts.
Write natural, readable English. Use short paragraphs, gentle headers with an emoji only when helpful.
Avoid bold **markdown** and jargon. If a technical term appears, translate to everyday English.
Tone: encouraging, specific, non‑generic. Keep it human and useful.

You MUST return JSON with:
{
  "output": {
    "title": string,
    "bullets": string[],
    "forecastOneLiner": string,
    "sections": [
      {"key":"core","title":"Core Traits & Disposition","body": string},
      {"key":"balance","title":"Element Balance","body": string},
      {"key":"ten_gods","title":"The Influence of Ten Gods","body": string},
      {"key":"luck","title":"Your Luck Cycle","body": string},
      {"key":"wellness","title":"Wellness Suggestions","body": string},
      {"key":"summary","title":"Summary of Insights","body": string}
    ],
    "cards": { "badge"?: string }
  }
}
All bodies must be >= 4 sentences each, tailored to the given chart.
  `.trim();

  const user = {
    role: 'user',
    content:
      `Locale: ${locale}\nLength: ${length}\nMax bullets: ${maxBullets}\n\n` +
      `FOUR PILLARS:\n${JSON.stringify(pillars)}\n\n` +
      `ELEMENTS(wood,fire,earth,metal,water):\n${JSON.stringify(elements)}\n\n` +
      `TEN GODS (if any):\n${JSON.stringify(tenGods || {})}\n\n` +
      `INTERACTIONS (if any):\n${JSON.stringify(interactions || {})}\n\n` +
      `Write the JSON exactly as specified.`
  };

  try {
    const ai = await callOpenAI([{ role: 'system', content: sys }, user], true);
    if (ai.error) { res.status(200).json({ ok:false, error: ai.error, raw: ai.raw || null }); return; }

    const parsed = tryParseJSON(ai.content);
    if (!parsed?.output) {
      // JSON 모드 실패 → 텍스트라도 래핑해서 보냄(프론트는 항상 JSON 수신)
      res.status(200).json({
        ok: true,
        fallback: true,
        output: {
          title: 'Your Saju Reading',
          bullets: [],
          forecastOneLiner: '',
          sections: [],
          cards: {}
        },
        raw: ai.content
      });
      return;
    }

    // 섹션 6개 강제 보정(누락되면 빈 섹션이라도 채움)
    const want = [
      ['core','Core Traits & Disposition'],
      ['balance','Element Balance'],
      ['ten_gods','The Influence of Ten Gods'],
      ['luck','Your Luck Cycle'],
      ['wellness','Wellness Suggestions'],
      ['summary','Summary of Insights'],
    ];
    const haveKeys = new Set((parsed.output.sections||[]).map(s=>s.key));
    parsed.output.sections = parsed.output.sections || [];
    for (const [k,t] of want) {
      if (!haveKeys.has(k)) parsed.output.sections.push({ key: k, title: t, body: '' });
    }

    res.status(200).json({ ok:true, output: parsed.output, mocked:false, fallback:false });
  } catch (e) {
    res.status(200).json({ ok:false, error: String(e?.message||e) });
  }
}
