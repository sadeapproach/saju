// /api/ask.js
// Topic cards & Ask input → 공통 톤/구조 템플릿을 강제해 답변 일관성 보장
// INPUT:  POST { topic?: string, question?: string, calc?: {...} }
// OUTPUT: { ok, topic, question, sections:[{id,label,body}], markdown, model }

const MODEL = process.env.OPENAI_MODEL || process.env.OPENAI_API_MODEL || "gpt-4o-mini";
const OPENAI_KEY = process.env.OPENAI_API_KEY;

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function J(s){ try{return JSON.parse(s)}catch{ return null } }
function clip(s, n){ return (s||"").length>n ? (s.slice(0,n)+"…") : (s||"") }

// 이모지 사전 (섹션 제목에 자동 부착)
const EMO = {
  overview: "✨",
  phases: "🗓️",
  cautions: "⚠️",
  tips: "🌿",
};

const TOPIC_TITLES = {
  wealth: "Wealth & Money",
  money: "Wealth & Money",
  love: "Love & Relationships",
  relationship: "Love & Relationships",
  career: "Career & Growth",
  health: "Health & Wellness",
  family: "Family & Children",
  travel: "Travel / Relocation",
  learning: "Learning & Skills",
  timing: "Timing & Luck Windows",
};

function normalizeTopic(raw){
  const k = (raw||"").toLowerCase().trim();
  for (const key of Object.keys(TOPIC_TITLES)){
    if (k.includes(key)) return key;
  }
  return "wealth";
}

// 템플릿을 마크다운으로 조립
function toMarkdown(blocks){
  const { overview, phases=[], cautions=[], tips=[] } = blocks || {};
  const L = [];
  if (overview) {
    L.push(`**${EMO.overview} Overview**\n${overview.trim()}\n`);
  }
  if (Array.isArray(phases) && phases.length){
    L.push(`**${EMO.phases} Key Phases**`);
    phases.forEach(p=>{
      if (!p || (!p.label && !p.text)) return;
      L.push(`- **${p.label || "Phase"}**: ${p.text}`);
    });
    L.push("");
  }
  if (Array.isArray(cautions) && cautions.length){
    L.push(`**${EMO.cautions} Watch Out**`);
    cautions.forEach(c=>{ if (c) L.push(`- ${c}`); });
    L.push("");
  }
  if (Array.isArray(tips) && tips.length){
    L.push(`**${EMO.tips} Tips**`);
    tips.forEach(t=>{ if (t) L.push(`- ${t}`); });
    L.push("");
  }
  return L.join("\n");
}

// LLM 호출
async function askOpenAI(prompt){
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content:
`You are a Saju (Four Pillars) guide for English-speaking users.
You ALWAYS respond in a unified, warm, concise style (no asterisks/bold spam).
You MUST return valid JSON ONLY with this exact schema:

{
  "overview": "≤120 words, single paragraph, neutral-positive, clear.",
  "phases": [
    {"label": "0–10", "text": "1–2 sentences"},
    {"label": "20s", "text": "1–2 sentences"},
    {"label": "30s", "text": "1–2 sentences"},
    {"label": "40s", "text": "1–2 sentences"},
    {"label": "50s–60s", "text": "1–2 sentences"}
  ],
  "cautions": ["2–4 specific risks, no fearmongering."],
  "tips": ["2–4 practical habits or actions."]
}

Style rules:
- Empathetic, modern tone. Use 1–2 relevant emojis in section headers or first sentence (already injected by UI if missing).
- Avoid generic hype. Balance growth with cautions.
- NEVER include markdown or code fences in the JSON.`
        },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!r.ok) {
    const tx = await r.text();
    throw new Error(`OpenAI ${r.status}: ${clip(tx, 300)}`);
  }
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  return { raw: text, usage: data?.usage };
}

// 프롬프트 생성
function buildPrompt({topic, question, calc}){
  const title = TOPIC_TITLES[topic] || TOPIC_TITLES.wealth;

  // 차트 컨텍스트 요약 (필요한 핵심만)
  const dm = calc?.data?.dayMaster || calc?.data?.pillars?.day?.stem || "";
  const el = calc?.data?.elements || {};
  const pillars = calc?.data?.pillars || {};
  const luck = calc?.data?.luck?.bigLuck || [];
  const luckBrief = Array.isArray(luck) ? luck.map(l => `${l.startAge ?? "?"}:${(l.tenGod ?? l.role ?? l.star ?? "").toString()}`).slice(0,6).join(", ") : "";

  return `
Topic: ${title}
User Question: ${question || "(none, general topic reading)"}

Chart summary (for context):
- Day Master (stem): ${dm}
- Elements ratio (0–1): wood:${el.wood ?? 0}, fire:${el.fire ?? 0}, earth:${el.earth ?? 0}, metal:${el.metal ?? 0}, water:${el.water ?? 0}
- Pillars: H:${pillars.hour?.stem || ""}${pillars.hour?.branch || ""} / D:${pillars.day?.stem || ""}${pillars.day?.branch || ""} / M:${pillars.month?.stem || ""}${pillars.month?.branch || ""} / Y:${pillars.year?.stem || ""}${pillars.year?.branch || ""}
- Big Luck (startAge:tenGod): ${luckBrief}

Task:
Return ONLY the JSON per schema. Keep it on-topic for "${title}" and subtly reflect the chart context.
Ensure the "cautions" list is concrete (no fear), and "tips" are actionable.
`;
}

// Fallback(네트워크/모델 장애 시) – 차트로 간단 생성
function fallbackBlocks(topic, calc) {
  const title = TOPIC_TITLES[topic] || TOPIC_TITLES.wealth;
  const el = calc?.data?.elements || {};
  const dom = Object.entries(el).sort((a,b)=>b[1]-a[1])[0]?.[0] || "wood";
  const map = {
    wood: "growth and learning",
    fire: "expression and visibility",
    earth: "stability and planning",
    metal: "structure and decision‑making",
    water: "adaptability and research",
  };
  return {
    overview: `Your chart leans toward ${dom}, supporting ${map[dom]}. Keep your pace steady and adjust plans with simple checkpoints.`,
    phases: [
      {label:"0–10", text:"Build healthy attitudes. Learn by observation and simple routines."},
      {label:"20s",  text:"Seek mentors and stable processes to support momentum."},
      {label:"30s",  text:"Turn ideas into consistent output; avoid overextending."},
      {label:"40s",  text:"Collaborate with reliable partners; balance ambition with rest."},
      {label:"50s–60s", text:"Consolidate strengths; favor low‑risk, long‑term benefits."},
    ],
    cautions: [
      "Avoid rushing decisions during emotionally charged periods.",
      "Beware of scattered efforts—finish small loops before adding more.",
    ],
    tips: [
      "Use a simple monthly check‑in to tweak goals.",
      "Pair a tiny daily habit with one weekly review to compound gains.",
    ],
  };
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });
  if (!OPENAI_KEY) return res.status(500).json({ ok:false, error:"Missing OPENAI_API_KEY" });

  try{
    const body = typeof req.body === "string" ? J(req.body) : req.body;
    const topicKey = normalizeTopic(body?.topic || "");
    const question = (body?.question || "").trim();
    const calc = body?.calc || null;

    const prompt = buildPrompt({ topic: topicKey, question, calc });
    let parsed = null, blocks = null, md = "";
    let usedModel = MODEL, usage = null;

    try{
      const out = await askOpenAI(prompt);
      usage = out.usage;
      parsed = J(out.raw);
      if (!parsed || typeof parsed !== "object") throw new Error("Bad JSON from model");
      blocks = parsed;
      md = toMarkdown(blocks);
    } catch(e){
      // Fallback
      blocks = fallbackBlocks(topicKey, calc);
      md = toMarkdown(blocks);
    }

    return res.status(200).json({
      ok: true,
      topic: TOPIC_TITLES[topicKey],
      question,
      sections: [
        { id:"overview", label:`${EMO.overview} Overview`, body: blocks.overview },
        { id:"phases",   label:`${EMO.phases} Key Phases`, body: (blocks.phases||[]).map(p=>`• ${p.label}: ${p.text}`).join("\n") },
        { id:"cautions", label:`${EMO.cautions} Watch Out`, body: (blocks.cautions||[]).map(c=>`• ${c}`).join("\n") },
        { id:"tips",     label:`${EMO.tips} Tips`, body: (blocks.tips||[]).map(t=>`• ${t}`).join("\n") },
      ],
      markdown: md,
      model: usedModel,
      usage
    });

  }catch(err){
    return res.status(500).json({ ok:false, error: err?.message || "server_error" });
  }
};
