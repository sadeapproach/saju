// /api/reading-generate.js
// Next.js pages/api (serverless) — 7‑section reading (EN) with OpenAI + resilient fallbacks

import OpenAI from "openai";

export const config = {
  api: {
    bodyParser: true, // JSON body
  },
};

// ---------- helpers ----------
function countElements(pillars) {
  const STEM_ELEM = { "甲":"wood","乙":"wood","丙":"fire","丁":"fire","戊":"earth","己":"earth","庚":"metal","辛":"metal","壬":"water","癸":"water" };
  const BRANCH_ELEM = { "子":"water","丑":"earth","寅":"wood","卯":"wood","辰":"earth","巳":"fire","午":"fire","未":"earth","申":"metal","酉":"metal","戌":"earth","亥":"water" };
  const m = { wood:0, fire:0, earth:0, metal:0, water:0 };
  if (!pillars) return m;
  ["hour","day","month","year"].forEach(k=>{
    const p = pillars[k]; if (!p) return;
    const s = STEM_ELEM[p.stem]; const b = BRANCH_ELEM[p.branch];
    if (s) m[s]++; if (b) m[b]++;
  });
  return m;
}

function pickCurrentLuck(luck, birthISO){
  const list = luck?.bigLuck || [];
  if (!list.length) return { cur:null, next:null };
  const now = new Date();
  const by = birthISO ? new Date(birthISO).getFullYear() : null;
  const age = by ? (now.getFullYear() - by - ((now.getMonth()<new Date(birthISO).getMonth() || (now.getMonth()===new Date(birthISO).getMonth() && now.getDate()<new Date(birthISO).getDate()))?1:0)) : null;

  let cur = null;
  for (const seg of list) {
    if (age!=null && age >= seg.startAge && age < seg.startAge + 10) { cur = seg; break; }
  }
  const next = cur ? list.find(s => s.startAge === cur.startAge + 10) || null : list[0] || null;
  return { cur, next, age };
}

function getPayloadPieces(reqBodyOrQuery) {
  // Accept multiple shapes:
  // { pillars, elements, tenGods, interactions, luck }
  // { chart: { pillars, ... } }
  // { data:  { pillars, ... } }
  const obj = reqBodyOrQuery || {};
  const base = obj.chart || obj.data || obj;
  return {
    pillars: base?.pillars || null,
    elements: base?.elements || null,
    tenGods: base?.tenGods || null,
    interactions: base?.interactions || null,
    luck: base?.luck || null,
    birthDateISO: base?.birthDateISO || obj.birthDateISO || null,
  };
}

function englishFallbackSections(payload){
  const { pillars, luck, birthDateISO } = getPayloadPieces(payload);
  const em = countElements(pillars);
  const dom = Object.entries(em).sort((a,b)=>b[1]-a[1])[0]?.[0] || "mixed";
  const hour = `${pillars?.hour?.stem||""}${pillars?.hour?.branch||""}`.trim();
  const day  = `${pillars?.day?.stem||""}${pillars?.day?.branch||""}`.trim();
  const month= `${pillars?.month?.stem||""}${pillars?.month?.branch||""}`.trim();
  const year = `${pillars?.year?.stem||""}${pillars?.year?.branch||""}`.trim();
  const { cur, next, age } = pickCurrentLuck(luck, birthDateISO);
  const curStr = cur ? `${cur.startAge}–${cur.startAge+9} ${cur.stem||""}${cur.branch||""}` : "N/A";
  const nextStr = next ? `${next.startAge}–${next.startAge+9} ${next.stem||""}${next.branch||""}` : "N/A";

  return {
    pillars:
      `Your pillars at a glance — Hour ${hour}, Day ${day}, Month ${month}, Year ${year}. ` +
      `This gives a quick snapshot across personal (day/hour), seasonal (month), and ancestral (year) influences.`,
    day_master:
      `Your Day Master is **${day || "unknown"}**. Treat it as your core style—how you act, decide, and recharge. ` +
      `Notice what strengthens your Day Master and avoid routines that drain it.`,
    five_elements:
      `Element balance shows **${dom}** leaning. Totals — wood:${em.wood}, fire:${em.fire}, earth:${em.earth}, metal:${em.metal}, water:${em.water}. ` +
      `Support the weakest element in daily habits; soften the strongest when it overheats your schedule.`,
    structure:
      `Your base pattern suggests a few recurring themes. Use it as a north star—don’t force‑fit against it. ` +
      `Careers tend to thrive when they echo your natural rhythm and energy budget.`,
    yongshin:
      `Helpful focus (yongshin‑style): pick one helpful theme (e.g., learning, planning, hydration, rest) and make it a weekly non‑negotiable. ` +
      `Consistent small adjustments compound into stability.`,
    life_flow:
      `Decade cycles — current: **${curStr}**, next: **${nextStr}**${age!=null?`, age ${age}`:""}. ` +
      `Periods peak and ebb; plan launches during steadier months and use noisy seasons for drafts and exploration.`,
    summary:
      `Strengths: momentum and adaptability. Watch‑outs: overcommitment and sleep debt. ` +
      `Try this week: one 30‑minute block that supports your weakest element (e.g., water → hydration + evening wind‑down).`
  };
}

// ---------- OpenAI prompting ----------
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function buildSystemPrompt(){
  return [
    "You are a Saju/Bazi guide who writes in clear, warm, practical ENGLISH.",
    "Avoid jargon. If a Bazi term appears, explain it in plain English within 1 short phrase.",
    "Return ONLY valid JSON with these keys (string values):",
    "pillars, day_master, five_elements, structure, yongshin, life_flow, summary.",
    "Each value = 2–5 sentences (concise, practical). No markdown, no lists."
  ].join("\n");
}

function buildUserPrompt(payload){
  const { pillars, luck, birthDateISO, tenGods, elements } = getPayloadPieces(payload);
  const em = countElements(pillars);
  const hour = `${pillars?.hour?.stem||""}${pillars?.hour?.branch||""}`.trim();
  const day  = `${pillars?.day?.stem||""}${pillars?.day?.branch||""}`.trim();
  const month= `${pillars?.month?.stem||""}${pillars?.month?.branch||""}`.trim();
  const year = `${pillars?.year?.stem||""}${pillars?.year?.branch||""}`.trim();
  const { cur, next, age } = pickCurrentLuck(luck, birthDateISO);

  return JSON.stringify({
    chart: { pillars: { hour, day, month, year }, tenGods, elements, birthDateISO },
    element_totals: em,
    current_luck: cur ? { startAge: cur.startAge, stem: cur.stem, branch: cur.branch, tenGod: cur.tenGod || "" } : null,
    next_luck: next ? { startAge: next.startAge, stem: next.stem, branch: next.branch, tenGod: next.tenGod || "" } : null,
    age
  });
}

async function callOpenAI(payload){
  if (!openai) return { ok:false, error:"NO_OPENAI_KEY" };
  try{
    const completion = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.5,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(payload) }
      ],
    });
    const txt = completion?.choices?.[0]?.message?.content || "{}";
    let parsed = {};
    try { parsed = JSON.parse(txt); } catch { parsed = {}; }
    // Ensure all keys exist as strings
    const result = {
      pillars: parsed.pillars || "",
      day_master: parsed.day_master || "",
      five_elements: parsed.five_elements || "",
      structure: parsed.structure || "",
      yongshin: parsed.yongshin || "",
      life_flow: parsed.life_flow || "",
      summary: parsed.summary || "",
    };
    return { ok:true, output: result, raw: parsed, provider:"openai" };
  }catch(e){
    return { ok:false, error:String(e?.message || e) };
  }
}

// ---------- handler ----------
export default async function handler(req, res){
  try{
    const isGET = req.method === "GET";
    const body = isGET ? req.query : req.body || {};
    const pieces = getPayloadPieces(body);

    // 1) Try OpenAI if key exists
    const ai = await callOpenAI({ ...pieces });
    if (ai.ok) {
      return res.status(200).json({ ok:true, output: ai.output, meta: { provider:"openai" } });
    }

    // 2) Fallback (deterministic)
    const fb = englishFallbackSections({ ...pieces });
    return res.status(200).json({ ok:true, output: fb, meta: { provider:"fallback", reason: ai.error || "no_ai" } });

  }catch(err){
    // 3) Last‑resort error
    return res.status(500).json({
      ok:false,
      error: "READING_GENERATE_FAILED",
      message: String(err?.message || err),
    });
  }
}
