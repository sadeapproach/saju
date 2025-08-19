// /api/ask.js
export const config = { runtime: 'edge' };

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const FALLBACKS = {
  invalid:
    "I'm not sure I understood that. Could you ask about timing, relationships, career, or health? For example: “When is a good time to change jobs?” or “How does my chart look for savings this year?” 🙂",
};

export default async function handler(req) {
  if (req.method && req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { question = '', topic = '', pillars, elements, tenGods, luck } = body || {};

    if (!pillars || !elements) {
      return jsonResponse({ ok: false, error: 'Missing pillars/elements in request body.' });
    }

    // 의미 없는 입력 방어
    const q = String(question || '').trim();
    if (!q || q.length < 4 || !/[a-zA-Z가-힣]/.test(q)) {
      return jsonResponse({ ok: true, output: { type: 'fallback', text: FALLBACKS.invalid } });
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_GPT || '';
    if (!apiKey) {
      return jsonResponse({ ok: false, error: 'Missing OPENAI_API_KEY on server.' });
    }

    const model =
      process.env.OPENAI_RESPONSES_MODEL ||
      process.env.OPENAI_MODEL ||
      'gpt-4o-mini';

    const system = [
      'You are a helpful Saju(Four Pillars) assistant.',
      'Answer in warm, clear English suitable for general users.',
      'Keep it actionable. Use short paragraphs and occasional bullets.',
      'Include one “watch-out” caution if relevant.',
      'Add a light emoji only where it really helps (1–2 max, optional).',
    ].join(' ');

    const compact = {
      pillars,
      elements,
      tenGods: tenGods ? (tenGods.byPillar || tenGods) : null,
      luck: Array.isArray(luck?.bigLuck) ? luck.bigLuck.slice(0, 8) : null,
      topic: topic || null,
    };

    const prompt = [
      'User question:',
      q,
      '',
      'Use this Saju context (JSON, compact):',
      JSON.stringify(compact),
      '',
      'Return JSON:',
      `{
        "ok": true,
        "output": {
          "title": "string",
          "body": "3-6 short paragraphs and/or bullets",
          "tips": ["one-liners ..."]
        }
      }`,
      'Only return JSON. No backticks.',
    ].join('\n');

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
          { role: 'user', content: prompt },
        ],
        max_output_tokens: 800,
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
      // 모델이 JSON을 못 지켰을 때 친절한 폴백
      return jsonResponse({
        ok: true,
        output: {
          title: 'Let’s refine the question',
          body: FALLBACKS.invalid,
          tips: [
            'Ask about timing: “When is a good time for a move in the next 12 months?”',
            'Ask about focus: “What should I prioritize for career growth this year?”',
          ],
        },
        fallback: true,
      });
    }

    return jsonResponse({ ok: true, ...data });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: 'Unhandled server error in /api/ask',
      detail: (err && err.message) || String(err),
    });
  }
}
