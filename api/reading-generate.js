// /api/reading-generate.js
export const config = { runtime: 'edge' };

function J(res, status=200){return new Response(JSON.stringify(res),{status,headers:{'content-type':'application/json; charset=utf-8'}})}

function localSections() {
  // 쉬운 요약 + 자세 설명(디테일) 데모
  const EZ = (s, b=[], tip='') => ({ summary:s, details: { text:s, bullets:b, try:tip }});
  return {
    core:     EZ("You’re thoughtful and steady. Lead with your strengths, and keep your plans simple.",[
                "Notice when you do your best work (time/place).",
                "Write one weekly outcome you can ship.",
              ],"Pick one small habit that makes everything easier."),
    balance:  EZ("Your elements ask for balance: steady structure + small creative breaks.",[
                "Pair focus blocks with short resets.",
                "Keep essentials light (sleep, water, walks).",
              ],"Try a 25–30 min focus → 5 min reset rhythm."),
    tengods:  EZ("Your Ten Gods point to output, support, and influence as your main levers.",[
                "Use output for momentum.",
                "Ask for support for the rest.",
              ],"Write one role you’re best suited for this quarter."),
    luck:     EZ("Treat each 10‑year cycle like a theme. Double down on what’s supported; test the rest lightly.",[
                "Mark gentle checkpoints each quarter.",
                "Adjust plans to real‑world feedback.",
              ],"Name one small bet to test this month."),
    wellness: EZ("Small routines beat big pushes. Recovery is part of performance.",[
                "Sleep rhythm first; light daily movement.",
                "Season‑friendly meals; drink water.",
              ],"Schedule one tiny wellness ritual you can keep."),
    summary:  EZ("In short, focus on one theme, plan by quarters, and keep a buffer. Consistency over intensity.",[
                "Lead with strengths; invite help elsewhere.",
                "Let feedback guide your next step.",
              ],"Write your next one‑week step now.")
  };
}

export default async function handler(req){
  if (req.method !== 'POST') return J({ ok:false, error:'Method not allowed' }, 405);

  let payload={}; try{payload=await req.json()}catch{}
  const apiKey = process.env.OPENAI_API_KEY;
  const model  = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  // OpenAI가 없으면 로컬 폴백
  if (!apiKey) return J({ ok:true, output:{ sections: localSections() }, fallback:true });

  try{
    const resp = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'content-type':'application/json','authorization':`Bearer ${apiKey}`},
      body:JSON.stringify({
        model, temperature:0.7, response_format:{type:'json_object'},
        messages:[
          {role:'system',content:
            'You are a concise Saju interpreter for English speakers. Return JSON {sections:{core:{summary,details:{text,bullets,try}},balance:{...},tengods:{...},luck:{...},wellness:{...},summary:{...}}}. Keep summary lines plain and friendly; details can be denser.'},
          {role:'user',content:`Make a 6-section reading (summary + details). Chart JSON:\n${JSON.stringify(payload).slice(0,5000)}`}
        ]
      })
    });
    const text=await resp.text(); let data=null; try{data=JSON.parse(text)}catch{}
    if(!resp.ok||!data) return J({ ok:false, error:`OpenAI request failed\n${text}` });
    let content=data?.choices?.[0]?.message?.content; if(typeof content==='string'){try{content=JSON.parse(content)}catch{}}
    const sections=content?.sections || null; if(!sections) return J({ ok:false, error:'OpenAI returned no sections field.' });
    return J({ ok:true, output:{ sections } });
  }catch(e){ return J({ ok:false, error:`OpenAI call exception: ${e?.message||e}` }); }
}
