// /api/ask.js
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

function normalizeTopic(topic) {
  const t = String(topic || '').trim().toLowerCase();
  const map = {
    wealth: 'Wealth & Money',
    love: 'Love & Relationships',
    career: 'Career & Growth',
    health: 'Health & Wellness',
    family: 'Family & Children',
    travel: 'Travel / Relocation',
    learning: 'Learning & Skills',
    timing: 'Timing & Windows'
  };
  return { key: t, label: map[t] || 'Your Topic' };
}

export default async function handler(req, ctx) {
  try {
    let body = {};
    const url = new URL(req.url);
    if (req.method === 'GET') {
      // GET 호환 (쿼리로 topic 받기)
      body.topic = url.searchParams.get('topic');
      body.q = url.searchParams.get('q'); // 자유질문 호환
    } else if (req.method === 'POST') {
      try { body = await req.json(); } catch { body = {}; }
    } else {
      return bad('Method not allowed', 405);
    }

    // topic 우선, 없으면 자유질문(q)
    const topic = body.topic;
    const q = body.q;

    if (!topic && !q) {
      return bad('Provide either "topic" or "q"');
    }

    // 여기서는 데모로 서버에서 템플릿 조합만 해줍니다.
    // (실서비스에선 OpenAI 호출/템플릿 삽입 로직을 두세요)
    if (topic) {
      const { key, label } = normalizeTopic(topic);
      const output = {
        overview: `Here’s a focused overview for ${label}. We’ll keep it practical and readable.`,
        phases: `0–10: build habits • 20s: explore & learn • 30s: output & momentum • 40s: peers & leverage • 50–60s: authority & stewardship.`,
        watch: `Avoid overextending during “high-opportunity” windows. Be wary of vague offers; confirm fit and risk.`,
        tips: `Pick 1–2 moves, not 5. Review quarterly. Keep a small buffer to stay flexible.`
      };
      return ok({ topic: key, label, output });
    }

    // 자유 질문(q) 템플릿 응답
    const output =
      `I’ll use your current chart as context.\n` +
      `• What I’m seeing: balanced potential with pockets of momentum.\n` +
      `• If timing matters, think in quarters and review monthly.\n` +
      `• Watch one risk: over-committing before validation.\n` +
      `• Next step: write one concrete move you can test within 2–3 weeks.`;

    return ok({ output });
  } catch (e) {
    return bad(`Server error: ${e?.message || e}`, 500);
  }
}
