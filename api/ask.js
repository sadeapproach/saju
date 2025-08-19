// /api/ask.js
// Vercel Serverless (Node.js) — OpenAI 연결 + 안전한 fallback 포함

export const config = { runtime: "edge" }; // Edge가 더 빠름. Node가 필요하면 제거하고 default 사용.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_TOKEN || "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // 필요시 gpt-4o 등으로 변경 가능

// 공통 유틸
const json = (obj, init = {}) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" }, ...init });

const bad = (msg, status = 200) =>
  json({ ok: false, error: msg }, { status });

const clamp = (s, n = 4000) => (typeof s === "string" ? s.slice(0, n) : s);

const isNonsense = (q = "") => {
  const t = q.trim().toLowerCase();
  if (!t || t.length < 2) return true;
  if (/^[^a-zA-Z가-힣0-9?!. ]+$/.test(t)) return true;          // 기호만
  if (/([a-z])\1{3,}/.test(t)) return true;                    // 같은 글자 반복
  if (t.split(" ").length <= 1 && !/[?]/.test(t)) return false; // 단어 1개는 OK(예: "career?")
  return false;
};

// OpenAI 호출
async function openaiChat(messages, { temperature = 0.7, max_tokens = 400 } = {}) {
  if (!OPENAI_API_KEY) return { ok: false, error: "Missing OPENAI_API_KEY" };

  const body = {
    model: MODEL,
    temperature,
    max_tokens,
    messages
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body),
    // 간단한 타임아웃 보호
    signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined
  });

  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }

  const content = data?.choices?.[0]?.message?.content?.trim();
  if (r.ok && content) return { ok: true, content, raw: data };
  return { ok: false, error: data?.error?.message || text };
}

// 프롬프트 템플릿
function systemForChat() {
  return {
    role: "system",
    content:
      "You are a friendly Saju (Four Pillars) interpreter for English-speaking users. " +
      "Use the provided chart JSON if available. Answer the user's question directly in 3–6 sentences. " +
      "Be clear and practical, avoid generic filler. Offer one useful timing or action and one caution when possible. " +
      "Use approachable language; you may include one emoji if helpful (max one). " +
      "No markdown headings, no asterisks lists; keep it conversational. " +
      "Avoid medical/legal/absolute predictions. Use hedging language when appropriate."
  };
}

function userForChat(question, chart) {
  const ctx = chart ? `Chart JSON (truncated):\n${clamp(JSON.stringify(chart), 3000)}` : "Chart JSON: (not provided)";
  return {
    role: "user",
    content: `${ctx}\n\nQuestion:\n${question}`
  };
}

function systemForTopic(topic) {
  return {
    role: "system",
    content:
      "You are a Saju (Four Pillars) interpreter. Generate concise, useful guidance for the requested topic " +
      "based on the chart JSON if provided. Respond STRICTLY as JSON with keys: overview, phases, watch, tips. " +
      "Each value must be plain text (no markdown, no asterisks). " +
      "overview: 3–5 sentences with one tasteful emoji. " +
      "phases: a compact paragraph listing age-phase or cycle highlights separated by ' • '. " +
      "watch: cautions, also compact with ' • '. " +
      "tips: practical actions, compact with ' • '."
  };
}

function userForTopic(topic, chart) {
  const ctx = chart ? `Chart JSON (truncated):\n${clamp(JSON.stringify(chart), 3000)}` : "Chart JSON: (not provided)";
  return {
    role: "user",
    content:
      `${ctx}\n\nTopic: ${topic}\n` +
      "Return JSON only."
  };
}

// 간단 Fallback (키 없거나 장애 시)
const FALLBACK_TOPIC = (topic) => ({
  overview: `Here’s a short ${topic} overview based on common Saju patterns. As cycles shift, focus on steady routines and review your plans quarterly. A small buffer and clear checkpoints go a long way. 🙂`,
  phases: "0–10: build habits • 20s: learn + network • 30s: output + ship • 40s: team + influence • 50s–60s: consolidation + stewardship",
  watch: "avoid overcommitting • check assumptions at each phase • beware of vague offers during high-stress windows",
  tips: "set quarterly goals • keep a small buffer • validate before scaling • journal quick wins to keep momentum"
});

const FALLBACK_CHAT = (q) =>
  `Here’s a practical take on “${q}”. Start with the smallest useful step, plan in quarters, and keep a small buffer for surprises. ` +
  `Avoid big commitments during heavy‑stress weeks; batch admin work when energy is low. When in doubt, test small before going all‑in.`;

// 본문 파서 (GET/POST 둘 다 지원)
async function parseRequest(req) {
  const url = new URL(req.url);
  const topic = url.searchParams.get("topic") || null;

  if (req.method === "GET") {
    // /api/ask?topic=wealth
    return { mode: topic ? "topic" : null, topic, q: null, chart: null };
  }

  if (req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch {}
    const q = body?.q || null;
    const chart = body?.chart || body?.context || null; // 프론트에서 넘기면 사용
    const t = body?.topic || topic || null;
    return { mode: q ? "chat" : t ? "topic" : null, topic: t, q, chart };
  }

  return { mode: null, topic: null, q: null, chart: null };
}

// 핸들러
export default async function handler(req) {
  const { mode, topic, q, chart } = await parseRequest(req);

  // 모드 없으면 안내
  if (!mode) {
    return bad("Specify ?topic=… on GET for card insights, or POST { q } for chat.");
  }

  // 의미 없는 입력 방지
  if (mode === "chat" && isNonsense(q)) {
    return json({
      ok: true,
      output:
        "I couldn’t quite understand that. Could you rephrase your question in a simple way? " +
        "For example: “When is a good time to move?”, “Is next year favorable for a job change?”, or “Any cautions for finances this quarter?”"
    });
  }

  // === Topic 카드 ===
  if (mode === "topic") {
    try {
      const messages = [systemForTopic(topic), userForTopic(topic, chart)];
      const r = await openaiChat(messages, { temperature: 0.6, max_tokens: 500 });

      if (r.ok) {
        // JSON 파싱 시도
        let parsed = null;
        try { parsed = JSON.parse(r.content); } catch {}
        if (parsed && typeof parsed === "object") {
          // 최소 키 보정
          const merged = {
            overview: parsed.overview || FALLBACK_TOPIC(topic).overview,
            phases: parsed.phases || FALLBACK_TOPIC(topic).phases,
            watch: parsed.watch || FALLBACK_TOPIC(topic).watch,
            tips: parsed.tips || FALLBACK_TOPIC(topic).tips
          };
          return json({ ok: true, output: merged });
        }
      }

      // 실패시 fallback
      return json({ ok: true, output: FALLBACK_TOPIC(topic), fallback: true });
    } catch (e) {
      return json({ ok: true, output: FALLBACK_TOPIC(topic), fallback: true, note: String(e?.message || e) });
    }
  }

  // === Ask 채팅 ===
  if (mode === "chat") {
    try {
      const messages = [systemForChat(), userForChat(q, chart)];
      const r = await openaiChat(messages, { temperature: 0.7, max_tokens: 420 });

      if (r.ok) {
        return json({ ok: true, output: r.content });
      }

      // 실패 시 짧은 fallback
      return json({ ok: true, output: FALLBACK_CHAT(q), fallback: true });
    } catch (e) {
      return json({ ok: true, output: FALLBACK_CHAT(q), fallback: true, note: String(e?.message || e) });
    }
  }

  // 그 외
  return bad("Unsupported mode");
}
