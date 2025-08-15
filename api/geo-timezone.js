// api/geo-timezone.js (offline-first final)
// City -> (lat,lng) -> tzId
// Geocoding: Nominatim -> maps.co -> Open‑Meteo
// Timezone: ① tz-lookup (offline) -> ② timeapi.io -> ③ open‑meteo -> ④ proxy 우회
// + 타임아웃/재시도/상세로그/CORS

const tzlookup = require('tz-lookup');

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchTextWithTimeout(url, { headers={}, timeoutMs=7000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal, cache: 'no-store' });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: `NETWORK_ERROR: ${e?.name || ''} ${e?.message || ''}` };
  } finally {
    clearTimeout(t);
  }
}
const J = (s)=>{ try { return JSON.parse(s); } catch { return null; } };

// ---------- helpers
function normalizeCity(raw){
  let s = (raw||'').trim().replace(/\s+/g,' ');
  s = s.split(',').map(p=>p.trim()).join(', ');
  if (/^new york$/i.test(s)) s = 'New York City, USA';
  if (/^seoul$/i.test(s)) s = 'Seoul, South Korea';
  return s;
}
function isFiniteNum(n){ return Number.isFinite(n); }

// ---------- Geocoders
async function geoNominatim(q){
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&addressdetails=1`;
  const r = await fetchTextWithTimeout(url, { headers: { 'User-Agent':'saju-eight/1.0 (+https://saju-eight.vercel.app)' } });
  const d = J(r.text);
  const f = Array.isArray(d) ? d[0] : null;
  if (!r.ok || !f) return { ok:false, provider:'nominatim', url, status:r.status, raw:r.text };
  return { ok:true, provider:'nominatim', url, name:f.display_name, lat:parseFloat(f.lat), lng:parseFloat(f.lon), country:f.address?.country||null };
}
async function geoMapsCo(q){
  const url = `https://geocode.maps.co/search?q=${encodeURIComponent(q)}&api_key=free`;
  const r = await fetchTextWithTimeout(url);
  const d = J(r.text);
  const f = Array.isArray(d) ? d[0] : null;
  if (!r.ok || !f) return { ok:false, provider:'maps.co', url, status:r.status, raw:r.text };
  return { ok:true, provider:'maps.co', url, name:f.display_name, lat:parseFloat(f.lat), lng:parseFloat(f.lon), country:null };
}
async function geoOpenMeteo(q){
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
  const r = await fetchTextWithTimeout(url);
  const d = J(r.text);
  const f = d?.results?.[0];
  if (!r.ok || !f) return { ok:false, provider:'open-meteo-geocoding', url, status:r.status, raw:r.text };
  return { ok:true, provider:'open-meteo-geocoding', url, name:`${f.name}${f.country?', '+f.country:''}`, lat:f.latitude, lng:f.longitude, country:f.country||null };
}

// ---------- Timezone providers (온라인 폴백)
async function tzTimeapi(lat,lng){
  const headers = {
    'Accept':'application/json',
    'User-Agent':'saju-eight/1.0 (+https://saju-eight.vercel.app)',
    'Origin':'https://saju-eight.vercel.app',
    'Referer':'https://saju-eight.vercel.app/'
  };
  const url1 = `https://timeapi.io/api/TimeZone/coordinate?latitude=${lat}&longitude=${lng}`;
  const url2 = `https://timeapi.io/api/Time/current/coordinate?latitude=${lat}&longitude=${lng}`;
  for (const u of [url1, url2]){
    for (let i=0;i<2;i++){
      const r = await fetchTextWithTimeout(u, { headers });
      const d = J(r.text);
      if (r.ok && d && (d.timeZone || d.timeZoneName || d.timezone)) {
        const tz = d.timeZone || d.timeZoneName || d.timezone;
        return { ok:true, provider:'timeapi.io', url:u, timezone:tz };
      }
      await sleep(200);
    }
  }
  return { ok:false, provider:'timeapi.io', url:url1, status:0, raw:'timeapi_failed' };
}
async function tzOpenMeteo(lat,lng){
  const url = `https://api.open-meteo.com/v1/timezone?latitude=${lat}&longitude=${lng}`;
  const r = await fetchTextWithTimeout(url);
  const d = J(r.text);
  if (r.ok && d?.timezone) return { ok:true, provider:'open-meteo-timezone', url, timezone:d.timezone };
  return { ok:false, provider:'open-meteo-timezone', url, status:r.status, raw:r.text };
}
// --- Proxy 우회
async function tzTimeapiProxy(lat,lng){
  const wrap = u => `https://r.jina.ai/http://${u.replace(/^https?:\/\//,'')}`;
  for (const u of [
    wrap(`https://timeapi.io/api/TimeZone/coordinate?latitude=${lat}&longitude=${lng}`),
    wrap(`https://timeapi.io/api/Time/current/coordinate?latitude=${lat}&longitude=${lng}`)
  ]){
    const r = await fetchTextWithTimeout(u);
    const d = J(r.text);
    if (r.ok && d && (d.timeZone || d.timeZoneName || d.timezone)) {
      const tz = d.timeZone || d.timeZoneName || d.timezone;
      return { ok:true, provider:'timeapi.io-proxy', url:u, timezone:tz };
    }
  }
  return { ok:false, provider:'timeapi.io-proxy', url:'proxy', status:0, raw:'proxy_failed' };
}
async function tzOpenMeteoProxy(lat,lng){
  const u = `https://r.jina.ai/http://api.open-meteo.com/v1/timezone?latitude=${lat}&longitude=${lng}`;
  const r = await fetchTextWithTimeout(u);
  const d = J(r.text);
  if (r.ok && d?.timezone) return { ok:true, provider:'open-meteo-timezone-proxy', url:u, timezone:d.timezone };
  return { ok:false, provider:'open-meteo-timezone-proxy', url:u, status:r.status, raw:r.text };
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') { res.setHeader('Allow','GET, OPTIONS'); return res.status(405).json({ ok:false, error:'Use GET' }); }

  const raw = (req.query.city||'').toString();
  if (!raw.trim()) return res.status(400).json({ ok:false, error:'Missing ?city=' });

  const candidates = [ normalizeCity(raw), raw.replace(/\+/g,' ') ];

  try {
    // 1) Geocoding (최대 3×2회 시도)
    const attempts = [];
    let geo = null;
    const geoProviders = [ geoNominatim, geoMapsCo, geoOpenMeteo ];

    for (const q of candidates) {
      for (const provider of geoProviders) {
        for (let i=0;i<2;i++){
          const r = await provider(q);
          attempts.push(r);
          if (r.ok) { geo = r; break; }
          await sleep(250);
        }
        if (geo) break;
      }
      if (geo) break;
    }
    if (!geo) return res.status(502).json({ ok:false, error:'Geocoding failed', attempts });

    const { lat, lng } = geo;

    // 2) Timezone — 오프라인 tz-lookup 우선
    if (isFiniteNum(lat) && isFiniteNum(lng)) {
      try {
        const zone = tzlookup(lat, lng); // 🔥 네트워크 없이 즉시 계산
        if (zone && typeof zone === 'string') {
          return res.status(200).json({
            ok:true,
            input:{ city: raw },
            provider: geo.provider,
            location:{ name: geo.name, country: geo.country, lat, lng },
            timezone: zone,
            debug:{ geo_url: geo.url, tz_url: 'tz-lookup(local)' }
          });
        }
      } catch (e) {
        // 계속 진행하여 온라인 폴백 사용
      }
    }

    // 3) 온라인 폴백
    const tzAttempts = [];
    let tz = await tzTimeapi(lat, lng);      tzAttempts.push(tz);
    if (!tz.ok) { const t2 = await tzOpenMeteo(lat, lng);      tzAttempts.push(t2); tz = t2; }
    if (!tz.ok) { const t3 = await tzTimeapiProxy(lat, lng);   tzAttempts.push(t3); tz = t3; }
    if (!tz.ok) { const t4 = await tzOpenMeteoProxy(lat, lng); tzAttempts.push(t4); tz = t4; }

    if (!tz.ok) return res.status(502).json({ ok:false, error:'Timezone lookup failed', geo, tzAttempts });

    // 4) 성공
    return res.status(200).json({
      ok:true,
      input:{ city: raw },
      provider: geo.provider,
      location:{ name: geo.name, country: geo.country, lat, lng },
      timezone: tz.timezone,
      debug:{ geo_url: geo.url, tz_url: tz.url }
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || 'unknown_error' });
  }
};
