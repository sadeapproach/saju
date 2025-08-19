// /api/calc.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { calcFourPillars } from '../lib/sajuEngine';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok:false, error:'Method not allowed' });
    }
    const { birthDateISO, birthTime, tzId, lat, lng, timeAccuracy } = req.body || {};
    if (!birthDateISO) return res.status(400).json({ ok:false, error:'birthDateISO required' });

    const out = calcFourPillars({ birthDateISO, birthTime, tzId });
    return res.status(200).json({ ok:true, data: out });
  } catch (e:any) {
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
}
