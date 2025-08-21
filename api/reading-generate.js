// /api/reading-generate.js
// Next.js pages/api 스타일. OpenAI 있으면 JSON 구조 생성, 없으면 서버 폴백 생성.

export const config = { api: { bodyParser: true } };

// ---------- 작은 유틸 ----------
const STEM_ELEM = { "甲":"wood","乙":"wood","丙":"fire","丁":"fire","戊":"earth","己":"earth","庚":"metal","辛":"metal","壬":"water","癸":"water" };
const BRANCH_ELEM = { "子":"water","丑":"earth","寅":"wood","卯":"wood","辰":"earth","巳":"fire","午":"fire","未":"earth","申":"metal","酉":"metal","戌":"earth","亥":"water" };

function countElementsFromPillars(pillars){
  const m={wood:0,fire:0,earth:0,metal:0,water:0};
  const push=(ch)=>{const e=STEM_ELEM[ch]||BRANCH_ELEM[ch]; if(e) m[e]++;};
  if(!pillars) return m;
  ["hour","day","month","year"].forEach(k=>{ const p=pillars[k]; if(!p) return; push(p.stem); push(p.branch); });
  return m;
}
function labelElements(m){ return `wood:${m.wood}, fire:${m.fire}, earth:${m.earth}, metal:${m.metal}, water:${m.water}`; }
function age(b){ if(!b) return "N/A"; const d=new Date(b+"T00:00:00"); const n=new Date(); let a=n.getFullYear()-d.getFullYear(); const m=n.getMonth()-d.getMonth(); if(m<0||(m===0&&n.getDate()<d.getDate())) a--; return a; }
function currentLuckInfo(luck,birthISO){
  const a=typeof birthISO==="string"? age(birthISO) : null;
  let cur=null,next=null; const list=luck?.bigLuck||[];
  for(const seg of list){ if(typeof a==="number" && a>=seg.startAge && a<seg.startAge+10) cur=seg; }
  if(cur){ next=list.find(x=>x.startAge===cur.startAge+10)||null; } else { next=list[0]||null; }
  return {cur,next,age:a};
}

const DM_DESC = {
  '甲':'Yang Wood (tree): direct, upright, needs space to grow.',
  '乙':'Yin Wood (vine): adaptive, relational, grows by support.',
  '丙':'Yang Fire (sun): bold, generous, visible; needs fuel & pacing.',
  '丁':'Yin Fire (candle): warm, insightful; protect from overuse.',
  '戊':'Yang Earth (mountain): reliable, protective; beware rigidity.',
  '己':'Yin Earth (field): caring, practical; guard against worry.',
  '庚':'Yang Metal (axe): clear‑cutting, decisive; soften edges.',
  '辛':'Yin Metal (jewel): refined, precise; avoid over‑perfection.',
  '壬':'Yang Water (ocean): broad, visionary; anchor your flow.',
  '癸':'Yin Water (dew): observant, adaptive; keep firm boundaries.'
};

// ---------- 서버 폴백 7-섹션 생성 ----------
function synthesizeDetailedReading(ctx){
  const p = ctx?.pillars||{};
  const hour=`${p.hour?.stem||''}${p.hour?.branch||''}`.trim();
  const dayS=p.day?.stem||'', dayB=p.day?.branch||'';
  const day=`${dayS}${dayB}`.trim();
  const month=`${p.month?.stem||''}${p.month?.branch||''}`.trim();
  const year=`${p.year?.stem||''}${p.year?.branch||''}`.trim();

  const em = countElementsFromPillars(p);
  const emLbl = labelElements(em);
  const dom = Object.entries(em).sort((a,b)=>b[1]-a[1])[0]?.[0]||'mixed';
  const missing = Object.keys(em).filter(k=>em[k]===0);
  const {cur,next,age:a} = currentLuckInfo(ctx?.luck, ctx?.birthDateISO);
  const curStr = cur? `${cur.startAge}–${cur.startAge+9} ${cur.stem||''}${cur.branch||''}` : 'N/A';
  const nextStr = next? `${next.startAge}–${next.startAge+9} ${next.stem||''}${next.branch||''}` : 'N/A';
  const dmLine = DM_DESC[dayS] || 'Day Master: description unavailable.';

  const pillars = [
    `Your pillars at a glance —  Hour ${hour}, Day ${day}, Month ${month}, Year ${year}. This is a quick snapshot of personal (day/hour), seasonal (month), and ancestral (year) influences.`,
    `Together they show a **${dom}‑leaning** profile with this count → ${emLbl}.`,
    `Tension to balance: **stability (Earth) vs. expansion (Wood)**. Use choices that feel both *expansive and stable*.`
  ].join('\n\n');

  const day_master = [
    `Your Day Master is **${dayS}**. ${dmLine}`,
    `Style: test‑and‑sense before committing; resilient yet can hesitate.`,
    `Recharge: quiet/natural settings (walks, journaling, water/greenery).`,
    `Watch‑outs: scattering energy or saying “yes” too easily.`,
    `Try: a daily boundary ritual (fixed cutoff time or phone‑off hour).`
  ].join('\n');

  const compat = missing.includes('metal')
    ? 'People with strong **Metal** (clarity, pruning) sharpen your plans; too much extra Wood around you can feel chaotic.'
    : missing.includes('water')
      ? 'People with strong **Water** (insight, reflection) help you pace; heavy Fire crowds decision space.'
      : 'Match with folks who supply what you lack and calm what you overdo.';

  const five_elements = [
    `Element balance leans **${dom}**. Totals → ${emLbl}.`,
    missing.length? `Notable gap: **${missing.join(', ')}**.` : `No hard gap detected; still add intentional pruning and recovery.`,
    compat,
    (missing.includes('metal')
      ? 'Borrow Metal weekly: tidy a workspace, set clear deadlines, do a 15‑min Friday review.'
      : missing.includes('water')
        ? 'Borrow Water: 2×20‑min reflection blocks, hydration anchor, earlier wind‑down.'
        : 'Keep both space (Wood) and order (Earth) in your week.')
  ].join('\n');

  const structure = [
    `Base pattern shows **Resource → Output**: you absorb, then translate into something useful.`,
    `Career fit: teaching/explaining, research→design, content/product where ideas become tools.`,
    `Pitfall: over‑studying without shipping. Design a cycle: **absorb → create → rest**, with visible delivery points.`
  ].join('\n');

  const yongshin = (missing.includes('metal'))
    ? [
        `Most helpful focus: **Metal** (clarity, pruning, boundaries).`,
        `Why: plenty of ideas (Wood) and duty (Earth) but low pruning.`,
        `Make it weekly non‑negotiable:`,
        `• Planning ritual every Sunday\n• Declutter one corner weekly\n• Boundary phrase: “I’ll confirm tomorrow.”`
      ].join('\n')
    : (missing.includes('water'))
      ? [
          `Most helpful focus: **Water** (rest, reflection, hydration).`,
          `Why: strong drive but not enough cooling/recovery.`,
          `Make it weekly non‑negotiable:`,
          `• 2 evening wind‑downs\n• Hydration + short journaling\n• One tech‑free walk`
        ].join('\n')
      : [
          `Helpful focus: **Consistent review cadence**.`,
          `Anchor: weekly plan → mid‑week check → Friday retro.`
        ].join('\n');

  const life_flow = [
    `Decade cycles — current: **${curStr}**, next: **${nextStr}**.`,
    cur ? `Now’s tone: ${cur.tenGod||'mixed'}; practice balancing obligations with 2–3 “big rocks”.` : 'Now: practice balance and baseline routines.',
    next ? `Next decade tends to feel more **decisive** (sharper Metal/Water); expect clearer priorities.` : 'Next: keep optionality and skills broad.',
    `Timing hint: use quieter months to launch; noisy seasons for testing and networking.`
  ].join('\n');

  const summary = [
    `**Strengths:** adaptability, empathy, steady persistence.`,
    `**Watch‑outs:** over‑responsibility, lack of pruning.`,
    `**Micro‑habit:** weekly review + cut‑back ritual (borrow the element you lack).`,
    `Operating manual: a flexible stream with solid banks flows farthest — pair your adaptability with pruning and structure.`,
    `**This week:** finish one project; decline one extra duty.`
  ].join('\n');

  return { pillars, day_master, five_elements, structure, yongshin, life_flow, summary };
}

// ---------- OpenAI 호출 (있으면 사용) ----------
async function tryOpenAI(payload){
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || process.env.OPENAI_API;
  if(!apiKey) return { ok:false, reason:'NO_KEY' };

  let OpenAI;
  try { OpenAI = (await import('openai')).default; }
  catch { return { ok:false, reason:'MODULE_NOT_FOUND' }; }

  const client = new OpenAI({ apiKey });
  const { pillars, luck, birthDateISO } = payload;

  const hour=`${pillars?.hour?.stem||''}${pillars?.hour?.branch||''}`.trim();
  const day=`${pillars?.day?.stem||''}${pillars?.day?.branch||''}`.trim();
  const month=`${pillars?.month?.stem||''}${pillars?.month?.branch||''}`.trim();
  const year=`${pillars?.year?.stem||''}${pillars?.year?.branch||''}`.trim();

  const em = countElementsFromPillars(pillars);
  const {cur,next,age:a} = currentLuckInfo(luck,birthDateISO);
  const curStr = cur? `${cur.startAge}–${cur.startAge+9} ${cur.stem||''}${cur.branch||''}` : 'N/A';
  const nextStr = next? `${next.startAge}–${next.startAge+9} ${next.stem||''}${next.branch||''}` : 'N/A';

  const sys = [
    'You are a Saju/Bazi guide for English speakers.',
    'Tone: clear, warm, practical; avoid jargon; explain briefly when needed.',
    'Return ONLY a JSON object with keys: pillars, day_master, five_elements, structure, yongshin, life_flow, summary.',
    'Write 6–12 sentences per section, use concrete, personalized details from the chart summary.'
  ].join(' ');

  const user = [
    `Pillars: Hour ${hour}, Day ${day}, Month ${month}, Year ${year}.`,
    `Element counts: ${labelElements(em)}.`,
    `Decade: current ${curStr}, next ${nextStr}, age ${a}.`,
    'Follow the user-facing style we agreed (specific, non-generic, helpful micro-habits).'
  ].join(' ');

  try{
    const resp = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.6,
      response_format: { type:'json_object' },
      messages: [
        { role:'system', content: sys },
        { role:'user', content: user }
      ]
    });
    const text = resp.choices?.[0]?.message?.content || '';
    const json = JSON.parse(text);
    // 최소 키 검사
    if(json && (json.pillars || json.day_master || json.five_elements)) {
      return { ok:true, sections: json, meta:{provider:'openai'} };
    }
    return { ok:false, reason:'BAD_JSON' };
  }catch(e){
    return { ok:false, reason:'API_FAIL', error: String(e?.message||e) };
  }
}

// ---------- 핸들러 ----------
export default async function handler(req,res){
  try{
    const payload = req.method === 'POST'
      ? (req.body || {})
      : (req.query || {});

    // 다양한 래핑 케이스 풀기
    const data = payload.chart || payload.data || payload || {};
    const { pillars, elements, tenGods, interactions, luck, birthDateISO } = data;

    const ctx = { pillars, elements, tenGods, interactions, luck, birthDateISO };

    // 1) OpenAI 시도
    const ai = await tryOpenAI(ctx);

    if (ai.ok && ai.sections) {
      return res.status(200).json({ ok:true, output: ai.sections, meta: ai.meta });
    }

    // 2) 서버 폴백 생성
    const sections = synthesizeDetailedReading(ctx);
    return res.status(200).json({ ok:true, output: sections, meta:{ provider:'fallback', reason: ai.reason || 'no_ai' } });

  }catch(e){
    return res.status(200).json({
      ok:false,
      message:'reading-generator failed',
      error:String(e?.message||e)
    });
  }
}
