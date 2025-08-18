// /api/ask.js
// 자유 질문(채팅)용. 표준 톤/레이아웃 강제.

import OpenAI from "openai";
import { STYLE_SYSTEM, TOPIC_HEAD } from "./_style";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 질문에서 토픽 키워드 유추 (라벨만 가벼운 힌트로 전달. 모델은 STYLE_SYSTEM을 항상 따름)
function guessTopic(q="") {
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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

  try {
    const { question, // string
            pillars, elements, tenGods, interactions, luck, // chart context
            locale = "en-US" } = req.body || {};

    if (!question || !pillars) {
      return res.status(400).json({ ok:false, error:"Missing question or chart context (pillars)" });
    }

    const topic = guessTopic(question);
    const head  = TOPIC_HEAD[topic] || TOPIC_HEAD.general;

    const userPrompt = `
User question: ${question}

Write the answer in ${locale} using the STYLE rules.
Topic header to use: "${head}"

Chart context (use lightly and naturally):
- Day Master (stem): ${pillars?.day?.stem || ""}
- Four Pillars: hour ${pillars?.hour?.stem||""}/${pillars?.hour?.branch||""}, day ${pillars?.day?.stem||""}/${pillars?.day?.branch||""}, month ${pillars?.month?.stem||""}/${pillars?.month?.branch||""}, year ${pillars?.year?.stem||""}/${pillars?.year?.branch||""}
- Elements balance: ${JSON.stringify(elements || {})}
- Ten Gods highlights (if given): ${JSON.stringify(tenGods || {})}
- Current big luck (if given): ${JSON.stringify(luck?.current || luck?.bigLuck || {})}

Answer with the DEFAULT LAYOUT described in STYLE_SYSTEM.
`;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: STYLE_SYSTEM },
        { role: "user",   content: userPrompt }
      ]
    });

    const output = completion.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ ok:true, output, topic, head });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || "ask_failed" });
  }
}
