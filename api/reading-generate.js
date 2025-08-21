// /api/reading-generate.js
// Next.js pages/api — 7‑section reading (EN)
// Robust: works even if OPENAI not installed or API key missing (fallback returns English text)

export const config = {
  api: { bodyParser: true },
};

// ---------- small utils ----------
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
  if (!list.length) return { cur:null, next:null, age:null };
  const now = new Date();
  let age = null;
  if (birthISO) {
    const bd = new Date(birthISO);
    age = now.getFullYear() - bd.getFullYear();
    const m = now.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) age--;
  }
  let cur = null;
  if (age!=null) for (const seg of list) { if (age >= seg.startAge && age < seg.startAge+10) { cur = seg; break; } }
  const next = cur ? (list.find(s=>s.startAge===cur.startAge+10) || null) : (list[0] || null);
  return { cur, next, age };
}
function getPieces(src){
  const base = (src?.chart || src?.data || src) || {};
  return {
    pillars: base.pillars || null,
    elements: base.elements || null,
    tenGods: base.tenGods || null,
    interactions: base.interactions || null,
    luck: base.luck || null,
    birthDateISO: base.birthDateISO || src?.birthDateISO || null,
  };
}

// ---------- deterministic English fallback (always safe) ----------
function englishFallbackSections(payload){
  const { pillars, luck, birthDateISO } = getPieces(payload);
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
      `This is a quick snapshot of personal (day/hour), seasonal (month), and ancestral (year) influences.`,
    day_master:
      `Your Day Master is **${day || "unknown"}**. Treat it as your core style—how you act, decide, and recharge. ` +
      `Support routines that strengthen it; avoid habits that drain it.`,
    five_elements:
      `Element balance leans **${dom}**. Totals — wood:${em.wood}, fire:${em.fire}, earth:${em.earth}, metal:${em.metal}, water:${em.water}. ` +
      `Feed the weakest element in daily life; soften the strongest when it overheats your schedule.`,
    structure:
      `Your base pattern hints at a few repeating themes. Use it as a north star; don’t force‑fit against it. ` +
      `Careers thrive when they echo your natural rhythm and energy budget.`,
    yongshin:
      `Helpful focus (“yongshin” style): pick one supportive theme (learning, planning, hydration, rest) and make it a weekly non‑negotiable. ` +
      `Small consistent moves compound into stability.`,
    life_flow:
      `Decade cycles — current: **${curStr}**, next: **${nextStr}**${age!=null?`, age ${age}`:""}. ` +
      `Launch during steadier months; use noisy seasons for drafts and exploration.`,
    summary:
      `Strengths: momentum & adaptability. Watch‑outs: overcommitment & sleep debt. ` +
      `Try this week: one 30‑minute block that supports your weakest element (e.g., water → hydration + evening wind‑down).`
  };
}

// ---------- OpenAI (dynamic import; optional) ----------
async function safeCallOpenAI(payload){
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok:false, error:"NO_OPENAI_KEY" };

  // 동적 import — openai 패키지가 없으면 여기서 catch로 폴백합니다.
  let OpenAI;
  try {
    ({ default: OpenAI } = await import("openai"));
  } catch (e) {
    return { ok:false, error:"OPENAI_MODULE_NOT_FOUND" };
  }

  const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAI({ apiKey: key });

  const { pillars, elements, tenGods, luck, birthDateISO } = getPieces(payload);
  const em = countElements(pillars);
  const hour = `${pillars?.hour?.stem||""}${pillars?.hour?.branch||""}`.trim();
  const day  = `${pillars?.day?.stem||""}${pillars?.day?.branch||""}`.trim();
  const month= `${pillars?.month?.stem||""}${pillars?.month?.branch||""}`.trim();
  const year = `${pillars?.year?.stem||""}${pillars?.year?.branch||""}`.trim();
  const { cur, next, age } = pickCurrentLuck(luck, birthDateISO);

  const system = [
    "You are a Saju/Bazi guide who writes in clear, warm, practical ENGLISH.",
    "Avoid jargon. If a Bazi term appears, explain it in plain English within 1 short phrase.",
    "Return ONLY valid JSON with these string keys:",
    "pillars, day_master, five_elements, structure, yongshin, life_flow, summary.",
    "Each value = 2–5 sentences. No markdown, no lists."
  ].join("\n");

  const userObj = {
    chart: { pillars: { hour, day, month, year }, elements, tenGods, birthDateISO },
    element_totals: em,
    current_luck: cur ? { startAge: cur.startAge, stem: cur.stem, branch: cur.branch, tenGod: cur.tenGod||"" } : null,
    next_luck: next ? { startAge: next.startAge, stem: next.stem, branch: next.branch, tenGod: next.tenGod||"" } : null,
    age
  };

  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.5,
      // 구형 SDK/엔드포인트에서도 동작하도록 response_format은 옵션 처리
      ...(client.chat?.completions?.create ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(userObj) }
      ]
    });

    const txt = resp?.choices?.[0]?.message?.content || "{}";
    let parsed = {};
    try { parsed = JSON.parse(txt); } catch { parsed = {}; }

    const output = {
      pillars: parsed.pillars || "",
      day_master: parsed.day_master || "",
      five_elements: parsed.five_elements || "",
      structure: parsed.structure || "",
      yongshin: parsed.yongshin || "",
      life_flow: parsed.life_flow || "",
      summary: parsed.summary || "",
    };
    return { ok:true, output, provider:"openai" };
  } catch (e) {
    return { ok:false, error:String(e?.message||e) };
  }
}

// ---------- handler ----------
export default async function handler(req, res){
  try{
    const input = req.method === "GET" ? req.query : (req.body || {});

    // 1) OpenAI 시도 (없어도 안전)
    const ai = await safeCallOpenAI(input);
    if (ai.ok) {
      return res.status(200).json({ ok:true, output: ai.output, meta:{ provider: ai.provider } });
    }

    // 2) Fallback (항상 성공)
    const fb = englishFallbackSections(input);
    return res.status(200).json({ ok:true, output: fb, meta:{ provider:"fallback", reason: ai.error || "no_ai" } });

  } catch (err) {
    return res.status(500).json({
      ok:false,
      error:"READING_GENERATE_FAILED",
      message:String(err?.message||err),
    });
  }
}
