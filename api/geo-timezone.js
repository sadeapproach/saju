// api/geo-timezone.js
// 도시명으로 좌표를 찾고(geocoding) → 좌표로 타임존을 얻는 엔드포인트
// 오픈메테오의 무료 API 사용 (키 필요 없음). 운영 전환 시 Mapbox/Google로 교체 권장.

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // 필요시 특정 도메인으로 제한
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const fetchJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Upstream error: ${await r.text()}`);
  return r.json();
};

module.exports = async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ ok:false, error:'Use GET' });
  }

  const city = (req.query.city || '').toString().trim();
  if (!city) return res.status(400).json({ ok:false, error:'Missing ?city=' });

  try {
    // 1) 도시 → 좌표 (최상위 1개만 사용)
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
    const geo = await fetchJson(geoUrl);
    const first = geo.results && geo.results[0];
    if (!first) return res.status(404).json({ ok:false, error:'City not found' });

    const lat = first.latitude;
    const lng = first.longitude;

    // 2) 좌표 → 타임존
    const tzUrl = `https://api.open-meteo.com/v1/timezone?latitude=${lat}&longitude=${lng}`;
    const tz = await fetchJson(tzUrl);
    const tzId = tz.timezone;

    return res.status(200).json({
      ok: true,
      input: { city },
      location: { name: first.name, country: first.country, lat, lng },
      timezone: tzId
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
};
