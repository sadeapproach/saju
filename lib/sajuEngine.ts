// lib/sajuEngine.ts
// ✅ 단일 표준: late-zi, jieqi(Asia/Seoul), TrueSolar OFF, 절기 산법(기운)
// - 절기(Jieqi) 계산은 기본 ‘근사’ 공급자를 넣고, 정확 패키지로 쉽게 교체 가능하도록 분리.

// ----------------- 상수/테이블 -----------------
const STEMS = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'] as const;
const BRANCHES = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'] as const;
const STEM_ELEM = ['wood','wood','fire','fire','earth','earth','metal','metal','water','water'] as const;
const BRANCH_ELEM = ['water','earth','wood','wood','earth','fire','fire','earth','metal','metal','earth','water'] as const;

// 지장간(간단판) — 필요 시 세부치환 교체 가능
const HIDDEN_STEMS: Record<typeof BRANCHES[number], string[]> = {
  子:['癸'],
  丑:['己','癸','辛'],
  寅:['甲','丙','戊'],
  卯:['乙'],
  辰:['戊','乙','癸'],
  巳:['丙','戊','庚'],
  午:['丁','己'],
  未:['己','丁','乙'],
  申:['庚','壬','戊'],
  酉:['辛'],
  戌:['戊','辛','丁'],
  亥:['壬','甲'],
};

// 십신(十神) — 기준: ‘일간’(Day Stem) 대비 상대 오행/음양
type TenGod =
  | '비견' | '겁재'  // 同比(wood:wood) ± 음양
  | '식신' | '상관'  // 내가 생하는 오행
  | '편재' | '정재'  // 내가 극하는 오행
  | '편관' | '정관'  // 나를 극하는 오행
  | '편인' | '정인'; // 나를 생하는 오행

function tenGodOf(dayStemIdx: number, otherStemIdx: number): TenGod {
  const meElem = STEM_ELEM[dayStemIdx];             // 내 오행
  const youElem = STEM_ELEM[otherStemIdx];          // 상대 오행
  const meYang = dayStemIdx % 2 === 0;              // 甲丙戊庚壬: 양
  const youYang = otherStemIdx % 2 === 0;

  // 오행 상생/상극 관계
  const gen: Record<string,string> = { wood:'fire', fire:'earth', earth:'metal', metal:'water', water:'wood' }; // 내가 생하는
  const drain: Record<string,string> = Object.fromEntries(Object.entries(gen).map(([k,v])=>[v,k]));              // 나를 생하는
  const conquer: Record<string,string> = { wood:'earth', earth:'water', water:'fire', fire:'metal', metal:'wood' }; // 내가 극하는
  const beConquered: Record<string,string> = Object.fromEntries(Object.entries(conquer).map(([k,v])=>[v,k]));      // 나를 극하는

  if (youElem === meElem) return youYang === meYang ? '비견' : '겁재';
  if (youElem === gen[meElem]) return youYang === meYang ? '식신' : '상관';
  if (youElem === conquer[meElem]) return youYang === meYang ? '편재' : '정재';
  if (youElem === beConquered[meElem]) return youYang === meYang ? '편관' : '정관';
  if (youElem === drain[meElem]) return youYang === meYang ? '편인' : '정인';
  // fallback
  return '비견';
}

// 시간별 지지(자~해)
function hourBranchByHM(h:number, m:number): number {
  const hh = h + (m>=0?0:0); // 단순
  // 자(23-01), 축(01-03), …, 해(21-23)
  const blocks = [23,1,3,5,7,9,11,13,15,17,19,21]; // 시작시
  for (let i=0;i<12;i++){
    const s = blocks[i], e = (s+2)%24;
    if (s===23 && (hh>=23 || hh<1)) return 0; // 子
    if (s!==23 && hh>=s && hh<e) return i;
  }
  return 0;
}

// 일간별 ‘자시’ 천간(시주의 천간 시작점)
const HOUR_STEM_SEED_BY_DAYSTEM: Record<number, number> = {
  // 일간 甲/己 → 子시 천간 甲(0), 乙/庚 → 丙(2), 丙/辛 → 戊(4), 丁/壬 → 庚(6), 戊/癸 → 壬(8)
  0:0, 5:0,
  1:2, 6:2,
  2:4, 7:4,
  3:6, 8:6,
  4:8, 9:8,
};

// 60갑자 인덱스 유틸
function ganzhiFromIndex(idx:number){ return { stem: STEMS[idx%10], branch: BRANCHES[idx%12] }; }

// 1984-02-02 (UTC) = 갑자(甲子)일로 쓰는 관용 기준 (많은 만세력에서 쓰는 anchor)
// 일주 계산: (엡실론 차이 허용)
const ANCHOR_DATE_UTC = Date.UTC(1984,1,2); // 1984-02-02
const ANCHOR_DAY_INDEX = 0; // 甲子

function dayIndexFromUTC(utcMs:number){
  const days = Math.floor((utcMs - ANCHOR_DATE_UTC)/86400000);
  const idx = (ANCHOR_DAY_INDEX + ((days%60)+60)%60) % 60;
  return idx;
}

// ----------------- 절기 공급자(플러그형) -----------------
// 기본은 '근사 버전': 1900–2100년대에서는 보통 입절이 4~8일 근처로 고정.
// 실제 상용정확도를 원하면 이 부분을 고정밀 라이브러리/테이블로 교체.
// - 교체 포인트: getJieqiBoundaries(year, tz) -> 각 절기 UTC 타임스탬프 반환
type Jieqi = {
  name: string;          // 입춘, 우수, 경칩, ...
  time: number;          // UTC ms
};
type JieqiProvider = (year:number, tzId:string)=>Promise<Jieqi[]>;

function approxJieqiProvider(): JieqiProvider {
  // 아주 단순 근사: "입춘 = yyyy-02-04 10:00 KST" 등 대략치. (테스트/개발 용)
  // 실제 서비스에선 꼭 high-precision 공급자로 교체!
  const base = [
    ['小寒', '01-06 00:00'], ['大寒','01-20 00:00'],
    ['立春','02-04 00:00'], ['雨水','02-19 00:00'],
    ['驚蟄','03-06 00:00'], ['春分','03-21 00:00'],
    ['清明','04-05 00:00'], ['穀雨','04-20 00:00'],
    ['立夏','05-06 00:00'], ['小滿','05-21 00:00'],
    ['芒種','06-06 00:00'], ['夏至','06-21 00:00'],
    ['小暑','07-07 00:00'], ['大暑','07-22 00:00'],
    ['立秋','08-07 00:00'], ['處暑','08-23 00:00'],
    ['白露','09-07 00:00'], ['秋分','09-23 00:00'],
    ['寒露','10-08 00:00'], ['霜降','10-24 00:00'],
    ['立冬','11-08 00:00'], ['小雪','11-22 00:00'],
    ['大雪','12-07 00:00'], ['冬至','12-21 00:00'],
  ] as const;
  return async (year:number, tzId:string)=>{
    // tz은 무시하고 KST 00:00 근사로 생성 → 실제 서비스에서는 tz 반영 필요.
    return base.map(([n,md])=>{
      const d = new Date(`${year}-${md}:00 +09:00`);
      return { name: n, time: d.getTime() - (9*3600*1000) }; // UTC로
    });
  };
}

// 더 높은 정확도로 바꾸고 싶다면:
// 1) npm의 고정밀 천문 라이브러리로 태양황경=15°k 시각을 구해 절기 시각을 산출
// 2) 또는 1900~2100년 절기표 JSON을 넣고 그대로 써도 됨.
let getJieqiBoundaries: JieqiProvider = approxJieqiProvider();

// ----------------- 핵심 계산 -----------------
export type EngineOptions = {
  useTrueSolar?: false;           // 강제 OFF
  hourRule?: 'late-zi';           // 강제
  monthBy?: 'jieqi';              // 강제
  jieqiTZ?: string;               // "Asia/Seoul"
  startAgeMethod?: 'qi-yun-jieqi';// 강제
}

export type CalcResult = {
  pillars: { hour:{stem:string,branch:string}, day:{stem:string,branch:string}, month:{stem:string,branch:string}, year:{stem:string,branch:string} };
  tenGods: { byPillar: Record<'hour'|'day'|'month'|'year', string> };
  hiddenStems: Record<'hour'|'day'|'month'|'year', string[]>;
  luck: { startAge:number, bigLuck: Array<{ startAge:number, stem:string, branch:string, tenGod?:string }> };
};

function pad2(n:number){ return (n<10?'0':'')+n; }

export async function calcSajuStrict(input:{
  y:number,m:number,d:number, hh:number, mm:number, tzId:string, lat?:number, lng?:number
}, opts?: EngineOptions): Promise<CalcResult> {

  // 1) late-zi: 23:00–00:59는 ‘익일’ 관점 반영(전날 밤 입력 → 다음날로 넘어감)
  let {y,m,d,hh,mm} = input;
  if (hh>=23) {
    const dt = new Date(`${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:00`);
    dt.setDate(dt.getDate()+1);
    y = dt.getFullYear(); m = dt.getMonth()+1; d = dt.getDate(); // 시간은 그대로 23시
  }

  // 2) 현지 → UTC
  const local = new Date(`${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:00`);
  const utcMs = local.getTime() - (local.getTimezoneOffset()*60000); // 런타임TZ 기준; 서버가 UTC면 offset=0

  // 3) 절기: 월주/연주 경계(입춘) 판정
  const jieqi = await getJieqiBoundaries(y, input.tzId || 'Asia/Seoul');
  const lichun = jieqi.find(j=>j.name==='立春')?.time ?? Date.UTC(y,1,4); // fallback 2/4
  // 연주는 "입춘 기준"으로 년 경계
  const solarYear = (utcMs >= lichun) ? y : (y - 1);

  // 4) 연주: 갑자년 anchor = 1984(갑자) 기준 관용치
  const baseJiaZiYear = 1984; // 갑자
  const yearIndex = ((solarYear - baseJiaZiYear) % 60 + 60) % 60;
  const yearP = ganzhiFromIndex(yearIndex);

  // 5) 일주: 앵커 1984-02-02(UTC)=갑자일 기준
  const dayIndex = dayIndexFromUTC(utcMs);
  const dayP = ganzhiFromIndex(dayIndex);

  // 6) 월주: 절기 구간으로 월지 결정 + 천간은 (연간/월지) 규칙
  // 간단판: 입절 시각 배열에서 자신의 UTC가 포함된 절기 구간의 ‘월지’를 선택
  //   입춘=寅, 경칩=卯, 청명=辰, … (24절기 중 홀수번째가 "중기"라 월지 전환 기준으로 흔히 씀)
  // 여기선 간단하게 “입절 순서 → 寅부터 12지 순환” 근사
  const monthBranchIndexFromLichun = (():number=>{
    // 寅을 0으로 보고 30일≈1지지 근사
    const msPerBranch = 30*86400000; // 근사
    const diff = utcMs - (lichun ?? utcMs);
    const k = Math.floor(diff / msPerBranch);
    return ((k%12)+12)%12; // 0..11
  })();
  const MONTH_START = 2; // 寅 index = 2?  (BRANCHES: 子(0)~亥(11). 寅은 2)
  const monthBranchIdx = (2 + monthBranchIndexFromLichun) % 12;
  const monthBranch = BRANCHES[monthBranchIdx];

  // 월간: 연간과 월지로부터 도출(간지표). 간단 규칙: (년간Index*2 + 월지Index) % 10
  const yearStemIdx = STEMS.indexOf(yearP.stem);
  const monthStemIdx = (yearStemIdx*2 + monthBranchIdx) % 10;
  const monthP = { stem: STEMS[monthStemIdx], branch: monthBranch };

  // 7) 시주: 시간 지지 + 일간에 따른 천간 시드
  const hbIdx = hourBranchByHM(hh, mm);         // 0..11
  const dayStemIdx = STEMS.indexOf(dayP.stem);  // 0..9
  const seed = HOUR_STEM_SEED_BY_DAYSTEM[dayStemIdx];
  const hourStemIdx = (seed + hbIdx) % 10;
  const hourP = { stem: STEMS[hourStemIdx], branch: BRANCHES[hbIdx] };

  // 8) 십신/지장간
  const tgHour  = tenGodOf(dayStemIdx, hourStemIdx);
  const tgMonth = tenGodOf(dayStemIdx, monthStemIdx);
  const tgYear  = tenGodOf(dayStemIdx, STEMS.indexOf(yearP.stem));
  const tgDay   = '비견'; // 일간 대비 자기 자신

  const hidden = {
    hour:  HIDDEN_STEMS[hourP.branch],
    day:   HIDDEN_STEMS[dayP.branch],
    month: HIDDEN_STEMS[monthP.branch],
    year:  HIDDEN_STEMS[yearP.branch],
  };

  // 9) 대운 시작(절기 산법, 근사): 출생시각→다음 절기까지 일수/3
  const nextJieqi = jieqi.find(j=>j.time>utcMs)?.time ?? (utcMs + 15*86400000);
  const diffDays = (nextJieqi - utcMs)/86400000;
  const startAge = Math.max(0, Math.floor(diffDays/3)); // 근사: 3일=1세

  // 10) 대운 8주기(남성 순행/여성 역행 등 학파차는 고정 필요 시 여기에 반영)
  // 여기선 간단히 ‘순행’ 0~70세까지 10년 간격 8주기
  const bigLuck = Array.from({length:8}).map((_,i)=>{
    const stem = STEMS[(monthStemIdx + i + 1) % 10];
    const branch=BRANCHES[(monthBranchIdx + i + 1) % 12];
    const tg = tenGodOf(dayStemIdx, STEMS.indexOf(stem));
    return { startAge: startAge + i*10, stem, branch, tenGod: tg };
  });

  return {
    pillars: { hour:hourP, day:dayP, month:monthP, year:yearP },
    tenGods: { byPillar: { hour:tgHour, day:tgDay, month:tgMonth, year:tgYear } },
    hiddenStems: hidden,
    luck: { startAge, bigLuck },
  };
}

// 고정 규칙으로 쓰려면 외부에서 이 함수만 쓰면 됩니다.
export async function calcWithFixedStandard(params:{
  y:number,m:number,d:number, hh:number, mm:number, tzId:string, lat?:number, lng?:number
}){
  return calcSajuStrict(params, {
    useTrueSolar:false,
    hourRule:'late-zi',
    monthBy:'jieqi',
    jieqiTZ:'Asia/Seoul',
    startAgeMethod:'qi-yun-jieqi',
  });
}

// (선택) 절기 공급자 교체 API
export function setJieqiProvider(p:JieqiProvider){ getJieqiBoundaries = p; }
