// pages/api/reading-generate.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { pillars } = req.body;

    // OpenAI 프롬프트
    const prompt = `
You are an expert in Saju (Four Pillars of Destiny). 
Based on the given pillars, generate a 7-section reading.
Each section must have:
- title: concise English heading
- subtitle: one-line explanation in simple English
- content: 3–5 sentences of analysis, practical and insightful

Sections:
1. Four Pillars Overview
2. Day Master Traits
3. Five Elements Balance
4. Chart Structure
5. Key Balancing Energy
6. Life Flow & Timing
7. Strengths & Challenges

Pillars: ${JSON.stringify(pillars)}
Output in strict JSON array format.
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
    });

    let text = completion.choices[0].message.content;

    // JSON 파싱 시도
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      // 혹시 JSON이 아니면 fallback
      json = [{ title: "Reading Error", subtitle: "", content: text }];
    }

    res.status(200).json(json);
  } catch (err) {
    console.error("Reading error:", err);
    res.status(500).json({ error: "Failed to generate reading" });
  }
}
