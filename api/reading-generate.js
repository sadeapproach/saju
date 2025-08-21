// /api/reading-generate.js
// OpenAI 우선(강제) + 안전한 fallback. meta.provider 로 openai/fallback 표시.
// ★ 중요: 정적 import 삭제! (동적 import로 전환)

export const config = { api: { bodyParser: true } };
// (App Router를 쓰고 있다면 다음 줄이 필요합니다. pages/api면 없어도 됩니다.)
export const runtime = 'nodejs';

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
  if (!luck || !Array.isArray(luck.bigLuck)) return { now:null, next:null, age:null };
  const age = (()=>{ const d=new Date((birthISO||"1970-01-01")+"T00:00:00"); const n=new Date();
    let a=n.getFullYear()-d.getFullYear(); const m=n.getMonth()-d.getMonth();
    if (m<0 || (m===0 && n.getDate()<d.getDate())) a--; return a; })();
  let now=null;
  for (const seg of luck.bigLuck){ if (age>=seg.startAge && age<seg.startAge+10) { now=seg; break; } }
  const next = now ? (luck.bigLuck.find(s=>s.startAge===now.startAge+10)||null) : (luck.bigLuck[0]||null);
  return { now, next, age };
}

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
You are a friendly, practical Saju/Bazi guide for English speakers. Tie every point to THIS chart. Avoid generic advice.

Return JSON with these keys (English text):
{
  "pillars": string,
  "day_master": string,
  "five_elements": string,
  "structure": string,
  "yongshin": string,
  "life_flow": string,
  "summary": string
}

Rules:
- 150–220 words each (summary 110–150). 2 short paragraphs + 3–6 bullets.
- Gloss “Day Master” once. Plain language. No headings; just paragraphs and "- " bullets.
- Separate paragraphs with blank lines.

Chart:
- Pillars hour/day/month/year: ${hour}, ${day}, ${month}, ${year}
- Day stem (Day Master): ${dm}
- Element counts: wood:${elementsCount.wood}, fire:${elementsCount.fire}, earth:${elementsCount.earth}, metal:${elementsCount.metal}, water:${elementsCount.water}
- Dominant: ${dominant||"unknown"} | Weakest: ${weakest||"unknown"}
- Luck decades: current ${luckNow}, next ${luckNext}
`.trim();
}

async function tryOpenAI(payload){
  // ★ 동적 import — 여기서만 로드. 실패 시 우리가 잡아서 리턴.
  let OpenAI;
  try{
    OpenAI = (await import('openai')).default;
  }catch(e){
    return { ok:false, reason:'OPENAI_MODULE_NOT_FOUND', more: String(e?.message||e) };
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENAI_APIKEY;
  if (!apiKey) return { ok:false, reason:"OPENAI_API_KEY missing" };

  const client = new OpenAI({ apiKey });

  const elementsCount = countElements(payload.pillars);
  const { dominant, weakest } = pickDominantWeak(elementsCount);
  const luckInfo = findLuckNowNext(payload.luck, payload.birthDateISO);
  const prompt = buildPrompt({ pillars:payload.pillars, elementsCount, dominant, weakest, luckInfo });

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    response_format: { type:"json_object" },
    messages: [
      { role:"system", content:"You produce long, practical Saju readings as structured JSON only." },
      { role:"user", content: prompt }
    ]
  });

  const text = resp?.choices?.[0]?.message?.content || "";
  let data=null; try{ data = JSON.parse(text); }catch{}
  const keys = ["pillars","day_master","five_elements","structure","yongshin","life_flow","summary"];
  const valid = data && typeof data==="object" && keys.every(k => typeof data[k]==="string" && data[k].trim().length>20);
  if (!valid) return { ok:false, reason:"Bad JSON from model", raw:text };

  return { ok:true, output:data, meta:{ provider:"openai", model:resp.model||"gpt-4o-mini" } };
}

function fallbackReading(payload){
  const { pillars, luck, birthDateISO } = payload || {};
  const p = pillars || {};
  const em = countElements(pillars);
  const { dominant, weakest } = pickDominantWeak(em);
  const { now, next } = findLuckNowNext(luck, birthDateISO);

  const four = `Your pillars at a glance —  Hour ${p.hour?.stem||''}${p.hour?.branch||''}, Day ${p.day?.stem||''}${p.day?.branch||''}, Month ${p.month?.stem||''}${p.month?.branch||''}, Year ${p.year?.stem||''}${p.year?.branch||''}. This snapshot shows personal (day/hour), seasonal (month), and ancestral (year) influences.

Together they show a ${dominant||"mixed"}‑leaning profile with counts → wood:${em.wood}, fire:${em.fire}, earth:${em.earth}, metal:${em.metal}, water:${em.water}.

- Prefer choices that feel both “steady and expandable”.
- Feed the weakest element (“${weakest}”) weekly via tiny rituals.
- Anchor one recurring review to lower noise.`;

  const day = `Your Day Master is ${p.day?.stem||'unknown'} (core style—your default way to act, decide, recharge).

- Best environments: natural light, quiet corners, short walks.
- Communication: decide slowly, say “no” earlier, keep boundaries explicit.
- Recovery: one protected block for rest after heavy social/ship weeks.`;

  const five = `Element balance shows ${dominant||"the leading"} element and a gap at ${weakest||"one area"}.

- Add ${weakest||"the weakest"} via weekly choices (hydration/sleep for water, pruning/clarity for metal, etc.).
- Ease dominance with constraints—time budgets, tidy workspace, small routines.
- A 15‑minute Friday review resets energy and prevents spillover.`;

  const struct = `Pattern leans Resource → Output: absorb, then translate ideas into something useful. Avoid over‑studying without shipping.

- Plan **absorb → create → rest** with visible delivery points.
- Put “demo day” on the calendar; protect recovery after launches.
- Avoid stacking multiple “firsts” in the same week.`;

  const ys = `Helpful focus (“yongshin”-like): one supportive theme as a weekly non‑negotiable.

- If Metal is low: clarity & pruning → tidy a corner, set brief specs, clear deadlines.
- If Water is low: hydration + evening wind‑down twice a week.
- If Wood is high: add structure → boundary phrase “I’ll confirm tomorrow.”`;

  const flow = `Decade cycles — current: ${now ? `${now.startAge}–${now.startAge+9} ${now.stem||''}${now.branch||''}` : "N/A"}, next: ${next ? `${next.startAge}–${next.startAge+9} ${next.stem||''}${next.branch||''}` : "N/A"}.

- Start during low‑noise stretches; avoid “all new things at once”.
- Restart after a rest week; plan one small win to rebuild momentum.
- Preview the next 6 weeks every Sunday.`;

  const sum = `Strengths: adaptability, patient growth, steady persistence. Watch‑outs: scattered yeses, over‑responsibility.
Tiny habit this week: a 30‑minute block that feeds “${weakest}” — e.g., water → hydration + evening wind‑down.`;

  return { pillars:four, day_master:day, five_elements:five, structure:struct, yongshin:ys, life_flow:flow, summary:sum };
}

export default async function handler(req, res){
  try{
    const forceAI = String(req.query.force||"").toLowerCase()==="ai" || (req.body && req.body.useAI===true);

    const body = req.method==="GET" ? {} : (req.body||{});
    const src = body.chart || body.data || body || {};
    const payload = {
      pillars: src.pillars || body.pillars || null,
      elements: src.elements || body.elements || null,
      tenGods: src.tenGods || body.tenGods || null,
      interactions: src.interactions || body.interactions || null,
      luck: src.luck || body.luck || null,
      birthDateISO: src.birthDateISO || body.birthDateISO || null
    };

    // 1) OpenAI 시도
    try{
      const ai = await tryOpenAI(payload);
      if (ai.ok) return res.status(200).json({ ok:true, output:ai.output, meta:ai.meta });
      if (forceAI) {
        return res.status(500).json({ ok:false, error:"OPENAI_FAILED", reason:ai.reason, more:ai.more||null, raw:ai.raw||null });
      }
    }catch(e){
      if (forceAI) return res.status(500).json({ ok:false, error:"OPENAI_EXCEPTION", message:e?.message||String(e) });
      // 강제 아니면 fallback
    }

    // 2) fallback
    const fb = fallbackReading(payload);
    return res.status(200).json({ ok:true, output:fb, meta:{ provider:"fallback", reason:"OpenAI missing or failed" } });

  }catch(e){
    return res.status(500).json({ ok:false, error:"SERVER_ERROR", message:e?.message||String(e) });
  }
}
