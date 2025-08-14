// api/geo-timezone.js
// 도시명 → (위도/경도) → 타임존
// 1차: Nominatim(OpenStreetMap)  /  2차: Open-Meteo geocoding  /  최종: Open-Meteo timezone
// 키 불필요. CORS/OPTIONS 포함.

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // 필요시 특정 도메인으로 제한
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function fetchJson(url, headers = {}) {
  const r = await fetch(url, { headers });
  const text = await r.text();
  // 일부 서비스는 200이 아닌데도 JSON을 줄 수 있어 안전 파싱
  let data = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  if (!r.ok) {
    throw new Error(data ? JSON.stringify(data) : `HTTP ${r.status}: ${text}`);
  }
  return data ?? {};
}

// 1차 시도: Nominatim(오픈스트리트맵) — 키 불필요, User-Agent 필수 권장
async function geocodeNominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`;
  const data = await fetchJson(url, { 'User-Agent': 'saju-eight/1.0 (contact: example@example.com)' });
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  return {
    name: first.display_name,
    lat: parseFloat(first.lat),
    lng: parseFloat(first.lon),
    country: first.address?.country || null
  };
}

// 2차 시도: Open‑Meteo geocoding
async function geocodeOpenMeteo(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  const data = await fetchJson(url);
  const first = data?.results?.[0];
  if (!first) return null;
  return {
    name: `${first.name}${first.country ? ', ' + first.country : ''}`,
    lat: first.latitude,
    lng: first.longitude,
    country: first.country || null
  };
}

// 좌표 → 타임존(Open‑Meteo)
async function lookupTimezone(lat, lng) {
  const url = `https://api.open-meteo.com/v1/timezone?latitude=${lat}&longitude=${lng}`;
  const tz = await fetchJson(url);
  const tzId = tz?.timezone;
  if (!tzId) throw new Error('Timezone not found');
  return tzId;
}

module.exports = async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Use GET' });
  }

  const rawCity = (req.query.city || '').toString().trim();
  if (!rawCity) return res.status(400).json({ ok: false, error: 'Missing ?city=' });

  // 입력 정리: 공백/쉼표 다양한 표기를 허용
  // 예) "New York", "New York, USA", "Seoul", "서울"
  const candidates = [
    rawCity,
    rawCity.replace(/\+/g, ' '),  // "New+York" → "New York"
  ];

  try {
    // 1) 지오코딩 (Nominatim → Open‑Meteo 폴백)
    let geo = null;
    for (const q of candidates) {
      geo = await geocodeNominatim(q);
      if (geo) break;
    }
    if (!geo) {
      for (const q of candidates) {
        geo = await geocodeOpenMeteo(q);
        if (geo) break;
      }
    }
    if (!geo) {
      return res.status(404).json({ ok: false, error: 'City not found (geocoding failed)' });
    }

    // 2) 타임존
    const timezone = await lookupTimezone(geo.lat, geo.lng);

    return res.status(200).json({
      ok: true,
      input: { city: rawCity },
      location: { name: geo.name, country: geo.country, lat: geo.lat, lng: geo.lng },
      timezone
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'unknown_error' });
  }
};
