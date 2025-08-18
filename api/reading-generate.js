// api/reading-generate.js
// Modes: summary | topic | question
// Returns strict JSON: { ok, mocked?, fallback?, output: { title, bullets[], forecastOneLiner, actions[], sections? }, raw? }

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // 필요시 바꿔도 됩니다.
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const J = (s) => { try { return JSON.parse(s); } catch { return null; } };

// --------- Keyword guards for topic validation ---------
const TOPIC_KEYWORDS = {
  wealth: ["money","income","saving","invest","budget","profit","expense","finance","cash","asset"],
  love: ["love","relationship","partner","romance","dating","marriage","compatib"],
  career: ["job","career","work","role","manager","lead","promotion","portfolio","craft","pivot"],
  health: ["health","wellness","sleep","exercise","diet","stress","breath","hydration","routine"],
  family: ["child","children","family","parent","pregnan","fertility","home"],
  moving: ["travel","relocat","move","city","country","visa","direction","place"],
  study: ["study","learn","exam","course","skill","practice","education"],
  timing: ["month","quarter","window","timing","period","next","avoid","calendar"],
};
function looksOnTopic(text, topic) {
  const bag = (TOPIC_KEYWORDS[topic] || []).map(k => k.toLowerCase());
  const t = (text || "").toLowerCase();
  return bag.some(k => t.includes(k));
}

// --------- Prompt builders ---------
function buildCalcContext({ pillars, elements, tenGods, interactions, luck } = {}) {
  const dm = pillars?.day?.stem || "?";
  const e = elements || {};
  const elems = Object.entries(e).map(([k,v]) => `${k}:${Math.round((v||0)*100)}%`).join(", ");
  const bl = (luck?.bigLuck || []).slice(0,6).map(s => `${s.startAge}-${s.startAge+9}:${s.stem||""}${s.branch||""}`).join("; ");
  return `DayMaster=${dm}; Elements=${elems || "N/A"}; BigLuck=${bl || "N/A"}`;
}

function buildSystem() {
  return [
    {
      role: "system",
      content:
`You are a Saju (Four Pillars) analyst for English-speaking users.
- Be specific, practical, and emotionally warm.
- Keep cultural references universal.
- When asked for a TOPIC, talk only about that topic (do not drift).
- Prefer short, crisp bullet points over long paragraphs.
- Include timing windows (months / quarters / age windows) whenever relevant.
- Always return STRICT JSON following the provided schema.`
    }
  ];
}

function buildUserSummary({ locale = "en-US", length = "deep", minSections = 6, wantSections = [], calcContext = "", pillars, elements, tenGods, interactions, luck }) {
  return [
    {
      role: "user",
      content:
`Task: Write a deep Saju reading in English with ${minSections} sections minimum.
ChartContext: ${calcContext}

Desired sections (use these titles if possible):
${wantSections.join(", ") || "(free form okay)"}

JSON schema to return:
{
  "title": string,
  "bullets": string[3..6],
  "forecastOneLiner": string,
  "actions": string[1..3],
  "sections": [
    { "title": string, "points": string[4..8], "tags": string[] }
  ]
}

- Keep each bullet concrete, avoid generic advice.
- Use month/quarter/age windows when helpful.
- Keep tone encouraging and clear.`
    }
  ];
}

function buildUserTopic({ topic, topicHints = "", calcContext = "" }) {
  return [
    {
      role: "user",
      content:
`Task: Provide a focused Saju reading ONLY about the topic "${topic}".
ChartContext: ${calcContext}

Topic rules:
${topicHints || "(no extra hints provided)"}

JSON schema to return:
{
  "title": string,
  "bullets": string[5..10],
  "forecastOneLiner": string,
  "actions": string[1..3]
}

- Stay strictly on-topic.
- Use specific, testable guidance (timing windows, thresholds, simple rules).
- No off-topic general life advice.`
    }
  ];
}

function buildUserQuestion({ question = "", questionHints = "", calcContext = "" }) {
  return [
    {
      role: "user",
      content:
`Task: Answer the user's question based on their Saju.
Question: ${question}
ChartContext: ${calcContext}

Hints:
${questionHints || "(no extra hints)"}

JSON schema to return:
{
  "title": string,
  "bullets": string[4..8],
  "forecastOneLiner": string,
  "actions": string[0..2]
}

- Be succinct and actionable.
- Provide timing / windows if possible.
- Keep to the point.`
    }
  ];
}

// --------- OpenAI call + JSON guard ---------
async function callOpenAI(messages, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(OPENAI_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages
      })
    });
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || "";
    let json = J(text);
    // fallback: try to find JSON inside fences
    if (!json) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) json = J(m[0]);
    }
    return { ok: r.ok, status: r.status, data, text, json };
  } catch (e) {
    return { ok: false, status: 0, error: e?.message || "fetch_failed" };
  } finally {
    clearTimeout(to);
  }
}

// --------- Handler ---------
module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow","POST, OPTIONS");
    return res.status(405).json({ ok:false, error:"Use POST" });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ ok:false, error:"Missing OPENAI_API_KEY env" });
  }

  let body = {};
  try { body = req.body || JSON.parse(await new Promise(r=>{let s=""; req.on("data",c=>s+=c); req.on("end",()=>r(s))})) } catch {}
  const {
    type = "summary", // "summary" | "topic" | "question"
    topic,
    topicHints = "",
    question = "",
    questionHints = "",
    locale = "en-US",
    length = "deep",
    minSections = 6,
    wantSections = [],

    // chart data for context
    pillars, elements, tenGods, interactions, luck,

    // client hints
    strict, forceBullets
  } = body || {};

  const calcContext = buildCalcContext({ pillars, elements, tenGods, interactions, luck });
  const sys = buildSystem();

  try {
    // ---- SUMMARY ----
    if (type === "summary") {
      const user = buildUserSummary({ locale, length, minSections, wantSections, calcContext, pillars, elements, tenGods, interactions, luck });
      const first = await callOpenAI([...sys, ...user]);
      if (!first.ok || !first.json) {
        return res.status(502).json({ ok:false, error:"openai_failed", raw:first });
      }
      return res.status(200).json({ ok:true, output:first.json, raw:first.text });
    }

    // ---- TOPIC ----
    if (type === "topic") {
      const user = buildUserTopic({ topic, topicHints, calcContext });
      let attempt = await callOpenAI([...sys, ...user]);
      let out = attempt.json;

      // Validate & maybe retry with stricter guard
      const looksGood = attempt.ok && out && looksOnTopic(JSON.stringify(out), topic);
      if (!looksGood) {
        await sleep(600);
        const extraGuard = `
STRICT RULES:
- Talk ONLY about ${topic}.
- Include at least ${forceBullets || 6} concrete bullets with timing windows when relevant.
- Absolutely no generic advice outside ${topic}. Use the chart context.`;
        const user2 = buildUserTopic({ topic, topicHints: (topicHints || "") + "\n" + extraGuard, calcContext });
        const retry = await callOpenAI([...sys, ...user2], { timeoutMs: 24000 });
        out = retry.json || out;
        const looksGood2 = retry.ok && out && looksOnTopic(JSON.stringify(out), topic);
        if (!looksGood2) {
          return res.status(200).json({ ok:true, fallback:true, output: out || { title:"Topic Result", bullets:["(Fallback) Unable to specialize sufficiently this time."], forecastOneLiner:"Try again shortly.", actions:["Refine your question."] }, raw: attempt.text });
        }
        return res.status(200).json({ ok:true, output: out, raw: retry.text });
      }
      return res.status(200).json({ ok:true, output: out, raw: attempt.text });
    }

    // ---- QUESTION ----
    if (type === "question") {
      const user = buildUserQuestion({ question, questionHints, calcContext });
      const first = await callOpenAI([...sys, ...user]);
      if (!first.ok || !first.json) {
        return res.status(502).json({ ok:false, error:"openai_failed", raw:first });
      }
      return res.status(200).json({ ok:true, output:first.json, raw:first.text });
    }

    return res.status(400).json({ ok:false, error:"Unknown type" });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e?.message || "internal_error" });
  }
};
