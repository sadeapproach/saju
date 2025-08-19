// /api/calc.ts  (Next.js App Router or Vercel Functions)
// 고정 표준: late-zi, no true-solar, jieqi month(Asia/Seoul), qi-yun(절기 산법)

// --- 유틸 & 타입 -------------------------------------------------------------
type CalcInput = {
  birthDateISO: string;      // "YYYY-MM-DD"
  birthTime?: string;        // "HH:mm" (optional)
  lat?: number;
  lng?: number;
  tzId: string;              // e.g., "Asia/Seoul"
  timeAccuracy?: 'exact' | 'unknown'; // not used but 허용
};

type Pillar = { stem: string; branch: string };
type FourPillars = { hour: Pillar; day: Pillar; month: Pillar; year: Pillar };

type CalcOutput = {
  pillars: FourPillars;
  elements?: any;
  tenGods?: any;
  hiddenStems?: any;
  interactions?: any;
  luck?: {
    bigLuck: Array<{ startAge: number; stem: string; branch: string; tenGod?: string }>;
    startAge?: number;
  };
};

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string };

// --- 날짜/시간 보정: late-zi(23:00–00:59 → 익일) ----------------------------
function applyLateZiRule(localY: number, localM: number, localD: number, hh: number, mm: number) {
  // late-zi: 23:00 ~ 00:59 은 **다 익일**로 본다.
  // - 23:xx → 날짜 +1, 시간은 그대로(23시)
  // - 00:xx → 날짜는 그대로(이미 익일의 자정이므로)  ← 일반적 구현
  //   (국내 앱 다수는 00시대는 이미 익일로 입력된 것으로 간주)
  if (hh >= 23) {
    const dt = new Date(localY, localM - 1, localD, hh, mm, 0, 0);
    dt.setDate(dt.getDate() + 1);
    return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), h: hh, min: mm };
  }
  return { y: localY, m: localM, d: localD, h: hh, min: mm };
}

// --- 절기(節氣) 기반 월주 / 대운산법을 쓰도록 엔진 호출 ----------------------
// NOTE: 이 부분에서 "실제 사주 엔진"을 호출하세요.
// - 우리 프로젝트에 이미 있는 계산기를 부르면 됩니다.
// - 아래는 “더미 엔진”을 명시해 두었고, 반드시 TODO를 실제 엔진으로 바꿔 주세요.

type EngineOptions = {
  useTrueSolar: false;         // 고정
  hourRule: 'late-zi';         // 고정
  monthBy: 'jieqi';            // 고정 (절기)
  jieqiTZ: string;             // "Asia/Seoul" 고정
  startAgeMethod: 'qi-yun-jieqi'; // 고정
};

async function runEngineStrict(
  y: number, m: number, d: number, hh: number, mm: number,
  tzId: string, lat?: number, lng?: number
): Promise<CalcOutput> {

  const fixedOpts: EngineOptions = {
    useTrueSolar: false,
    hourRule: 'late-zi',
    monthBy: 'jieqi',
    jieqiTZ: 'Asia/Seoul',
    startAgeMethod: 'qi-yun-jieqi',
  };

  // TODO: 실제 엔진으로 교체하세요.
  // 예: return await calcWithOurEngine({ y,m,d, hh,mm, tzId, lat,lng, ...fixedOpts })
  // ----------------------------------------------------------
  // 임시 더미: 반드시 교체!
  // 이 더미는 형식만 맞춘 "예시"입니다. (실제 결과와 다름)
  const dummy: CalcOutput = {
    pillars: {
      hour:  { stem: '庚', branch: '子' },
      day:   { stem: '丙', branch: '戌' },
      month: { stem: '甲', branch: '寅' },
      year:  { stem: '己', branch: '酉' },
    },
    luck: {
      startAge: 8, // 예시
      bigLuck: [
        { startAge: 0, stem: '己', branch: '酉' },
        { startAge: 10, stem: '丙', branch: '戌' },
        { startAge: 20, stem: '癸', branch: '亥' },
        { startAge: 30, stem: '庚', branch: '子' },
        { startAge: 40, stem: '丁', branch: '丑' },
        { startAge: 50, stem: '甲', branch: '寅' },
        { startAge: 60, stem: '辛', branch: '卯' },
      ],
    },
  };
  return dummy;
  // ----------------------------------------------------------
}

// --- 요청 파싱/검증 ----------------------------------------------------------
function fail(error: string): ApiResponse<never> { return { ok: false, error }; }
function ok<T>(data: T): ApiResponse<T> { return { ok: true, data }; }

function parseTimeHHmm(s?: string) {
  if (!s) return { hh: 12, mm: 0 }; // 시간 없으면 정오로 가정(고정표준엔 영향 없음)
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return { hh: 12, mm: 0 };
  let hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  let mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return { hh, mm };
}

// --- 핸들러 (Edge/Node 공용) -------------------------------------------------
export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json(fail('Method not allowed')); return;
    }
    const body = (typeof req.body === 'string') ? JSON.parse(req.body) : req.body as CalcInput;
    const { birthDateISO, birthTime, tzId, lat, lng } = body || {};
    if (!birthDateISO || !tzId) {
      res.status(400).json(fail('Missing required fields: birthDateISO, tzId')); return;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDateISO);
    if (!m) {
      res.status(400).json(fail('birthDateISO must be YYYY-MM-DD')); return;
    }
    const y = parseInt(m[1], 10), mn = parseInt(m[2], 10), d = parseInt(m[3], 10);
    const { hh, mm } = parseTimeHHmm(birthTime);

    // ① late‑zi 보정(23:00–00:59 → 익일)
    const adj = applyLateZiRule(y, mn, d, hh, mm);

    // ② 고정 표준을 강제한 엔진 호출
    const out = await runEngineStrict(adj.y, adj.m, adj.d, adj.h, adj.min, tzId, lat, lng);

    res.status(200).json(ok(out));
  } catch (e: any) {
    res.status(500).json(fail(e?.message || 'Server error'));
  }
}

// --- (선택) Next.js App Router용 ------------------------------------------------
// export const config = { runtime: 'nodejs' }; // Vercel Node 런타임 사용 시
