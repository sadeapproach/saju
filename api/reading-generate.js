// /api/reading-generate.ts  (Node/Edge 런타임 둘 다 OK한 단순 핸들러 예시)
import type { NextRequest } from 'next/server';

// ---- util: JSON code block 안전 파서 ----
function safeJsonExtract(s: string) {
  if (!s) return null;
  // ```json ... ``` 우선
  const m = s.match(/```json\s*([\s\S]*?)\s*```/i) || s.match(/```\s*([\s\S]*?)\s*```/i);
  const body = m ? m[1] : s;
  try { return JSON.parse(body); } catch { return null; }
}

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  try {
    const body = await req.json();
    const { pillars, elements, tenGods, interactions } = body || {};

    const system = [
      "You are a Saju/Bazi interpreter.",
      "Always return a SINGLE JSON object with EXACT KEYS:",
      "pillars, day_master, five_elements, structure, yongshin, life_flow, summary.",
      "Do NOT add any prose outside JSON. Keep each field concise, plain-English (or localized) paragraphs or bullet points.",
    ].join("\n");

    const schemaHint = `Return JSON like:
{
  "pillars": "연/월/일/시 천간·지지 요약",
  "day_master": "일간 성격/대인관계/행동패턴",
  "five_elements": "오행 편중/부족 분석과 생활 조언",
  "structure": "격국과 기본 운세 방향성",
  "yongshin": "용신(보완 기운) 및 활용 포인트",
  "life_flow": "초년·중년·말년 흐름(기회/도전)",
  "summary": "장단점 요약(강점/약점/한줄 권장사항)"
}`;

    // 컨텍스트 요약(모델이 과하게 장황해지지 않도록 핵심만)
    const ctx = {
      pillars, elements, tenGods,
      interactionsBrief: interactions ? Object.keys(interactions) : []
    };

    // === OpenAI 호출 (fetch로 예시) ===
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // 사용 모델은 프로젝트에 맞게
        temperature: 0.5,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              "Generate a structured 7‑section Saju reading.",
              "Keep it practical and easy-to-understand. Avoid jargon; if used, explain briefly.",
              schemaHint,
              "Chart Context JSON:",
              "```json",
              JSON.stringify(ctx, null, 2),
              "```"
            ].join("\n")
          }
        ]
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(JSON.stringify({ ok: false, error: text }), { status: 500 });
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = safeJsonExtract(raw);

    // 스키마 보정(누락 키가 있으면 빈 문자열로 보완)
    const keys = ["pillars","day_master","five_elements","structure","yongshin","life_flow","summary"];
    const output: Record<string,string> = {} as any;
    keys.forEach(k => { output[k] = (parsed && typeof parsed[k] === 'string') ? parsed[k] : ""; });

    return new Response(JSON.stringify({ ok: true, output }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
}
