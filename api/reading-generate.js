// /api/reading-generate.js
// Edge 호환: fs, path 등 사용 금지
export const config = { runtime: 'edge' };

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default async function handler(req) {
  if (req.method && req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { pillars, elements, tenGods, interactions, locale = 'en-US', length = 'long', maxBullets = 6 } = body || {};

    if (!pillars || !elements) {
      return jsonResponse({ ok: false, error: 'Missing pillars/elements in request body.' });
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_GPT || '';
    if (!apiKey) {
      return jsonResponse({ ok: false, error: 'Missing OPENAI_API_KEY on server.' });
    }

    // 안전한 컨텍스트 축약
    const safe = {
      pillars,
      elements: Object.fromEntries(Object.entries(elements).slice(0, 5)),
      tenGods: tenGods ? (tenGods.byPillar || tenGods) : null,
      interactions: interactions ? { stems: interactions.stems || {}, branches: interactions.branches || {} } : null,
    };

    const system = [
      'You are a Saju(Four Pillars) interpreter for non‑experts.',
      'Write in warm, natural English. Use short paragraphs and helpful bullets.',
      'Be specific but pragmatic; include one risk/“watch out” line when relevant.',
      'Never output markdown headings like ##; just plain text and bullets.',
    ].join(' ');

    const user = [
      `Locale: ${locale}`,
      `Length: ${length}; At most ${maxBullets} bullets under the main section.`,
      'Input (JSON, compact):',
      JSON.stringify(safe),
      '',
      'Return JSON with shape:',
      `{
        "ok": true,
        "output": {
          "title": "string",
          "bullets": ["..."],
          "forecastOneLiner": "string",
          "actions": ["..."],
          "sections": [
            {"title":"Core Traits","body":"4+ sentences"},
            {"title":"Element Balance","body":"4+ sentences"},
            {"title":"Ten Gods","body":"4+ sentences"},
            {"title":"Luck Cycle","body":"4+ sentences"},
            {"title":"Wellness","body":"4+ sentences"},
            {"title":"Summary","body":"4+ sentences"}
          ]
        }
      }`,
      'Only return JSON. No backticks.'
    ].join('\n');

    // OpenAI Responses API (JSON 모드)
    const model =
      process.env.OPENAI_RESPONSES_MODEL ||
      process.env.OPENAI_MODEL ||
      'gpt-4o-mini';

    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_output_tokens: 1200,
        temperature: 0.5,
        response_format: { type: 'json_object' },
      }),
    });

    const raw = await resp.text();
    if (!resp.ok) {
      return jsonResponse({
        ok: false,
        error: 'OpenAI request failed',
        status: resp.status,
        detail: raw?.slice(0, 800),
      });
    }

    let data;
    try {
      const parsed = JSON.parse(raw);
      const txt = parsed?.output?.[0]?.content?.[0]?.text || parsed?.output_text || '';
      data = JSON.parse(txt);
    } catch (e) {
      return jsonResponse({
        ok: false,
        error: 'Failed to parse AI JSON',
        detail: raw?.slice(0, 800),
      });
    }

    // 방어: 섹션 6개 강제 보장
    if (data?.output) {
      const need = [
        'Core Traits',
        'Element Balance',
        'Ten Gods',
        'Luck Cycle',
        'Wellness',
        'Summary',
      ];
      const got = Array.isArray(data.output.sections) ? data.output.sections : [];
      need.forEach((title) => {
        if (!got.find((s) => s?.title?.toLowerCase().includes(title.toLowerCase()))) {
          got.push({ title, body: 'Additional context will be added here based on your pillars and elements.' });
        }
      });
      data.output.sections = got.slice(0, 6);
    }

    return jsonResponse({ ok: true, ...data });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: 'Unhandled server error in /api/reading-generate',
      detail: (err && err.message) || String(err),
    });
  }
}
