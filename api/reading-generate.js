// --- Safe fallback /api/reading-generate ---
// 위치: 프로젝트 루트의 /api/reading-generate.js  (기존 패턴과 동일)
// 만약 pages 디렉토리 구조라면: /pages/api/reading-generate.js 로 두세요.

export default async function handler(req, res) {
  try {
    // 1) 입력 파싱 (여러 형태 호환: v1, v2, data/chart 래핑, GET)
    const isPost = req.method === "POST";
    const body = isPost ? (await readJson(req)) : {};
    const payload =
      body?.data ||
      body?.chart ||
      body ||
      {};

    const pillars =
      payload.pillars ||
      body?.pillars ||
      null;

    const tenGods =
      payload.tenGods ||
      body?.tenGods ||
      null;

    const interactions =
      payload.interactions ||
      body?.interactions ||
      null;

    const luck =
      payload.luck ||
      body?.luck ||
      null;

    const locale =
      body?.locale ||
      "ko-KR";

    // 2) 최소 요구사항 체크
    if (!pillars || typeof pillars !== "object") {
      // 그래도 UI를 계속 테스트할 수 있도록, 매우 간단한 더미를 만들어 반환
      const dummy = buildDummyPillars();
      const out = generateReading({ pillars: dummy, tenGods: null, interactions: null, luck: null, locale });
      return res.status(200).json({ ok: true, output: out, sections: out });
    }

    // 3) 실제 생성 (LLM 없이 규칙 기반 폴백)
    const out = generateReading({ pillars, tenGods, interactions, luck, locale });

    // 4) 프론트 호환: output 과 sections 둘 다 제공
    return res.status(200).json({ ok: true, output: out, sections: out });
  } catch (err) {
    // 절대 500로 죽지 않게, UI가 에러 내용을 볼 수 있도록 안전하게 반환
    const message = err && (err.message || String(err));
    return res.status(200).json({
      ok: false,
      error: "READING_GENERATE_FAILED",
      message
    });
  }
}

/* ---------------- helpers ---------------- */

function buildDummyPillars() {
  // 아주 기본적인 형태만 제공 (hour/day/month/year: {stem,branch})
  return {
    hour:  { stem: "乙", branch: "卯" },
    day:   { stem: "癸", branch: "未" },
    month: { stem: "甲", branch: "戌" },
    year:  { stem: "己", branch: "巳" }
  };
}

async function readJson(req) {
  // Next.js pages/api 에선 req.body가 객체일 수도 있어서 보호코드
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

// 간단한 오행 매핑 (천간/지지 → 오행)
const STEM_ELEM = { "甲":"wood","乙":"wood","丙":"fire","丁":"fire","戊":"earth","己":"earth","庚":"metal","辛":"metal","壬":"water","癸":"water" };
const BRANCH_ELEM = { "子":"water","丑":"earth","寅":"wood","卯":"wood","辰":"earth","巳":"fire","午":"fire","未":"earth","申":"metal","酉":"metal","戌":"earth","亥":"water" };

function elemOf(ch) { return STEM_ELEM[ch] || BRANCH_ELEM[ch] || null; }

function countElements(pillars) {
  const m = { wood:0, fire:0, earth:0, metal:0, water:0 };
  const push = (ch)=>{ const e=elemOf(ch); if(e) m[e]++; };
  ["hour","day","month","year"].forEach(k=>{
    const p = pillars?.[k];
    if (!p) return;
    push(p.stem); push(p.branch);
  });
  return m;
}

function strongestElement(m) {
  const pairs = Object.entries(m);
  pairs.sort((a,b)=>b[1]-a[1]);
  return pairs[0]?.[0] || "mixed";
}

function formatPillarsLine(pillars) {
  const h = `${pillars?.hour?.stem||""}${pillars?.hour?.branch||""}`;
  const d = `${pillars?.day?.stem||""}${pillars?.day?.branch||""}`;
  const m = `${pillars?.month?.stem||""}${pillars?.month?.branch||""}`;
  const y = `${pillars?.year?.stem||""}${pillars?.year?.branch||""}`;
  return `시주 ${h} · 일주 ${d} · 월주 ${m} · 년주 ${y}`;
}

function generateReading({ pillars, tenGods, interactions, luck, locale }) {
  // 아주 간단한 규칙 기반 설명문. 나중에 LLM 연결 시 이 부분만 교체하면 됨.
  const elemCnt = countElements(pillars);
  const dom = strongestElement(elemCnt);
  const dayMaster = `${pillars?.day?.stem||""}${pillars?.day?.branch||""}`.trim();

  // 균형 코멘트
  const lack = Object.entries(elemCnt).filter(([_,v])=>v===0).map(([k])=>k);
  let balanceLine = `오행 분포는 ${Object.entries(elemCnt).map(([k,v])=>`${k}:${v}`).join(", ")} 입니다.`;
  if (lack.length) balanceLine += ` 특히 ${lack.join(", ")} 기운이 약해 보이니 생활에서 보완해 주세요.`;

  // 격국/용신은 폴백 문구(LLM 연결 전)
  const structureLine = `전체 흐름은 '${dom}' 기운을 중심으로 전개되는 경향이 있습니다.`;
  const yongshinLine = `부족한 기운을 일상에서 채우는 것이 핵심입니다. 예) 물(수)이 약하면 휴식/수면/학습 같은 '차분함'을 의식적으로 배치.`;

  // 큰 흐름(대운) 요약
  const flowLine = buildFlowLine(luck);

  // 최종 7섹션 구조
  return {
    pillars: `네 기둥 요약: ${formatPillarsLine(pillars)}\n\n천간과 지지가 이루는 틀을 먼저 봅니다.`,
    day_master: `당신의 일주는 ‘${dayMaster}’ 입니다. 일간을 중심으로 기본 성향이 형성됩니다. 주도성/관계 방식/에너지 소비 패턴을 확인해 보세요.`,
    five_elements: `${balanceLine}\n지나치게 강한 한쪽 에너지는 '속도 과열', 지나치게 약한 에너지는 '회복 지연'으로 나타날 수 있습니다.`,
    structure: structureLine,
    yongshin: yongshinLine,
    life_flow: flowLine,
    summary: `강점은 '${dom}' 에서 나옵니다. 이를 바탕으로 속도·정확·유연 중 하나를 대표 장점으로 삼고, 약한 영역은 루틴으로 보완하세요.`
  };
}

function buildFlowLine(luck){
  const list = Array.isArray(luck?.bigLuck) ? luck.bigLuck : [];
  if (!list.length) {
    return "초년·중년·말년의 큰 흐름은 대운(10년 주기) 배치에 따라 달라집니다. 현재 차트만으로는 간단 가이드를 제공합니다: 초년엔 기반 다지기, 중년엔 확장/전환, 말년엔 안정/정리의 흐름을 추천합니다.";
  }
  const seg = (s)=>`Age ${s.startAge}–${s.startAge+9} ${s.stem||""}${s.branch||""}${s.tenGod?` (${s.tenGod})`:""}`;
  return [
    `현재/다가오는 대운을 기준으로 계획을 세우세요.`,
    ...list.slice(0,3).map(s => `• ${seg(s)}: 기회와 주제에 집중.`)
  ].join("\n");
}
