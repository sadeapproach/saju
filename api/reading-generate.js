// /api/reading-generate.js
// Vercel serverless (pages/api or app/api/route.js 스타일 아님) — CommonJS/ESM 혼합 허용
// OPENAI_API_KEY가 환경변수로 있어야 함.

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || process.env.OPENAIKEY
});

// ---- helpers ---------------------------------------------------
const STEM_ELEM = { "甲":"wood","乙":"wood","丙":"fire","丁":"fire","戊":"earth","己":"earth","庚":"metal","辛":"metal","壬":"water","癸":"water" };
const BRANCH_ELEM = { "子":"water","丑":"earth","寅":"wood","卯":"wood","辰":"earth","巳":"fire","午":"fire","未":"earth","申":"metal","酉":"metal","戌":"earth","亥":"water" };

function countElements(pillars){
  const m = { wood:0, fire:0, earth:0, metal:0, water:0 };
  if (!pillars) return m;
  ["hour","day","month","year"].forEach(k=>{
    const p = pillars[k]; if(!p) return;
    const s = STEM_ELEM[p.stem]; const b = BRANCH_ELEM[p.branch];
    if (s) m[s]++; if (b) m[b]++;
  });
  return m;
}

function topAndWeak(m){
  const arr = Object.entries(m).sort((a,b)=>b[1]-a[1]);
  const top = arr[0]; const weak = arr[arr.length-1];
  return { top:top?{elem:top[0],n:top[1]}:null, weak:weak?{elem:weak[0],n:weak[1]}:null };
}

function pstr(p){ if(!p) return ""; return `${p.stem||""}${p.branch||""}`; }
function safe(v, alt="N/A"){ return (v==null || v==="") ? alt : String(v); }

function chartFacts(chart){
  const p = chart?.pillars || {};
  const c = countElements(p);
  const tw = topAndWeak(c);
  const day = p.day || {};
  const facts = [];
  facts.push(`Day Pillar = ${pstr(p.day)}; Hour = ${pstr(p.hour)}; Month = ${pstr(p.month)}; Year = ${pstr(p.year)}.`);
  facts.push(`Element counts → wood:${c.wood}, fire:${c.fire}, earth:${c.earth}, metal:${c.metal}, water:${c.water}.`);
  if (tw.top)  facts.push(`Dominant element = ${tw.top.elem} (${tw.top.n}).`);
  if (tw.weak) facts.push(`Weakest element = ${tw.weak.elem} (${tw.weak.n}).`);
  if (day.stem && STEM_ELEM[day.stem]) facts.push(`Day Master element = ${STEM_ELEM[day.stem]}.`);
  const curDec = pickCurrentLuck(chart?.luck, chart?.birthDateISO);
  if (curDec) facts.push(`Current decade = age ${curDec.startAge}–${curDec.startAge+9} (${safe(curDec.stem)}${safe(curDec.branch)}).`);
  return { counts:c, tw, facts, dayMasterElem: STEM_ELEM[day.stem] || "" };
}

function pickCurrentLuck(luck, birthISO){
  if(!luck || !Array.isArray(luck.bigLuck)) return null;
  const a = age(birthISO);
  return luck.bigLuck.find(x=> a>=x.startAge && a< x.startAge+10) || null;
}
function age(b){
  if(!b) return null;
  const d=new Date(b+"T00:00:00");const n=new Date();
  let a=n.getFullYear()-d.getFullYear();const m=n.getMonth()-d.getMonth();
  if(m<0||(m===0&&n.getDate()<d.getDate())) a--; return a;
}

// ---- prompt builders -------------------------------------------
const SYSTEM_RULES = `
You are a Saju/Bazi coach. Write with clarity, warmth, and practicality.
CRITICAL STYLE RULES:
1) Be concrete. Use numbers, counts, names of elements/pillars the user has.
2) Explain the why → therefore what-to-do. (Because X, therefore Y.)
3) Avoid vague hedges: "maybe, might, could, seems to, possibly, some, kind of".
   Replace with: "if/when <specific condition>, then <specific action>".
4) Prefer short sentences, but write complete ideas. 
5) Format with 2–3 short paragraphs per section, separated by blank lines (\\n\\n).
6) Do NOT repeat the same sentence across sections.
7) No superstition or fatalistic claims; we talk about tendencies and choices.
8) Keep jargon minimal; when used (Day Master, Five Elements), give quick meaning.
9) English only.
LENGTH: 120–180 words per section, except "Daily Compass" (80–120 words).
`;

function userPrompt(chart){
  const { facts, counts, tw, dayMasterElem } = chartFacts(chart);
  const pillars = chart?.pillars || {};
  const day = pillars.day||{};
  const hour = pillars.hour||{};
  const month= pillars.month||{};
  const year = pillars.year||{};
  const curLuck = pickCurrentLuck(chart?.luck, chart?.birthDateISO);

  // 섹션 사양(제목/부제는 프론트에서 고정, 여기서는 내용만 생성)
  return `
Write a 7-section reading. For EACH section:
- 2–3 paragraphs (blank line between paragraphs).
- Include NO bullet lists.
- Include at least 2 concrete specifics drawn from FACTS below (numbers, pillar names, element names).
- Use "Because X, therefore Y" where appropriate.
- Avoid vague hedges; if uncertainty exists, say what extra info would resolve it.

SECTIONS (content only):
1) pillars: overview of 4 pillars and what they suggest this year.
2) day_master: explain Day Master (what it is), show personality/decision style, recharge environment.
3) five_elements: analyze counts, name dominant/weak elements, describe fit/avoid dynamics with examples.
4) structure: how this chart leans (career vs. wealth vs. learning), 1 risk and 1 antidote, 1 weekly rhythm suggestion.
5) yongshin: pick ONE helpful focus keyword (e.g., clarity, pruning, pacing), explain why, give 2 micro-habits.
6) life_flow: current decade’s tilt and timing hint (what to start/avoid now vs next).
7) daily_compass: short daily operating guide (strengths, watch-outs, one tiny habit).

FACTS (use these!):
- ${facts.join("\n- ")}

Make the writing specific to these facts.`;
}

// ---- OpenAI call ------------------------------------------------
async function callOpenAI(chart){
  const sys = SYSTEM_RULES;
  const usr = userPrompt(chart);
  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: usr }
    ]
  });
  const text = resp.choices?.[0]?.message?.content?.trim() || "";
  return text;
}

// ---- post-processing: split into 7 parts ------------------------
function splitIntoSections(text){
  // 모델은 연속 본문을 반환할 수 있으므로, 섹션별 마커가 없더라도 7개로 균등 분할 시도
  // 우선 ##, **, 숫자제목 등을 시도해서 나누고, 부족하면 균등 분할.
  let parts = text
    .split(/\n(?:#{1,3}|\d\)|\d\.)\s*[A-Za-z].*?\n/).filter(Boolean); // 느슨 분할
  if (parts.length < 7){
    // 단락 기준으로 나누고 7등분
    const paras = text.split(/\n{2,}/).map(s=>s.trim()).filter(Boolean);
    const target = 14; // 섹션당 2개 문단 기대
    while (paras.length < target) paras.push(""); // 최소 길이 보장
    // 7 구간으로 묶기
    parts = [];
    const chunk = Math.ceil(paras.length / 7);
    for (let i=0; i<7; i++){
      const seg = paras.slice(i*chunk, (i+1)*chunk).join("\n\n").trim();
      parts.push(seg);
    }
  } else if (parts.length > 7){
    parts = parts.slice(0,7);
  }
  while (parts.length < 7) parts.push("");
  return parts;
}

// ---- robust fallback (명확하고 길게) ----------------------------
function fallbackReading(chart){
  const { facts, counts, tw, dayMasterElem } = chartFacts(chart);
  const fc = facts.join("\n");

  const para = (p)=>p.replace(/\n{2,}/g,"\n\n");
  const mk = {
    pillars: para(
`Your chart combines concrete influences from all four pillars. Because Hour ${pstr(chart?.pillars?.hour)} pushes creativity/growth and Year ${pstr(chart?.pillars?.year)} brings external influence, decisions this year benefit from plans that are both expansive and stable. Use Month ${pstr(chart?.pillars?.month)} as your “career barometer”: if commitments crowd reflection time, schedule it first and let tasks fill the remaining space.

Work from the data: ${fc}
Because these are real counts, decide quarterly priorities in terms of element hygiene (what you feed daily vs. what you soften weekly).`),

    day_master: para(
`Your Day Master element is ${dayMasterElem || "unknown"}, which we treat as your core style—how you act, decide, and recharge. Because this core sets your pacing, protect its recharge window every day (15–30 minutes, no screens). Choose meeting slots that match this pacing rather than fighting it.

If stress rises, reduce inputs first (messages, tabs, asks), then re‑introduce them deliberately. This preserves decisiveness without swinging into rigidity.`),

    five_elements: para(
`Element counts: wood:${counts.wood}, fire:${counts.fire}, earth:${counts.earth}, metal:${counts.metal}, water:${counts.water}. Dominant = ${tw.top?.elem||"n/a"}; weakest = ${tw.weak?.elem||"n/a"}.
Because ${tw.top?.elem||"a top element"} is strong, it powers momentum—so pair it with the weakest (${tw.weak?.elem||"n/a"}) to avoid lopsided weeks. Example: if ${tw.weak?.elem||"weak"} is water (rest/reflection), anchor a nightly wind‑down; if metal (structure) is lean, tidy a corner and pre‑write the next day’s first checklist. Avoid long stretches that over‑feed the dominant while starving the weak.`),

    structure: para(
`Your base pattern leans toward learning→output: absorb, then translate into something useful. Because Month/Year pillars pull on external duties, protect a weekly “make‑time” block (2×90 min). Risk: over‑studying without shipping—ideas become comfortable, deliverables stay fuzzy. Antidote: publish a one‑pager or demo at the end of each learning loop.`),

    yongshin: para(
`Helpful focus (yongshin): **clarity**. Why clarity: your data shows competing pulls between expansion and stability; clarity shrinks indecision windows. Micro‑habits: (1) Every evening, rewrite tomorrow’s first 3 actions in verbs (“send draft”, “review PR #42”, “book venue”). (2) Define a boundary phrase you can say in 1 breath: “I’ll confirm tomorrow.”`),

    life_flow: para(
`Current decade tilt suggests consolidation then expansion. Start now: baseline routines, simple products, and relationship hygiene. Avoid now: high‑leverage bets that demand constant re‑invention. Next decade: increase option‑ality and public launches. Timing hint: ship during quieter seasons in your calendar; use noisy seasons for drafting and networking.`),

    daily_compass: para(
`Operate like this daily: bias for empathy and calm decisiveness. Watch‑outs: over‑accommodating or scattering energy across too many inputs. Tiny habit: 15‑minute close‑down—review today, write the first checklist item for tomorrow, then a hydration + evening wind‑down. This pairs your strongest element with the weakest so your system stays even.`)
  };

  return {
    pillars: mk.pillars,
    day_master: mk.day_master,
    five_elements: mk.five_elements,
    structure: mk.structure,
    yongshin: mk.yongshin,
    life_flow: mk.life_flow,
    daily_compass: mk.daily_compass
  };
}

// ---- handler ----------------------------------------------------
export default async function handler(req, res){
  try{
    if (req.method !== "POST"){
      return res.status(200).json({ ok:true, message:"POST chart to generate reading." });
    }
    const body = req.body || {};
    const chart = body.chart || body || {};

    // Try OpenAI
    let output = null;
    try{
      const raw = await callOpenAI(chart);
      const parts = splitIntoSections(raw);
      output = {
        pillars: parts[0] || "",
        day_master: parts[1] || "",
        five_elements: parts[2] || "",
        structure: parts[3] || "",
        yongshin: parts[4] || "",
        life_flow: parts[5] || "",
        daily_compass: parts[6] || ""
      };
    }catch(e){
      // fall back
      output = fallbackReading(chart);
      return res.status(200).json({ ok:true, provider:"fallback", reason:String(e?.message||e), output });
    }

    return res.status(200).json({ ok:true, provider:"openai", output });
  }catch(err){
    return res.status(500).json({ ok:false, error:"OPENAI_FAILED", reason:String(err?.message||err) });
  }
}
