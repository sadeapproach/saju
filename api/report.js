// /api/report.js
// Vercel Serverless Function (Node 런타임)
// Day Master(일간) 기반 간단 리포트 · 톤 일원화(파일 추가 없이 report.js 내에 내장)
//
// 요청: { pillars?, calc?, tone?("coach" | "plain") }
// 응답: { ok: true, data: { dayMaster: { label, traits[], explain } } }

function get(o, path) {
  if (!o) return undefined;
  return path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
}

function firstOf(root, paths, dft) {
  for (const p of paths) {
    const v = get(root, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return dft;
}

/* ─────────────────────────────────────────
 * 1) 일간(천간) → 음/양 + 오행 매핑
 *    - CN(甲乙…癸), EN("Yang Fire"), pinyin 모두 허용
 * ───────────────────────────────────────── */
const STEM_TO_YINYANG_ELEM = {
  // CN
  "甲": ["yang", "wood"],
  "乙": ["yin", "wood"],
  "丙": ["yang", "fire"],
  "丁": ["yin", "fire"],
  "戊": ["yang", "earth"],
  "己": ["yin", "earth"],
  "庚": ["yang", "metal"],
  "辛": ["yin", "metal"],
  "壬": ["yang", "water"],
  "癸": ["yin", "water"],
  // pinyin-ish
  "jia": ["yang", "wood"],
  "yi": ["yin", "wood"],
  "bing": ["yang", "fire"],
  "ding": ["yin", "fire"],
  "wu": ["yang", "earth"],
  "ji": ["yin", "earth"],
  "geng": ["yang", "metal"],
  "xin": ["yin", "metal"],
  "ren": ["yang", "water"],
  "gui": ["yin", "water"],
};

function normalizeDayMaster(stemAny) {
  if (!stemAny) return null;
  const s = String(stemAny).trim();

  // 1) 정확 매핑(CN/pinyin)
  if (STEM_TO_YINYANG_ELEM[s]) {
    const [yy, el] = STEM_TO_YINYANG_ELEM[s];
    return { yinYang: yy, elem: el, key: `${yy}_${el}` };
  }
  const low = s.toLowerCase();

  // 2) "Yang Fire" / "yin water" 같은 영문
  const m = low.match(/\b(yang|yin)\s*(wood|fire|earth|metal|water)\b/);
  if (m) {
    const yy = m[1];
    const el = m[2];
    return { yinYang: yy, elem: el, key: `${yy}_${el}` };
  }

  // 3) "Wood/Fire…"만 들어온 경우(양/음 미상 → 기본 yin로 가정)
  const elOnly = low.match(/\b(wood|fire|earth|metal|water)\b/);
  if (elOnly) {
    const el = elOnly[1];
    return { yinYang: "yin", elem: el, key: `yin_${el}` };
  }

  return null;
}

/* ─────────────────────────────────────────
 * 2) 톤 프로필(파일 분리 없이 report.js 안에 내장)
 *    - coach: 코치 톤(구체적, 실행 중심, 쉬운 영어)
 *    - plain: 더 중립/간결
 * ───────────────────────────────────────── */
const POLARITY_LABEL = { yin: "Quiet", yang: "Active" };
const ELEMENT_LABEL = { wood: "Wood", fire: "Fire", earth: "Earth", metal: "Metal", water: "Water" };

// 코치 톤: 요소별 4~5개 불릿
const COACH_TRAITS = {
  yin_water: [
    "Observant—reads the room quickly.",
    "Thinks deeply before deciding; clarity follows quiet.",
    "Works best in calm, uninterrupted blocks.",
    "Keeps plans flexible and adapts smoothly.",
  ],
  yang_water: [
    "Curious connector—shares and gathers info fast.",
    "Quick to switch lanes; weekly priorities keep you steady.",
    "Energized by new inputs and conversations.",
    "Benefits from short review checkpoints.",
  ],
  yin_wood: [
    "Patient builder—prefers steady, ethical progress.",
    "Focus grows with consistent routines.",
    "Values alignment and long-term growth over quick wins.",
    "Thrives with clear steps and gentle accountability.",
  ],
  yang_wood: [
    "Initiator—pushes growth and momentum.",
    "Great at starting; finishing improves with structure.",
    "Energized by movement and clear direction.",
    "Benefits from a visible plan and weekly finish lines.",
  ],
  yin_fire: [
    "Warm motivator—excellent in small groups.",
    "Ideas spark after conversations or at night.",
    "Needs boundaries to avoid burn-out.",
    "Recharge with quiet time and paced commitments.",
  ],
  yang_fire: [
    "Fast starter—decisive under pressure.",
    "Rallies people with enthusiasm.",
    "Sustains results with cooling breaks and review loops.",
    "Best with short sprints and clear win criteria.",
  ],
  yin_earth: [
    "Grounded and reliable—keeps teams steady.",
    "Prefers familiar tools and proven methods.",
    "Protects energy with simple, repeatable routines.",
    "Benefits from clear scope and realistic timelines.",
  ],
  yang_earth: [
    "Organizer—turns ideas into workable plans.",
    "Balances people and tasks with calm authority.",
    "Shines when setting boundaries and priorities.",
    "Avoids overload by delegating early.",
  ],
  yin_metal: [
    "Precise and discerning—spots weak points quickly.",
    "Focus deepens with clear standards.",
    "Simplifies complexity into clean systems.",
    "Benefits from defined ‘done’ checklists.",
  ],
  yang_metal: [
    "Decisive editor—cuts noise, keeps the signal.",
    "Leads best with clear rules and deadlines.",
    "Builds efficient systems others can follow.",
    "Protects energy by saying no early.",
  ],
};

// plain 톤(더 간결)
const PLAIN_TRAITS = {
  yin_water: [
    "Quiet, adaptive, observant.",
    "Clear thinking needs calm time.",
    "Prefers flexible plans over rigid schedules.",
  ],
  yang_water: [
    "Curious, fast-moving, social.",
    "Weekly priorities prevent scatter.",
    "Energized by new inputs.",
  ],
  yin_wood: [
    "Patient, steady growth.",
    "Strong values; prefers long-term progress.",
    "Routines support focus.",
  ],
  yang_wood: [
    "Initiates growth quickly.",
    "Best with clear direction and structure.",
    "Sprint → review works well.",
  ],
  yin_fire: [
    "Warm, insightful, people-attuned.",
    "Needs boundaries to avoid burn-out.",
    "Quiet recharge keeps clarity.",
  ],
  yang_fire: [
    "Bold starter; motivates others.",
    "Short sprints + cool-down reviews.",
    "Clear goals maintain momentum.",
  ],
  yin_earth: [
    "Reliable, practical, consistent.",
    "Works best with familiar systems.",
    "Clear scope prevents overload.",
  ],
  yang_earth: [
    "Organizer; turns ideas into plans.",
    "Prioritizes well; sets boundaries.",
    "Delegation keeps pace sustainable.",
  ],
  yin_metal: [
    "Precise, quality-driven.",
    "Clear standards sharpen focus.",
    "Enjoys clean systems.",
  ],
  yang_metal: [
    "Decisive editor; removes noise.",
    "Leads with rules and deadlines.",
    "Efficient, no-nonsense execution.",
  ],
};

function writeDayMaster(normalized, srcStemText, tone = "coach") {
  const key = normalized.key; // e.g., "yin_water"
  const label =
    `${POLARITY_LABEL[normalized.yinYang]} ${ELEMENT_LABEL[normalized.elem]}` +
    (srcStemText ? ` (${String(srcStemText)})` : "");

  const bank = tone === "plain" ? PLAIN_TRAITS : COACH_TRAITS;
  const traits = bank[key] || ["Balanced, adaptable.", "Clarity grows with simple structure."];

  const explain =
    `In this system, your Day Stem describes how you start, decide, and recharge. ` +
    `Yours leans **${POLARITY_LABEL[normalized.yinYang].toLowerCase()} ${ELEMENT_LABEL[normalized.elem].toLowerCase()}**—` +
    `so you do best when your week matches that rhythm. Use the traits above as small, testable actions.`;

  return { label, traits, explain, toneUsed: tone };
}

/* ─────────────────────────────────────────
 * 3) 메인 핸들러
 * ───────────────────────────────────────── */
export default async function handler(req, res) {
  // CORS (선택)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Use POST" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const tone = (body.tone === "plain" ? "plain" : "coach"); // 기본 coach

    // 1) 일간 후보(앱에서 넘어오는 다양한 위치 대비)
    const dayStemAny = firstOf(body, [
      "pillars.day.stem.en",
      "pillars.day.stem.pinyin",
      "pillars.day.stem.cn",
      "pillars.day.stem.han",
      "pillars.day.stem.kr",
      "calc.pillars.day.stem.en",
      "calc.pillars.day.stem.cn",
      "result.calc.pillars.day.stem.en",
    ], null);

    const norm = normalizeDayMaster(dayStemAny);
    if (!norm) {
      return res.status(200).json({
        ok: true,
        data: {
          dayMaster: {
            label: "Day Master: Unknown",
            traits: ["We couldn’t read your Day Stem.", "Please re-generate the chart."],
            explain: "Send the pillars/day stem again; we’ll translate it automatically.",
            toneUsed: tone,
          },
        },
      });
    }

    const dayMaster = writeDayMaster(norm, dayStemAny, tone);

    return res.status(200).json({
      ok: true,
      data: { dayMaster },
    });
  } catch (e) {
    console.error("[report] error:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}
