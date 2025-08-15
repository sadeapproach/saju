// City -> (lat,lng) -> tzId
// Geocoding: Nominatim -> maps.co -> Open‑Meteo
// Timezone: timeapi.io -> Open‑Meteo -> (proxy 우회) r.jina.ai
// + 타임아웃/재시도/상세로그/CORS

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

// ---------- Timezone providers (정식 + 프록시 우회)
async function tzTimeapi(lat,lng){
  const headers = {
    'Accept':'application/json',
    'User-Agent':'saju-eight/1.0 (+https://saju-eight.vercel.app)',
    'Origin':'https://saju-eight.vercel.app',
    'Referer':'https://saju-eight.vercel.app/'
  };
  const url1 = `https://timeapi.io/api/TimeZone/coordinate?latitude=${lat}&longitude=${lng}`;
  const url2 = `https://timeapi.io/api/Time/current/coordinate?latitude=${lat}&longitude=${lng}`;
  const tries = [url1, url2];
  const results = [];

  for (const u of tries){
    for (let j=0;j<2;j++){
      const r = await fetchTextWithTimeout(u, { headers });
      const d = J(r.text);
      if (r.ok && d && (d.timeZone || d.timeZoneName || d.timezone)) {
        const tz = d.timeZone || d.timeZoneName || d.timezone;
        return { ok:true, provider:'timeapi.io', url: u, timezone: tz };
      }
      results.push({ ok:false, provider:'timeapi.io', url:u, status:r.status, raw:r.text });
      await sleep(200);
    }
  }
  return { ok:false, provider:'timeapi.io', url:url1, status:0, raw: JSON.stringify(results).slice(0, 800) };
}

async function tzOpenMeteo(lat,lng){
  const url = `https://api.open-meteo.com/v1/timezone?latitude=${lat}&longitude=${lng}`;
  const r = await fetchTextWithTimeout(url);
  const d = J(r.text);
  if (r.ok && d?.timezone) return { ok:true, provider:'open-meteo-timezone', url, timezone:d.timezone };
  return { ok:false, provider:'open-meteo-timezone', url, status:r.status, raw:r.text };
}

// --- 프록시 우회 (r.jina.ai는 대상 URL의 원문을 그대로 반환)
async function tzTimeapiProxy(lat,lng){
  const pu = (u)=>`https://r.jina.ai/http://${u.replace(/^https?:\/\//,'')}`;
  const url1 = pu(`https://timeapi.io/api/TimeZone/coordinate?latitude=${lat}&longitude=${lng}`);
  const url2 = pu(`https://timeapi.io/api/Time/current/coordinate?latitude=${lat}&longitude=${lng}`);
  for (const u of [url1, url2]){
    const r = await fetchTextWithTimeout(u);
    const d = J(r.text);
    if (r.ok && d && (d.timeZone || d.timeZoneName || d.timezone)) {
      const tz = d.timeZone || d.timeZoneName || d.timezone;
      return { ok:true, provider:'timeapi.io-proxy', url:u, timezone:tz };
    }
  }
  return { ok:false, provider:'timeapi.io-proxy', url:url1, status:0, raw:'proxy_failed' };
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
    // 1) Geocoding
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

    // 2) Timezone: 정식 → 폴백 → 프록시 우회
    const tzAttempts = [];
    let tz = await tzTimeapi(geo.lat, geo.lng);
    tzAttempts.push(tz);
    if (!tz.ok) { const t2 = await tzOpenMeteo(geo.lat, geo.lng); tzAttempts.push(t2); tz = t2; }
    if (!tz.ok) { const t3 = await tzTimeapiProxy(geo.lat, geo.lng); tzAttempts.push(t3); tz = t3; }
    if (!tz.ok) { const t4 = await tzOpenMeteoProxy(geo.lat, geo.lng); tzAttempts.push(t4); tz = t4; }

    if (!tz.ok) return res.status(502).json({ ok:false, error:'Timezone lookup failed', geo, tzAttempts });

    // 3) Success
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
