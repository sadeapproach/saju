// /api/geo-timezone.js  — CommonJS, 서버리스/Node에서 동작
// 외부 지오코더가 실패하더라도 자주 쓰는 도시는 즉시 성공하도록 안전판 포함

// [A] 자주 쓰는 도시 하드맵(영문/한글/케이스 불문)
const PRESET = [
  // KR
  { keys: ['seoul','서울','seo ul'], tz: 'Asia/Seoul', lat: 37.5665, lng: 126.9780, name: 'Seoul' },
  { keys: ['busan','부산'],           tz: 'Asia/Seoul', lat: 35.1796, lng: 129.0756, name: 'Busan' },
  { keys: ['incheon','인천'],         tz: 'Asia/Seoul', lat: 37.4563, lng: 126.7052, name: 'Incheon' },

  // JP
  { keys: ['tokyo','도쿄','東京'],     tz: 'Asia/Tokyo', lat: 35.6762, lng: 139.6503, name: 'Tokyo' },
  { keys: ['osaka','오사카','大阪'],   tz: 'Asia/Tokyo', lat: 34.6937, lng: 135.5023, name: 'Osaka' },

  // US (대표)
  { keys: ['new york','nyc','뉴욕'],  tz: 'America/New_York', lat: 40.7128, lng: -74.0060, name: 'New York' },
  { keys: ['los angeles','la','엘에이','로스앤젤레스'],
    tz: 'America/Los_Angeles', lat: 34.0522, lng: -118.2437, name: 'Los Angeles' },
  { keys: ['san francisco','샌프란시스코'],
    tz: 'America/Los_Angeles', lat: 37.7749, lng: -122.4194, name: 'San Francisco' },

  // EU (대표)
  { keys: ['london','런던'],          tz: 'Europe/London', lat: 51.5072, lng: -0.1276, name: 'London' },
  { keys: ['paris','파리'],           tz: 'Europe/Paris',  lat: 48.8566, lng: 2.3522,  name: 'Paris' },
];

function norm(s='') {
  return String(s).trim().toLowerCase()
    .replace(/\s+/g,' ')
    .replace(/[.,]/g,'');
}

// 간단한 Nominatim 호출(가능할 때만). 실패/차단되면 null
async function geocodeCity(q) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
    const r = await fetch(url, {
      headers: {
        // Nominatim 정책 준수용 간단 UA
        'User-Agent': 'saju-eight/geo-timezone (contact: example@example.com)'
      }
    });
    if (!r.ok) return null;
    const arr = await r.json();
    if (!Array.isArray(arr) || !arr.length) return null;
    const it = arr[0];
    const lat = parseFloat(it.lat);
    const lng = parseFloat(it.lon);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng, name: it.display_name || q };
  } catch {
    return null;
  }
}

// 좌표→타임존 (브라우저가 아니라 서버이므로, 외부 서비스 사용 대신 최소 커버)
async function guessTimezoneFromLatLng(lat, lng) {
  // 최소 커버: 대표 영역 단순 분기 + 기본값
  // 필요 시 tz-lookup 같은 라이브러리 도입 가능.
  if (!isFinite(lat) || !isFinite(lng)) return null;

  // 아시아 대략
  if (lng >= 120 && lng <= 150 && lat >= 20 && lat <= 50) {
    // KR/JP/타이완 근처
    if (lng >= 125 && lng <= 131 && lat >= 33 && lat <= 39) return 'Asia/Seoul';
    if (lng >= 129 && lng <= 146 && lat >= 31 && lat <= 46) return 'Asia/Tokyo';
    return 'Asia/Seoul';
  }
  // 미국 대략
  if (lng <= -66 && lng >= -125 && lat >= 24 && lat <= 49) {
    // 서/동부 대충 분기
    if (lng < -100) return 'America/Los_Angeles';
    return 'America/New_York';
  }
  // 유럽 대략
  if (lng >= -10 && lng <= 40 && lat >= 35 && lat <= 60) {
    if (lng <= 0) return 'Europe/London';
    return 'Europe/Paris';
  }
  return 'UTC';
}

module.exports = async (req, res) => {
  try {
    const q = (req.query.city || req.body?.city || '').trim();
    if (!q) {
      res.statusCode = 400;
      return res.json({ ok: false, error: 'city is required' });
    }

    const qn = norm(q);

    // 1) 프리셋 즉시 매치
    for (const p of PRESET) {
      if (p.keys.some(k => qn.includes(norm(k)))) {
        return res.json({
          ok: true,
          provider: 'preset',
          location: { name: p.name, country: '', lat: p.lat, lng: p.lng },
          timezone: p.tz
        });
      }
    }

    // 2) 외부 지오코딩 시도 (실패해도 앱이 죽지 않게!)
    const g = await geocodeCity(q);
    if (g) {
      const tz = await guessTimezoneFromLatLng(g.lat, g.lng) || 'UTC';
      return res.json({
        ok: true,
        provider: 'nominatim',
        location: { name: g.name, country: '', lat: g.lat, lng: g.lng },
        timezone: tz
      });
    }

    // 3) 최후 안전값: 서울
    return res.json({
      ok: true,
      provider: 'fallback',
      location: { name: 'Seoul', country: 'KR', lat: 37.5665, lng: 126.9780 },
      timezone: 'Asia/Seoul'
    });
  } catch (e) {
    // 절대 500으로 앱이 끊기지 않도록, 마지막까지 fallback
    return res.json({
      ok: true,
      provider: 'fallback-ex',
      location: { name: 'Seoul', country: 'KR', lat: 37.5665, lng: 126.9780 },
      timezone: 'Asia/Seoul'
    });
  }
};
