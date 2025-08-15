// api/reading-generate.js
// Long-form Saju reading (6 sections) with robust fallback (CommonJS)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM = `
You are a Saju (Four Pillars) interpreter for an English-speaking audience.
Write in warm, encouraging, modern English. Be practical and non‑fatalistic.
Offer gentle lifestyle ideas, not medical/legal/financial advice.
Return ONLY JSON matching the schema.
`;

// ---- Long-form MOCK (used when no key / errors). At least ~4 sentences per section.
function mockOutput() {
  return {
    title: "Embracing Your Unique Journey",
    bullets: [
      "Your Day Master points to a calm yet creative core that prefers depth over rush.",
      "Element balance suggests clear strengths with a few areas that thrive on gentle support.",
      "Relationships benefit when pacing is steady and intentions are spoken early.",
      "Career growth compounds through small, consistent practice.",
      "This season rewards grounded routines and simple experiments."
    ],
    forecastOneLiner: "Build steady momentum through repeatable habits—clarity grows as you move.",
    actions: [
      "Reserve 25–30 minutes daily for one focused practice (study, portfolio, or craft).",
      "Choose one supportive routine (sleep window, short walks, hydration) and track it for 10 days.",
      "Share progress weekly with one trusted person to anchor accountability.",
      "Declutter one tiny space to lower friction for starting."
    ],
    sections: {
      corePersonality:
        "Your core nature combines steadiness with quiet curiosity. You notice patterns others miss and prefer making thoughtful moves over reacting quickly. People often feel at ease around you because your presence is calm and grounded. When decisions matter, you gather context and then act with intention—this becomes a superpower when paired with consistent practice.",
      fiveElementsBalance:
        "The five‑element mix shows reliable fire and earth for drive and stability, while water benefits from gentle support through rest, hydration, and reflective time. If energy dips, sunlight walks and light stretching can unlock focus. Use color and environment as subtle levers—greens and natural wood tones soothe; soft blues invite reflection. Seasonal rhythm helps too: spring projects for creativity, autumn for editing and simplification.",
      tenGodsThemes:
        "Money themes favor simple structures and repeatable income instead of high volatility. Career patterns suggest you grow best through craft mastery and calm leadership rather than loud competition. In relationships, cooperation outperforms rivalry—small acts of reliability build deep trust. When pressure rises, step back, name the outcome you want, and move in measured steps.",
      luckSummary:
        "Current luck emphasizes consolidating skills and strengthening your platform. It is a season to refine systems, document know‑how, and make your work easier to repeat. Near‑term opportunities tend to come from people who already know your reliability. Give 4–6 weeks to each experiment before you change direction; momentum will reward patience.",
      healthLifestyle:
        "Keep routines light and doable: a short walk after meals, steady hydration, and a consistent bedtime are surprisingly powerful. If screen time is heavy, add a brief stretch between tasks to reset posture and attention. Choose foods that are warm and easy to digest when stress is high, and schedule small social check‑ins to balance solitary focus. Your energy is more about rhythm than intensity.",
      overallSummary:
        "This phase invites steadiness over speed. Your strengths—care, clarity, and quiet consistency—become amplifiers when turned into routines. Focus on one craft or project you can improve weekly, and keep relationships warm with simple, regular contact. Small, repeatable steps will carry you further than dramatic pushes."
    },
    cards: {
      badge: "Personal Growth",
      share: { headline: "Discover Your Saju Insights", sub: "Reflect, refine, and grow—one steady step at a time." }
    }
  };
}

async function callOpenAI(payload) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
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

  // No key → return long-form mock safely
  if (!OPENAI_API_KEY) {
    return res.status(200).json({ ok: true, mocked: true, output: mockOutput() });
  }

  const schema = `{
  "title": string,
  "bullets": string[],
  "forecastOneLiner": string,
  "actions": string[],
  "sections": {
    "corePersonality": string,       // 4+ sentences
    "fiveElementsBalance": string,   // 4+ sentences
    "tenGodsThemes": string,         // 4+ sentences (money/career/relationships)
    "luckSummary": string,           // 4+ sentences (present big luck & near-term tone)
    "healthLifestyle": string,       // 4+ sentences (gentle lifestyle tips)
    "overallSummary": string         // 4+ sentences (keywords & closing)
  },
  "cards"?: { "badge"?: string, "share"?: { "headline": string, "sub"?: string } }
}`;

  const lengthGuide =
    length === 'long'
      ? `Write ${Math.min(5, maxBullets)}-${maxBullets} concise bullets, 3–5 actions, and SIX sections with 4–7 sentences each.`
      : `Write clear bullets and actions, keep sections at least 3 sentences each.`;

  const data = { pillars, elements, tenGods, interactions, luck, type, locale, length, maxBullets };

  const userMsg = `
SCHEMA:
${schema}

DATA:
${JSON.stringify(data)}

GUIDANCE:
- English tone: friendly, modern, practical; avoid fatalism.
- Mention Day Master as the core of personality in "corePersonality".
- Use the five‑element distribution for "fiveElementsBalance" with gentle supports (colors, hobbies, seasons, routines).
- "tenGodsThemes" covers money (재성), career (관성/인성), relationships (비견/겁재); keep it practical and non‑deterministic.
- "luckSummary" describes the *flavor* of timing (current big luck) and what benefits from attention now/soon.
- "healthLifestyle" offers general wellbeing ideas; no medical claims.
- "overallSummary" ends with 1–2 empowering sentences and clear keywords.
- Return ONE valid JSON object only. No markdown, no commentary.
`;

  try {
    const j = await callOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg }
      ]
    });

    const content = j?.choices?.[0]?.message?.content;
    let output = null;
    try { output = JSON.parse(content); } catch {}

    if (!output) {
      return res.status(200).json({ ok: true, fallback: true, reason: 'parse_failed', raw: j, output: mockOutput() });
    }
    return res.status(200).json({ ok: true, output });
  } catch (err) {
    return res.status(200).json({ ok: true, fallback: true, reason: 'openai_error', error: String(err), output: mockOutput() });
  }
};
