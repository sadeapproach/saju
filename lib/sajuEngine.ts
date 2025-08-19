// /lib/sajuEngine.ts
// Fixed “East Asia standard” rules: CST(UTC+8), Zi-boundary day shift(23:00),
// month by solar terms (JieQi, using 1900–2099 table), hour stem from day stem.

type Pillar = { stem: string; branch: string };
type FourPillars = { year: Pillar; month: Pillar; day: Pillar; hour: Pillar };

export type CalcInput = {
  birthDateISO: string;    // 'YYYY-MM-DD'
  birthTime?: string;      // 'HH:mm' (optional -> treat as 00:00)
  tzId?: string;           // e.g. 'Asia/Seoul' (we only need this to shift to UTC then CST)
};

export type CalcOutput = {
  pillars: FourPillars;
  luck: {
    bigLuck: Array<{ startAge: number; stem: string; branch: string; tenGod?: string }>;
  };
  // You can add: tenGods, hiddenStems, interactions... (omitted for brevity)
};

// ========== Basic tables ==========
const STEMS = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
const BRANCHES = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];

// hour stem map: given day stem index (0..9) and hour branch index (0..11)
const HOUR_STEM_FROM_DAYSTEM: number[][] = (() => {
  // For convenience: for each day stem, the Zi-hour stem cycles every 5 stems.
  // Standard table (JiaYi day -> 甲,乙 starts with 甲 at 子; 丙丁 starts with 丙; 戊己 starts with 戊; 庚辛 starts with 庚; 壬癸 starts with 壬)
  const startIdx = [0,0,2,2,4,4,6,6,8,8]; // for day stem 0..9
  const grid: number[][] = [];
  for (let d=0; d<10; d++) {
    const row:number[] = [];
    for (let b=0; b<12; b++) {
      // hour stem repeat every 10 over 12 branches: stemIndex = (start + branchIndex) % 10
      row.push((startIdx[d] + b) % 10);
    }
    grid.push(row);
  }
  return grid;
})();

// ========== Time helpers ==========
function toUTC(dateISO: string, timeHM: string|undefined, tz: string|undefined): Date {
  // Build a local time in the provided tz, then convert to UTC Date.
  // On Edge runtimes, toLocaleString with timeZone can help to emulate.
  const hm = (timeHM ?? "00:00").split(":").map(Number);
  const [hh, mm] = [hm[0]||0, hm[1]||0];
  // Compose in the provided tz, then get equivalent UTC
  const d = new Date(`${dateISO}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00`);
  if (!tz) return d; // assume already in local env -> treated as local then sent as is
  const asUTC = new Date(
    new Date(d.toLocaleString("en-US", { timeZone: "UTC" })).getTime()
    - new Date(d.toLocaleString("en-US", { timeZone: tz })).getTime()
    + d.getTime()
  );
  return asUTC;
}
function shiftToCST(utc: Date): Date {
  // CST = UTC+8
  return new Date(utc.getTime() + 8*60*60*1000);
}

// ========== Sexagenary helpers ==========
// Use reference epoch widely used in CN/HK apps.
// JD for 1984-02-02 (JiaZi day). We'll implement via algorithm on Gregorian.
function toJulianDay(d: Date): number {
  // Proleptic Gregorian → JD at 12:00 TT approx. We only need date-based integer math.
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  let a = Math.floor((14 - month) / 12);
  let y = year + 4800 - a;
  let m = month + 12*a - 3;
  let JDN = day + Math.floor((153*m + 2)/5) + 365*y + Math.floor(y/4) - Math.floor(y/100) + Math.floor(y/400) - 32045;
  // Move to noon boundary
  return JDN + (d.getUTCHours()-12)/24 + d.getUTCMinutes()/1440 + d.getUTCSeconds()/86400;
}

// We will compute the "GanZhi day index" with a stable offset so that 1984-02-02 is 甲子(0).
// For robustness we pin known date:
function ganzhiDayIndexFromJDN(jd: number): number {
  // JDN of 1984-02-02 00:00 UTC
  const ref = Date.UTC(1984, 1, 2, 0, 0, 0) / 86400000 + 2440587.5; // unix epoch to JD
  const days = Math.floor(jd - ref);
  let idx = (days % 60 + 60) % 60;
  return idx; // 0 => 甲子, 1 => 乙丑, ...
}
function stemBranchFromIndex(idx0_59: number): Pillar {
  const stem = STEMS[idx0_59 % 10];
  const branch = BRANCHES[idx0_59 % 12];
  return { stem, branch };
}

// ========== JieQi (solar terms) for 1900–2099 (CST) ==========
// Below uses the commonly-used minute offsets method from 1900-01-06 02:05.
// This is a classic table used in many lunar libs; good enough 1900–2099.
const TERM_INFO = [
  0,21208,42467,63836,85337,107014,128867,150921,173149,195551,218072,240693,
  263343,285989,308563,331033,353350,375494,397447,419210,440795,462224,483532,504758
];
function getJieQiDateUTC8(year:number, termIndex:number): Date {
  // termIndex: 0=小寒, 1=大寒, 2=立春, 3=雨水, ... 22=冬至, 23=小寒(next)
  // base: 1900-01-06 02:05 CST
  const base = Date.UTC(1900,0,6,2-8,5,0); // convert to UTC base
  const yearDiff = year - 1900;
  const minutes = 525948.76 * yearDiff + TERM_INFO[termIndex]; // mean tropical year minutes
  const ms = base + minutes * 60000;
  return new Date(ms); // UTC
}
function monthBranchAndStem(cst: Date): Pillar {
  const y = cst.getUTCFullYear();
  // Find current month by locating nearest "절(2,4,6,... index) thereafter"
  // Month index: 立春(2) -> 寅月, 驚蟄(4) -> 卯月, ... 霜降(18) -> 戌月, 小雪(20) -> 亥月
  let mIdx = -1;
  for (let k=2; k<24; k+=2) { // only "절"
    const t = getJieQiDateUTC8(y, k);
    if (cst.getTime() >= t.getTime()) mIdx = k;
  }
  if (mIdx < 0) {
    // before current year's 立春 → use last year's 小寒/大寒 … treat as previous year’s 丑月 then jump.
    // Easiest: fallback to previous year’s 立冬..小寒.., set mIdx to 22(冬至) or 0(小寒) before 2(立春)
    mIdx = 22; // force to 冬至 → 子月
  }
  const branchIndex = ((mIdx/2) + 1) % 12; // 2→寅(2/2+1=2) => index 2: 寅
  // month stem depends on year stem and month branch index:
  // standard: 月干 = (年干*2 + 月支序) % 10, where 月支序: 寅=1,...,丑=12
  const yearP = yearPillar(cst);
  const yearStemIdx = STEMS.indexOf(yearP.stem);
  const branchOrder = [null,"寅","卯","辰","巳","午","未","申","酉","戌","亥","子","丑"] as any;
  const monthOrder = branchOrder.indexOf(BRANCHES[branchIndex]);
  const stemIdx = (yearStemIdx * 2 + monthOrder) % 10;
  return { stem: STEMS[stemIdx], branch: BRANCHES[branchIndex] };
}
function yearPillar(cst: Date): Pillar {
  // Year by 立春: before 立春 → previous year
  const y = cst.getUTCFullYear();
  const liChun = getJieQiDateUTC8(y, 2);
  const base = (cst.getTime() >= liChun.getTime()) ? y : (y - 1);
  // 1984 is 甲子年 start, compute sexagenary year index:
  const cyc = (base - 1984) % 60;
  const idx = (cyc + 60) % 60; // 0 => 甲子
  return stemBranchFromIndex(idx);
}

function dayPillarWithZiBoundary(cst: Date): Pillar {
  // If time < 23:00, use previous calendar day for day-pillar
  const d = new Date(cst.getTime());
  if (d.getUTCHours() < 23) d.setUTCDate(d.getUTCDate() - 1);
  // Convert that 00:00 to JD and get 60-cycle
  d.setUTCHours(0,0,0,0);
  const jd = toJulianDay(d);
  const idx = ganzhiDayIndexFromJDN(jd);
  return stemBranchFromIndex(idx);
}

function hourPillar(cst: Date, dayStem: string): Pillar {
  // branch by 2-hour slot starting at 23:00=子
  const m = cst.getUTCMinutes();
  const h = cst.getUTCHours();
  // Convert to a "clock" starting at 23 = 0
  const hh = (h + 1) % 24; // shift so that 23→0, 0→1, ...
  const branch = Math.floor(hh/2) % 12;
  const dayStemIdx = STEMS.indexOf(dayStem);
  const stemIdx = HOUR_STEM_FROM_DAYSTEM[dayStemIdx][branch];
  return { stem: STEMS[stemIdx], branch: BRANCHES[branch] };
}

// ========== Public API ==========
export function calcFourPillars(input: CalcInput): CalcOutput {
  // 1) local → UTC → CST(UTC+8)
  const utc = toUTC(input.birthDateISO, input.birthTime, input.tzId);
  const cst = shiftToCST(utc);

  // 2) year/month/day/hour pillars
  const yP = yearPillar(cst);
  const mP = monthBranchAndStem(cst);
  const dP = dayPillarWithZiBoundary(cst);
  const hP = hourPillar(cst, dP.stem);

  // 3) dummy big luck (you can wire your existing logic)
  const bigLuck = [
    { startAge: 0, stem: "己", branch: "酉" },
    { startAge:10, stem: "庚", branch: "戌" },
    { startAge:20, stem: "辛", branch: "亥" },
    { startAge:30, stem: "壬", branch: "子" },
    { startAge:40, stem: "癸", branch: "丑" },
    { startAge:50, stem: "甲", branch: "寅" },
  ];

  return {
    pillars: { year: yP, month: mP, day: dP, hour: hP },
    luck: { bigLuck },
  };
}
