// /api/calc.js
const { calcPillars } = require('../lib/sajuEngine.js');

module.exports = async (req, res) => {
  // Vercel/Node 서버리스 기준 CommonJS 핸들러
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { birthDateISO, birthTime = '00:00', tzId, lat, lng, timeAccuracy = 'exact' } = body;

    if (!birthDateISO || !tzId) {
      res.statusCode = 400;
      return res.json({ ok: false, error: 'birthDateISO and tzId are required' });
    }

    // 현재 단계에서는 lat/lng/timeAccuracy를 사용하지 않지만, 서명 유지
    const data = calcPillars({ birthDateISO, birthTime, tzId });

    // UI가 기대하는 형태를 맞춰 반환(필요시 확장)
    return res.json({ ok: true, data });
  } catch (e) {
    console.error('[calc] error:', e);
    res.statusCode = 500;
    return res.json({ ok: false, error: String(e && e.message || e) });
  }
};
