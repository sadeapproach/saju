// /api/reading-generate.js
// OpenAI 기반 7-section 리딩 생성 (각 섹션은 "문단 배열"로 강제 → 서버에서 \n\n로 조인)
// 결과: 문단이 명확히 나뉘고, 분량을 충분히 확보

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
});

// 요소 카운트 유틸
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

// 안전 조인: ["p1","p2"] → "p1\n\np2"
function joinParas(val){
  if (Array.isArray(val)) return val.filter(Boolean).join("\n\n");
  if (typeof val === "string") {
    // 한 문단으로 왔으면 문장 수 기준으로 반 갈라서 \n\n 삽입 (응급 처리)
    const parts = val.split(/(?<=[.!?])\s+/);
    if (parts.length >= 4) {
      const mid = Math.ceil(parts.length/2);
      return parts.slice(0, mid).join(" ") + "\n\n" + parts.slice(mid).join(" ");
    }
    return val;
  }
  return "";
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

  // 섹션 당 2문단(각 3–5문장) *명확한 배열* 로 반환하도록 강제
  // 전체 길이 증가를 위해 각 섹션 최소 120~180 단어 정도 힌트 포함
  return `
You are a friendly Saju/Bazi guide writing in clear, simple English for readers new to Saju.
Write a 7‑section reading. For EACH section, output an ARRAY of EXACTLY TWO PARAGRAPHS.
Each paragraph should be 3–5 concise sentences; total ~120–200 words per section.
Do NOT include headings, asterisks, emojis, or markdown. Plain text only in the array items.
Be specific to this chart and avoid generic advice. Use the element counts and pillars explicitly.

Chart context (raw):
- Pillars: Hour ${hour}, Day ${day}, Month ${month}, Year ${year}
- Element counts: ${emStr}
- Ten Gods (if present): ${JSON.stringify(tenGods||{})}
- Interactions (if present): ${JSON.stringify(interactions||{})}
- Big Luck: ${luckList || "N/A"}
- Birth date: ${birthDateISO || "N/A"}

Return STRICT JSON with these exact keys (arrays of two strings each):
{
  "pillars": ["...", "..."],          // 1) Your Four Pillars Overview
  "day_master": ["...", "..."],       // 2) Day Master Traits
  "five_elements": ["...", "..."],    // 3) Element Balance
  "structure": ["...", "..."],        // 4) Base Pattern (Structure)
  "yongshin": ["...", "..."],         // 5) Helpful Focus (Yongshin)
  "life_flow": ["...", "..."],        // 6) Decade Cycle
  "daily_compass": ["...", "..."]     // 7) Daily Compass (strengths, watch-outs, tiny habit)
}

Section guidance:

1) Your Four Pillars Overview
- Explain the overall frame from hour/day/month/year pillars, call out one tension/harmony relevant this year.

2) Day Master Traits
- Personality and decision style tied to the Day Master. One concrete environment/routine that recharges.

3) Element Balance
- Use the counts above. Which elements feel supportive vs. draining. 2–3 practical daily adjustments.

4) Base Pattern (Structure)
- Natural emphasis among career / learning / wealth. One pitfall. One weekly rhythm suggestion.

5) Helpful Focus (Yongshin)
- Name 1–2 focus keywords (clarity, pruning, hydration, pacing…). Give concrete practice ideas.

6) Decade Cycle
- The current decade’s tone and the next decade’s shift; one timing hint for launching/pausing.

7) Daily Compass
- Paragraph 1: strengths + what to lean into this week.
- Paragraph 2: 1–2 watch‑outs + a tiny habit (e.g., “15‑minute close‑down ritual on Fri”).
`;
}

export default async function handler(req, res){
  try{
    const body = req.method === 'POST' ? (req.body || {}) : {};
    const payload = body.chart || body || {};
    const prompt = buildPrompt(payload);

    const completion = await client.responses.create({
      model: "gpt-4o-mini",
      temperature: 0.65,
      max_output_tokens: 1800,  // 분량 여유
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

    // 조인: 배열 → "\n\n" 문단
    const out = {
      pillars:       joinParas(data.pillars),
      day_master:    joinParas(data.day_master),
      five_elements: joinParas(data.five_elements),
      structure:     joinParas(data.structure),
      yongshin:      joinParas(data.yongshin),
      life_flow:     joinParas(data.life_flow),
      daily_compass: joinParas(data.daily_compass)
    };

    return res.status(200).json({ ok:true, output: out, raw: data });
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
