// /api/ask.js  (CommonJS)
// 자유 질문(채팅) — 공통 톤/레이아웃 적용

const OpenAI = require("openai");
const { STYLE_SYSTEM, TOPIC_HEAD } = require("./_style.js");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 질문으로 토픽 힌트 추정 (라벨만; 실제 톤/형식은 STYLE_SYSTEM이 강제)
function guessTopic(q = "") {
  const s = q.toLowerCase();
  if (/(money|income|salary|finance|save|savings|invest)/.test(s)) return "wealth";
  if (/(love|relationship|dating|marriage|partner)/.test(s)) return "love";
  if (/(job|career|work|promotion|boss|startup|business)/.test(s)) return "career";
  if (/(health|wellness|stress|sleep|diet)/.test(s)) return "health";
  if (/(child|fertility|family|kids|pregnan)/.test(s)) return "family";
  if (/(travel|move|relocat|visa|abroad)/.test(s)) return "travel";
  if (/(learn|study|skill|major|course)/.test(s)) return "learning";
  if (/(time|when|window|lucky|date|month|year)/.test(s)) return "timing";
  return "general";
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Use POST" });
  }

  try {
    const { question, pillars, elements, tenGods, interactions, luck, locale = "en-US" } =
      req.body || {};

    if (!question || !pillars) {
      return res.status(400).json({ ok: false, error: "Missing question or chart context (pillars)" });
    }

    const topic = guessTopic(question);
    const head = TOPIC_HEAD[topic] || TOPIC_HEAD.general;

    const userPrompt = `
User question: ${question}

Write the answer in ${locale} using the STYLE rules.
Topic header to use: "${head}"

Chart context (use lightly and naturally):
- Day Master (stem): ${pillars?.day?.stem || ""}
- Four Pillars: hour ${pillars?.hour?.stem || ""}/${pillars?.hour?.branch || ""}, day ${pillars?.day?.stem || ""}/${pillars?.day?.branch || ""}, month ${pillars?.month?.stem || ""}/${pillars?.month?.branch || ""}, year ${pillars?.year?.stem || ""}/${pillars?.year?.branch || ""}
- Elements balance: ${JSON.stringify(elements || {})}
- Ten Gods highlights (if given): ${JSON.stringify(tenGods || {})}
- Current big luck (if given): ${JSON.stringify(luck?.current || luck?.bigLuck || {})}

Answer with the DEFAULT LAYOUT described in STYLE_SYSTEM.
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
    return res.status(200).json({ ok: true, output, topic, head });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "ask_failed" });
  }
};
