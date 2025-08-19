// /api/fortune.js
/** @type {import('http').ServerResponse} */
function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function pickLuckSegments(ctx) {
  const segs = Array.isArray(ctx?.luck?.bigLuck) ? ctx.luck.bigLuck : [];
  const nowAge = (() => {
    if (!ctx?.birthDateISO) return null;
    const d = new Date(ctx.birthDateISO + 'T00:00:00');
    const n = new Date();
    let a = n.getFullYear() - d.getFullYear();
    const m = n.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
    return a;
  })();

  // 키가 startAge 대신 start/age 일 수도 있어서 유연하게 매핑
  const norm = seg => ({
    startAge: Number(seg.startAge ?? seg.start ?? seg.age ?? NaN),
    stem: seg.stem || '',
    branch: seg.branch || '',
    tenGod: seg.tenGod || '',
  });

  const list = segs.map(norm).filter(s => !Number.isNaN(s.startAge));
  let cur = null, next = null;

  if (nowAge != null) {
    for (const s of list) {
      if (nowAge >= s.startAge && nowAge < s.startAge + 10) {
        cur = s; break;
      }
    }
    if (cur) {
      next = list.find(x => x.startAge === cur.startAge + 10) || null;
    }
  }
  return { cur, next, list };
}

function dominantElementFromPillars(pillars) {
  const map = {
    '甲':'wood','乙':'wood','丙':'fire','丁':'fire','戊':'earth','己':'earth','庚':'metal','辛':'metal','壬':'water','癸':'water',
    '子':'water','丑':'earth','寅':'wood','卯':'wood','辰':'earth','巳':'fire','午':'fire','未':'earth','申':'metal','酉':'metal','戌':'earth','亥':'water'
  };
  const count = { wood:0, fire:0, earth:0, metal:0, water:0 };
  ['hour','day','month','year'].forEach(k => {
    const p = pillars?.[k] || {};
    if (map[p.stem]) count[map[p.stem]]++;
    if (map[p.branch]) count[map[p.branch]]++;
  });
  const sorted = Object.entries(count).sort((a,b)=>b[1]-a[1]);
  return (sorted[0] && sorted[0][1] > 0) ? sorted[0][0] : 'mixed';
}

async function handler(req, res) {
  try {
    // topic/category & ctx 수집 (GET/POST 모두 허용)
    const url = new URL(req.url, 'http://x');
    const body = req.method === 'POST'
      ? await new Promise(resolve => {
          let data=''; req.on('data', c=>data+=c);
          req.on('end', ()=>{ try{ resolve(JSON.parse(data||'{}')); }catch{ resolve({}); } });
        })
      : {};

    const topic = String(
      url.searchParams.get('topic')
      || url.searchParams.get('category')
      || body.topic || body.category || ''
    ).toLowerCase();

    const ctx = body.ctx || null;

    // 요약 만들어주기
    const p = ctx?.pillars || {};
    const domElem = dominantElementFromPillars(p);
    const luck = pickLuckSegments(ctx);

    const pillarsLine = `Hour ${p.hour?.stem||''}${p.hour?.branch||''}, Day ${p.day?.stem||''}${p.day?.branch||''}, Month ${p.month?.stem||''}${p.month?.branch||''}, Year ${p.year?.stem||''}${p.year?.branch||''}.`;
    const curLuckLine = luck.cur
      ? `${luck.cur.startAge}–${luck.cur.startAge+9} ${luck.cur.stem}${luck.cur.branch} (${luck.cur.tenGod||'?'})`
      : 'N/A';
    const nextLuckLine = luck.next
      ? `${luck.next.startAge}–${luck.next.startAge+9} ${luck.next.stem}${luck.next.branch} (${luck.next.tenGod||'?'})`
      : 'N/A';

    const summary = [
      `Pillars: ${pillarsLine}`,
      `Dominant element: ${domElem}.`,
      `Current luck: ${curLuckLine}.`,
      `Next luck: ${nextLuckLine}.`,
    ].join(' ');

    if (!process.env.OPENAI_API_KEY) {
      return send(res, 500, { ok:false, error:'OPENAI_API_KEY missing' });
    }

    // OpenAI 요청 (JSON 강제)
    const system = [
      'You are a concise Bazi/Saju guide.',
      'Audience: general users. Grade-7 reading level. No jargon unless explained.',
      'Be practical and specific; avoid mystical claims.',
      'Return ONLY valid JSON with keys: overview, phases, watch, tips.',
    ].join(' ');

    const user = [
      `TOPIC: ${topic || 'general'}`,
      'CHART SUMMARY:',
      summary,
      '',
      'Write:',
      '- overview: 3–5 sentences. plain, empathetic.',
      '- phases: 3–5 bullet points focused on timing (decades or seasonal cues).',
      '- watch: 2–4 bullet-point cautions.',
      '- tips: 3–5 bullet points; each starts with a verb.',
      '',
      'Style: short sentences. No emojis. No markdown. No section labels.',
    ].join('\n');

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        messages: [{ role:'system', content:system }, { role:'user', content:user }]
      })
    });
    const data = await resp.json();

    let payload = {};
    try {
      const text = data?.choices?.[0]?.message?.content || '';
      const m = text.match(/\{[\s\S]*\}$/); // 코드펜스 방지
      payload = m ? JSON.parse(m[0]) : JSON.parse(text);
    } catch(e) {
      payload = {};
    }

    // blocks 표준화
    const pick = k => (payload[k] && String(payload[k]).trim()) || '';
    const blocks = [];
    if (pick('overview')) blocks.push({ title:'Overview', body: pick('overview') });
    if (pick('phases'))   blocks.push({ title:'Key Phases', body: pick('phases') });
    if (pick('watch'))    blocks.push({ title:'Watch Out',  body: pick('watch') });
    if (pick('tips'))     blocks.push({ title:'Tips',       body: pick('tips') });

    return send(res, 200, { ok:true, output: { blocks, ...payload } });
  } catch (e) {
    return send(res, 500, { ok:false, error: String(e?.message||e) });
  }
}

module.exports = handler;
