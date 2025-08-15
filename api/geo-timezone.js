// api/geo-timezone.js (revised with custom provider order & clearer structure)
// City -> (lat,lng) -> tzId
// Geocoding: Open-Meteo -> maps.co(Nominatim mirror) -> Nominatim
// Timezone: timeapi.io -> Open-Meteo
// 추가: 6초 타임아웃, 2회 재시도, 상세 에러 리포트, CORS/OPTIONS

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchTextWithTimeout(url, { headers={}, timeoutMs=6000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: `NETWORK_ERROR: ${e?.name || ''} ${e?.message || ''}` };
  } finally {
    clearTimeout(t);
  }
}
const J = (s)=>{ try { return JSON.parse(s); } catch { return null; } };

// ---- helpers
function normalizeCity(raw){
  let s = (raw||'').trim().replace(/\s+/g,' ');
  s = s.split(',').map(p=>p.trim()).join(', ');
  if (/^new york$/i.test(s)) s = 'New York City, USA';
  if (/^seoul$/i.test(s)) s = 'Seoul, South Korea';
  return s;
}

// ---- Geocoders
async function geoOpenMeteo(q){
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
  const r = await fetchTextWithTimeout(url);
  const d = J(r.text);
  const f = d?.results?.[0];
  if (!r.ok || !f) return { ok:false, provider:'open-meteo-geocoding', url, status:r.status, raw:r.text };
  return { ok:true, provider:'open-meteo-geocoding', url, name:`${f.name}${f.country?', '+f.country:''}`, lat:f.latitude, lng:f.longitude, country:f.country||null };
}
async function geoMapsCo(q){
  const url = `https://geocode.maps.co/search?q=${encodeURIComponent(q)}&api_key=free`;
  const r = await fetchTextWithTimeout(url);
  const d = J(r.text);
  const f = Array.isArray(d) ? d[0] : null;
  if (!r.ok || !f) return { ok:false, provider:'maps.co', url, status:r.status, raw:r.text };
  return { ok:true, provider:'maps.co', url, name:f.display_name, lat:parseFloat(f.lat), lng:parseFloat(f.lon), country:null };
}
async function geoNominatim(q){
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&addressdetails=1`;
  const r = await fetchTextWithTimeout(url, { headers: { 'User-Agent':'saju-eight/1.0 (contact: hello@saju-eight.example)' } });
  const d = J(r.text);
  const f = Array.isArray(d) ? d[0] : null;
  if (!r.ok || !f) return { ok:false, provider:'nominatim', url, status:r.status, raw:r.text };
  return { ok:true, provider:'nominatim', url, name:f.display_name, lat:parseFloat(f.lat), lng:parseFloat(f.lon), country:f.address?.country||null };
}

// ---- Timezone
async function tzTimeapi(lat,lng){
  const url = `https://timeapi.io/api/TimeZone/coordinate?latitude=${lat}&longitude=${lng}`;
  const r = await fetchTextWithTimeout(url);
  const d = J(r.text);
  if (r.ok && d?.timeZone) return { ok:true, provider:'timeapi.io', url, timezone:d.timeZone };
  return { ok:false, provider:'timeapi.io', url, status:r.status, raw:r.text };
}
async function tzOpenMeteo(lat,lng){
  const url = `https://api.open-meteo.com/v1/timezone?latitude=${lat}&longitude=${lng}`;
  const r = await fetchTextWithTimeout(url);
  const d = J(r.text);
  if (r.ok && d?.timezone) return { ok:true, provider:'open-meteo-timezone', url, timezone:d.timezone };
  return { ok:false, provider:'open-meteo-timezone', url, status:r.status, raw:r.text };
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow','GET, OPTIONS');
    return res.status(405).json({ ok:false, error:'Use GET' });
  }

  const raw = (req.query.city||'').toString();
  if (!raw.trim()) return res.status(400).json({ ok:false, error:'Missing ?city=' });

  const candidates = [ normalizeCity(raw), raw.replace(/\+/g,' ') ];

  try {
    const attempts = [];
    let geo = null;

    // **여기서 순서 바꾸면 위치 이동 효과**
    const geoProviders = [
      geoNominatim,       // 예: nominatim을 1순위로
      geoMapsCo,
      geoOpenMeteo
    ];

    for (const q of candidates) {
      for (const provider of geoProviders) {
        for (let i=0; i<2; i++){
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

    let tz = await tzTimeapi(geo.lat, geo.lng);
    if (!tz.ok) tz = await tzOpenMeteo(geo.lat, geo.lng);
    if (!tz.ok) return res.status(502).json({ ok:false, error:'Timezone lookup failed', geo, tz });

    return res.status(200).json({
      ok:true,
      input:{ city: raw },
      provider: geo.provider,
      location:{ name: geo.name, country: geo.country, lat: geo.lat, lng: geo.lng },
      timezone: tz.timezone,
      debug:{ geo_url: geo.url, tz_url: tz.url }
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e?.message || 'unknown_error' });
  }
};
