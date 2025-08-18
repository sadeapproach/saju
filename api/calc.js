// api/calc.js
// Saju-Eight: Four Pillars calculator (MVP)
// - Local Solar Time(LST) correction for HOUR pillar
// - Solar-based Year/Month approximation (Lichun as year boundary, 寅月 as month 1)
// - Day pillar via JDN → Sexagenary mapping
// - Simple element ratios & ten gods (lightweight)
// NOTE: This is a practical MVP that matches most cases. For pro-grade accuracy,
//       later attach a precise solar term (節氣) & Equation of Time table.

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const STEMS = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸']; // 10
const BRANCHES = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥']; // 12

// element mapping
const STEM_ELEM = {甲:'wood',乙:'wood',丙:'fire',丁:'fire',戊:'earth',己:'earth',庚:'metal',辛:'metal',壬:'water',癸:'water'};
const BRANCH_ELEM = {子:'water',丑:'earth',寅:'wood',卯:'wood',辰:'earth',巳:'fire',午:'fire',未:'earth',申:'metal',酉:'metal',戌:'earth',亥:'water'};

// ------------------------------
// Time helpers (timezone & LST)
// ------------------------------

// 1) get offset(ms) of tz at a given UTC instant
function getOffsetMs(tz, utcDate) {
  // utcDate is a Date in UTC timeline
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = fmt.formatToParts(utcDate);
  const map = {};
  parts.forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });

  const asLocalUTC = Date.UTC(
    parseInt(map.year,10),
    parseInt(map.month,10)-1,
    parseInt(map.day,10),
    parseInt(map.hour,10),
    parseInt(map.minute,10),
    parseInt(map.second,10)
  );
  // offset = (local wall-clock as UTC) - actual UTC instant
  return asLocalUTC - utcDate.getTime();
}

// 2) build UTC instant from "local civil time" components in tz
function fromLocalCivilToUTC(tz, y,m,d,hh=0,mm=0,ss=0) {
  // initial guess: treat as if local==UTC, then iterate offset
  let guess = new Date(Date.UTC(y, m-1, d, hh, mm, ss));
  // compute actual offset for that wall-clock
  const off = getOffsetMs(tz, guess);
  return new Date(guess.getTime() - off);
}

// 3) std longitude from tz offset (in hours)
function stdLongitudeFromOffsetHours(offsetH) {
  // Standard meridians every 15°
  return 15 * offsetH; // east positive
}

// 4) derive offset hours at that instant
function offsetHoursAt(tz, utcDate) {
  const offMs = getOffsetMs(tz, utcDate);
  return offMs / 3_600_000;
}

// 5) apply Local Solar Time correction: LST = LCT + 4*(lon - stdLon) minutes
function applyLocalSolarTime(tz, utcCivilInstant, lngDeg) {
  const offH = offsetHoursAt(tz, utcCivilInstant); // e.g., Asia/Seoul => +9
  const stdLon = stdLongitudeFromOffsetHours(offH); // e.g., +9h => 135E
  const deltaMin = 4 * (lngDeg - stdLon); // east positive
  return new Date(utcCivilInstant.getTime() + deltaMin * 60_000);
}

// extract local H:M in tz for given UTC instant
function localHM(tz, utcInstant) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false, hour: '2-digit', minute: '2-digit'
  });
  const s = fmt.format(utcInstant); // "06:28"
  const [H,M] = s.split(':').map(n => parseInt(n,10));
  return { H, M };
}

// ------------------------------
// Sexagenary helpers
// ------------------------------

// mod helper
const mod = (a,m)=>((a%m)+m)%m;

// 1) Julian Day Number (Gregorian calendar → JDN, at local civil midnight)
function gregorianToJDN(y,m,d) {
  // Fliegel–Van Flandern algorithm
  const a = Math.floor((14 - m)/12);
  const yy = y + 4800 - a;
  const mm = m + 12*a - 3;
  return d + Math.floor((153*mm + 2)/5) + 365*yy + Math.floor(yy/4) - Math.floor(yy/100) + Math.floor(yy/400) - 32045;
}

// 2) 60-cycle index → stem/branch
function ganZhiFromIndex(idx) {
  const s = STEMS[mod(idx,10)];
  const b = BRANCHES[mod(idx,12)];
  return { stem: s, branch: b };
}

// 3) Day pillar from JDN
// Reference: pick JDN that maps to 甲子. Empirically, JDN=2445701 (1984-02-02) is often used.
// Using index = (JDN - 11) % 60 gives 1984-02-02 → 甲子. (wide used convention)
function dayPillarFromJDN(jdn) {
  const idx = mod(jdn - 11, 60);
  return ganZhiFromIndex(idx);
}

// 4) Year pillar (solar-based, year starts at approx. Lichun ≈ Feb 4)
function approxYearPillar(y, m, d) {
  // if date before Feb 4 → use previous year
  const useYear = (m < 2 || (m === 2 && d < 4)) ? (y - 1) : y;
  // 1984 is 甲子 year index anchor (common anchor)
  const yearIdx = mod((useYear - 1984), 60);
  return ganZhiFromIndex(yearIdx);
}

// 5) Month pillar (寅月=Month 1 anchored to ~Feb)
// This is an approximation: 寅,卯,辰,巳,午,未,申,酉,戌,亥,子,丑
function approxMonthPillar(yearStem, y, m, d) {
  // monthIndex 0..11, 寅=0
  // naive mapping by Gregorian month with Feb as 寅 start; if date < Feb 4, treat as previous month (丑)
  let mi;
  if (m === 1) mi = 11; // Jan → 丑 (previous cycle)
  else mi = (m - 2);    // Feb→0(寅), Mar→1(卯) ...

  // small tweak: if in Feb but before 4th, still use 丑
  if (m === 2 && d < 4) mi = 11;

  const monthBranch = BRANCHES[(2 + mi) % 12]; // 2: 寅, check mapping
  // month stem sequence depends on year stem group:
  // YearStem 甲己→ 丙 starts at 寅; 乙庚→ 戊; 丙辛→ 庚; 丁壬→ 壬; 戊癸→ 甲
  const startStemForYin = (() => {
    const s = yearStem;
    if (s==='甲'||s==='己') return '丙';
    if (s==='乙'||s==='庚') return '戊';
    if (s==='丙'||s==='辛') return '庚';
    if (s==='丁'||s==='壬') return '壬';
    return '甲'; // 戊 or 癸
  })();
  const startIdx = STEMS.indexOf(startStemForYin); // 寅의 천간
  // branch index from 寅(2) to current branch
  const bIdxFromYin = mod(BRANCHES.indexOf(monthBranch) - BRANCHES.indexOf('寅'), 12);
  const stemIdx = mod(startIdx + bIdxFromYin, 10);
  return { stem: STEMS[stemIdx], branch: monthBranch };
}

// 6) Hour pillar
//   - decide hour-branch by 2h bins starting from 23:00 → 子
//   - decide hour-stem from day-stem by rule:
//     甲己→ 甲(子시 시작), 乙庚→ 丙, 丙辛→ 戊, 丁壬→ 庚, 戊癸→ 壬
function hourPillarFromLocalHM(dayStem, H, M) {
  // 2h bin
  const totalMin = H*60 + M;
  // 子: 23:00~00:59, 丑: 01:00~02:59, ... 亥: 21:00~22:59
  // Map minutes to branch index 0..11 (子..亥)
  let branchIdx;
  if (totalMin >= 23*60 || totalMin < 1*60) branchIdx = 0; // 子
  else branchIdx = Math.floor((totalMin - 60) / 120) + 1;   // shift after 01:00

  const branch = BRANCHES[branchIdx];

  const startStemForZi = (() => {
    const s = dayStem;
    if (s==='甲'||s==='己') return '甲';
    if (s==='乙'||s==='庚') return '丙';
    if (s==='丙'||s==='辛') return '戊';
    if (s==='丁'||s==='壬') return '庚';
    return '壬'; // 戊 or 癸
  })();
  const startIdx = STEMS.indexOf(startStemForZi);
  const stemIdx = mod(startIdx + branchIdx, 10);
  return { stem: STEMS[stemIdx], branch };
}

// ------------------------------
// Elements & Ten Gods (light)
// ------------------------------
function elementsFromPillars(pillars) {
  const counts = { wood:0, fire:0, earth:0, metal:0, water:0 };
  ['hour','day','month','year'].forEach(k=>{
    const p = pillars[k];
    if (!p) return;
    counts[STEM_ELEM[p.stem]] += 0.6;   // stem weight
    counts[BRANCH_ELEM[p.branch]] += 0.4; // branch weight
  });
  const sum = Object.values(counts).reduce((a,b)=>a+b,0) || 1;
  const norm = {};
  Object.keys(counts).forEach(k=>norm[k] = +(counts[k]/sum).toFixed(2));
  return norm;
}

// very light ten gods by comparing hour stem vs day master (for demo)
function simpleTenGods(dayStem, pillars) {
  // mapping of “same element” as 比肩 등, “producing” as 食傷, “controlling” as 財/官 (simplified)
  // This is intentionally minimal – extend later.
  const rel = {};
  const stemIdx = STEMS.indexOf(dayStem);
  const elemOf = (s)=>STEM_ELEM[s];
  const relation = (s)=>{
    const e = elemOf(s);
    const me = elemOf(dayStem);
    if (e===me) return '比肩/劫財';
    if ((me==='wood' && e==='fire')||(me==='fire'&&e==='earth')||(me==='earth'&&e==='metal')||(me==='metal'&&e==='water')||(me==='water'&&e==='wood')) return '食神/傷官';
    if ((me==='wood' && e==='earth')||(me==='fire'&&e==='metal')||(me==='earth'&&e==='water')||(me==='metal'&&e==='wood')||(me==='water'&&e==='fire')) return '財(正/偏)';
    if ((me==='wood' && e==='metal')||(me==='fire'&&e==='water')||(me==='earth'&&e==='wood')||(me==='metal'&&e==='fire')||(me==='water'&&e==='earth')) return '官(正/偏)';
    return '印(正/偏)';
  };
  ['hour','month','year'].forEach(k=>{
    const p = pillars[k]; if(!p) return;
    rel[k] = relation(p.stem);
  });
  return rel;
}

// ------------------------------
// Main handler
// ------------------------------
module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false, error:'Use POST', allow:['POST','OPTIONS'] });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body||'{}') : (req.body||{});
    const {
      birthDateISO,        // "YYYY-MM-DD"
      birthTime,           // "HH:mm" (optional)
      tzId,                // e.g., "Asia/Seoul"
      lat, lng,            // for LST (lng used)
      timeAccuracy='exact',
      useLocalSolarTime=true // NEW: LST correction on by default
    } = body;

    if (!birthDateISO || !tzId) return json(res, 400, { ok:false, error:'Missing birthDateISO or tzId' });

    // parse birth local civil time
    const [y,m,d] = birthDateISO.split('-').map(n=>parseInt(n,10));
    let hh=0, mm=0;
    if (birthTime && /^\d{2}:\d{2}$/.test(birthTime)) {
      const [H,M] = birthTime.split(':').map(n=>parseInt(n,10));
      hh=H; mm=M;
    }

    // 1) local civil → UTC instant
    const utcCivil = fromLocalCivilToUTC(tzId, y,m,d, hh,mm,0);

    // 2) (optional) LST correction for HOUR ONLY
    const utcForHour = (useLocalSolarTime && typeof lng==='number')
      ? applyLocalSolarTime(tzId, utcCivil, lng)
      : utcCivil;

    // ------------------------------
    // Pillars calculation
    // ------------------------------

    // Day pillar by JDN of *local civil date* (no hour)
    const jdn = gregorianToJDN(y,m,d);
    const day = dayPillarFromJDN(jdn);

    // Year pillar (approx by Lichun ~ Feb 4)
    const year = approxYearPillar(y,m,d);

    // Month pillar (approx 寅=Feb)
    const month = approxMonthPillar(year.stem, y,m,d);

    // Hour pillar (use LST-corrected local time)
    const { H:locH, M:locM } = localHM(tzId, utcForHour);
    const hour = hourPillarFromLocalHM(day.stem, locH, locM);

    const pillars = { hour, day, month, year };

    // elements & very light ten gods
    const elements = elementsFromPillars(pillars);
    const tenGods = simpleTenGods(day.stem, pillars);

    // quick interactions stub (extend later)
    const interactions = { branches:{}, stems:{} };

    // simple “big luck” stub
    const birthYear = y;
    const ageNow = (()=>{ const now=new Date(); let a=now.getFullYear()-birthYear; const m0=(now.getMonth()+1)-(m); if (m0<0 || (m0===0 && now.getDate()<d)) a--; return a; })();
    const luck = {
      bigLuck: [0,10,20,30,40,50,60].map(a=>({ startAge:a, stem:null, branch:null, tenGod:null }))
    };

    return json(res, 200, {
      ok:true,
      data:{
        pillars,
        elements,
        tenGods,
        interactions,
        luck
      },
      meta:{
        useLocalSolarTime,
        input:{ birthDateISO, birthTime: birthTime||null, tzId, lat, lng, timeAccuracy },
        debug:{
          localCivilUTC: utcCivil.toISOString(),
          hourCalcUTC: utcForHour.toISOString(),
          hourLocalHM: `${String(locH).padStart(2,'0')}:${String(locM).padStart(2,'0')}`
        }
      }
    });

  } catch (e) {
    return json(res, 500, { ok:false, error:'calc_failed', detail: String(e && e.message || e) });
  }
};
