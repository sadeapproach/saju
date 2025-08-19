// /api/ask.js
// Vercel/Next API Route (Node 18+). OpenAI API 연결 + 사주 차트 컨텍스트 반영.
// POST JSON만 사용합니다. (GET 호출은 405 반환)
// Env: OPENAI_API_KEY, (선택) OPENAI_MODEL

export const config = {
  runtime: 'edge',
};

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function ok(data)  { return new Response(JSON.stringify({ ok:true,  ...data }), { status: 200, headers: { 'content-type': 'application/json' } }); }
function err(msg, status=400){ return new Response(JSON.stringify({ ok:false, error:msg }), { status, headers: { 'content-type': 'application/json' } }); }

function truncate(obj, max=8000){
  try {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return s.length > max ? s.slice(0, max) + '…(truncated)' : s;
  } catch { return ''; }
}

function systemForQA(){
  return [
`You are a gentle, practical Saju (Four Pillars) guide for English-speaking users.`,
`Style:
- Warm, clear, friendly; keep it readable for non-experts.
- Use short paragraphs and occasional bullets.
- Add 1–2 tasteful emojis where natural (🌱✨🧭💡), not every sentence.
- Always include *one caution* if relevant (what to avoid / watch out).
- Ground your answer in the provided Saju chart JSON when possible. If a detail isn't in chart, keep it general.`,
`Scope & Safety:
- Do NOT claim exact deterministic outcomes (e.g., exact number of children).
- Offer timing windows as “more/less favorable” rather than guarantees.
- If the question is nonsense or empty, ask them to rephrase briefly.`
  ].join('\n');
}

function systemForTopic(){
  return [
`You are a Saju (Four Pillars) guide. Produce insights for the requested topic using the supplied chart.`,
`Return four distinct sections: 
1) Overview 
2) Key Phases 
3) Watch Out 
4) Tips`,
`Style:
- Clear, concise blocks (2–5 lines each).
- Friendly, modern tone; 1–2 emojis total.
- Reference the chart softly (pillars/elements/luck) without jargon overload.`,
`No certainties; provide cautious guidance.`
  ].join('\n');
}

async function callOpenAI(messages){
  const key = process.env.OPENAI_API_KEY;
  if(!key) return { ok:false, status:500, data:null, raw:'Missing OPENAI_API_KEY' };

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{ 'authorization':`Bearer ${key}`, 'content-type':'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.6,
        max_tokens: 600,
      })
    });
    const data = await r.json();
    if(!r.ok) return { ok:false, status:r.status, data, raw: JSON.stringify(data) };
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    return { ok:true, status:200, data:{ text } };
  } catch(e){
    return { ok:false, status:0, data:null, raw:String(e?.message || e) };
  }
}

export default async function handler(req){
  if(req.method !== 'POST') return err('Method not allowed', 405);

  let body = {};
  try { body = await req.json(); } catch { /* noop */ }

  const q = (body?.q || '').toString().trim();
  const chart = body?.chart || null;          // 프론트에서 보내주는 사주 차트 JSON
  const topic = (body?.topic || '').toString().trim(); // 토픽 카드용

  // 간단한 입력 검증
  if(!q && !topic) return err('Provide "q" (question) or "topic".');

  // 노이즈/말 안 되는 입력 필터
  const isNonsense = q && q.length < 3 || (/^[\W_]+$/.test(q)); // 기호만/너무 짧음
  if(q && isNonsense){
    return ok({ output: `I couldn’t quite catch that. Could you rephrase your question in a simple sentence? 🙂` });
  }

  // 공통 chart 텍스트(너무 길면 잘라서)
  const chartText = chart ? truncate(chart, 8000) : null;

  if(topic){
    // 토픽 카드 확장
    const sys = systemForTopic();
    const usr = [
      chartText ? `Chart JSON:\n${chartText}\n` : '',
      `Topic: ${topic}`,
      `Please write four blocks with clear headings exactly named: Overview, Key Phases, Watch Out, Tips.`,
    ].join('\n');

    const res = await callOpenAI([
      { role:'system', content: sys },
      { role:'user',   content: usr }
    ]);
    if(!res.ok) return err(res.raw || 'OpenAI request failed', res.status || 500);

    // 간단한 파서: 섹션별로 분할
    const text = res.data.text;
    const sections = { overview:'', phases:'', watch:'', tips:'' };
    const lines = text.split(/\r?\n/);
    let cur = '';
    for(const ln of lines){
      const t = ln.trim();
      if(/^overview\b/i.test(t)) { cur='overview'; continue; }
      if(/^key\s*phases?\b/i.test(t)) { cur='phases'; continue; }
      if(/^watch\s*out\b/i.test(t)) { cur='watch'; continue; }
      if(/^tips?\b/i.test(t)) { cur='tips'; continue; }
      if(cur) sections[cur] += (sections[cur] ? '\n' : '') + ln;
    }
    return ok({ output: sections });
  }

  // 일반 Q&A
  if(q){
    const sys = systemForQA();
    const usr = [
      chartText ? `Here is the user's Saju chart JSON (truncated for length):\n${chartText}\n` : '',
      `Question: ${q}`,
      `Please answer in English.`
    ].join('\n');

    const res = await callOpenAI([
      { role:'system', content: sys },
      { role:'user',   content: usr }
    ]);
    if(!res.ok) return err(res.raw || 'OpenAI request failed', res.status || 500);
    return ok({ output: res.data.text });
  }

  return err('Nothing to do.');
}
