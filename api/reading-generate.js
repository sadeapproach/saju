// /api/reading-generate.js
// Next.js / Vercel serverless (pages/api/* or app/api/route.js 스타일 호환)
// OpenAI로 7-section reading을 생성. 장애 시 풍부한 규칙 기반 fallback 사용.

import OpenAI from "openai";

export const config = {
  api: { bodyParser: true },
};

/* ------------------------- helpers: chart utils ------------------------- */
const STEM_ELEM = { "甲":"wood","乙":"wood","丙":"fire","丁":"fire","戊":"earth","己":"earth","庚":"metal","辛":"metal","壬":"water","癸":"water" };
const BRANCH_ELEM = { "子":"water","丑":"earth","寅":"wood","卯":"wood","辰":"earth","巳":"fire","午":"fire","未":"earth","申":"metal","酉":"metal","戌":"earth","亥":"water" };

function countElements(pillars) {
  const m = { wood:0, fire:0, earth:0, metal:0, water:0 };
  if (!pillars) return m;
  ["hour","day","month","year"].forEach(k=>{
    const p = pillars[k]; if (!p) return;
    const e1 = STEM_ELEM[p.stem];   if (e1) m[e1]++;
    const e2 = BRANCH_ELEM[p.branch]; if (e2) m[e2]++;
  });
  return m;
}
function pickDominantWeak(m){
  const arr = Object.entries(m).sort((a,b)=>b[1]-a[1]);
  return { dominant: arr[0]?.[0]||"", weakest: arr.at(-1)?.[0]||"" };
}
function findLuckNowNext(luck, birthISO){
  if (!luck || !Array.isArray(luck.bigLuck)) return { now:null, next:null };
  const age = (()=>{ const d=new Date(birthISO+"T00:00:00"); const n=new Date();
    let a=n.getFullYear()-d.getFullYear(); const m=n.getMonth()-d.getMonth();
    if (m<0 || (m===0 && n.getDate()<d.getDate())) a--; return a; })();
  let now=null;
  for (const seg of luck.bigLuck){ if (age>=seg.startAge && age<seg.startAge+10) { now=seg; break; } }
  const next = now ? luck.bigLuck.find(s=>s.startAge===now.startAge+10) || null : luck.bigLuck[0] || null;
  return { now, next, age };
}

/* ----------------------- OpenAI prompt & generator ---------------------- */
function buildPrompt({pillars, elementsCount, dominant, weakest, luckInfo}) {
  const p = pillars || {};
  const hour = `${p.hour?.stem||''}${p.hour?.branch||''}`;
  const day  = `${p.day?.stem||''}${p.day?.branch||''}`;
  const month= `${p.month?.stem||''}${p.month?.branch||''}`;
  const year = `${p.year?.stem||''}${p.year?.branch||''}`;
  const dm = p.day?.stem || "";

  const luckNow = luckInfo.now ? `${luckInfo.now.startAge}–${luckInfo.now.startAge+9} ${luckInfo.now.stem||''}${luckInfo.now.branch||''}` : "N/A";
  const luckNext = luckInfo.next ? `${luckInfo.next.startAge}–${luckInfo.next.startAge+9} ${luckInfo.next.stem||''}${luckInfo.next.branch||''}` : "N/A";

  return `
You are a friendly, practical Saju/Bazi guide writing for English speakers who may be new to this topic.
Write **clear, concrete, non-generic** guidance tied to THIS chart.

Return ONLY valid JSON with the following keys (English values):
{
  "pillars": string,       // 130-180 words, 2 short paragraphs + 3-5 bullets
  "day_master": string,    // 130-180 words, 2 short paragraphs + 3-5 bullets
  "five_elements": string, // 130-180 words, show counts and what to add/avoid, 2 short paragraphs + 3-5 bullets
  "structure": string,     // 130-180 words, name likely pattern in plain English + how to use/avoid, 2 short paragraphs + 3-5 bullets
  "yongshin": string,      // 120-170 words, propose 1-2 supportive themes (yongshin-like), each with why/how, bullets
  "life_flow": string,     // 120-170 words, current decade then next; how to time starts/restarts; bullets
  "summary": string        // 90-130 words, strengths + watch-outs + 1 tiny habit
}

Rules:
- Use plain language. No unexplained jargon. If a term appears once (e.g., "Day Master"), add a parenthetical gloss the first time only.
- Tie every point back to the actual chart (pillars, element counts, current decade).
- Use short paragraphs separated by blank lines. Bullets must start with "- " (dash + space).
- Avoid fortune-cookie lines; prefer concrete behavior, schedules, and examples.
- Do not include any markdown headings; just paragraphs and bullets.

Chart context:
- Pillars (hour/day/month/year): ${hour}, ${day}, ${month}, ${year}
- Day stem (Day Master): ${dm}
- Element counts: wood:${elementsCount.wood}, fire:${elementsCount.fire}, earth:${elementsCount.earth}, metal:${elementsCount.metal}, water:${elementsCount.water}
- Dominant: ${dominant || "unknown"}  |  Weakest: ${weakest || "unknown"}
- Luck decades: current ${luckNow}, next ${luckNext}
`.trim();
}

async function callOpenAI(payload){
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || process.env.OPENAI_KEY;
  if (!apiKey) return { ok:false, reason:"OPENAI_API_KEY missing" };

  const client = new OpenAI({ apiKey });

  const { pillars, luck } = payload;
  const elementsCount = countElements(pillars);
  const { dominant, weakest } = pickDominantWeak(elementsCount);
  const luckInfo = findLuckNowNext(luck, payload.birthDateISO);

  const prompt = buildPrompt({ pillars, elementsCount, dominant, weakest, luckInfo });

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",          // 가볍고 빠른 모델. 품질 높이려면 gpt-4.1 등으로 교체 가능
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You produce long, practical Saju readings as structured JSON only." },
      { role: "user", content: prompt }
    ],
  });

  const text = resp?.choices?.[0]?.message?.content || "";
  let data = null;
  try { data = JSON.parse(text); } catch(e){ /* fall through */ }

  if (!data || typeof data !== "object") {
    return { ok:false, reason:"Bad JSON from model", raw:text };
  }

  // minimal sanity: all keys present
  const must = ["pillars","day_master","five_elements","structure","yongshin","life_flow","summary"];
  const ok = must.every(k => typeof data[k] === "string" && data[k].trim().length>10);
  if (!ok) return { ok:false, reason:"Missing keys in model JSON", raw:data };

  return { ok:true, output:data, meta:{ provider:"openai", model:"gpt-4o-mini" } };
}

/* --------------------------- rich fallback text ------------------------- */
function englishFallback(payload){
  const { pillars, luck, birthDateISO } = payload || {};
  const p = pillars || {};
  const em = countElements(pillars);
  const { dominant, weakest } = pickDominantWeak(em);
  const { now, next } = findLuckNowNext(luck, birthDateISO);

  const four = `Your pillars at a glance —  Hour ${p.hour?.stem||''}${p.hour?.branch||''}, Day ${p.day?.stem||''}${p.day?.branch||''}, Month ${p.month?.stem||''}${p.month?.branch||''}, Year ${p.year?.stem||''}${p.year?.branch||''}. This gives a snapshot of personal (day/hour), seasonal (month), and ancestral (year) influences.

Together they show a ${dominant || "mixed"}‑leaning profile with these counts → wood:${em.wood}, fire:${em.fire}, earth:${em.earth}, metal:${em.metal}, water:${em.water}.

- Stability axis: prefer decisions that feel both “steady and expandable”.
- Make room weekly for the weakest element (“${weakest}”) in your routines.
- Anchor one recurring ritual to keep noise down in busy months.`;

  const day = `Your Day Master is ${p.day?.stem||'unknown'} (your core style—how you act, decide, and recharge). Treat it as your design spec for energy.

- Best environments: natural light, quiet corners, short walks.
- Communication: decide slowly, say “no” earlier, keep boundaries explicit.
- Recovery: one protected block for rest after heavy social/ship weeks.`;

  const five = `Element balance shows ${dominant || "the leading"} element and a gap at ${weakest || "one area"}. To feel balanced, borrow what you lack and soften what’s dominant.

- Add ${weakest || "the weakest"} through weekly choices (e.g., hydration for water, pruning for metal).
- Ease dominance: small constraints → routines, time budgets, tidy workspace.
- One Friday review (15 min) prevents spillover and resets energy.`;

  const struct = `Base pattern leans Resource → Output: you absorb, then translate ideas into something useful. Careers thrive when you echo your natural rhythm (learn → make). Watch-out: studying without shipping.

- Design a cycle: **absorb → create → rest** with visible delivery points.
- Put “demo day” on the calendar; protect recovery after launches.
- Avoid sprinting across multiple firsts in the same week.`;

  const ys = `Helpful focus (“yongshin”-like): pick one supportive theme and make it non‑negotiable weekly.

- If Metal is low: clarity & pruning → tidy a corner, set clear deadlines, write short specs.
- If Water is low: hydration & evening wind‑down → earlier lights‑out 2×/week.
- If Wood is high: add structure → boundary phrase “I’ll confirm tomorrow.”`;

  const flow = `Decade cycles — current: ${now ? `${now.startAge}–${now.startAge+9} ${now.stem||''}${now.branch||''}` : "N/A"}, next: ${next ? `${next.startAge}–${next.startAge+9} ${next.stem||''}${next.branch||''}` : "N/A"}.
Use steadier seasons for launches; shift into drafts and networking in noisier months.

- Start during low‑noise stretches; avoid stacking new job + move + travel.
- Restart after a rest week; plan small “win” to rebuild momentum.
- Preview the next 6 weeks every Sunday.`;

  const sum = `Strengths: adaptability, patient growth, steady persistence. Watch‑outs: over‑responsibility, scattered yeses.
Tiny habit for this week: 30‑minute block that feeds the weakest element (“${weakest}”) — e.g., water → hydration + evening wind‑down.`;

  return {
    pillars: four,
    day_master: day,
    five_elements: five,
    structure: struct,
    yongshin: ys,
    life_flow: flow,
    summary: sum
  };
}

/* -------------------------------- handler ------------------------------- */
export default async function handler(req, res){
  try{
    // 다양한 형태(body.data, body.chart 등) 허용
    const body = req.method === "GET" ? {} : (req.body || {});
    const src = body.chart || body.data || body || {};
    const pillars = src.pillars || body.pillars || null;
    const elements = src.elements || body.elements || null; // 현재는 사용하지 않지만 그대로 전달
    const tenGods = src.tenGods || body.tenGods || null;
    const interactions = src.interactions || body.interactions || null;
    const luck = src.luck || body.luck || null;
    const birthDateISO = src.birthDateISO || body.birthDateISO || null;

    const payload = { pillars, elements, tenGods, interactions, luck, birthDateISO };

    // 1) OpenAI 시도
    try{
      const ai = await callOpenAI(payload);
      if (ai.ok){
        return res.status(200).json({ ok:true, output: ai.output, meta: ai.meta });
      }
      // fall through → fallback
    }catch(err){
      // swallow to fallback
    }

    // 2) Fallback (규칙 기반)
    const fb = englishFallback(payload);
    return res.status(200).json({ ok:true, output: fb, meta:{ provider:"fallback", reason:"OpenAI failed or missing" } });

  }catch(e){
    return res.status(200).json({
      ok:false,
      error:"SERVER_ERROR",
      message: e?.message || String(e),
    });
  }
}
