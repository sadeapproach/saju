// /api/reading-generate.mjs
// Node.js Serverless Function (ESM). Vercel은 .mjs를 지원합니다.
// 정적 import로 openai 의존성을 확실히 포함시킵니다.
import OpenAI from "openai";

/** Vercel Node 런타임 강제 (Edge가 아니어야 합니다) */
export const config = {
  runtime: "nodejs18.x"
};

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function countElements(pillars = {}) {
  const STEM = { "甲":"wood","乙":"wood","丙":"fire","丁":"fire","戊":"earth","己":"earth","庚":"metal","辛":"metal","壬":"water","癸":"water" };
  const BR  = { "子":"water","丑":"earth","寅":"wood","卯":"wood","辰":"earth","巳":"fire","午":"fire","未":"earth","申":"metal","酉":"metal","戌":"earth","亥":"water" };
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
    const b = new Date(birthISO + "T00:00:00");
    let age = today.getFullYear() - b.getFullYear();
    const m = today.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
    let cur=null, next=null;
    const list = Array.isArray(luck?.bigLuck) ? luck.bigLuck : [];
    for (const seg of list) if (age >= seg.startAge && age < seg.startAge + 10) cur = seg;
    if (cur) next = list.find(x=>x.startAge === cur.startAge + 10) || null;
    else next = list[0] || null;
    return { age, cur, next };
  }catch{ return { age:null, cur:null, next:null }; }
}

/** 안전한 텍스트 헬퍼 */
const safe = v => (typeof v === "string" ? v : v ? JSON.stringify(v) : "");

function makePrompt({pillars, elements, tenGods, luck, locale="en"}) {
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
Target length: each section 4–7 sentences (split into 1–2 short paragraphs if helpful). Add a few bullets where it improves scannability.
Never invent dates; use relative phrasing if exact dates are unavailable.

CHART SNAPSHOT
- Pillars: Hour ${hour}, Day ${day}, Month ${month}, Year ${year}.
- Element counts (stems+branches): ${byStrength}.
- Age: ${age ?? "N/A"}, Luck decades: current ${curStr}, next ${nxtStr}.
- Ten Gods (if provided): ${safe(tenGods && tenGods.summary || "")}

SECTIONS TO PRODUCE (exact keys, JSON; each value is rich plain text with minimal markdown):
{
  "pillars": "Your Four Pillars Overview — 1–2 short paragraphs. Mention how day/hour/month/year interact and one curious tension or harmony.",
  "day_master": "Day Master Traits — describe personality, decision style, social vibe, and recharge pattern that fit THIS day master + interactions.",
  "five_elements": "Element Balance — interpret the counts, name the weakest/strongest and how to support/balance them (daily routines and situations).",
  "structure": "Base Pattern (Structure) — what repeats in this chart (e.g., resource→output), ideal work/learning style, and a likely pitfall.",
  "yongshin": "Helpful Focus (Yongshin) — 1–2 themes that smooth the system (e.g., 'Metal for clarity'). Explain WHY and give 3 practical ways.",
  "life_flow": "Decade Cycle — how the current decade feels vs. the next decade. One suggestion for timing launches vs. drafting.",
  "summary": "One-Screen Summary — strengths (3), watch-outs (2), and a tiny habit to try this week (1)."
}

Return ONLY a minified JSON object with those keys (no code fences, no commentary).
`;
}

function buildFallback(payload) {
  // 안전한 폴백(서버/키 문제 시)
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
      structure: `Base pattern — the system you naturally repeat and one pitfall to watch.`,
      yongshin: `Helpful focus — one supportive theme and why it smooths your system.`,
      life_flow: `Decade view — how the current decade feels vs. next; when to launch vs. draft.`,
      summary: `Strong sides, watch‑outs, and one tiny habit to try this week.`
    },
    meta: { provider: "fallback", reason: "OPENAI_FAILED" }
  };
}

export default async function handler(req, res) {
  try {
    const body = req.method === "POST" ? (await readJSON(req)) : {};
    const payload = body.chart || body.data || body || {};
    // 필수 데이터
    const pillars = payload.pillars || {};
    const tenGods = payload.tenGods || null;
    const luck    = payload.luck || null;

    // OpenAI 호출
    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({ ok:false, error:"OPENAI_FAILED", reason:"NO_API_KEY", output: buildFallback(payload).output, meta:{provider:"fallback"} });
    }

    const prompt = makePrompt({ pillars, tenGods, luck });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: "You write helpful, concrete Saju readings for non‑experts. Keep it specific, grounded, and kind." },
        { role: "user", content: prompt }
      ]
    });

    const txt = (completion.choices?.[0]?.message?.content || "").trim();

    // JSON 파싱 (안전)
    let parsed = null;
    try {
      // 혹시 ```json ... ``` 형태면 벗겨냄
      const clean = txt.replace(/^```json/i,"").replace(/```$/,"").trim();
      parsed = JSON.parse(clean);
    } catch(_){ /* no-op */ }

    if (!parsed || typeof parsed !== "object") {
      // 모델이 형식을 어겼을 때는 폴백
      const fb = buildFallback(payload);
      return res.status(200).json(fb);
    }

    // 섹션 키 보정
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
    // 예외 발생 시 폴백
    const fb = buildFallback({});
    return res.status(200).json({ ok:false, error:"OPENAI_FAILED", reason:String(e?.message||e), output: fb.output, meta:{ provider:"fallback" } });
  }
}

/** ---- helpers ---- */
function readJSON(req) {
  return new Promise((resolve, reject)=>{
    let data = "";
    req.on("data", chunk => data += chunk);
    req.on("end", ()=>{
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch(e){ resolve({}); }
    });
    req.on("error", reject);
  });
}
