// /api/reading-generate.js
// Node Serverless (CommonJS). 정적 require로 openai 의존성을 확실히 포함시킵니다.

const OpenAI = require("openai");

exports.config = { runtime: "nodejs18.x" };

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ---- helpers ----
function countElements(pillars = {}) {
  const STEM = { "甲":"wood","乙":"wood","丙":"fire","丁":"fire","戊":"earth","己":"earth","庚":"metal","辛":"metal","壬":"water","癸":"water" };
  const BR   = { "子":"water","丑":"earth","寅":"wood","卯":"wood","辰":"earth","巳":"fire","午":"fire","未":"earth","申":"metal","酉":"metal","戌":"earth","亥":"water" };
  const n = { wood:0, fire:0, earth:0, metal:0, water:0 };
  ["hour","day","month","year"].forEach(k=>{
    const p = pillars[k];
    if (!p) return;
    const s = STEM[p.stem]; const b = BR[p.branch];
    if (s) n[s]++; if (b) n[b]++;
  });
  return n;
}

function currentLuck(luck, birthISO) {
  try{
    const today = new Date();
    const b = birthISO ? new Date(birthISO + "T00:00:00") : null;
    let age = b ? (today.getFullYear() - b.getFullYear()) : null;
    if (b) {
      const m = today.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
    }
    let cur=null, next=null;
    const list = Array.isArray(luck?.bigLuck) ? luck.bigLuck : [];
    for (const seg of list) if (age != null && age >= seg.startAge && age < seg.startAge + 10) cur = seg;
    if (cur) next = list.find(x=>x.startAge === cur.startAge + 10) || null;
    else next = list[0] || null;
    return { age, cur, next };
  }catch{ return { age:null, cur:null, next:null }; }
}

const safe = v => (typeof v === "string" ? v : v ? JSON.stringify(v) : "");

function makePrompt({pillars, tenGods, luck}) {
  const counts = countElements(pillars || {});
  const byStrength = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(", ");
  const { age, cur, next } = currentLuck(luck, pillars?.birthDateISO);

  const hour = `${pillars?.hour?.stem||""}${pillars?.hour?.branch||""}`;
  const day  = `${pillars?.day?.stem||""}${pillars?.day?.branch||""}`;
  const month= `${pillars?.month?.stem||""}${pillars?.month?.branch||""}`;
  const year = `${pillars?.year?.stem||""}${pillars?.year?.branch||""}`;

  const curStr = cur? `${cur.startAge}–${cur.startAge+9} ${safe(cur.stem)}${safe(cur.branch)} ${cur.tenGod?`(${cur.tenGod})`:""}` : "N/A";
  const nxtStr = next? `${next.startAge}–${next.startAge+9} ${safe(next.stem)}${safe(next.branch)} ${next.tenGod?`(${next.tenGod})`:""}` : "N/A";

  return `
You are a friendly Saju (Bazi) guide. Write in clear, warm, natural English (no jargon unless necessary, and explain it briefly).
Make the content SPECIFIC to the user's chart—do not give generic advice. Use concrete examples.
Target length: each section 4–7 sentences (1–2 short paragraphs). Use bullets sparingly for scannability.

CHART SNAPSHOT
- Pillars: Hour ${hour}, Day ${day}, Month ${month}, Year ${year}.
- Element counts (stems+branches): ${byStrength}.
- Age: ${age ?? "N/A"}, Luck decades: current ${curStr}, next ${nxtStr}.
- Ten Gods (if provided): ${safe(tenGods && tenGods.summary || "")}

Produce EXACTLY this JSON object (minified, no code fences):
{
  "pillars": "Your Four Pillars Overview — 1–2 short paragraphs. Mention how day/hour/month/year interact and one curious tension or harmony.",
  "day_master": "Day Master Traits — personality, decision style, social vibe, recharge pattern grounded in THIS chart.",
  "five_elements": "Element Balance — interpret counts, name weakest/strongest; how to support/balance with daily routines and concrete examples.",
  "structure": "Base Pattern (Structure) — repeated flow (e.g., resource→output), ideal work/learning style, and one likely pitfall and fix.",
  "yongshin": "Helpful Focus (Yongshin) — 1–2 supportive themes and WHY; include 3 practical ways.",
  "life_flow": "Decade Cycle — current vs next; when to launch vs draft; 1 timing hint.",
  "summary": "One-Screen Summary — strengths (3), watch-outs (2), tiny habit for this week (1)."
}
Return only the JSON.
`;
}

function buildFallback(payload) {
  const p = payload?.pillars || {};
  const c = countElements(p);
  const list = Object.entries(c).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(", ");
  const hour = `${p.hour?.stem||""}${p.hour?.branch||""}`;
  const day  = `${p.day?.stem||""}${p.day?.branch||""}`;
  const month= `${p.month?.stem||""}${p.month?.branch||""}`;
  const year = `${p.year?.stem||""}${p.year?.branch||""}`;
  return {
    ok: true,
    output: {
      pillars: `Your pillars at a glance — Hour ${hour}, Day ${day}, Month ${month}, Year ${year}. Element spread: ${list}.`,
      day_master: `Day Master quick take — practical, chart-aware paragraph here.`,
      five_elements: `Balance — what is strong/weak and how to support it in daily life.`,
      structure: `Base pattern — the loop you repeat and one pitfall to watch.`,
      yongshin: `Helpful focus — one supportive theme and why it smooths your system.`,
      life_flow: `Decade view — how the current decade feels vs. next; when to launch vs. draft.`,
      summary: `Strengths, watch‑outs, and one tiny habit to try this week.`
    },
    meta: { provider: "fallback", reason: "OPENAI_FAILED" }
  };
}

function readJSON(req) {
  return new Promise((resolve, reject)=>{
    let data=""; req.on("data", c=> data += c);
    req.on("end", ()=>{ if(!data) return resolve({}); try{ resolve(JSON.parse(data)); }catch{ resolve({}); }});
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  try {
    const body = req.method === "POST" ? (await readJSON(req)) : {};
    const payload = body.chart || body.data || body || {};
    const pillars  = payload.pillars || {};
    const tenGods  = payload.tenGods || null;
    const luck     = payload.luck || null;

    if (!process.env.OPENAI_API_KEY) {
      const fb = buildFallback(payload);
      return res.status(200).json({ ok:false, error:"OPENAI_FAILED", reason:"NO_API_KEY", output: fb.output, meta:{provider:"fallback"} });
    }

    const prompt = makePrompt({ pillars, tenGods, luck });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.75,
      messages: [
        { role: "system", content: "You write helpful, concrete Saju readings for non‑experts. Keep it specific, grounded, and kind." },
        { role: "user", content: prompt }
      ]
    });

    const txt = (completion.choices?.[0]?.message?.content || "").trim();
    let parsed = null;
    try{
      const clean = txt.replace(/^```json/i,"").replace(/```$/,"").trim();
      parsed = JSON.parse(clean);
    }catch{}

    if (!parsed || typeof parsed !== "object") {
      const fb = buildFallback(payload);
      return res.status(200).json(fb);
    }

    const out = {
      pillars: parsed.pillars || "",
      day_master: parsed.day_master || parsed["day master"] || "",
      five_elements: parsed.five_elements || parsed["five elements"] || "",
      structure: parsed.structure || "",
      yongshin: parsed.yongshin || parsed["helpful_focus"] || "",
      life_flow: parsed.life_flow || parsed["decade_cycle"] || "",
      summary: parsed.summary || ""
    };

    return res.status(200).json({ ok:true, output: out, meta:{ provider:"openai" } });

  } catch (e) {
    const fb = buildFallback({});
    return res.status(200).json({ ok:false, error:"OPENAI_FAILED", reason:String(e?.message||e), output: fb.output, meta:{ provider:"fallback" } });
  }
};
