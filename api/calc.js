// api/calc.js
// CommonJS 서버리스 함수 (Vercel/Node 런타임 호환)
// 목표: 일간/시주 계산을 안정화 (정시 경계 "이전 시각 포함" 규칙), 나머지(월/년/십신 등)는 placeholder
// 응답 구조는 기존 프론트가 기대하는 형태(data.pillars, data.elements 등)를 유지

// ----- 상수 테이블 -----
const STEMS = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
const BRANCH = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];

// Day stem → 子시 기준 시간의 시작 천간
const ZI_START_STEM = {
  "甲": "甲", "己": "甲",
  "乙": "丙", "庚": "丙",
  "丙": "戊", "辛": "戊",
  "丁": "庚", "壬": "庚",
  "戊": "壬", "癸": "壬",
};

// 간지 → 오행 매핑 (간/지 모두)
const STEM_ELEM = {甲:"wood",乙:"wood",丙:"fire",丁:"fire",戊:"earth",己:"earth",庚:"metal",辛:"metal",壬:"water",癸:"water"};
const BRANCH_ELEM = {子:"water",丑:"earth",寅:"wood",卯:"wood",辰:"earth",巳:"fire",午:"fire",未:"earth",申:"metal",酉:"metal",戌:"earth",亥:"water"};

// ----- 유틸 -----
function getLocalParts(isoDate, hhmm, tz) {
  // hh:mm 없으면 자정으로
  const t = (hhmm && /^\d{1,2}:\d{2}$/.test(hhmm)) ? `T${hhmm}:00` : "T00:00:00";
  // 입력은 "현지 태어난 시각"이라고 가정하고, 그 시각을 지정한 타임존으로 포매팅
  const d = new Date(`${isoDate}${t}Z`); // Z로 고정 → 아래 Intl에서 tz로 변환 출력
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  return {
    y: +parts.year,
    m: +parts.month,
    d: +parts.day,
    H: +parts.hour,
    M: +parts.minute,
    S: +parts.second,
  };
}

// UTC 날짜차 (일)
function dayDiffUTC(y1, m1, d1, y2, m2, d2) {
  const ms = Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2);
  return Math.round(ms / 86400000);
}

// 일주 계산: 1984-02-02(甲子) 기준 앵커
function getDayGanzhi(y, m, d) {
  const baseY = 1984, baseM = 2, baseD = 2; // 甲子 anchor
  const delta = dayDiffUTC(y, m, d, baseY, baseM, baseD);
  const idx = ((delta % 60) + 60) % 60;
  return {
    stem: STEMS[idx % 10],
    branch: BRANCH[idx % 12],
    idx60: idx,
  };
}

// 시지 계산: 경계 정시에 "이전 시각" 포함 (국내 앱과 동일 관행)
function getHourBranch(H, M, boundaryMode = "previous-on-exact") {
  const mins = H * 60 + M;

  // 각 지지 시간대 (시작~끝, [23:00, 01:00), [01:00, 03:00) …)
  const slots = [
    { b: "子", start: 23 * 60, end: 24 * 60 },
    { b: "丑", start: 1 * 60, end: 3 * 60 },
    { b: "寅", start: 3 * 60, end: 5 * 60 },
    { b: "卯", start: 5 * 60, end: 7 * 60 },
    { b: "辰", start: 7 * 60, end: 9 * 60 },
    { b: "巳", start: 9 * 60, end: 11 * 60 },
    { b: "午", start: 11 * 60, end: 13 * 60 },
    { b: "未", start: 13 * 60, end: 15 * 60 },
    { b: "申", start: 15 * 60, end: 17 * 60 },
    { b: "酉", start: 17 * 60, end: 19 * 60 },
    { b: "戌", start: 19 * 60, end: 21 * 60 },
    { b: "亥", start: 21 * 60, end: 23 * 60 },
    { b: "子", start: 0, end: 1 * 60 }, // 00:00 ~ 01:00
  ];

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (boundaryMode === "previous-on-exact") {
      if (mins >= s.start && mins < s.end) return s.b;
      // 경계 정시에는 이전 구간으로
      if (mins === s.start && s.start !== 0) {
        const prev = slots[(i - 1 + slots.length) % slots.length];
        return prev.b;
      }
    } else {
      if (mins >= s.start && mins < s.end) return s.b;
    }
  }
  return "子";
}

// 시간간 계산: 일간의 子시 시작간 기준 + 지지 오프셋
function hourStemFrom(dayStem, hourBranch) {
  const baseStem = ZI_START_STEM[dayStem];
  const baseIdx = STEMS.indexOf(baseStem);
  const hourIdx = BRANCH.indexOf(hourBranch);
  return STEMS[(baseIdx + hourIdx) % 10];
}

// 간지 → 오행 집계
function tallyElements(pillars) {
  const acc = { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 };
  const add = (elem) => { if (acc.hasOwnProperty(elem)) acc[elem] += 1; };

  ["year", "month", "day", "hour"].forEach(k => {
    const p = pillars[k];
    if (!p) return;
    if (p.stem && p.stem !== "?") add(STEM_ELEM[p.stem]);
    if (p.branch && p.branch !== "?") add(BRANCH_ELEM[p.branch]);
  });

  const total = Object.values(acc).reduce((a, b) => a + b, 0) || 1;
  // 0~1 비율로 반환
  Object.keys(acc).forEach(k => acc[k] = +(acc[k] / total).toFixed(2));
  return acc;
}

// ----- API 핸들러 -----
module.exports = async (req, res) => {
  // CORS 허용(필요시)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const birthDateISO = (body.birthDateISO || '').toString().trim();   // 예: "1961-11-07"
    const birthTime = (body.birthTime || null);                         // 예: "07:00" or null
    const tzId = (body.tzId || 'Asia/Seoul').toString();                // 타임존
    // lat/lng/timeAccuracy는 여기선 계산에 직접 안 씀 (보존만)
    const lat = typeof body.lat === 'number' ? body.lat : null;
    const lng = typeof body.lng === 'number' ? body.lng : null;
    const timeAccuracy = (body.timeAccuracy || 'exact');

    if (!birthDateISO) {
      return res.status(400).json({ ok: false, error: 'Missing birthDateISO' });
    }

    // 1) 타임존 기준 로컬 Y-M-D H-M-S
    const L = getLocalParts(birthDateISO, birthTime, tzId);

    // 2) 일주 계산 (1984-02-02 甲子 앵커)
    const dayGZ = getDayGanzhi(L.y, L.m, L.d);

    // 3) 시주 계산 (경계 정시 → 이전 시각 포함)
    const hourBranch = getHourBranch(L.H, L.M, "previous-on-exact");
    const hourStem = hourStemFrom(dayGZ.stem, hourBranch);

    // 4) (임시) 월/년주는 Placeholder — 기존 로직 붙일 자리
    const pillars = {
      year:  { stem: "?", branch: "?" },   // TODO: 네 기존 년주 계산으로 교체
      month: { stem: "?", branch: "?" },   // TODO: 네 기존 월주 계산으로 교체
      day:   { stem: dayGZ.stem, branch: dayGZ.branch },
      hour:  { stem: hourStem,  branch: hourBranch },
    };

    // 5) 오행 비율(가우지 용) — 현재는 가용 pillar만 집계
    const elements = tallyElements(pillars);

    // 6) 프론트가 기대하는 data 구조 맞춰서 응답
    return res.status(200).json({
      ok: true,
      input: { birthDateISO, birthTime, tzId, lat, lng, timeAccuracy, local: L },
      data: {
        pillars,
        elements,
        // 아래는 아직 계산치 없음 — 프론트에서 optional로 처리됨
        tenGods: {},          // TODO
        hiddenStems: {},      // TODO
        interactions: {},     // TODO
        luck: {},             // TODO (대운)
      },
      meta: {
        rules: {
          hourBoundary: "previous-on-exact", // 정시(07:00 등) → 이전 시각 포함
          dayAnchor: "1984-02-02 甲子 (UTC day-diff)",
        },
        debug: { dayIdx60: dayGZ.idx60 },
      },
    });
  } catch (e) {
    // 에러도 보기 좋게
    return res.status(500).json({
      ok: false,
      error: 'calc_failed',
      detail: {
        name: e?.name || 'Error',
        message: e?.message || String(e),
        stack: e?.stack?.split('\n').slice(0, 3).join('\n') || null,
      },
    });
  }
};
