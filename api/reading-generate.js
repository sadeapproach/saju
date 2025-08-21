// /api/reading-generate.js
// Next.js/Vercel serverless (pages/api/ or app/api/route.js 스타일)
// OpenAI가 없으면 안전한 Fallback 영어 리딩을 생성합니다.

import OpenAI from "openai";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function countElements(pillars) {
  const STEM_ELEM = { "甲":"wood","乙":"wood","丙":"fire","丁":"fire","戊":"earth","己":"earth","庚":"metal","辛":"metal","壬":"water","癸":"water" };
  const BRANCH_ELEM = { "子":"water","丑":"earth","寅":"wood","卯":"wood","辰":"earth","巳":"fire","午":"fire","未":"earth","申":"metal","酉":"metal","戌":"earth","亥":"water" };
  const m = { wood:0, fire:0, earth:0, metal:0, water:0 };
  if (!pillars) return m;
  const push = (ch)=>{ const e = STEM_ELEM[ch] || BRANCH_ELEM[ch]; if (e) m[e]++; };
  ["hour","day","month","year"].forEach(k=>{
    const p = pillars?.[k]; if(!p) return; push(p.stem); push(p.branch);
  });
  return m;
}

function englishFallbackSections(payload) {
  const { pillars, luck, birthDateISO } = payload || {};
  const hour = `${pillars?.hour?.stem||""}${pillars?.hour?.branch||""}`.trim();
  const day  = `${pillars?.day?.stem||""}${pillars?.day?.branch||""}`.trim();
  const month= `${pillars?.month?.stem||""}${pillars?.month?.branch||""}`.trim();
  const year = `${pillars?.year?.stem||""}${pillars?.year?.branch||""}`.trim();
  const em = countElements(pillars);
  const dom = Object.entries(em).sort((a,b)=>b[1]-a[1])[0]?.[0] || "mixed";
  const d = birthDateISO ? new Date(birthDateISO) : null;
  const age = d ? (new Date().getFullYear() - d.getFullYear()) : "N/A";
  const curLuck = (luck?.bigLuck||[]).find(seg=>{
    if (!d) return false;
    const a = (new Date().getFullYear() - d.getFullYear());
    return a >= seg.startAge && a < (seg.startAge+10);
  });
  const curLuckStr = curLuck ? `${curLuck.startAge}–${curLuck.startAge+9} (${curLuck.stem||""}${curLuck.branch||""})` : "N/A";

  return [
    {
      title: "Four Pillars Overview",
      subtitle: "A quick look at the overall chart structure.",
      content: `Your pillars show as Hour ${hour}, Day ${day}, Month ${month}, and Year ${year}. This gives a balanced snapshot of personal, seasonal, and ancestral influences. We’ll use this frame to understand your core tendencies and timing windows.`
    },
    {
      title: "Day Master Traits",
      subtitle: "The element that represents you.",
      content: `Your Day Master (self) is the stem of the Day Pillar (here: ${day || "unknown"}). It frames how you act, decide, and recharge. Keep it well‑supported to avoid over‑spending energy in busy months.`
    },
    {
      title: "Five Elements Balance",
      subtitle: "Where your energy leans — and what to watch.",
      content: `Element counts — wood:${em.wood}, fire:${em.fire}, earth:${em.earth}, metal:${em.metal}, water:${em.water}. The current tilt looks **${dom}**. Use this awareness to balance routines: reinforce weaker areas and avoid over‑amplifying what’s already strong.`
    },
    {
      title: "Chart Structure",
      subtitle: "What your chart tends to prioritize.",
      content: `The chart suggests a steady baseline with practical considerations. It often points to consistent routines, measured risks, and guardrails that keep momentum without burnout.`
    },
    {
      title: "Key Balancing Energy",
      subtitle: "A simple lever to keep things even.",
      content: `Pick one balancing theme for the next quarter (e.g., “more water” = learning, reflection; “more metal” = boundaries and systems). Little shifts, repeated weekly, will compound.`
    },
    {
      title: "Life Flow & Timing",
      subtitle: "Your current decade trend and near‑term windows.",
      content: `Age: ${age}. Current luck decade: ${curLuckStr}. Use tailwinds for starts and visibility; use quieter weeks for drafts and recovery. Decisions land better when energy is steady rather than spiky.`
    },
    {
      title: "Strengths & Challenges",
      subtitle: "Quick wins and gentle cautions.",
      content: `Lean into your natural strengths (focus, initiative, or adaptability). Watch the usual traps (over‑commitment, delayed rest, or unclear boundaries). Small buffers — time and money — reduce friction across the year.`
    }
  ];
}

function stripJson(text) {
  if (typeof text !== "string") return text;
  // ```json ... ``` 제거
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  if (m) return m[1];
  const m2 = text.match(/```([\s\S]*?)```/);
  if (m2) return m2[1];
  return text;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const payload = req.body || {};
  try {
    // OpenAI가 없으면 안전한 영어 Fallback
    if (!client) {
      const sections = englishFallbackSections(payload);
      return res.status(200).json({ sections, ok: true, source: "fallback" });
    }

    const prompt = `
You are a friendly Saju (Four Pillars) guide.
Given this chart context, produce exactly 7 sections, each with:
- "title" (short, in English)
- "subtitle" (one-line, simple English)
- "content" (3–5 sentences, practical and helpful, in English)

Sections in order:
1. Four Pillars Overview
2. Day Master Traits
3. Five Elements Balance
4. Chart Structure
5. Key Balancing Energy
6. Life Flow & Timing
7. Strengths & Challenges

Return ONLY valid JSON with the shape:
{ "sections": [ { "title": "...", "subtitle": "...", "content": "..." }, ... 7 items total ] }

Chart payload (stringified):
${JSON.stringify(payload)}
    `.trim();

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = completion?.choices?.[0]?.message?.content || "";
    let txt = stripJson(raw);
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch {
      // 마지막 안전장치: 통째로 content에 넣어서 한 섹션이라도 보이게
      parsed = {
        sections: englishFallbackSections(payload)
      };
    }

    // 최소 형식 보정
    if (!parsed || !Array.isArray(parsed.sections)) {
      parsed = { sections: englishFallbackSections(payload) };
    }

    return res.status(200).json({ ...parsed, ok: true, source: "openai" });
  } catch (err) {
    console.error("reading-generate error:", err);
    // 에러 시 Fallback
    return res.status(200).json({
      sections: englishFallbackSections(payload),
      ok: true,
      source: "error-fallback",
    });
  }
}
