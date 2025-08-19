// /api/reading-generate.js
export const config = { runtime: 'edge' };

function bad(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status, headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
function ok(data) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return bad('Method not allowed', 405);
  }

  let payload = {};
  try { payload = await req.json(); } catch {}

  // 1) 환경변수 검사
  const apiKey = process.env.OPENAI_API_KEY;
  const model  = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!apiKey) {
    return bad('OpenAI API key is missing. Set OPENAI_API_KEY in your environment.', 200);
  }

  // 2) 프롬프트 재료 검사(최소한의 가드)
  const hasPillars = !!payload?.pillars;
  if (!hasPillars) {
    return bad('Missing pillars in request body.', 200);
  }

  // 3) OpenAI 호출
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{
        'content-type':'application/json',
        'authorization':`Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role:'system', content:
            'You are a concise Saju interpreter. Return JSON: { sections:{ core:{text,bullets,try}, balance:{...}, tengods:{...}, luck:{...}, wellness:{...}, summary:{...} } }' },
          { role:'user', content:
            `Create a 6-section English reading for this chart (be readable, concrete).\n`+
            `Chart JSON:\n${JSON.stringify(payload).slice(0,5000)}`
          }
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' }
      })
    });

    const text = await resp.text();
    let data=null; try { data=JSON.parse(text); } catch {}

    if (!resp.ok || !data) {
      // OpenAI에서 에러를 문자열로 줄 수도 있기에 원문을 그대로 내보냄
      return bad(`OpenAI request failed\n${text}`, 200);
    }

    // 보통 data.choices[0].message.content 가 JSON string 이거나 객체형
    let content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      try { content = JSON.parse(content); } catch {}
    }
    const sections = content?.sections || null;
    if (!sections) {
      return bad('OpenAI returned no sections field.', 200);
    }

    return ok({ output: { sections } });
  } catch (e) {
    return bad(`OpenAI call exception: ${e?.message || e}`, 200);
  }
}
