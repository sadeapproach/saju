// /api/reading-generate.js
// Next.js / Vercel serverless (Node on Vercel). CommonJS 스타일.
// OpenAI 호출 + 강한 포맷 지시 + 클린업 후 7섹션 반환.

const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || "",
});

function countElements(pillars) {
  const STEM = { "甲":"wood","乙":"wood","丙":"fire","丁":"fire","戊":"earth","己":"earth","庚":"metal","辛":"metal","壬":"water","癸":"water" };
  const BR =   { "子":"water","丑":"earth","寅":"wood","卯":"wood","辰":"earth","巳":"fire","午":"fire","未":"earth","申":"metal","酉":"metal","戌":"earth","亥":"water" };
  const m = { wood:0, fire:0, earth:0, metal:0, water:0 };
  if (!pillars) return m;
  ["hour","day","month","year"].forEach(k=>{
    const p=pillars[k]; if(!p) return;
    const e1 = STEM[p.stem]; if(e1) m[e1]++;
    const e2 = BR[p.branch]; if(e2) m[e2]++;
  });
  return m;
}

function currentLuckInfo(luck, birthISO){
  const age = (()=>{ try{
    if(!birthISO) return null;
    const d=new Date(birthISO+"T00:00:00");
    const n=new Date(); let a=n.getFullYear()-d.getFullYear();
    const m=n.getMonth()-d.getMonth();
    if(m<0 || (m===0 && n.getDate()<d.getDate())) a--;
    return a;
  }catch{ return null; } })();
  let cur=null, next=null;
  const list = (luck && Array.isArray(luck.bigLuck)) ? luck.bigLuck : [];
  for (const seg of list){
    if (age!=null && age>=seg.startAge && age<seg.startAge+10) cur = seg;
  }
  if (cur) next = list.find(x=>x.startAge===cur.startAge+10) || null;
  else next = list[0] || null;
  return { age, cur, next };
}

function summarizeChart(chart){
  const {pillars={}, luck} = chart || {};
  const hour=`${pillars?.hour?.stem||''}${pillars?.hour?.branch||''}`;
  const day =`${pillars?.day?.stem||''}${pillars?.day?.branch||''}`;
  const month=`${pillars?.month?.stem||''}${pillars?.month?.branch||''}`;
  const year =`${pillars?.year?.stem||''}${pillars?.year?.branch||''}`;
  const em = countElements(pillars);
  const dom = Object.entries(em).sort((a,b)=>b[1]-a[1])[0]?.[0]||'mixed';
  const {age,cur,next} = currentLuckInfo(luck, chart?.birthDateISO);
  const curStr = cur ? `${cur.startAge}–${cur.startAge+9} ${cur.stem||''}${cur.branch||''} ${cur.tenGod?`(${cur.tenGod})`:''}` : 'N/A';
  const nextStr = next ? `${next.startAge}–${next.startAge+9} ${next.stem||''}${next.branch||''} ${next.tenGod?`(${next.tenGod})`:''}` : 'N/A';
  return [
    `Pillars: Hour ${hour}, Day ${day}, Month ${month}, Year ${year}.`,
    `Element counts → wood:${em.wood}, fire:${em.fire}, earth:${em.earth}, metal:${em.metal}, water:${em.water}. Dominant: ${dom}.`,
    `Age: ${age==null?'N/A':age}. Luck decades: current ${curStr}; next ${nextStr}.`
  ].join(' ');
}

/* ----------- strict cleanup: 제목/넘버링/불릿/별표 제거 & 여백 정리 ----------- */
function cleanText(t){
  if(!t) return "";
  let s = String(t);

  // 라인 앞 제목/넘버링 제거: "**1. Title**", "1. Title", "# Title", "## Title", "- bullet", "• bullet" 등
  s = s.replace(/^\s*\*{1,3}\s*\d+\.\s*.*?\*{1,3}\s*$/gm, ""); // **1. Title**
  s = s.replace(/^\s*\d+[\.\)]\s+/gm, "");                     // 1. Title
  s = s.replace(/^\s*#{1,6}\s+/gm, "");                        // # Title
  s = s.replace(/^\s*[-–•●]\s+/gm, "");                        // bullets
  s = s.replace(/^\s*\*\s+/gm, "");                            // * bullet

  // 남은 별표(**bold**, *italic*) 모두 제거
  s = s.replace(/\*/g, "");

  // 분리자 실수로 남은 경우 제거
  s = s.replace(/<<<[A-Z_]+>>>/g, "");

  // 문단 trim & 연속 개행 3개 이상 → 2개
  s = s.split("\n").map(l=>l.trimEnd()).join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

/* ----------- 분리자 기반 파서 ----------- */
function splitIntoSections(raw){
  if (!raw) return Array(7).fill("");
  const grab = (a,b) => {
    const r = new RegExp(`${a}([\\s\\S]*?)${b}`); const m = raw.match(r);
    return m ? m[1].trim() : "";
  };
  const p1 = grab("<<<PILLARS>>>","<<<DAY_MASTER>>>");
  const p2 = grab("<<<DAY_MASTER>>>","<<<FIVE_ELEMENTS>>>");
  const p3 = grab("<<<FIVE_ELEMENTS>>>","<<<STRUCTURE>>>");
  const p4 = grab("<<<STRUCTURE>>>","<<<YONGSHIN>>>");
  const p5 = grab("<<<YONGSHIN>>>","<<<LIFE_FLOW>>>");
  const p6 = grab("<<<LIFE_FLOW>>>","<<<DAILY_COMPASS>>>");
  const p7 = grab("<<<DAILY_COMPASS>>>","<<<END>>>");

  return [p1,p2,p3,p4,p5,p6,p7].map(cleanText);
}

/* ----------- 프롬프트 ----------- */
function buildPrompt(chart){
  const chartSummary = summarizeChart(chart);

  // * 섹션 제목 절대 금지
  // * 별표/불릿/넘버링 전부 금지
  // * 각 섹션 2~3 문단, 총 160~220+ 단어 권장
  // * 분리자 사이 '본문만' 작성
  return `
You are a friendly Saju/Bazi guide for English-speaking users who are new to this topic.
Write clearly, concretely, and practically, avoiding jargon unless explained in simple words.

HARD FORMAT RULES (VERY IMPORTANT):
- Do NOT include any section titles, headings, numbering, bullets, or asterisks anywhere.
- Write plain paragraphs only.
- Use 2–3 paragraphs per section, each with 2–4 sentences (more if needed for clarity).
- Be specific and tailored to the chart; avoid generic motivational lines.
- Keep grammar tight; prefer active voice and crisp sentences.

CHART CONTEXT (for reference):
${chartSummary}

SECTIONS TO WRITE (CONTENT ONLY, NO TITLES):
1) PILLARS OVERVIEW:
  - What the four pillars together imply this year (personal/day, seasonal/month, ancestral/year influences).
  - Note the main tension or harmony you see; explain how to navigate it with one actionable idea.
  - 2–3 paragraphs.

2) DAY MASTER TRAITS:
  - Personality, decision style, social/relationship pattern, recharge environments and recovery.
  - 2–3 paragraphs.

3) ELEMENT BALANCE:
  - Map element counts to behavior; say what’s strong/weak and what to add or soften in daily life.
  - State at least one DO and one AVOID.
  - 2–3 paragraphs.

4) BASE PATTERN (STRUCTURE):
  - What themes repeat for career/learning vs wealth; north-star guidance; one pitfall & how to counter it.
  - 2–3 paragraphs.

5) HELPFUL FOCUS (YONGSHIN):
  - A single focus keyword (e.g., clarity, pacing, boundaries); justify with chart; give 2 micro-habits.
  - 2–3 paragraphs.

6) DECADE CYCLE (LIFE FLOW):
  - Describe current decade tone vs next decade shift; when to push vs pause; one timing hint.
  - 2–3 paragraphs.

7) DAILY COMPASS:
  - A tiny daily habit + how to apply strengths and protect common weak spots; make it immediately usable.
  - 2–3 paragraphs.

OUTPUT EXACTLY IN THIS MACHINE-READABLE LAYOUT (do not add any extra text):
<<<PILLARS>>>
[content only]
<<<DAY_MASTER>>>
[content only]
<<<FIVE_ELEMENTS>>>
[content only]
<<<STRUCTURE>>>
[content only]
<<<YONGSHIN>>>
[content only]
<<<LIFE_FLOW>>>
[content only]
<<<DAILY_COMPASS>>>
[content only]
<<<END>>>
  `.trim();
}

/* ----------- 핸들러 ----------- */
async function handler(req, res){
  try{
    if (req.method !== "POST" && req.method !== "GET") {
      res.status(405).json({ ok:false, error:"METHOD_NOT_ALLOWED" });
      return;
    }

    // 입력 수집
    let chart = {};
    if (req.method === "POST") {
      chart = req.body?.chart || req.body || {};
      // 보편 케이스도 지원: {pillars,elements,tenGods,interactions,luck}
      if (!chart.pillars && req.body?.pillars) {
        chart = {
          pillars: req.body.pillars,
          elements: req.body.elements,
          tenGods: req.body.tenGods,
          interactions: req.body.interactions,
          luck: req.body.luck,
          birthDateISO: req.body.birthDateISO
        };
      }
    } else {
      // GET일 때는 데모/폴백: 프런트에서 호출만 확인 용
      chart = {};
    }

    // OpenAI 호출
    if (!client.apiKey) {
      // 키가 없으면 폴백(로컬/프리뷰)
      const demo = {
        pillars: "Your chart combines grounded planning with creative growth. Treat stability as a launchpad, not a cage. Use weekly reviews to course‑correct early.",
        day_master: "You tend to decide through feeling plus fact. Keep boundaries firm; recover in quiet nature or short reflective walks.",
        five_elements: "Wood & Earth are strong; Metal/Water weaker. Do: tidy workspace on Fridays; Avoid: scattering focus across too many starts.",
        structure: "Theme favors learning→shipping loop. North‑star: small, visible deliveries. Pitfall: perfectionism; counter with time‑boxed drafts.",
        yongshin: "Focus: clarity. Micro‑habits: 10‑min morning outline + one‑line evening debrief.",
        life_flow: "Current decade emphasizes personal craft; next expands reach. Launch during quieter seasonal windows; pause during family spikes.",
        daily_compass: "Tiny habit: 5‑minute ‘close‑down’ each evening—pick tomorrow’s first step and clear the desk."
      };
      res.status(200).json({ ok:true, provider:"fallback", output: demo });
      return;
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const prompt = buildPrompt(chart);

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.6,
      messages: [
        { role: "system", content: "You are a precise, concrete Saju/Bazi guide. Follow formatting instructions strictly." },
        { role: "user", content: prompt }
      ]
    });

    const rawText = completion.choices?.[0]?.message?.content || "";

    const parts = splitIntoSections(rawText);

    const output = {
      pillars: parts[0],
      day_master: parts[1],
      five_elements: parts[2],
      structure: parts[3],
      yongshin: parts[4],
      life_flow: parts[5],
      daily_compass: parts[6]
    };

    res.status(200).json({
      ok: true,
      provider: "openai",
      model,
      output,
      raw: process.env.NODE_ENV === "development" ? rawText : undefined
    });

  }catch(err){
    res.status(500).json({
      ok:false,
      error:"OPENAI_FAILED",
      reason: err?.message || String(err),
      more: (err && err.response && err.response.data) ? err.response.data : undefined
    });
  }
}

module.exports = handler;
