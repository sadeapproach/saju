// api/reading-generate.js
// Long-form Saju reading with robust fallback & clearer errors (CommonJS).

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM = `
You are a Saju (Four Pillars) interpreter for an English-speaking audience.
Write in warm, encouraging, modern English. Be practical and non‑fatalistic.
Avoid medical/legal/financial advice; keep it general wellbeing.
Output valid JSON ONLY using the requested schema.
`;

function mockOutput() {
  return {
    title: "Saju Analysis Summary",
    bullets: [
      "Your Day Master suggests a calm, thoughtful core with creative leanings.",
      "Element balance shows strengths you can grow and a few areas to gently support.",
      "Relationships benefit from steady pacing and honest, low‑pressure conversations.",
      "Career themes favor consistent practice over quick wins.",
      "This phase rewards grounded routines and small experiments."
    ],
    forecastOneLiner: "Lean into steady progress and simple, repeatable habits—your momentum will build.",
    actions: [
      "Block 25 minutes daily for one focused activity (study, portfolio, practice).",
      "Choose one supportive routine (sleep, walking, hydration) and track for 7 days.",
      "Reach out to one person each week to share progress or ask for feedback.",
      "Declutter one small area of your workspace to reduce friction."
    ],
    sections: {
      overview: "Your Day Master points to a steady, thoughtful temperament. You tend to prefer depth over noise, and you do best when you can pace yourself and build trust over time.",
      elements: "Your five‑element balance hints at areas to nourish gently through environment and routines. Small daily rituals—light movement, hydration, sunlight—will support clarity and energy.",
      careerMoney: "For work, think process over outcome: consistent practice compounds. Money decisions benefit from simplicity and clarity—reduce distractions and keep a single source of truth.",
      relationships: "Relating improves through calm pacing and realistic expectations. Share intentions early and keep space for others’ timing.",
      healthLifestyle: "Pick one foundational habit and make it easy: earlier bedtime, a short walk after meals, or keeping water at your desk.",
      timing: "In the near term, steady routines beat intensity. Give yourself 4–6 weeks for a fair test before changing course.",
      closing: "You don’t need to do everything at once. Choose one step you can repeat this week—momentum will take care of the rest."
    },
    cards: {
      badge: "Personal Growth",
      share: { headline: "Discover Your Saju Insights", sub: "Reflect, refine, and grow—one step at a time." }
    }
  };
}

async function callOpenAI(payload) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  return j;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST' });

  const {
    pillars,
    elements,
    tenGods,
    interactions,
    luck,
    type = 'summary',
    locale = 'en-US',
    length = 'long',
    maxBullets = 6
  } = req.body || {};

  if (!pillars || !elements) {
    return res.status(400).json({ ok: false, error: 'Missing pillars/elements' });
  }

  // ── 1) 환경 변수 없으면 즉시 MOCK 반환 (UX 보호)
  if (!OPENAI_API_KEY) {
    return res.status(200).json({ ok: true, mocked: true, output: mockOutput() });
  }

  const schema = `{
  "title": string,
  "bullets": string[],
  "forecastOneLiner": string,
  "actions": string[],
  "sections": {
    "overview"?: string,
    "elements"?: string,
    "careerMoney"?: string,
    "relationships"?: string,
    "healthLifestyle"?: string,
    "timing"?: string,
    "closing"?: string
  },
  "cards"?: {
    "badge"?: string,
    "share"?: { "headline": string, "sub"?: string }
  }
}`;

  const lengthGuide =
    length === 'long'
      ? `Write ${Math.min(5, maxBullets)}-${maxBullets} bullets, 3-5 actions, and 5-7 short paragraphs across sections.`
      : length === 'medium'
      ? `Write 4-5 bullets, 2-3 actions, and 3-4 paragraphs.`
      : `Write 3 bullets, 2 actions, and 1-2 short paragraphs.`;

  const hints = `
- Day Master (일간) → personality core in "overview".
- Element balance → lifestyle supports; gentle, doable steps.
- Ten Gods / interactions → themes only (no predictions).
- Big Luck → flavor of timing, not fortunes.`;

  const data = { pillars, elements, tenGods, interactions, luck, type, locale, length, maxBullets };

  const userMsg = `
SCHEMA:
${schema}

DATA (JSON):
${JSON.stringify(data)}

TASK:
- ${lengthGuide}
- Friendly, modern, practical. Avoid fatalism. No medical/legal/financial advice.
- Output ONE valid JSON object only (use the schema above).`;

  try {
    const j = await callOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0.35,
      max_tokens: 1100,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: hints },
        { role: 'user', content: userMsg }
      ]
    });

    const content = j?.choices?.[0]?.message?.content;
    let output = null;
    try { output = JSON.parse(content); } catch (e) {}

    if (!output) {
      // ── 2) 모델이 JSON을 못 주면 폴백
      return res.status(200).json({
        ok: true,
        fallback: true,
        reason: 'parse_failed',
        raw: j,
        output: mockOutput()
      });
    }

    return res.status(200).json({ ok: true, output });
  } catch (err) {
    // ── 3) 네트워크/권한/쿼터 등 모든 오류 폴백
    return res.status(200).json({
      ok: true,
      fallback: true,
      reason: 'openai_error',
      error: String(err),
      output: mockOutput()
    });
  }
};
