// api/calc.js  (CommonJS / Vercel serverless)
// Day Pillar: JDN(율리우스일) 기반 + 子正(23:00) 경계 적용
// Hour Pillar: 일간 + 시지 (경계 정시 "이전 시각 포함" 규칙 유지)
// Month/Year Pillar는 아직 자리만 — 다음 단계에서 절기 기반으로 교체 예정.

const STEMS = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
const BRANCH = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];

const ZI_START_STEM = {
  "甲":"甲","己":"甲",
  "乙":"丙","庚":"丙",
  "丙":"戊","辛":"戊",
  "丁":"庚","壬":"庚",
  "戊":"壬","癸":"壬",
};

const STEM_ELEM = {甲:"wood",乙:"wood",丙:"fire",丁:"fire",戊:"earth",己:"earth",庚:"metal",辛:"metal",壬:"water",癸:"water"};
const BRANCH_ELEM = {子:"water",丑:"earth",寅:"wood",卯:"wood",辰:"earth",巳:"fire",午:"fire",未:"earth",申:"metal",酉:"metal",戌:"earth",亥:"water"};

// ---------- Time helpers ----------
function getLocalParts(isoDate, hhmm, tz) {
  // 사용자 입력을 "현지 태어난 시각"으로 보고 tz로 포매팅
  const t = (hhmm && /^\d{1,2}:\d{2}$/.test(hhmm)) ? `T${hhmm}:00` : "T00:00:00";
  // 문자열 Z 붙여도 아래 Intl의 tz가 최종 로컬 시각을 만들어줌(날짜/시/분/초만 필요)
  const d = new Date(`${isoDate}${t}Z`);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  });
  const obj = Object.fromEntries(fmt.formatToParts(d).map(p=>[p.type,p.value]));
  return { y:+obj.year, m:+obj.month, d:+obj.day, H:+obj.hour, M:+obj.minute, S:+obj.second };
}

function addDaysYMD(y,m,d,delta){
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate()+delta);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth()+1, d: dt.getUTCDate() };
}

// ---------- JDN & Day Ganzhi ----------
function jdnGregorian(y,m,d){
  // Meeus 알고리즘 (Gregorian)
  const a = Math.floor((14 - m)/12);
  const y2 = y + 4800 - a;
  const m2 = m + 12*a - 3;
  let J = d + Math.floor((153*m2 + 2)/5) + 365*y2 + Math.floor(y2/4) - Math.floor(y2/100) + Math.floor(y2/400) - 32045;
  return J; // 정오 기준 JDN (정수)
}

// JDN → Sexagenary day index (0=甲子)
function ganzhiIndexFromJDN(J){
  // 널리 쓰이는 오프셋: (JDN + 49) % 60 == 0 → 甲子
  return ((J + 49) % 60 + 60) % 60;
}

function dayGanzhiByJDN(y,m,d, H, M){
  // 子正(23:00) 경계: 현지시각 23:00~23:59면 '다음 날'로 간주
  let Y=y, Mth=m, D=d;
  if (H >= 23) {
    const nd = addDaysYMD(y,m,d, +1);
    Y = nd.y; Mth = nd.m; D = nd.d;
  }
  const J = jdnGregorian(Y,Mth,D);
  const idx60 = ganzhiIndexFromJDN(J);
  return {
    stem: STEMS[idx60 % 10],
    branch: BRANCH[idx60 % 12],
    idx60,
  };
}

// ---------- Hour (branch & stem) ----------
function getHourBranch(H, M, rule="previous-on-exact"){
  const mins = H*60 + M;
  // 경계표 (이전 시각 포함 rule): [23:00,01:00), [01:00,03:00) ...
  const slots = [
    { b:"子", s:23*60, e:24*60 },
    { b:"丑", s: 1*60, e: 3*60 },
    { b:"寅", s: 3*60, e: 5*60 },
    { b:"卯", s: 5*60, e: 7*60 },
    { b:"辰", s: 7*60, e: 9*60 },
    { b:"巳", s: 9*60, e:11*60 },
    { b:"午", s:11*60, e:13*60 },
    { b:"未", s:13*60, e:15*60 },
    { b:"申", s:15*60, e:17*60 },
    { b:"酉", s:17*60, e:19*60 },
    { b:"戌", s:19*60, e:21*60 },
    { b:"亥", s:21*60, e:23*60 },
    { b:"子", s: 0,    e: 1*60 },
  ];
  for (let i=0;i<slots.length;i++){
    const s=slots[i];
    if (rule==="previous-on-exact"){
      if (mins>=s.s && mins<s.e) return s.b;
      if (mins===s.s && s.s!==0){
        const prev=slots[(i-1+slots.length)%slots.length];
        return prev.b;
      }
    } else {
      if (mins>=s.s && mins<s.e) return s.b;
    }
  }
  return "子";
}

function hourStemFrom(dayStem, hourBranch){
  const base = ZI_START_STEM[dayStem];
  const idx0 = STEMS.indexOf(base);
  const off  = BRANCH.indexOf(hourBranch);
  return STEMS[(idx0 + off) % 10];
}

// ---------- Elements tally ----------
function tallyElements(pillars){
  const acc={wood:0, fire:0, earth:0, metal:0, water:0};
  const add=k=>{ if(acc.hasOwnProperty(k)) acc[k]+=1; };
  ["year","month","day","hour"].forEach(k=>{
    const p = pillars[k]; if(!p) return;
    if (p.stem && p.stem!=="?") add(STEM_ELEM[p.stem]);
    if (p.branch && p.branch!=="?") add(BRANCH_ELEM[p.branch]);
  });
  const total = Object.values(acc).reduce((a,b)=>a+b,0) || 1;
  Object.keys(acc).forEach(k=>acc[k] = +(acc[k]/total).toFixed(2));
  return acc;
}

// ---------- API ----------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Use POST' });

  try{
    const body = typeof req.body==='string' ? JSON.parse(req.body||'{}') : (req.body||{});
    const birthDateISO = (body.birthDateISO||'').trim();
    const birthTime    = (body.birthTime||null);
    const tzId         = (body.tzId||'Asia/Seoul').toString();
    const lat          = typeof body.lat==='number' ? body.lat : null;
    const lng          = typeof body.lng==='number' ? body.lng : null;
    const timeAccuracy = (body.timeAccuracy||'exact');

    if(!birthDateISO) return res.status(400).json({ ok:false, error:'Missing birthDateISO' });

    // 1) 현지 시각/날짜
    const L = getLocalParts(birthDateISO, birthTime, tzId);

    // 2) JDN + 子正 경계 → 일간/일지
    const dayGZ = dayGanzhiByJDN(L.y, L.m, L.d, L.H, L.M);

    // 3) 시지/시간 (경계 정시: 이전시각 포함)
    const hourBranch = getHourBranch(L.H, L.M, "previous-on-exact");
    const hourStem   = hourStemFrom(dayGZ.stem, hourBranch);

    // 4) (임시) 월/년주는 자리만 — 다음 단계에서 절기 기반 구현
    const pillars = {
      year:  { stem:"?", branch:"?" },
      month: { stem:"?", branch:"?" },
      day:   { stem: dayGZ.stem, branch: dayGZ.branch },
      hour:  { stem: hourStem,   branch: hourBranch },
    };

    const elements = tallyElements(pillars);

    return res.status(200).json({
      ok:true,
      input:{ birthDateISO, birthTime, tzId, lat, lng, timeAccuracy, local:L },
      data:{
        pillars,
        elements,
        tenGods:{}, hiddenStems:{}, interactions:{}, luck:{}
      },
      meta:{
        rules:{
          dayBoundary:"23:00 (子正) → next day",
          dayIndex:"JDN-based ( (JDN+49) mod 60 = 甲子 )",
          hourBoundary:"previous-on-exact"
        },
        debug:{ jdn: jdnGregorian(L.y, L.m, (L.H>=23? addDaysYMD(L.y,L.m,L.d,1).d : L.d)) }
      }
    });
  }catch(e){
    return res.status(500).json({
      ok:false, error:"calc_failed",
      detail:{ name:e?.name||'Error', message:e?.message||String(e), stack:e?.stack?.split('\n').slice(0,3).join('\n')||null }
    });
  }
};
