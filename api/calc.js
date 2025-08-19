// /api/calc.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { calcWithFixedStandard } from '@/lib/sajuEngine';

type CalcInput = {
  birthDateISO: string; // "YYYY-MM-DD"
  birthTime?: string;   // "HH:mm"
  lat?: number;
  lng?: number;
  tzId: string;
};

type ApiResp<T> = { ok:true; data:T } | { ok:false; error:string };

function fail(error:string): ApiResp<never>{ return { ok:false, error }; }
function ok<T>(data:T): ApiResp<T>{ return { ok:true, data }; }
const pad2 = (n:number)=> (n<10?'0':'')+n;

function parseTime(s?:string){ 
  if(!s) return {hh:12,mm:0};
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if(!m) return {hh:12,mm:0};
  return { hh: Math.min(23, +m[1]), mm: Math.min(59, +m[2]) };
}

export default async function handler(req:NextApiRequest,res:NextApiResponse<ApiResp<any>>){
  try{
    if(req.method!=='POST'){ res.status(405).json(fail('Method not allowed')); return; }
    const body = typeof req.body==='string'? JSON.parse(req.body) : req.body as CalcInput;
    const { birthDateISO, birthTime, tzId, lat, lng } = body || {};
    if(!birthDateISO || !tzId){ res.status(400).json(fail('Missing birthDateISO or tzId')); return; }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDateISO);
    if(!m){ res.status(400).json(fail('birthDateISO must be YYYY-MM-DD')); return; }

    const y=+m[1], mo=+m[2], d=+m[3];
    const {hh,mm} = parseTime(birthTime);

    // late-zi(23시~) 익일 반영은 엔진 내부에서도 처리하지만,
    // 표면상 날짜 보기도 위해 그대로 전달.
    const out = await calcWithFixedStandard({ y, m:mo, d, hh, mm, tzId, lat, lng });

    res.status(200).json(ok(out));
  }catch(e:any){
    res.status(500).json(fail(e?.message || 'Server error'));
  }
}
