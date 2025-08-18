// api/calc.js
// End-to-end calc with guaranteed 6 reading sections.
// - Tries to use your existing precise engine if present (./saju/calc-core or ./saju/calc).
// - Falls back to a lightweight deterministic calculator so the endpoint never breaks.
// - Always returns { ok:true, data:{ pillars, elements, tenGods, interactions, luck, sections } }

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok:false, error:'Use POST' });
  }

  try {
    const {
      birthDateISO,      // "YYYY-MM-DD"
      birthTime,         // "HH:mm" | null
      lat, lng,
      tzId,              // e.g. "Asia/Seoul"
      timeAccuracy = 'exact'
    } = (req.body || {});

    if (!birthDateISO) {
      return res.status(400).json({ ok:false, error:'Missing birthDateISO' });
    }

    // 1) RUN YOUR EXISTING PRECISE ENGINE IF AVAILABLE
    //    (Put your real calculator in ./saju/calc-core.js or ./saju/calc.js exporting compute(payload))
    let core = null;
    try { core = require('./saju/calc-core'); } catch {}
    if (!core?.compute) { try { core = require('./saju/calc'); } catch {} }

    let computed = null;
    if (core?.compute) {
      computed = await core.compute({ birthDateISO, birthTime, lat, lng, tzId, timeAccuracy });
      // Expect shape: { pillars, elements, tenGods, interactions, luck }
    } else {
      // 2) LIGHT FALLBACK so endpoint never breaks (not for production astrology accuracy)
      computed = fallbackCompute({ birthDateISO, birthTime, tzId });
    }

    // 3) ALWAYS ATTACH SECTIONS (the 6 guaranteed cards)
    const sections = buildSections(computed, { birthDateISO, tzId });

    const payload = {
      ok: true,
      input: { birthDateISO, birthTime, lat, lng, tzId, timeAccuracy },
      data: {
        ...computed,
        sections
      }
    };

    return res.status(200).json(payload);
  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || 'calc_failed' });
  }
}

/* --------------------------------------------
   Fallback calculator (simple & deterministic)
   -------------------------------------------- */
function fallbackCompute({ birthDateISO, birthTime, tzId }) {
  // Very lightweight deterministic generator so UI works.
  // It is NOT a precise 4P calculator. Your own engine (if present) is used first.
  const seed = hash(`${birthDateISO}|${birthTime||''}|${tzId||''}`);

  const STEMS = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
  const BRANCH = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
  const pick = (arr, s) => arr[Math.abs(s)%arr.length];

  const pillars = {
    hour:  { stem: pick(STEMS, seed+11), branch: pick(BRANCH, seed+31) },
    day:   { stem: pick(STEMS, seed+23), branch: pick(BRANCH, seed+47) },
    month: { stem: pick(STEMS, seed+5),  branch: pick(BRANCH, seed+19) },
    year:  { stem: pick(STEMS, seed),    branch: pick(BRANCH, seed+7)  },
  };

  // Elements (rough proportions) – stable sum ~ 1.0
  const weights = fiveSplit(seed);
  const elements = {
    wood : round01(weights[0]),
    fire : round01(weights[1]),
    earth: round01(weights[2]),
    metal: round01(weights[3]),
    water: round01(weights[4]),
  };

  // Ten Gods (very compact demo)
  const tenGods = {
    byPillar: {
      hour : 'Resource',
      day  : 'Self',
      month: 'Output',
      year : 'Influence'
    }
  };

  // Interactions (empty for fallback)
  const interactions = {
    branches: {}, stems: {}
  };

  // Very simple big luck bands (10y)
  const start = 0;
  const bigLuck = Array.from({length:7}).map((_,i)=>({
    startAge: i*10,
    stem: pick(STEMS, seed+i*3),
    branch: pick(BRANCH, seed+i*5),
    tenGod: ['Wealth','Influence','Resource','Output','Peer','Authority','Growth'][i%7]
  }));

  return { pillars, elements, tenGods, interactions, luck:{ bigLuck } };
}

/* --------------------------------------------
   Sections builder (the important part)
   -------------------------------------------- */
function buildSections(computed, ctx) {
  const { pillars={}, elements={}, tenGods={}, luck={} } = computed;
  const dm = pillars?.day?.stem || 'Day Master';
  const { strong, weak, dominantList, lackingList } = analyzeElements(elements);

  // small helpers for friendlier English labels
  const elemWord = (e) => ({
    wood:'Wood', fire:'Fire', earth:'Earth', metal:'Metal', water:'Water'
  }[e] || e);

  const tenGodLabel = simplifyTenGods(tenGods);

  // Core (기본 성향)
  const core = [
    `As a Day Master represented by ${dm}, your nature blends ${elemWord(strong)} strengths with a thoughtful, steady temperament.`,
    `You tend to excel when you can express ideas creatively while supporting others with reliability.`,
    `People often appreciate your willingness to take responsibility and your calm approach to challenges.`,
    `In new environments, your adaptability helps you find practical solutions without losing your unique voice.`
  ].join(' ');

  // Balance (오행의 균형)
  const balance = [
    dominantList.length ? `Your chart leans toward ${dominantList.map(elemWord).join(' & ')}.` : `Your five-element balance is relatively even.`,
    weak ? `Meanwhile, ${elemWord(weak)} appears comparatively lower, which can feel like a blind spot in some seasons or contexts.` : `No single element is critically low at a glance.`,
    weak ? `To gently nourish ${elemWord(weak)}, consider colors, activities, and environments associated with it (e.g., ${suggestForElement(weak)}).` : `Continue maintaining a varied routine so no element overwhelms the others.`,
    `When you actively balance elements—rather than forcing extremes—you’ll notice clearer thinking, steadier energy, and smoother relationships.`
  ].join(' ');

  // Ten Gods (십신)
  const tenGodsText = [
    `Your Ten-Gods pattern highlights ${tenGodLabel.main} as a noticeable theme across your pillars.`,
    tenGodLabel.support ? `It’s supported by ${tenGodLabel.support}, suggesting practical opportunities to apply this trait in daily life.` : `This focus encourages you to develop the trait with intention.`,
    `In work and relationships, you’ll thrive when you channel this energy with patience and good boundaries.`,
    `Think of Ten-Gods as “roles you play”—choose the right role for the situation, and your chart works for you.`
  ].join(' ');

  // Luck (대운)
  const age = guessAge(ctx.birthDateISO);
  const current = (luck?.bigLuck||[]).find(b => typeof age==='number' ? age>=b.startAge && age<b.startAge+10 : false);
  const luckText = [
    current
      ? `You are currently in a ${current.tenGod || 'growth'} decade (age ${current.startAge}–${current.startAge+9}).`
      : `Your 10-year luck cycles invite you to take the long view—momentum builds gradually.`,
    `Focus on consistent habits over quick wins; this compounding effect is where your chart shines.`,
    `When choices feel unclear, return to your element balance: supporting the weaker element often unlocks movement.`,
    `Track what works season-to-season; aligning timing with your energy will make progress feel natural.`
  ].join(' ');

  // Wellness (건강/생활)
  const wellness = [
    weak
      ? `For wellbeing, gently strengthen ${elemWord(weak)} through ${wellnessForElement(weak)}.`
      : `Keep a steady rhythm of sleep, nutrition, and movement; consistency suits you well.`,
    `Breath, posture, and hydration have outsized impact on your focus and mood—treat them as daily anchors.`,
    `Creative expression (journaling, light art, or music) lowers stress by giving emotions a safe channel.`,
    `Protect recovery time after busy periods; your clarity returns fastest when you truly rest.`
  ].join(' ');

  // Summary (요약)
  const summary = [
    `Overall, your chart blends ${elemWord(strong)} qualities with a calm, thoughtful presence.`,
    weak
      ? `Balance improves when you tend to ${elemWord(weak)}—small, daily steps matter more than dramatic changes.`
      : `With no major deficits, keep routines diverse and avoid over-committing to a single style.`,
    `Use the current luck cycle to practice your strengths on real projects while staying open to feedback.`,
    `Lean into relationships and timing that feel sustainable—this is how you turn insight into results.`
  ].join(' ');

  return { core, balance, tenGods: tenGodsText, luck: luckText, wellness, summary };
}

/* --------------------------------------------
   Small utilities
   -------------------------------------------- */
function hash(s){ let h=0; for(let i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0;} return h; }
function fiveSplit(seed){
  // make 5 positive numbers, normalize to 1
  const r = [13,29,47,71,89].map((p,i)=>Math.abs(Math.sin((seed+p)*(i+1)))+0.1);
  const sum=r.reduce((a,b)=>a+b,0);
  return r.map(v=>v/sum);
}
function round01(x){ return Math.round(x*100)/100; }

function analyzeElements(e){
  const entries = Object.entries(e||{});
  const sorted = entries.sort((a,b)=>b[1]-a[1]);
  const strong = sorted[0]?.[0] || null;
  const weak   = sorted[sorted.length-1]?.[0] || null;

  const topVal = sorted[0]?.[1] ?? 0;
  const dom = sorted.filter(([_,v]) => topVal>0 ? v >= topVal*0.9 : false).map(([k])=>k);
  const lowVal = sorted[sorted.length-1]?.[1] ?? 0;
  const lack = sorted.filter(([_,v]) => v <= lowVal*1.05).map(([k])=>k);

  return { strong, weak, dominantList: dom, lackingList: lack };
}

function simplifyTenGods(tenGods){
  // Try to pick a meaningful label from byPillar.
  const bp = tenGods?.byPillar || {};
  const list = ['day','month','year','hour'].map(k=>bp[k]).filter(Boolean);
  const main = list[0] || 'Growth';
  const support = list[1] || null;
  return { main, support };
}

function guessAge(birthDateISO){
  if (!birthDateISO) return null;
  const b = new Date(`${birthDateISO}T00:00:00Z`);
  if (isNaN(b.getTime())) return null;
  const n = new Date();
  let a = n.getUTCFullYear()-b.getUTCFullYear();
  const m = n.getUTCMonth()-b.getUTCMonth();
  if (m<0 || (m===0 && n.getUTCDate()<b.getUTCDate())) a--;
  return a;
}

function suggestForElement(e){
  switch(e){
    case 'wood':  return 'green palettes, nature walks, planning & growth activities';
    case 'fire':  return 'sunlight, warm colors, social/performing arts, cardio-style movement';
    case 'earth': return 'grounding routines, consistent schedules, gardening or pottery';
    case 'metal': return 'decluttering, structured learning, breath-work, strength practice';
    case 'water': return 'restorative sleep, meditation, journaling, calm blue/black tones';
    default: return 'balanced routines and gentle variety';
  }
}
function wellnessForElement(e){
  switch(e){
    case 'wood':  return 'stretching, spine mobility, green veggies, outdoor time';
    case 'fire':  return 'circulation support, playful exercise, laughter, vitamin D';
    case 'earth': return 'regular meals, warm foods, core stability, steady rhythms';
    case 'metal': return 'lung health, breath-work, light strength, tidy spaces';
    case 'water': return 'hydration, sleep hygiene, meditation, kidney-friendly habits';
    default: return 'simple, consistent care routines';
  }
}
