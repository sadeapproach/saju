// api/calc.js
import { NextApiRequest, NextApiResponse } from "next";

// ===== 공통 테이블 =====
const STEMS = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
const BRANCH = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
const ZI_START_STEM = {
  "甲": "甲", "己": "甲",
  "乙": "丙", "庚": "丙",
  "丙": "戊", "辛": "戊",
  "丁": "庚", "壬": "庚",
  "戊": "壬", "癸": "壬",
};

// ===== 유틸 =====

// (1) 타임존 기준 로컬 YMDHM 얻기
function getLocalParts(isoDate, hhmm, tz) {
  const t = (hhmm && /^\d{1,2}:\d{2}$/.test(hhmm)) ? `T${hhmm}:00` : "T00:00:00";
  const d = new Date(`${isoDate}${t}Z`);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  return {
    y: +parts.year, m: +parts.month, d: +parts.day,
    H: +parts.hour, M: +parts.minute, S: +parts.second,
  };
}

// (2) 두 날짜 차이(일수, UTC 기준)
function dayDiffUTC(y1, m1, d1, y2, m2, d2) {
  const ms = Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2);
  return Math.round(ms / 86400000);
}

// (3) 일주 계산: 1984-02-02(甲子) 기준
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

// (4) 시지 계산: 정시 포함 규칙
function getHourBranch(H, M, boundaryMode = "previous-on-exact") {
  const mins = H * 60 + M;
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
    { b: "子", start: 0, end: 1 * 60 },
  ];

  for (const s of slots) {
    if (boundaryMode === "previous-on-exact") {
      if (mins >= s.start && mins < s.end) return s.b;
      if (mins === s.start && s.start !== 0) {
        const i = slots.indexOf(s);
        return slots[(i - 1 + slots.length) % slots.length].b;
      }
    } else {
      if (mins >= s.start && mins < s.end) return s.b;
    }
  }
  return "子";
}

// (5) 시간간 계산
function hourStemFrom(dayStem, hourBranch) {
  const baseStem = ZI_START_STEM[dayStem];
  const baseIdx = STEMS.indexOf(baseStem);
  const hourIdx = BRANCH.indexOf(hourBranch);
  return STEMS[(baseIdx + hourIdx) % 10];
}

// ===== 메인 API 핸들러 =====
export default function handler(req = NextApiRequest, res = NextApiResponse) {
  try {
    const birthDateISO = (req.body?.birthDateISO || req.query?.birthDateISO || "").toString();
    const birthTime = (req.body?.birthTime || req.query?.birthTime || null);
    const tzId = (req.body?.tzId || req.query?.tzId || "Asia/Seoul");

    // 1. 로컬 시각 파싱
    const L = getLocalParts(birthDateISO, birthTime, tzId);

    // 2. 일주 계산
    const dayGZ = getDayGanzhi(L.y, L.m, L.d);

    // 3. 시주 계산
    const hb = getHourBranch(L.H, L.M, "previous-on-exact");
    const hs = hourStemFrom(dayGZ.stem, hb);

    // 4. (추가) 월/년주는 네 기존 로직 or placeholder (여기선 단순 반환)
    const pillars = {
      year: { stem: "?", branch: "?" },   // TODO: 기존 연주 계산 로직 연결
      month: { stem: "?", branch: "?" },  // TODO: 기존 월주 계산 로직 연결
      day: { stem: dayGZ.stem, branch: dayGZ.branch },
      hour: { stem: hs, branch: hb },
    };

    // 5. 응답
    res.status(200).json({
      ok: true,
      input: { birthDateISO, birthTime, tzId, local: L },
      pillars,
      meta: {
        dayHourFix: {
          applied: true,
          boundaryMode: "previous-on-exact",
          anchor: "1984-02-02 甲子",
          idx60: dayGZ.idx60,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
