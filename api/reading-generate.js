// /api/reading-generate.js
// 메인 리딩을 6개 섹션으로 생성 (Core / Balance / Ten Gods / Luck Cycle / Wellness / Summary)
// INPUT:  POST { pillars, elements, tenGods, interactions, luck, locale?, length?, maxBullets? }
// OUTPUT: { ok, output: { title, bullets, forecastOneLiner, actions, sections:[...] }, fallback, mocked }

const MODEL = process.env.OPENAI_MODEL || process.env.OPENAI_API_MODEL || "gpt-4o-mini";
const OPENAI_KEY = process.env.OPENAI_API_KEY;

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function J(s){ try{return JSON.parse(s)}catch{ return null } }
function clip(s, n){ return (s||"").length>n ? (s.slice(0,n)+"…") : (s||"") }

const SECTION_ORDER = [
  { id:"core",    title:"Your Unique Traits" },
  { id:"balance", title:"Creating Balance in Life" },
  { id:"tengods", title:"The Influence of Ten Gods" },
  { id:"luck",    title:"Your Luck Cycle" },
  { id:"wellness",title:"Wellness Suggestions" },
  { id:"summary", title:"Summary of Insights" },
];

const EMO = { core:"💡", balance:"⚖️", tengods:"🧭", luck:"🗓️", wellness:"🩺", summary:"🧾" };

function briefContext({pillars, elements, tenGods, luck}){
  const dm = pillars?.day?.stem || "";
  const el = elements || {};
  const lr = `wood:${el.wood??0}, fire:${el.fire??0}, earth:${el.earth??0}, metal:${el.metal??0}, water:${el.water??0}`;
  const bl = Array.isArray(luck?.bigLuck) ? luck.bigLuck.map(x=>`${x.startAge??"?"}:${x.tenGod??x.role??x.star??""}`).slice(0,6).join(", ") : "";
  return `DayMaster:${dm} | Elements(${lr}) | BigLuck(${bl})`;
}

async function askLLM(prompt){
  const r = await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{
      "Authorization":`Bearer ${OPENAI_KEY}`,
      "Content-Type":"application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.6,
      messages: [
        {
          role:"system",
          content:
`You are a Saju (Four Pillars) guide for English speakers.
Produce a 6-section reading in JSON ONLY with:

{
  "title": "short heading",
  "bullets": ["3–5 concise bullet insights"],
  "forecastOneLiner": "one encouraging yet grounded line",
  "actions": ["1 short 'Try:' suggestion"],
  "sections": [
    {"id":"core","body":"≥4 sentences"},
    {"id":"balance","body":"≥4 sentences"},
    {"id":"tengods","body":"≥4 sentences"},
    {"id":"luck","body":"≥4 sentences"},
    {"id":"wellness","body":"≥4 sentences (include 1 caution)"},
    {"id":"summary","body":"≥3 sentences; crisp recap"}
  ]
}

Style rules:
- Friendly, modern tone. No markdown or code fences in JSON.
- Avoid generic hype. Include 1–2 grounded cautions where relevant (esp. wellness/luck).
- No asterisks or heavy bold; we will render styling in UI.`
        },
        { role:"user", content: prompt }
      ]
    })
  });
  if(!r.ok){ const tx=await r.text(); throw new Error(`OpenAI ${r.status}: ${clip(tx,300)}`); }
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  return { raw:text, usage:data?.usage };
}

function fallbackReading(ctx){
  // 간단 규칙형
  const el = ctx?.elements || {};
  const dom = Object.entries(el).sort((a,b)=>b[1]-a[1])[0]?.[0] || "wood";
  const map = {
    wood: ["curiosity","learning","growth"],
    fire: ["visibility","expression","warmth"],
    earth:["stability","planning","care"],
    metal:["clarity","standards","focus"],
    water:["insight","adaptability","research"],
  };
  const lead = map[dom] || ["balance","clarity"];
  const mkBody = (t)=>`You’re supported by ${lead[0]} and ${lead[1]}. Keep routines light but consistent; pair small daily steps with a brief weekly review. Watch for overextension; close loops before adding more.`;
  return {
    title: "Steady Momentum Ahead",
    bullets: [
      "Lean into your natural strengths while pacing your output.",
      "Close small loops to reduce stress and build confidence.",
      "Simple habits compound faster than big sporadic pushes."
    ],
    forecastOneLiner: "This period favors consistent, grounded progress.",
    actions: ["Try a 10‑minute daily habit paired with a weekly check‑in."],
    sections: SECTION_ORDER.map(s=>({ id:s.id, body: mkBody(s.id) }))
  };
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });
  if (!OPENAI_KEY) return res.status(500).json({ ok:false, error:"Missing OPENAI_API_KEY" });

  try{
    const body = typeof req.body === "string" ? J(req.body) : req.body;
    const pillars = body?.pillars || {};
    const elements = body?.elements || {};
    const tenGods = body?.tenGods || {};
    const luck = body?.luck || {};

    const ctx = { pillars, elements, tenGods, luck };
    const summary = briefContext(ctx);

    const userContent = `
Generate the 6-section reading for this chart.

Context:
${summary}

Notes:
- Audience: general English speakers (not Saju experts).
- Keep it practical, empathetic, specific where possible (without overclaiming).`;

    let parsed=null, out=null, usage=null;

    try{
      const r = await askLLM(userContent);
      usage = r.usage;
      parsed = J(r.raw);
      if (!parsed?.sections || !Array.isArray(parsed.sections)) throw new Error("Bad JSON from model");
      // 섹션 순서 보정 + 라벨 부여
      const secMap = new Map(parsed.sections.map(s=>[s.id,s.body]));
      const fixedSections = SECTION_ORDER.map(s=>({
        id: s.id,
        label: `${EMO[s.id]} ${s.title}`,
        body: (secMap.get(s.id) || "").trim()
      }));
      out = {
        title: parsed.title || "Your Saju Reading",
        bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0,6) : [],
        forecastOneLiner: parsed.forecastOneLiner || "",
        actions: Array.isArray(parsed.actions) && parsed.actions[0] ? [parsed.actions[0]] : [],
        sections: fixedSections
      };
    }catch(e){
      const fb = fallbackReading(ctx);
      out = {
        title: fb.title,
        bullets: fb.bullets,
        forecastOneLiner: fb.forecastOneLiner,
        actions: fb.actions,
        sections: SECTION_ORDER.map(s=>({
          id:s.id, label:`${EMO[s.id]} ${s.title}`,
          body: fb.sections.find(x=>x.id===s.id)?.body || ""
        }))
      };
    }

    return res.status(200).json({
      ok:true,
      output: out,
      fallback: !parsed,
      model: MODEL,
    });

  }catch(err){
    return res.status(500).json({ ok:false, error: err?.message || "server_error" });
  }
};
