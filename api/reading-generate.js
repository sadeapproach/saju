// api/reading-generate.js
// Extended reading generator that ALWAYS returns 6 sections the frontend expects.
// - If OPENAI_API_KEY is present, it will ask the model for copy and then enrich/guard.
// - If not, it will build high-quality deterministic prose from pillars/elements/tenGods/interactions/luck.
// Response shape:
// {
//   ok: true,
//   output: {
//     title, bullets[], forecastOneLiner, actions[],
//     sections: [{ id, kicker, title, p1..p5, list[], keywords[] }, ... 6 items]
//   },
//   mocked: boolean, fallback: boolean
// }

const USE_MODEL = !!process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.SAJU_OPENAI_MODEL || "gpt-4o-mini"; // small, cheap; override if you like

function J(x){ try { return JSON.parse(x); } catch { return null; } }
function pct(n){ return Math.round((n || 0) * 100); }

function nounFor(elem){
  return {wood:"Wood",fire:"Fire",earth:"Earth",metal:"Metal",water:"Water"}[elem] || elem;
}
function emoFor(elem){
  return {
    wood:"growth, creativity, planning",
    fire:"passion, visibility, courage",
    earth:"stability, care, patience",
    metal:"clarity, discipline, structure",
    water:"intuition, adaptability, wisdom"
  }[elem] || "balance";
}
function lifestyleFor(elem){
  return {
    wood:"green color palette, hiking, learning new skills",
    fire:"sunlight, warm colors, dance or cardio",
    earth:"gardening, cooking, grounding routines",
    metal:"decluttering, journaling, breathwork",
    water:"meditation near water, reflective writing, calm walks"
  }[elem] || "gentle movement and mindful routines";
}
function healthFor(elem){
  return {
    wood:"liver/eyes; stretch hips & sides; sleep by 11pm",
    fire:"heart/small intestine; keep caffeine moderate; cooling foods",
    earth:"spleen/stomach; consistent meals; warm easy-to-digest foods",
    metal:"lungs/skin; fresh air; breath training",
    water:"kidneys/ears; hydrate; manage stress and sleep"
  }[elem] || "overall balance";
}
function guessDayMaster(pillars){
  // pillars.day.stem exists in our calc output
  const dm = pillars?.day?.stem || "";
  const map = {甲:"wood",乙:"wood",丙:"fire",丁:"fire",戊:"earth",己:"earth",庚:"metal",辛:"metal",壬:"water",癸:"water"};
  return map[dm] || null;
}
function topElements(elements){
  const arr = Object.entries(elements||{}).map(([k,v])=>({k,v}));
  arr.sort((a,b)=> (b.v||0) - (a.v||0));
  return arr;
}
function need(bucket, t=0.20){ // deficient if strictly below 20%
  return (bucket||0) < t;
}
function excess(bucket, t=0.30){ // strong if >= 30%
  return (bucket||0) >= t;
}

function buildDeterministicReading(payload){
  const { pillars, elements={}, tenGods={}, interactions={}, luck } = payload || {};

  // ---- Header summary
  const dm = guessDayMaster(pillars);
  const top = topElements(elements);
  const topKey = top[0]?.k || dm || "balance";
  const dmNoun = nounFor(dm || topKey);

  const title = "Embracing Your Unique Journey";
  const bullets = [
    `Balance your elements for a harmonious life.`,
    `Focus on nurturing relationships and meaningful connections.`,
    `Stay open to new opportunities and hands-on experiences.`,
    `Prioritize self-care and mindful routines to sustain energy.`
  ];
  const forecastOneLiner = "This is a period to align your strengths with supportive habits and clear intentions.";
  const actions = [
    `Try: Engage in creative outlets that express your inner voice (e.g., ${lifestyleFor(topKey)}).`
  ];

  // ---- Section 1: Traits
  const traits = {
    id: "traits",
    kicker: "SECTION",
    title: "Core Traits & Disposition (기본 성향·기질)",
    p1: `As a Day Master represented by ${dmNoun} element, your core nature leans toward ${emoFor(dm || topKey)}.`,
    p2: `You thrive when your daily life includes rhythms that match your temperament—this keeps your decision-making clear and your motivation steady.`,
    p3: `Your strengths are noticeable in the way you handle challenges: you tend to learn, adapt, and then move forward with confidence.`,
    p4: `When stressed, you may overuse your strongest element; creating small balancing rituals helps you stay centered.`
  };

  // ---- Section 2: Element Balance
  const balanceList = [
    `Wood ${pct(elements.wood)}%`, `Fire ${pct(elements.fire)}%`,
    `Earth ${pct(elements.earth)}%`, `Metal ${pct(elements.metal)}%`,
    `Water ${pct(elements.water)}%`
  ];
  const lack = Object.entries(elements).filter(([k,v])=>need(v)).map(([k])=>nounFor(k));
  const strong = Object.entries(elements).filter(([k,v])=>excess(v)).map(([k])=>nounFor(k));
  const balance = {
    id: "balance",
    kicker: "SECTION",
    title: "Element Balance (오행 균형·보완)",
    p1: `Your mix shows strengths in ${strong.length? strong.join(", "): "certain areas"} and room to nourish ${lack.length? lack.join(", "): "overall steadiness"}.`,
    p2: `${lack.length? `Gently boost ${lack.join(", ")} with colors, activities, and environments that evoke them.` : `Maintain your current routines to protect balance.`}`,
    p3: `${strong.length? `If a strong element runs the show for too long, schedule counter-balancing breaks to avoid burnout.` : `Keep small anchors—sleep, food, fresh air—to stay grounded.`}`,
    p4: `Practical cues: ${nounFor(topKey)} rituals such as ${lifestyleFor(topKey)} are especially beneficial now.`,
    list: balanceList,
    keywords: ["balance","habits", dmNoun, ...strong.slice(0,1), ...lack.slice(0,1)].filter(Boolean)
  };

  // ---- Section 3: Ten Gods — Wealth/Career/Relationships
  const tgDay = (tenGods?.byPillar?.day || tenGods?.day || "");
  const tgMonth = (tenGods?.byPillar?.month || tenGods?.month || "");
  const tgYear = (tenGods?.byPillar?.year || tenGods?.year || "");
  const tenGodsSec = {
    id: "tenGods",
    kicker: "SECTION",
    title: "Ten Gods — Wealth/Career/Relationships (십신 기반 경향)",
    p1: `Career & learning: signs point to growth through ${tgMonth || "focused practice"} and consistent skill-building.`,
    p2: `Wealth: look for ${tgDay || "steady"} income streams first; experiment with variable opportunities once the foundation holds.`,
    p3: `Relationships: your ${tgYear || "social ties"} benefit from clear communication and shared goals.`,
    p4: `Teamwork improves when you mix your strengths with someone whose element complements yours.`
  };

  // ---- Section 4: Luck cycles
  const firstLuck = (luck?.bigLuck || [])[0];
  const nowLuck = (luck?.bigLuck || []).find(x=>{
    const a = x?.startAge; if(typeof a!=='number') return false;
    const age = payload?.age;
    return typeof age==='number' ? (age>=a && age<a+10) : false;
  });
  const luckSec = {
    id: "luck",
    kicker: "SECTION",
    title: "Big Luck & Yearly Outlook (대운·세운 요약)",
    p1: `Your long cycles suggest steady progress when you keep routines that amplify your strongest qualities.`,
    p2: nowLuck ? `Current 10-year cycle (starts ${nowLuck.startAge}): ${nowLuck.stem||""}${nowLuck.branch||""} — lean into its lessons with patience.` : `Focus on building momentum for the coming cycle.`,
    p3: firstLuck ? `Early cycle hint: ${firstLuck.stem||""}${firstLuck.branch||""} encouraged foundational skills—returning to those basics can open new doors.` : `Use the present to lay strong groundwork.`,
    p4: `Yearly changes add flavor, but your daily habits decide the real outcome.`
  };

  // ---- Section 5: Wellness
  const weak = topElements(elements).slice().reverse().find(x=>need(x.v,0.20))?.k || null;
  const wellness = {
    id: "wellness",
    kicker: "SECTION",
    title: "Health & Lifestyle Advice (건강·생활 조언)",
    p1: `Keep body and mind steady with realistic sleep, simple nutrition, and fresh air.`,
    p2: weak ? `Gently nourish ${nounFor(weak)}: ${healthFor(weak)}.` : `Maintain balance across all five phases; small routines beat big overhauls.`,
    p3: `Stress test: if your strongest element gets overused (e.g., too much work, too much socializing), plan a brief opposite activity to reset.`,
    p4: `Light, movement, and hydration remain the simplest levers with the biggest payoff.`,
    keywords: ["well-being","sleep","movement","hydration"]
  };

  // ---- Section 6: Overall summary
  const summary = {
    id: "summary",
    kicker: "SECTION",
    title: "Overall Keywords & One-liner (전반 요약)",
    p1: `This season rewards patience, steady practice, and self-honesty.`,
    p2: `Your strengths are ${dmNoun.toLowerCase()}-style qualities—use them to shape routines that truly fit you.`,
    p3: `Focus on what you can repeat weekly; momentum follows clarity.`,
    p4: `A small, meaningful action repeated often will outpace a perfect plan delayed.`,
    keywords: ["clarity","consistency","momentum"]
  };

  return {
    ok: true,
    output: { title, bullets, forecastOneLiner, actions, sections:[traits, balance, tenGodsSec, luckSec, wellness, summary] },
    mocked: !USE_MODEL,
    fallback: false
  };
}

// If OPENAI key exists, we’ll ask for prose then still guarantee sections.
async function callModel(payload){
  const { pillars, elements, tenGods, interactions, luck } = payload || {};
  const sys = `You are a Saju (Four Pillars) assistant. Output JSON ONLY with:
{
 "title": "...",
 "bullets": ["...", "...", "..."],
 "forecastOneLiner": "...",
 "actions": ["..."],
 "sections": [
   {"id":"traits","kicker":"SECTION","title":"...","p1":"...","p2":"...","p3":"...","p4":"..."},
   {"id":"balance","kicker":"SECTION","title":"...","p1":"...","p2":"...","p3":"...","p4":"...","list":["..."],"keywords":["..."]},
   {"id":"tenGods","kicker":"SECTION","title":"...","p1":"...","p2":"...","p3":"...","p4":"..."},
   {"id":"luck","kicker":"SECTION","title":"...","p1":"...","p2":"...","p3":"...","p4":"..."},
   {"id":"wellness","kicker":"SECTION","title":"...","p1":"...","p2":"...","p3":"...","p4":"...","keywords":["..."]},
   {"id":"summary","kicker":"SECTION","title":"...","p1":"...","p2":"...","p3":"...","p4":"...","keywords":["..."]}
 ]
}
Each paragraph must be 1–2 sentences in clear, encouraging English. Avoid medical claims; give gentle lifestyle suggestions.`;

  const user = {
    pillars,
    elements,
    tenGods,
    interactions,
    luck,
    intent: "long_sections",
    locale: "en-US"
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{
      "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type":"application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        {role:"system", content: sys},
        {role:"user", content: JSON.stringify(user)}
      ],
      temperature: 0.7,
    })
  });
  if(!r.ok){
    const text = await r.text();
    return { ok:false, error:`openai_error ${r.status}`, raw:text };
  }
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content || "{}";
  const parsed = J(text) || {};
  // Guard: ensure we have sections; otherwise fallback to deterministic
  if(!Array.isArray(parsed.sections) || parsed.sections.length < 6){
    const det = buildDeterministicReading(payload);
    // merge model header if present
    det.output.title = parsed.title || det.output.title;
    det.output.bullets = Array.isArray(parsed.bullets)&&parsed.bullets.length ? parsed.bullets : det.output.bullets;
    det.output.forecastOneLiner = parsed.forecastOneLiner || det.output.forecastOneLiner;
    det.output.actions = Array.isArray(parsed.actions)&&parsed.actions.length ? parsed.actions : det.output.actions;
    return { ok:true, output: det.output, mocked:false, fallback:true };
  }
  return { ok:true, output: parsed, mocked:false, fallback:false };
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    return res.status(405).json({ ok:false, error:"Use POST" });
  }
  const body = typeof req.body === 'string' ? J(req.body) : req.body || {};
  const payload = {
    pillars: body.pillars || {},
    elements: body.elements || {},
    tenGods: body.tenGods || {},
    interactions: body.interactions || {},
    luck: body.luck || {},
    age: body.age
  };

  try{
    let out;
    if(USE_MODEL){
      out = await callModel(payload);
      if(!out.ok) {
        // Model failed → deterministic fallback with flag
        const det = buildDeterministicReading(payload);
        det.fallback = true;
        return res.status(200).json(det);
      }
      return res.status(200).json(out);
    } else {
      const det = buildDeterministicReading(payload);
      return res.status(200).json(det);
    }
  } catch (e){
    const det = buildDeterministicReading(payload);
    det.fallback = true;
    det.error = e?.message || 'reading_error';
    return res.status(200).json(det);
  }
}
