// /api/topic-insight.js  (CommonJS)
// 카드(Wealth/Love/… ) 클릭 시 호출 — 공통 톤/레이아웃 적용

const OpenAI = require("openai");
const { STYLE_SYSTEM, TOPIC_HEAD } = require("./_style.js");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function normalizeTopic(t = "") {
  const s = t.toLowerCase();
  if (s.includes("wealth") || s.includes("money") || s.includes("finance")) return "wealth";
  if (s.includes("love") || s.includes("relationship")) return "love";
  if (s.includes("career") || s.includes("work") || s.includes("growth")) return "career";
  if (s.includes("health") || s.includes("wellness")) return "health";
  if (s.includes("family") || s.includes("child")) return "family";
  if (s.includes("travel") || s.includes("relocation")) return "travel";
  if (s.includes("learning") || s.includes("skill") || s.includes("study")) return "learning";
  if (s.includes("timing") || s.includes("window") || s.includes("luck")) return "timing";
  return "general";
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Use POST" });
  }

  try {
    const { topic, pillars, elements, tenGods, interactions, luck, locale = "en-US" } = req.body || {};
    if (!topic || !pillars) {
      return res.status(400).json({ ok: false, error: "Missing topic or chart context (pillars)" });
    }

    const key = normalizeTopic(topic);
    const head = TOPIC_HEAD[key] || TOPIC_HEAD.general;

    const userPrompt = `
Generate a "${key}" insight that follows STYLE_SYSTEM.
Use this header exactly: "${head}"
Write in ${locale}.

Chart to reference (lightly and naturally):
- Day Master (stem): ${pillars?.day?.stem || ""}
- Four Pillars: hour ${pillars?.hour?.stem || ""}/${pillars?.hour?.branch || ""}, day ${pillars?.day?.stem || ""}/${pillars?.day?.branch || ""}, month ${pillars?.month?.stem || ""}/${pillars?.month?.branch || ""}, year ${pillars?.year?.stem || ""}/${pillars?.year?.branch || ""}
- Elements balance: ${JSON.stringify(elements || {})}
- Ten Gods highlights (if present): ${JSON.stringify(tenGods || {})}
- Interactions (if present): ${JSON.stringify(interactions || {})}
- Current luck cycles (if present): ${JSON.stringify(luck?.current || luck?.bigLuck || {})}

Follow the DEFAULT LAYOUT from STYLE_SYSTEM. Output plain text.
`.trim();

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: STYLE_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    });

    const output = completion.choices?.[0]?.message?.content?.trim() || "";
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ ok: true, output, topic: key, head });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "topic_insight_failed" });
  }
};
