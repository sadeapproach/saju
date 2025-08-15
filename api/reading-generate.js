// api/reading-generate.js
// Long-form Saju reading with clear sections for English audiences.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Use POST' });

  const {
    pillars,
    elements,
    tenGods,
    interactions,
    luck,
    type = 'summary',
    locale = 'en-US',
    length = 'long',        // 'short' | 'medium' | 'long'
    maxBullets = 6
  } = req.body || {};

  if (!pillars || !elements) {
    return res.status(400).json({ ok:false, error:'Missing pillars/elements' });
  }

  // --- System guardrails: friendly, actionable, safe for general audiences
  const system = `
You are a Saju (Four Pillars) interpreter for an English-speaking audience.
Write in warm, encouraging, and modern American-English.
Be practical and suggest small, doable next steps. Avoid fatalism and guarantees.
Never give medical/legal/financial advice; use general wellbeing language.
Output valid JSON only, using the schema provided.
`;

  // --- Output schema: rich sections (backward compatible with the old UI)
  const schema = `{
  "title": string,                     // concise headline
  "bullets": string[],                 // ${Math.min(5, maxBullets)}-${maxBullets} key points (short, concrete)
  "forecastOneLiner": string,          // 1-2 sentences, uplifting & realistic
  "actions": string[],                 // 3-5 specific suggestions a person can try within a week

  // Optional long-form sections (if present, the UI will render them nicely)
  "sections": {
    "overview"?: string,               // personality & core tendencies (Day Master)
    "elements"?: string,               // five-element balance + gentle lifestyle ideas
    "careerMoney"?: string,            // work, growth themes; money mindset (no financial advice)
    "relationships"?: string,          // how to connect better with others
    "healthLifestyle"?: string,        // general wellbeing & routines (non-medical)
    "timing"?: string,                 // big-luck/near-term timing themes (no predictions)
    "closing"?: string                 // short, hopeful wrap-up
  },

  // Optional badges for the card footer
  "cards"?: {
    "badge"?: string,
    "share"?: { "headline": string, "sub"?: string }
  }
}`;

  // --- Extra guidance to steer length and content
  const lengthGuide =
    length === 'long'
      ? `Write ${Math.min(5, maxBullets)}-${maxBullets} bullets, 3-5 actions,
and 5-7 concise paragraphs across sections. Keep each paragraph 2-4 sentences.`
      : length === 'medium'
      ? `Write 4-5 bullets, 2-3 actions, and 3-4 concise paragraphs.`
      : `Write 3 bullets, 2 actions, and 1-2 short paragraphs.`;

  const hints = `
MAPPING HINTS (soft, not deterministic):
- Day Master (일간) informs core temperament; reference it briefly in "overview".
- Element balance: high values ~ strengths; very low values ~ areas to support with environment, hobbies, colors, routines.
- Ten Gods: 財/官 → responsibility/resources themes; 印 → learning/care; 食/傷 → creativity/output; 比/劫 → peers/self-drive.
- Interactions (合/冲/刑/破/害) can be framed as relationship or pacing tips.
- Big Luck: talk about the "flavor" of the current cycle; avoid fortune-telling.
- Tone: practical + kind; focus on what is in the user's control.
`;

  const data = {
    pillars, elements, tenGods, interactions, luck,
    type, locale, length, maxBullets
  };

  const user = `
SCHEMA:
${schema}

DATA (JSON):
${JSON.stringify(data)}

TASK:
- ${lengthGuide}
- Write for a general English-speaking audience; avoid jargon or explain it in plain words.
- Do not output anything except one valid JSON object following the schema.
`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${OPENAI_API_KEY}\`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',      // 사용 모델
        temperature: 0.35,         // 따뜻하지만 일관되게
        max_tokens: 1100,          // 충분한 길이
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: hints },
          { role: 'user', content: user }
        ]
      })
    });

    const j = await r.json();
    const content = j.choices?.[0]?.message?.content;
    let output = null;
    try { output = JSON.parse(content); } catch(e){}

    if (!output) {
      return res.status(502).json({ ok:false, error:'parse_failed', raw:j });
    }

    return res.status(200).json({ ok:true, output });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e) });
  }
}
