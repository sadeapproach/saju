// /api/report.js
// Vercel Serverless Function (Node/Edge 아님)
// Day Master(천간) 기반의 간단한 규칙형 리포트 응답
// - 입력: { pillars?, calc? } (app에서 그대로 넘겨주면 됨)
// - 출력: { ok: true, data: { dayMaster: {label, traits[], explain} } }

function get(o, path) {
  if (!o) return undefined;
  return path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
}
function firstOf(root, paths, dflt) {
  for (const p of paths) {
    const v = get(root, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return dflt;
}

// 천간 → 음양/오행 정규화
const STEM_CN_TO_YINYANG_ELEM = {
  "甲": ["Yang", "Wood"],
  "乙": ["Yin", "Wood"],
  "丙": ["Yang", "Fire"],
  "丁": ["Yin", "Fire"],
  "戊": ["Yang", "Earth"],
  "己": ["Yin", "Earth"],
  "庚": ["Yang", "Metal"],
  "辛": ["Yin", "Metal"],
  "壬": ["Yang", "Water"],
  "癸": ["Yin", "Water"],
};

function normalizeDayMaster(stemAny) {
  if (!stemAny) return null;

  const s = String(stemAny).trim();
  // CN 단일 한자
  if (STEM_CN_TO_YINYANG_ELEM[s]) {
    const [yy, el] = STEM_CN_TO_YINYANG_ELEM[s];
    return { key: `${yy.toLowerCase()} ${el.toLowerCase()}`, label: `${yy} ${el}` };
  }

  // "Yang Wood", "Yin Fire" 등 영문
  const m = s.match(/(yang|yin)\s+(wood|fire|earth|metal|water)/i);
  if (m) {
    const yy = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const el = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
    return { key: `${yy.toLowerCase()} ${el.toLowerCase()}`, label: `${yy} ${el}` };
  }

  // pinyin 일부(선택적)
  const PINYIN_TO_CN = {
    jia: "甲", yi: "乙", bing: "丙", ding: "丁",
    wu: "戊", ji: "己", geng: "庚", xin: "辛",
    ren: "壬", gui: "癸",
  };
  const pin = s.toLowerCase().trim();
  if (PINYIN_TO_CN[pin]) {
    const [yy, el] = STEM_CN_TO_YINYANG_ELEM[PINYIN_TO_CN[pin]];
    return { key: `${yy.toLowerCase()} ${el.toLowerCase()}`, label: `${yy} ${el}` };
  }

  return null;
}

// 10천간(음/양 × 5행) 기본 성향 템플릿
const DM_TRAITS = {
  "yang wood": {
    traits: [
      "Builds momentum steadily once started",
      "Prefers structure over chaos",
      "Loyal and consistent in commitments",
    ],
    explain:
      "Yang Wood tends to grow with stable routines and repeatable processes. You do best when goals are clear and tracked visibly.",
  },
  "yin wood": {
    traits: [
      "Adaptive and relationship-oriented",
      "Finds creative paths around blockers",
      "Values gentle, sustainable progress",
    ],
    explain:
      "Yin Wood thrives on flexibility and supportive environments. Light constraints and friendly accountability keep you engaged.",
  },
  "yang fire": {
    traits: [
      "Quick to initiate and mobilize others",
      "Works best with short sprints",
      "Motivates through passion and vision",
    ],
    explain:
      "Yang Fire moves fast and shines when sharing energy. Use focused bursts and clear cooldowns to prevent burnout.",
  },
  "yin fire": {
    traits: [
      "Intuitive and empathetic communicator",
      "Strong in polishing and storytelling",
      "Benefits from calm, consistent pacing",
    ],
    explain:
      "Yin Fire influences through warmth and nuance. Set gentle rhythms and reflection time to keep clarity high.",
  },
  "yang earth": {
    traits: [
      "Dependable and grounded under pressure",
      "Prefers clear roles and ownership",
      "Builds durable systems over time",
    ],
    explain:
      "Yang Earth stabilizes teams and plans. Define boundaries and milestones; steady progress compounds for you.",
  },
  "yin earth": {
    traits: [
      "Supportive, patient, detail-aware",
      "Good at integration and hand-offs",
      "Needs periodic re-prioritization",
    ],
    explain:
      "Yin Earth excels at care and maintenance. Regularly zoom out to prevent over-serving and to keep scope tidy.",
  },
  "yang metal": {
    traits: [
      "Clear standards and sharp judgment",
      "Efficient once criteria are set",
      "Naturally good at cutting noise",
    ],
    explain:
      "Yang Metal performs best with defined quality bars. Decide the ‘done’ criteria early and protect deep-work blocks.",
  },
  "yin metal": {
    traits: [
      "Refines and perfects with precision",
      "Strong at reviews and quality control",
      "Benefits from small-batch delivery",
    ],
    explain:
      "Yin Metal improves outcomes through careful iteration. Ship in small increments to keep feedback loops tight.",
  },
  "yang water": {
    traits: [
      "Explores widely and connects patterns",
      "Comfortable with ambiguity",
      "Energized by movement and variety",
    ],
    explain:
      "Yang Water learns by flowing through contexts. Rotate focus intentionally to avoid diffusion and to sustain depth.",
  },
  "yin water": {
    traits: [
      "Observant, strategic, sensitive to timing",
      "Excellent at research and synthesis",
      "Needs quiet to crystallize insight",
    ],
    explain:
      "Yin Water excels when you protect solitude for sense-making. Set gentle deadlines so insights become decisions.",
  },
};

export default async function handler(req, res) {
  // CORS (개발 편의)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    // 앱에서 보낸 calc/pillars 어느 쪽이든 받아서 day stem 찾기
    const dayStem =
      firstOf(body, [
        "pillars.day.stem.en",
        "pillars.day.stem.cn",
        "pillars.day.stem",
        "calc.pillars.day.stem.en",
        "calc.pillars.day.stem.cn",
        "calc.pillars.day.stem",
        "result.calc.pillars.day.stem.en",
        "result.calc.pillars.day.stem.cn",
        "result.calc.pillars.day.stem",
      ]) || null;

    const dm = normalizeDayMaster(dayStem);

    // 기본 응답
    const data = { dayMaster: { label: null, traits: [], explain: "" } };

    if (dm && DM_TRAITS[dm.key]) {
      data.dayMaster.label = dm.label;
      data.dayMaster.traits = DM_TRAITS[dm.key].traits;
      data.dayMaster.explain = DM_TRAITS[dm.key].explain;
    } else {
      // 안전한 폴백(입력이 빈약할 때)
      data.dayMaster.traits = [
        "We’re missing a reliable Day Master value.",
        "Re-try with precise birth time if possible.",
      ];
      data.dayMaster.explain =
        "Once we confirm your Day Master (heavenly stem of the Day), we’ll tailor traits and timing for you.";
    }

    return res.status(200).json({ ok: true, data });
  } catch (e) {
    console.error("[report] error:", e);
    return res.status(200).json({
      ok: false,
      error: e?.message || "Server error",
    });
  }
}
