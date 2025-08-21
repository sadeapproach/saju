// /api/reading-generate.js
// Next.js / Vercel serverless (pages/api/* or app/api/route.js 스타일)
// OpenAI 기반: 7-section reading 생성 (문단/줄바꿈 규칙 포함)

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY, // 호환
});

function countElements(pillars){
  const STEM_ELEM = { "甲":"wood","乙":"wood","丙":"fire","丁":"fire","戊":"earth","己":"earth","庚":"metal","辛":"metal","壬":"water","癸":"water" };
  const BRANCH_ELEM = { "子":"water","丑":"earth","寅":"wood","卯":"wood","辰":"earth","巳":"fire","午":"fire","未":"earth","申":"metal","酉":"metal","戌":"earth","亥":"water" };
  const m = { wood:0, fire:0, earth:0, metal:0, water:0 };
  if (!pillars) return m;
  ["hour","day","month","year"].forEach(k=>{
    const p = pillars[k]; if(!p) return;
    const push=(ch)=>{ const e = STEM_ELEM[ch] || BRANCH_ELEM[ch]; if(e) m[e]++; };
    push(p.stem); push(p.branch);
  });
  return m;
}

function buildPrompt(payload){
  const { pillars={}, elements={}, tenGods={}, interactions={}, luck={}, birthDateISO } = payload || {};
  const hour = `${pillars?.hour?.stem||''}${pillars?.hour?.branch||''}`.trim();
  const day  = `${pillars?.day?.stem||''}${pillars?.day?.branch||''}`.trim();
  const month= `${pillars?.month?.stem||''}${pillars?.month?.branch||''}`.trim();
  const year = `${pillars?.year?.stem||''}${pillars?.year?.branch||''}`.trim();
  const elm  = countElements(pillars);
  const emStr = `wood:${elm.wood}, fire:${elm.fire}, earth:${elm.earth}, metal:${elm.metal}, water:${elm.water}`;
  const luckList = (luck?.bigLuck||[]).map(s=>`${s.startAge}–${s.startAge+9} ${s.stem||''}${s.branch||''}${s.tenGod?`(${s.tenGod})`:''}`).join(", ");

  // 프롬프트: 각 섹션은 2개의 짧은 문단(또는 2~3문장 단락)로, 문단 사이에 반드시 빈 줄(\n\n) 삽입
  // 불릿을 쓰면 앞에 "- " 사용. Markdown 굵게/헤딩 금지.
  return `
You are a friendly Saju/Bazi guide writing in clear, simple English for readers new to Saju.
Write a 7‑section reading. Each section must be 2 short paragraphs (2–4 concise sentences each).
Insert a single blank line between paragraphs (i.e., two newline characters: \\n\\n).
Avoid bold, headings, emojis, or special formatting. Plain text only.
If you use bullets, start lines with "- " and keep to 3–5 bullets max.
Be specific to this chart and avoid generic advice.

Chart context (raw):
- Pillars: Hour ${hour}, Day ${day}, Month ${month}, Year ${year}
- Element counts: ${emStr}
- Ten Gods (if present): ${JSON.stringify(tenGods||{})}
- Interactions (if present): ${JSON.stringify(interactions||{})}
- Big Luck: ${luckList || "N/A"}
- Birth date: ${birthDateISO || "N/A"}

Return STRICT JSON with these exact keys (strings only; no Markdown):
{
  "pillars": "...",          // Section 1: Your Four Pillars Overview
  "day_master": "...",       // Section 2: Day Master Traits
  "five_elements": "...",    // Section 3: Element Balance
  "structure": "...",        // Section 4: Base Pattern (Structure)
  "yongshin": "...",         // Section 5: Helpful Focus (Yongshin)
  "life_flow": "...",        // Section 6: Decade Cycle
  "daily_compass": "..."     // Section 7: Daily Compass (strengths, watch-outs, one tiny habit)
}

Section guidance:

1) Your Four Pillars Overview
- Explain the overall frame from hour/day/month/year pillars.
- Point out one tension or harmony in the chart relevant to decisions this year.

2) Day Master Traits
- Explain personality, decision style, social/relationship style tied to the Day Master (day stem).
- Give a concrete routine or environment that recharges this person.

3) Element Balance
- Use the element counts above. Identify strong/weak elements.
- Tell which elements they collaborate well with, and which feel draining. Offer 2–3 practical adjustments in daily life.

4) Base Pattern (Structure)
- Reconcile "career vs. learning vs. wealth" emphasis for this chart.
- One pitfall to watch. One small design for a weekly cycle that suits them.

5) Helpful Focus (Yongshin)
- Name 1–2 focus keywords (e.g., clarity, pruning, hydration, pacing) that smooth the system.
- Give concrete practice ideas, not generic advice.

6) Decade Cycle
- Speak to the current decade’s tone and the next decade’s shift (if data is present; otherwise infer from chart).
- Add one timing hint for launching/pausing.

7) Daily Compass
- Paragraph 1: strengths in plain words + what to lean into this week.
- Paragraph 2: 1–2 watch‑outs + one tiny habit (e.g., “15‑minute close‑down ritual on Fri”).
`;
}

export default async function handler(req, res){
  try{
    const body = req.method === 'POST' ? (req.body || {}) : {};
    const payload = body.chart || body || {};
    const prompt = buildPrompt(payload);

    // OpenAI 호출
    const completion = await client.responses.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      max_output_tokens: 900,
      input: [
        { role: "system", content: "You output ONLY valid JSON. No markdown fences, no extra text." },
        { role: "user", content: prompt }
      ]
    });

    const txt = completion.output_text || "";
    let data = null;
    try { data = JSON.parse(txt); } catch(e){}

    if (!data || typeof data !== 'object'){
      return res.status(200).json({
        ok:false,
        error:"OPENAI_JSON_PARSE_FAILED",
        raw: txt?.slice(0, 2000) || ""
      });
    }

    // 필요한 키가 없을 경우 빈 문자열 보정
    const out = {
      pillars: data.pillars || "",
      day_master: data.day_master || "",
      five_elements: data.five_elements || "",
      structure: data.structure || "",
      yongshin: data.yongshin || "",
      life_flow: data.life_flow || "",
      daily_compass: data.daily_compass || ""
    };

    return res.status(200).json({ ok:true, output: out });
  }catch(err){
    return res.status(200).json({
      ok:false,
      error:"OPENAI_FAILED",
      more: String(err && err.message || err)
    });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
