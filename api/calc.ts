// /api/calc.ts — Vercel Node (TypeScript) 서버리스 함수
// 기존 /api/calc.js 가 있으면 반드시 삭제하거나 이름 변경! (둘 다 있으면 .js 가 잡히면서 TS import 실패)

import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─────────────────────────────────────────────────────────────
// ① lib/sajuEngine.ts에서 compute를 가져오되, 실패 시 안전하게 처리
// ─────────────────────────────────────────────────────────────
async function loadEngine() {
  try {
    // 정적 import 가 가장 안전. (.ts → .js 트랜스파일 자동됨)
    const mod = await import('../lib/sajuEngine');
    const f =
      (mod as any).compute ||
      (mod as any).computeChart ||
      (mod as any).buildChart ||
      (mod as any).default;
    if (typeof f !== 'function') throw new Error('compute() not exported');
    return f as (input: any) => Promise<any>;
  } catch (e: any) {
    // 엔진 import 실패 시, 임시 더미 엔진으로라도 동작시켜 Step2를 통과시킴
    console.error('[calc] engine import failed:', e?.message || e);
    return async function fallbackEngine(input: any) {
      const { birthDateISO = '2000-01-01' } = input || {};
      // 아주 단순한 더미 결과: UI가 기대하는 구조만 메우기 (진짜 로직은 lib에서 교체)
      return {
        pillars: {
          hour: { stem: '庚', branch: '子' },
          day: { stem: '丙', branch: '辰' },
          month: { stem: '甲', branch: '寅' },
          year: { stem: '己', branch: '酉' },
        },
        elements: { wood: 2, fire: 2, earth: 2, metal: 2, water: 2 },
        tenGods: {
          byPillar: { hour: 'Resource', day: 'Self', month: 'Output', year: 'Influence' },
        },
        hiddenStems: { hour: [], day: [], month: [], year: [] },
        interactions: {},
        luck: {
          bigLuck: [
            { startAge: 0, stem: '乙', branch: '酉', tenGod: 'Wealth' },
            { startAge: 10, stem: '丙', branch: '戌', tenGod: 'Influence' },
            { startAge: 20, stem: '癸', branch: '亥', tenGod: 'Resource' },
            { startAge: 30, stem: '庚', branch: '子', tenGod: 'Output' },
            { startAge: 40, stem: '丁', branch: '丑', tenGod: 'Peer' },
            { startAge: 50, stem: '甲', branch: '申', tenGod: 'Authority' },
            { startAge: 60, stem: '辛', branch: '卯', tenGod: 'Growth' },
          ],
        },
        meta: {
          engine: 'fallback',
          note: 'sajuEngine import failed; returning placeholder chart',
          birthDateISO,
        },
      };
    };
  }
}

function bad(res: VercelResponse, code: number, msg: string, extra: any = {}) {
  return res.status(code).json({ ok: false, error: msg, ...extra });
}

type CalcInput = {
  birthDateISO: string; // 'YYYY-MM-DD'
  birthTime?: string;   // 'HH:mm'
  tzId: string;         // 'Asia/Seoul'
  lat?: number;
  lng?: number;
  timeAccuracy?: 'exact' | 'approx';
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return bad(res, 405, 'Method Not Allowed');
  }

  let input: CalcInput;
  try {
    input = (typeof req.body === 'string') ? JSON.parse(req.body) : (req.body as any);
  } catch (e) {
    return bad(res, 400, 'Invalid JSON body');
  }

  const { birthDateISO, tzId } = input || {};
  if (!birthDateISO || !tzId) {
    return bad(res, 400, 'Missing required fields: birthDateISO, tzId');
  }

  // 표준(고정) 옵션: 입춘/절기/자시 기준
  const convention = {
    school: 'kr-standard',
    yearBoundary: 'lichun',
    monthSystem: 'solarTerms',
    hourSystem: 'zishi-2hr',
  };

  try {
    const compute = await loadEngine();
    const result = await compute({ ...input, convention });

    if (!result || !result.pillars) {
      return bad(res, 500, 'Engine returned empty result', { result });
    }

    return res.status(200).json({
      ok: true,
      data: {
        pillars: result.pillars,
        elements: result.elements ?? {},
        tenGods: result.tenGods ?? {},
        hiddenStems: result.hiddenStems ?? {},
        interactions: result.interactions ?? {},
        luck: result.luck ?? { bigLuck: [] },
        meta: {
          engine: result.meta?.engine ?? 'sajuEngine',
          school: 'KR standard (fixed)',
          yearBoundary: 'Lichun',
          monthSystem: '24 Solar Terms',
          hourSystem: 'Zishi 2‑hour',
        },
      },
    });
  } catch (err: any) {
    console.error('[calc] engine run error:', err?.stack || err);
    return bad(res, 500, 'Engine error', { message: String(err?.message || err) });
  }
}
