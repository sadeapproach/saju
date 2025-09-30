// /api/report.js
// Returns English copy for Report screen (Card #2: "Day Master Traits").
// Accepts POST with { calc?, pillars?, result? } and detects the Day Master robustly.

const STEM_TRAITS = {
  "Yang Wood": {
    traits: ["Fast to start", "Growth-oriented", "Direct communication"],
    explain:
      "Like a tree shooting upward, Yang Wood moves quickly and expands territory. Great for initiating. Balance speed with periodic structure and review."
  },
  "Yin Wood": {
    traits: ["Observant", "Relationship-centered", "Flexible problem-solving"],
    explain:
      "Yin Wood adapts like a vine—subtle and people-savvy. Clear boundaries prevent energy leaks; gentle consistency multiplies impact."
  },
  "Yang Fire": {
    traits: ["Charismatic drive", "Decisive", "Motivates others"],
    explain:
      "Yang Fire warms and mobilizes. You set the tone and move teams forward. Add cool-down rituals (walks, nightly reset) to avoid over-heating."
  },
  "Yin Fire": {
    traits: ["Ideas & inspiration", "Sensitive", "Persuasive subtly"],
    explain:
      "Yin Fire is a spark—creative and emotive. Pair inspiration with lightweight routines and checklists to convert ideas into steady output."
  },
  "Yang Earth": {
    traits: ["Stable & reliable", "Endures long games", "System builder"],
    explain:
      "Yang Earth is mountain-like. You anchor plans and operations. When starting change, break work into small chunks to gain momentum."
  },
  "Yin Earth": {
    traits: ["Supportive", "Practical", "Mediator"],
    explain:
      "Yin Earth nourishes like fertile soil—great at buffering teams. Guard your scope; clear limits keep support sustainable."
  },
  "Yang Metal": {
    traits: ["Principled", "Precise", "Decisive cuts"],
    explain:
      "Yang Metal clarifies standards and trims noise. Watch perfectionism—use time boxes and versioning to keep shipping."
  },
  "Yin Metal": {
    traits: ["Refinement", "Brand sense", "Crisp communication"],
    explain:
      "Yin Metal polishes details and narratives. Define ‘Done’ up front to protect both speed and quality."
  },
  "Yang Water": {
    traits: ["Explorer mindset", "Adaptive", "Fast learner"],
    explain:
      "Yang Water flows widely—great at research and expansion. Choose 1–2 focus points per cycle to turn breadth into visible wins."
  },
  "Yin Water": {
    traits: ["Insightful", "Connective", "Deep listener"],
    explain:
      "Yin Water sees beneath the surface and weaves connections. Externalize insights (notes, summaries) to scale your influence."
  }
};

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
async function readJson(req) {
  // Vercel can pass parsed body; if not, read stream.
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString("utf8");
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
const get = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

// “first available value”
function firstOf(root, paths, fallback) {
  for (const p of paths) {
    const v = get(root, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fallback;
}

// Map CN/KR/pinyin to English Day Master
const STEM_FROM_CN = {
  "甲":"Yang Wood","乙":"Yin Wood","丙":"Yang Fire","丁":"Yin Fire",
  "戊":"Yang Earth","己":"Yin Earth","庚":"Yang Metal","辛":"Yin Metal",
  "壬":"Yang Water","癸":"Yin Water"
};
const STEM_FROM_KR = {
  "갑":"Yang Wood","을":"Yin Wood","병":"Yang Fire","정":"Yin Fire",
  "무":"Yang Earth","기":"Yin Earth","경":"Yang Metal","신":"Yin Metal",
  "임":"Yang Water","계":"Yin Water"
};
const STEM_FROM_PINYIN = {
  "jia":"Yang Wood","yi":"Yin Wood","bing":"Yang Fire","ding":"Yin Fire",
  "wu":"Yang Earth","ji":"Yin Earth","geng":"Yang Metal","xin":"Yin Metal",
  "ren":"Yang Water","gui":"Yin Water"
};

function normalizeDayMaster(input) {
  if (!input) return "";
  const s = String(input).trim();

  // If already “Yang Wood” form
  const m = s.match(/(yang|yin)\s+(wood|fire|earth|metal|water)/i);
  if (m) {
    const pol = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const el  = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
    return `${pol} ${el}`;
  }

  // CN character(甲..癸)
  if (s.length === 1 && STEM_FROM_CN[s]) return STEM_FROM_CN[s];

  // KR (갑 을 병 정 무 기 경 신 임 계)
  if (STEM_FROM_KR[s]) return STEM_FROM_KR[s];

  // pinyin-ish
  const low = s.toLowerCase();
  if (STEM_FROM_PINYIN[low]) return STEM_FROM_PINYIN[low];

  // Element + Yang/Yin sprinkled in other languages
  const pol = /(yang|yin|양|음)/i.test(s)
    ? /yang|양/i.test(s) ? "Yang" : "Yin"
    : "";
  const elMatch = s.match(/wood|fire|earth|metal|water|목|화|토|금|수/i);
  const elMap = { "목":"Wood","화":"Fire","토":"Earth","금":"Metal","수":"Water" };
  let el = elMatch ? elMatch[0] : "";
  el = elMap[el] || (el ? el[0].toUpperCase() + el.slice(1).toLowerCase() : "");
  return pol && el ? `${pol} ${el}` : "";
}

function pickDayMaster(calc, pillars) {
  // Look through common shapes we’ve seen in your app
  return firstOf({ calc, pillars }, [
    "calc.pillars.day.stem.en",
    "pillars.day.stem.en",
    "calc.pillars.day.stem.enShort",
    "pillars.day.stem.enShort",
    "calc.pillars.day.stem.cn",
    "pillars.day.stem.cn",
    "calc.pillars.day.stem.kr",
    "pillars.day.stem.kr",
    "calc.dayMaster",
    "pillars.day.stem"
  ], "");
}

// ────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  // CORS (optional but handy)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }

  try {
    const body = await readJson(req);

    // Accept payloads shaped as { calc, pillars } OR { result:{calc,pillars} } OR mixed.
    const calc    = body.calc || body.result?.calc || {};
    const pillars = body.pillars || calc.pillars || body.result?.pillars || {};

    const dmRaw = pickDayMaster(calc, pillars);
    const dayMaster = normalizeDayMaster(dmRaw);

    const pack = STEM_TRAITS[dayMaster] || {
      traits: ["We’re still identifying your core pattern", "Please verify birth time/timezone", "Try recalculating"],
      explain:
        "We couldn’t confidently map your Day Master. Double-check birth time and timezone, then regenerate your chart."
    };

    res.status(200).json({
      ok: true,
      data: {
        dayMaster,
        cards: {
          // Card #2 for Report screen
          dayMasterTraits: {
            title: "Day Master Traits",
            traits: pack.traits,     // 3 bullets
            explain: pack.explain    // 1 short paragraph
          }
        }
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};
