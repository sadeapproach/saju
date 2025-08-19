// /api/calc.ts  — TypeScript 서버리스 함수 (Vercel/Node 18)
// JS로 쓰던 /api/calc.js 는 삭제하거나 확장자만 .ts 로 바꿔주세요.

import type { VercelRequest, VercelResponse } from '@vercel/node';

// lib/sajuEngine.ts 를 TypeScript로 직접 import
// (api와 lib 모두 .ts이면 Vercel이 자동 빌드합니다)
import * as Engine from '../lib/sajuEngine';

// ---- 유틸: 안전 파서 ----
function pickCompute() {
  // lib 쪽 함수 이름이 달라도 최대한 찾아서 호출되게 백업 경로를 둡니다.
  return (
    (Engine as any).compute ||
    (Engine as any).computeChart ||
    (Engine as any).buildChart ||
    (Engine as any).calc ||
    (Engine as any).getChart ||
    (Engine as any).default
  );
}

function bad(res: VercelResponse, status: number, msg: string, extra: any = {}) {
  return res.status(status).json({ ok: false, error: msg, ...extra });
}

// ---- 타입(느슨하게) ----
type CalcInput = {
  birthDateISO: string; // 'YYYY-MM-DD'
  birthTime?: string;   // 'HH:mm' (선택)
  tzId: string;         // 'Asia/Seoul' 등
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
  } catch {
    return bad(res, 400, 'Invalid JSON body');
  }

  const { birthDateISO, birthTime, tzId, lat, lng } = input || {};
  if (!birthDateISO || !tzId) {
    return bad(res, 400, 'Missing required fields: birthDateISO, tzId');
  }

  // 엔진 함수 확인
  const compute = pickCompute();
  if (typeof compute !== 'function') {
    return bad(res, 500, 'sajuEngine.ts: export function compute(...) (or computeChart/buildChart) not found', {
      exports: Object.keys(Engine || {}),
    });
  }

  try {
    // 엔진 호출
    const result = await compute({
      birthDateISO,
      birthTime: birthTime ?? null,
      tzId,
      lat: typeof lat === 'number' ? lat : null,
      lng: typeof lng === 'number' ? lng : null,
      timeAccuracy: input.timeAccuracy ?? 'exact',
      // 고정 해석 옵션(우리의 표준): 한국권(정통파) + 균시차/시각대 보정 + 리춘 기준
      convention: {
        school: 'kr-standard',     // 내부 엔진에서 인식하도록(없으면 무시해도 됨)
        yearBoundary: 'lichun',    // 입춘 기준
        monthSystem: 'solarTerms', // 절기 기준
        hourSystem: 'zishi-2hr',   // 2시간 시각
      },
    });

    // 예상하는 최소 형태 검증 (프론트와 합치기)
    // result = { pillars, elements, tenGods, hiddenStems, interactions, luck, meta }
    if (!result || !result.pillars) {
      return bad(res, 500, 'Engine returned empty result', { result });
    }

    // 프론트가 기대하는 포맷으로 감싸서 반환
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
          engine: result.meta?.engine ?? 'sajuEngine.ts',
          school: 'KR standard (fixed)',
          yearBoundary: 'Lichun',
          monthSystem: '24 Solar Terms',
          hourSystem: 'Zishi 2‑hour',
        },
      },
    });
  } catch (err: any) {
    // 엔진 내부 오류 잡기
    return bad(res, 500, 'Engine error', {
      message: String(err?.message || err),
      stack: err?.stack || undefined,
    });
  }
}
