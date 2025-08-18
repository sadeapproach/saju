// api/calc.js
// Saju-Eight v1 • Four Pillars core engine (approx-solar-term)
// - TZ/DST 적용
// - 절입(24절기) 기반 월주, 입춘 경계 기반 연주
// - 일주(60갑자), 시주(자시 23:00 시작)
// - 십신/장간/오행(라이트)
// - 경계일 근접 경고(meta.warnings)

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const STEMS = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const ZHIS  = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const STEM_ELEM = {甲:'wood',乙:'wood',丙:'fire',丁:'fire',戊:'earth',己:'earth',庚:'metal',辛:'metal',壬:'water',癸:'water'};
const STEM_YANG = new Set(['甲','丙','戊','庚','壬']); // 양/음 판정
const BRANCH_ELEM = {子:'water',丑:'earth',寅:'wood',卯:'wood',辰:'earth',巳:'fire',午:'fire',未:'earth',申:'metal',酉:'metal',戌:'earth',亥:'water'};
// 장간(지지 숨은 천간)
const HIDDEN_STEMS = {
  子:['癸'], 丑:['己','癸','辛'], 寅:['甲','丙','戊'], 卯:['乙'],
  辰:['戊','乙','癸'], 巳:['丙','戊','庚'], 午:['丁','己'], 未:['己','丁','乙'],
  申:['庚','壬','戊'], 酉:['辛'], 戌:['戊','辛','丁'], 亥:['壬','甲']
};

// ---- Timezone helpers (no external libs)
function getTzOffsetMinutes(tz, date) {
  // returns minutes to ADD to local -> get UTC (i.e., UTC = local - offsetMinutes)
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset', hour12:false });
  const parts = fmt.formatToParts(date);
  const off = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+0';
  // "GMT+9" or "GMT+09:00"
  const m = off.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if(!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  const h = parseInt(m[2]||'0',10);
  const mm = parseInt(m[3]||'0',10);
  return sign * (h*60 + mm);
}
function localToUTC(tzId, y, M, d, hh=0, mm=0) {
  // Create a "local" time in that tz, then convert to UTC Date.
  // We build a guess and adjust by offset.
  const localGuess = new Date(Date.UTC(y, M-1, d, hh, mm, 0));
  const off = getTzOffsetMinutes(tzId, localGuess); // minutes to add to local
  // local time = UTC + offset => UTC = local - offset
  return new Date(Date.UTC(y, M-1, d, hh, mm, 0) - off*60*1000);
}

// ---- Astronomy (approx) to get solar ecliptic longitude
// Julian Day (UTC)
function toJulianDay(dateUTC){ // dateUTC is Date in UTC
  const t = dateUTC.getTime() / 86400000 + 2440587.5; // unix epoch -> JD
  return t;
}
// Sun ecliptic longitude (degrees, 0..360). Meeus-style low-precision.
function sunEclipticLongitude(jd){
  const T = (jd - 2451545.0)/36525;
  const L0 = (280.46646 + 36000.76983*T + 0.0003032*T*T) % 360;
  const M  = (357.52911 + 35999.05029*T - 0.0001537*T*T) * Math.PI/180;
  const C  = (1.914602 - 0.004817*T - 0.000014*T*T)*Math.sin(M)
           + (0.019993 - 0.000101*T)*Math.sin(2*M)
           + 0.000289*Math.sin(3*M);
  const trueLong = L0 + C;
  return (trueLong + 360) % 360;
}

// ---- Calendar/Ganzhi helpers
function mod(a,b){ return ((a%b)+b)%b; }

function ganzhiFromIndex(idx60){
  return { stem: STEMS[mod(idx60,10)], branch: ZHIS[mod(idx60,12)] };
}

// Year GanZhi by "civil year", adjusted by Lichun (approx at ~315°)
function yearGanzhiBySolar(dateLocalUTC, tzId){
  const y = dateLocalUTC.getUTCFullYear(); // we'll test around Feb
  // Check if before Lichun of that "TZ" local time (≈ solar long 315°)
  // Approach: compute solar longitude at given moment; if < 315°, use previous year for sexagenary year.
  const jd = toJulianDay(dateLocalUTC);
  const lon = sunEclipticLongitude(jd);
  const useYear = (lon >= 315 || lon < 315 && dateLocalUTC.getUTCMonth() >= 2) ? y : y-1;
  // Traditional mapping: year stem/branch index since 4CE (甲子 year is 4 CE)
  const stemIdx = mod((useYear - 4), 10);
  const branchIdx = mod((useYear - 4), 12);
  return { stem: STEMS[stemIdx], branch: ZHIS[branchIdx], usedYear: useYear, solarLong: lon };
}

// Month Branch from solar longitude:
//寅= 315°~345°, 卯=345°~15°, 辰=15°~45°, ...丑=285°~315°
// rule: idx = floor((lon + 45)/30) % 12, 0->寅
const BR_OF_INDEX_FROM_LON = ['寅','卯','辰','巳','午','未','申','酉','戌','亥','子','丑'];
function monthBranchFromSolarLongitude(lonDeg){
  const idx = Math.floor(((lonDeg + 45) % 360) / 30);
  return BR_OF_INDEX_FROM_LON[idx];
}
// Month Stem from Year Stem group + month number (寅=1..丑=12)
// YearStem group → 寅월의 천간:
// 甲己→丙, 乙庚→戊, 丙辛→庚, 丁壬→壬, 戊癸→甲
const YGROUP_TO_FIRST_MONTH_STEM = {
  '甲': '丙', '己': '丙',
  '乙': '戊', '庚': '戊',
  '丙': '庚', '辛': '庚',
  '丁': '壬', '壬': '壬',
  '戊': '甲', '癸': '甲'
};
function monthStemFromYearStemAndBranch(yearStem, monthBranch){
  const monthOrder = {寅:1,卯:2,辰:3,巳:4,午:5,未:6,申:7,酉:8,戌:9,亥:10,子:11,丑:12}[monthBranch];
  const first = YGROUP_TO_FIRST_MONTH_STEM[yearStem];
  const firstIdx = STEMS.indexOf(first);
  const stemIdx = mod(firstIdx + (monthOrder - 1), 10);
  return STEMS[stemIdx];
}

// Day GanZhi from Julian Day (commonly used anchor)
// Use: 1984-02-02 (Gregorian) is 甲子 day. Many references use +38/39 shifts;
// this anchor is widely adopted in open-source implementations.
function dayGanzhiFromUTC(utcDate){
  const jd = Math.floor(toJulianDay(utcDate) + 0.5); // JDN at 0h
  // JDN for 1984-02-02 00:00 UTC (approx) = 2445722
  const anchorJDN = 2445722;
  const diff = jd - anchorJDN;
  const idx60 = mod(diff, 60);
  return ganzhiFromIndex(idx60);
}

// Hour Pillar
// Hour branch: 2-hour bins, 子 = 23:00~00:59 (자시 23:00 시작)
function hourBranchFromLocalHour(hh){
  // map 23,0 -> 子(0), 1-2 -> 丑(1), ... 21-22 -> 亥(11)
  const table = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
  const slot = (hh === 23) ? 0 : Math.floor(hh / 2) + 1; // 0→丑 slot, but adjust
  return table[slot % 12];
}
// Hour stem depends on Day stem group + hour branch order(0..11)
// 子시의 시간(천간) 시작:
// 甲/己日→甲, 乙/庚日→丙, 丙/辛日→戊, 丁/壬日→庚, 戊/癸日→壬
const DAY_GROUP_TO_ZI_STEM = {
  '甲':'甲','己':'甲', '乙':'丙','庚':'丙', '丙':'戊','辛':'戊', '丁':'庚','壬':'庚', '戊':'壬','癸':'壬'
};
function hourStemFromDayStemAndHourBranch(dayStem, hourBranch){
  const ziStem = DAY_GROUP_TO_ZI_STEM[dayStem];
  const base = STEMS.indexOf(ziStem);             // 子시의 시작 천간 index
  const order = {子:0,丑:1,寅:2,卯:3,辰:4,巳:5,午:6,未:7,申:8,酉:9,戌:10,亥:11}[hourBranch];
  return STEMS[mod(base + order, 10)];
}

// Ten Gods (간단 규칙, 영문+한글)
const TEN_GODS = {
  peer: 'Peer(比肩)', robber: 'Rival(劫財)',
  eating: 'Eating God(食神)', hurting: 'Hurting Officer(傷官)',
  dr: 'Direct Resource(正印)', ir: 'Indirect Resource(偏印)',
  dw: 'Direct Wealth(正財)', iw: 'Indirect Wealth(偏財)',
  dof:'Direct Officer(正官)', seven:'Seven Kill(七殺)'
};
function tenGodFrom(dayStem, otherStem){
  if(!dayStem || !otherStem) return '';
  const e1 = STEM_ELEM[dayStem], e2 = STEM_ELEM[otherStem];
  const sameElem = e1 === e2;
  const dayYang = STEM_YANG.has(dayStem);
  const otherYang = STEM_YANG.has(otherStem);
  if (sameElem) return (dayYang === otherYang) ? TEN_GODS.peer : TEN_GODS.robber;
  // 생성/극 관계
  const cycle = ['wood','fire','earth','metal','water'];
  const idx1 = cycle.indexOf(e1), idx2 = cycle.indexOf(e2);
  const gen = (idx1+1)%5 === idx2;        // 내가 생하는(자식) → 食神/傷官
  const beGen = (idx2+1)%5 === idx1;      // 나를 생하는(인성) → 正印/偏印
  const control = (idx1+2)%5 === idx2;    // 내가 극하는(재성) → 正/偏財
  const beCtrl = (idx2+2)%5 === idx1;     // 나를 극하는(관성) → 正官/七殺
  if (gen)    return (dayYang === otherYang) ? TEN_GODS.eating : TEN_GODS.hurting;
  if (beGen)  return (dayYang === otherYang) ? TEN_GODS.dr    : TEN_GODS.ir;
  if (control)return (dayYang === otherYang) ? TEN_GODS.dw    : TEN_GODS.iw;
  if (beCtrl) return (dayYang === otherYang) ? TEN_GODS.dof   : TEN_GODS.seven;
  return '';
}

// Elements score (간단 가중치)
function elementsScoreFrom(stems, branches){
  const base = {wood:0,fire:0,earth:0,metal:0,water:0};
  stems.forEach(s=>{ base[STEM_ELEM[s]] += 0.7; });
  branches.forEach(b=>{ base[BRANCH_ELEM[b]] += 0.5; (HIDDEN_STEMS[b]||[]).forEach(h=>{ base[STEM_ELEM[h]] += 0.2; }); });
  // normalize to 1.0 total
  const total = Object.values(base).reduce((a,b)=>a+b,0) || 1;
  Object.keys(base).forEach(k=> base[k] = +(base[k]/total).toFixed(2));
  return base;
}

// Interactions (미니: 충/합)
const BR_CLASH = {子:'午',午:'子',卯:'酉',酉:'卯',寅:'申',申:'寅',辰:'戌',戌:'辰',丑:'未',未:'丑',巳:'亥',亥:'巳'};
const BR_HARMONY = [['子','丑'],['寅','亥'],['卯','戌'],['辰','酉'],['巳','申'],['午','未']];
function interactionsOf(branches){
  const list = Object.values(branches).filter(Boolean);
  const res = { branches:{合:[],充:[],形:[],破:[],害:[]}, stems:{} };
  // 충
  list.forEach(b=>{
    const c = BR_CLASH[b];
    if (c && list.includes(c)) res.branches['充'].push(`${b}↔${c}`);
  });
  // 합(육합)
  BR_HARMONY.forEach(([a,b])=>{
    if (list.includes(a) && list.includes(b)) res.branches['合'].push(`${a}+${b}`);
  });
  return res;
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Use POST' });

  try {
    const { birthDateISO, birthTime, tzId, lat, lng, timeAccuracy='exact' } = req.body || {};
    if (!birthDateISO || !tzId) return res.status(400).json({ ok:false, error:'Missing birthDateISO or tzId' });

    // parse input
    const [y, m, d] = birthDateISO.split('-').map(n=>parseInt(n,10));
    let hh=0, mm=0;
    if (birthTime && /^\d{1,2}:\d{2}$/.test(birthTime)) {
      [hh, mm] = birthTime.split(':').map(n=>parseInt(n,10));
    }

    // Local time -> UTC (TZ/DST 반영)
    const utc = localToUTC(tzId, y, m, d, hh, mm);

    // Solar longitude & meta
    const jd = toJulianDay(utc);
    const lon = sunEclipticLongitude(jd);

    // Year pillar (입춘 기준)
    const Y = yearGanzhiBySolar(utc, tzId);
    const year = { stem: Y.stem, branch: Y.branch };

    // Month pillar (절입 기반)
    const mBranch = monthBranchFromSolarLongitude(lon);
    const mStem   = monthStemFromYearStemAndBranch(year.stem, mBranch);
    const month   = { stem: mStem, branch: mBranch };

    // Day pillar (UTC 기준 anchor)
    const day     = dayGanzhiFromUTC(utc);

    // Hour pillar (자시 23:00 시작, 로컬시)
    const localHour = hh; // 입력 그대로 사용(정확모드). approx/unknown은 null 허용.
    let hour = null;
    if (!isNaN(localHour)) {
      const hBranch = hourBranchFromLocalHour(localHour);
      const hStem   = hourStemFromDayStemAndHourBranch(day.stem, hBranch);
      hour = { stem: hStem, branch: hBranch };
    }

    // Ten Gods (일간 기준으로 각 기둥의 '천간'만 라벨)
    const tenGods = {
      byPillar: {
        year:  tenGodFrom(day.stem, year.stem),
        month: tenGodFrom(day.stem, month.stem),
        day:   'Self(本人/日主)',
        hour:  hour ? tenGodFrom(day.stem, hour.stem) : ''
      }
    };

    // Hidden stems
    const hiddenStems = { byBranch: {} };
    [year, month, day, hour].forEach(p=>{
      if (p && p.branch) hiddenStems.byBranch[p.branch] = HIDDEN_STEMS[p.branch] || [];
    });

    // Elements balance (간단)
    const elScore = elementsScoreFrom(
      [year?.stem, month?.stem, day?.stem, hour?.stem].filter(Boolean),
      [year?.branch, month?.branch, day?.branch, hour?.branch].filter(Boolean)
    );

    // Interactions (간단)
    const inter = interactionsOf({year:year.branch, month:month.branch, day:day.branch, hour:hour?.branch});

    // Boundary warnings (입춘±24h 등)
    const warnings = [];
    // very rough check: if solar longitude within 1.5° of 315°/345°/... boundaries → 경계 주의
    const boundaries = Array.from({length:12}, (_,i)=> (315 + i*30) % 360); // 寅 시작 기준
    const minDiff = Math.min(...boundaries.map(b => Math.min((360+lon-b)%360, (360+b-lon)%360)));
    if (minDiff < 1.5) warnings.push('Near solar-term boundary: month/year pillar may flip within hours (경계 근접).');

    return res.status(200).json({
      ok: true,
      input: { birthDateISO, birthTime: birthTime||null, tzId, lat, lng, timeAccuracy },
      data: {
        pillars: { year, month, day, hour },
        elements: elScore,
        tenGods,
        hiddenStems,
        interactions: inter,
        luck: { note: 'big-luck placeholder (later step)' },
        meta: {
          method: 'approx-solar-term',
          solarLongitudeDeg: +lon.toFixed(3),
          yearUsed: Y.usedYear,
          tzOffsetMinutes: getTzOffsetMinutes(tzId, utc),
          warnings
        }
      }
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || 'calc_failed' });
  }
};
