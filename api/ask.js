// api/ask.js
// Q&A for Saju-specific questions using current chart context.
// POST { question, context: { birthDateISO, birthTime, tzId, lat, lng, pillars, elements, tenGods, hiddenStems, interactions, luck } }

const MODEL = process.env.SAJU_MODEL || "gpt-4o-mini"; // or "gpt-4o" if 여유
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ ok: false, error: "Use POST" });
  }

  try {
    const { question, context } = req.body || {};
    if (!question || !context) {
      return res.status(400).json({ ok: false, error: "Missing question or context" });
    }

    // 가벼운 컨텍스트 축약 (너무 길면 비용↑)
    const safeCtx = {
      birthDateISO: context.birthDateISO || null,
      birthTime: context.birthTime || null,
      tzId: context.tzId || null,
      lat: context.lat || null,
      lng: context.lng || null,
      pillars: context.pillars || null,
      elements: context.elements || null,
      tenGods: context.tenGods || null,
      interactions: context.interactions || null,
      luck: Array.isArray(context?.luck?.bigLuck) ? { bigLuck: context.luck.bigLuck.slice(0, 8) } : null
    };

    const system = [
      "You are a helpful Saju (Four Pillars) explainer for general audiences.",
      "Write in clear, warm, supportive, modern English.",
      "Ground every answer in the provided Saju context. Do not fabricate dates or facts.",
      "Avoid jargon. If you must reference a concept, translate it:",
      "- Ten Gods map: 正官=Upright Authority, 七殺/偏官=Challenging Authority, 正財=Stable Wealth, 偏財=Dynamic Wealth, 食神=Growth/Output, 傷官=Bold Output, 正印=Supportive Wisdom, 偏印=Adaptive Wisdom, 比肩=Independent Peer, 劫財=Competitive Peer.",
      "Stems/branches/elements: 甲乙=Wood, 丙丁=Fire, 戊己=Earth, 庚辛=Metal, 壬癸=Water; 子=Zi (Water), 丑=Chou (Earth), 寅=Yin (Wood), 卯=Mao (Wood), 辰=Chen (Earth), 巳=Si (Fire), 午=Wu (Fire), 未=Wei (Earth), 申=Shen (Metal), 酉=You (Metal), 戌=Xu (Earth), 亥=Hai (Water).",
      "If timing is requested, infer windows using Month/Year pillar element flows and the provided luck cycles, but state it as guidance (not absolute prediction).",
      "Give concise, practical bullet points first (3–6), then a short closing paragraph."
    ].join("\n");

    const user = {
      role: "user",
      content: [
        { type: "text", text: `QUESTION:\n${question}` },
        { type: "text", text: `SAJU CONTEXT (JSON):\n${JSON.stringify(safeCtx)}` }
      ]
    };

    const resp = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.5,
        max_tokens: 600,
        messages: [
          { role: "system", content: system },
          user
        ]
      })
    });

    if (!resp.ok) {
      const raw = await resp.text();
      return res.status(502).json({ ok: false, error: "openai_error", raw });
    }

    const data = await resp.json();
    const answer = data?.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn’t generate an answer.";
    return res.status(200).json({ ok: true, answer });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "server_error" });
  }
}
