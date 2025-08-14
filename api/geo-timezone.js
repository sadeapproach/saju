// api/geo-timezone.js
// 도시명 → (위도/경도) → 타임존
// 1) 지오코딩: Nominatim(OSM) → 실패 시 Open‑Meteo
// 2) 타임존: timeapi.io → 실패 시 Open‑Meteo
// * 키 불필요, CORS 및 OPTIONS 처리 포함, 디버그 정보(provider/url) 포함

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // 필요 시 특정 도메인으로 제한
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function fetchText(url, headers = {}) {
  const r = await fetch(url, { headers });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
}
function safeJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

/* ---------- Geocoding: 1) Nominatim (OpenStreetMap) ---------- */
async function geocodeNominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`;
  const headers = { 'User-Agent': 'saju-eight/1.0 (contact: hello@saju-eight.example)' }; // UA 권장
  const r = await fetchText(url, headers);
  const data = safeJSON(r.text);
  if (!r.ok || !Array.isArray(data) || data.length === 0) {
    return { ok: false, provider: 'nominatim', url, status: r.status, raw: r.text };
  }
  const first = data[0];
  return {
    ok: true,
    provider: 'nominatim',
    url,
    name: first.display_name,
    lat: parseFloat(first.lat),
    lng: parseFloat(first.lon),
    country: first.address?.country || null,
  };
}

/* ---------- Geocoding: 2) Open‑Meteo (fallback) ---------- */
async function geocodeOpenMeteo(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  const r = await fetchText(url);
  const data = safeJSON(r.text);
  const first = data?.results?.[0];
  if (!r.ok || !first) {
    return { ok: false, provider: 'open-meteo-geocoding', url, status: r.status, raw: r.text };
  }
  return {
    ok: true,
    provider: 'open-meteo-geocoding',
    url,
    name: `${first.name}${first.country ? ', ' + first.country : ''}`,
    lat: first.latitude,
    lng: first.longitude,
    country: first.country || null,
  };
}

/* ---------- Timezone: 1) timeapi.io → 2) open‑meteo fallback ---------- */
async function lookupTimezone(lat, lng) {
  // 1) timeapi.io (키 불필요)
  {
    const url = `https://timeapi.io/api/TimeZone/coordinate?latitude=${lat}&longitude=${lng}`;
    const r = await fetchText(url);
    const data = safeJSON(r.text);
    if (r.ok && data?.timeZone) {
      return { ok: true, provider: 'timeapi.io', url, timezone: data.timeZone };
    }
  }
  // 2) open‑meteo (폴백)
  {
    const url = `https://api.open-meteo.com/v1/timezone?latitude=${lat}&longitude=${lng}`;
    const r = await fetchText(url);
    const data = safeJSON(r.text);
    if (r.ok && data?.timezone) {
      return { ok: true, provider: 'open-meteo-timezone', url, timezone: data.timezone };
    }
    return { ok: false, provider: 'open-meteo-timezone', url, status: r.status, raw: r.text };
  }
}

/* ---------- Handler ---------- */
module.exports = async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Use GET' });
  }

  const rawCity = (req.query.city || '').toString().trim();
  if (!rawCity) return res.status(400).json({ ok: false, error: 'Missing ?city=' });

  // 후보 문자열: + 를 공백으로 치환한 버전도 시도
  const candidates = [rawCity, rawCity.replace(/\+/g, ' ')];

  try {
    // 1) Geocoding 시도 (Nominatim → Open‑Meteo 폴백)
    let geo = null;
    const attempts = [];

    for (const q of candidates) {
      const r1 = await geocodeNominatim(q);
      attempts.push(r1);
      if (r1.ok) { geo = r1; break; }
    }
    if (!geo) {
      for (const q of candidates) {
        const r2 = await geocodeOpenMeteo(q);
        attempts.push(r2);
        if (r2.ok) { geo = r2; break; }
      }
    }
    if (!geo) {
      return res.status(404).json({ ok: false, error: 'City not found', attempts });
    }

    // 2) Timezone 조회 (timeapi.io → open‑meteo 폴백)
    const tz = await lookupTimezone(geo.lat, geo.lng);
    if (!tz.ok) {
      return res.status(502).json({ ok: false, error: 'Timezone lookup failed', geo, tz });
    }

    // 3) 결과
    return res.status(200).json({
      ok: true,
      input: { city: rawCity },
      provider: geo.provider,            // 어떤 지오코더를 썼는지
      location: {
        name: geo.name,
        country: geo.country,
        lat: geo.lat,
        lng: geo.lng,
      },
      timezone: tz.timezone,
      debug: { geo_url: geo.url, tz_url: tz.url }, // 디버그용
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'unknown_error' });
  }
};
