// /api/ask.js
export const config = { runtime: 'nodejs' };

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const API_KEY = process.env.OPENAI_API_KEY;

function parseBody(req){
  try{
    if (req.body && typeof req.body === 'object') return req.body;
    const txt = req.body || '';
    return txt ? JSON.parse(txt) : {};
  }catch{ return {}; }
}
function tryParseJSON(text){
  if (!text) return null;
  try{ return JSON.parse(text); }catch{}
  const m = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (m) { try{ return JSON.parse(m[1]); }catch{} }
  return null;
}
async function callOpenAI(messages, json=true){
  if (!API_KEY) return { error:'Missing OPENAI_API_KEY' };
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{'Authorization':`Bearer ${API_KEY}`, 'Content-Type':'application/json'},
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      messages,
      ...(json ? { response_format: { type: 'json_object' } } : {})
    })
  });
  const txt = await r.text();
  if (!r.ok) return { error:`OpenAI ${r.status}`, raw:txt };
  let content = '';
  try{ content = JSON.parse(txt).choices[0].message.content; }
  catch{ content = txt; }
  return { content, raw: txt };
}

export default async function handler(req,res){
  if (req.method !== 'POST'){ res.status(405).json({ ok:false, error:'Method Not Allowed' }); return; }

  const { question, pillars, elements, tenGods, interactions, luck, locale='en-US' } = parseBody(req);
  if (!question) { res.status(400).json({ ok:false, error:'Missing question' }); return; }
  if (!pillars)   { res.status(400).json({ ok:false, error:'Missing pillars' }); return; }

  const sys = `
You are "Mellow Guide", a calm Saju/Bazi advisor. 
Answer in friendly, natural English with short paragraphs. 
Avoid markdown bold (**), avoid bullet lists unless truly necessary. Keep it specific to the chart. 
Return JSON: { "output": string }.
  `.trim();

  const user = {
    role:'user',
    content:
`Question: ${question}
Locale: ${locale}

Use this chart as context:
pillars=${JSON.stringify(pillars)}
elements=${JSON.stringify(elements||{})}
tenGods=${JSON.stringify(tenGods||{})}
interactions=${JSON.stringify(interactions||{})}
luck=${JSON.stringify(luck||{})}

Write 2–5 short paragraphs. Offer a gentle headline line first, then practical steps or timing windows if appropriate.
Return JSON exactly as { "output": string }.`
  };

  try{
    const ai = await callOpenAI([{role:'system', content:sys}, user], true);
    if (ai.error){ res.status(200).json({ ok:false, error:ai.error, raw:ai.raw||null }); return; }
    const parsed = tryParseJSON(ai.content);
    if (!parsed?.output){ res.status(200).json({ ok:true, fallback:true, output: ai.content }); return; }
    res.status(200).json({ ok:true, output: parsed.output });
  }catch(e){
    res.status(200).json({ ok:false, error:String(e?.message||e) });
  }
}
