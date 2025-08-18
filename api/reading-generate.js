// api/reading-generate.js
// Robust reading generator:
// - Accepts { pillars, elements, tenGods, interactions, type, locale, length, maxBullets, sections? }
// - Normalizes `sections` no matter it is string | string[] | {core,...} | null
// - Uses OpenAI when available; otherwise produces a deterministic local fallback.
// - Never throws: returns { ok:true, output, mocked? , fallback? } on success.

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok:false, error:'Use POST' });
  }

  try {
    const body = req.body || {};
    const {
      pillars = {},
      elements = {},
      tenGods = {},
      interactions = {},
      type = 'summary',
      locale = 'en-US',
      length = 'long',
      maxBullets = 6,
      sections
    } = body;

    const normSections = normalizeSections(sections); // string
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const key = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_1 || '';

    let output = null;
    let usedLLM = false;

    if (key) {
      try {
        const prompt = buildPrompt({ pillars, elements, tenGods, interactions, normSections, type, locale, length, maxBullets });
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type':'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model,
            temperature: 0.8,
            messages: [
              { role:'system', content: 'You are a concise, empathetic Saju (Four Pillars) interpreter for English users.' },
              { role:'user', content: prompt }
            ]
          })
        });

        if (!r.ok) throw new Error(`openai_failed_${r.status}`);
        const data = await r.json();
        const txt = (data?.choices?.[0]?.message?.content || '').trim();
        output = parseLLMTextToOutput(txt, { elements, maxBullets });
        usedLLM = true;
      } catch (e) {
        // fall through to local fallback
      }
    }

    if (!output) {
      output = localFallback({ pillars, elements, tenGods, interactions, maxBullets });
    }

    return res.status(200).json({
      ok: true,
      output,
      mocked: !usedLLM,
      fallback: !usedLLM
    });
  } catch (e) {
    return res.status(200).json({ ok:false, error: e?.message || 'reading_failed' });
  }
}

/* ---------------- Helpers ---------------- */

function normalizeSections(sections) {
  if (!sections) return '';
  if (typeof sections === 'string') return sections;
  // array of strings
  if (Array.isArray(sections)) {
    return sections.filter(Boolean).join('\n\n');
  }
  // object {core, balance, ...}
  if (typeof sections === 'object') {
    const order = ['core','balance','tenGods','luck','wellness','summary'];
    const parts = [];
    for (const k of order) {
      if (sections[k]) parts.push(String(sections[k]));
    }
    // include any remaining keys
    for (const k of Object.keys(sections)) {
      if (!order.includes(k) && sections[k]) parts.push(String(sections[k]));
    }
    return parts.join('\n\n');
  }
  return '';
}

function buildPrompt({ pillars, elements, tenGods, interactions, normSections, type, locale, length, maxBullets }) {
  return [
    `Locale: ${locale}`,
    `Length preference: ${length}`,
    `Max bullets: ${maxBullets}`,
    `Type: ${type}`,
    ``,
    `Four Pillars (rough):`,
    safeJSON(pillars),
    ``,
    `Five Elements balance (0~1):`,
    safeJSON(elements),
    ``,
    `Ten Gods (if present):`,
    safeJSON(tenGods),
    ``,
    `Interactions (clash/harmony etc., if present):`,
    safeJSON(interactions),
    ``,
    normSections ? `Pre-computed sections (use as hints, do not repeat verbatim):\n${normSections}\n` : '',
    `Task: Produce a short English reading with:`,
    `- "title" (short, positive)`,
    `- "bullets" (up to ${maxBullets} bullets; crisp, specific, helpful)`,
    `- "forecastOneLiner" (1 sentence about near-term vibe)`,
    `- "actions" (1~2 practical suggestions)`,
    `Return only strict JSON with keys {title, bullets, forecastOneLiner, actions}. No prose outside JSON.`
  ].join('\n');
}

function parseLLMTextToOutput(txt, { elements, maxBullets }) {
  // Try parse JSON; if fails, wrap as single bullet
  let out = null;
  try { out = JSON.parse(txt); } catch {}
  if (!out || typeof out !== 'object') {
    out = {
      title: 'Your Saju Insights',
      bullets: sanitizeBullets(txt.split('\n').filter(Boolean)).slice(0, maxBullets),
      forecastOneLiner: quickForecast(elements),
      actions: ['Reflect on your element balance and try one small routine change this week.']
    };
  } else {
    out.title = out.title || 'Your Saju Insights';
    out.bullets = sanitizeBullets(out.bullets || []).slice(0, maxBullets);
    out.forecastOneLiner = out.forecastOneLiner || quickForecast(elements);
    out.actions = Array.isArray(out.actions) && out.actions.length ? out.actions.slice(0,2) : ['Try one gentle, practical step today.'];
  }
  return out;
}

function localFallback({ elements, maxBullets }) {
  const bullets = makeElementBullets(elements).slice(0, maxBullets);
  return {
    title: 'Saju Reading (Local Summary)',
    bullets,
    forecastOneLiner: quickForecast(elements),
    actions: ['Choose one routine to support your lower element.', 'Journal one insight after a week.']
  };
}

function makeElementBullets(e) {
  const sorted = Object.entries(e||{}).sort((a,b)=>b[1]-a[1]);
  const top = sorted[0]?.[0];
  const low = sorted[sorted.length-1]?.[0];
  const names = { wood:'Wood', fire:'Fire', earth:'Earth', metal:'Metal', water:'Water' };

  const list = [];
  if (top) list.push(`${names[top]} feels strong—leverage it on tasks that need that quality.`);
  if (low) list.push(`${names[low]} is comparatively low—add small habits to nurture it.`);
  list.push('Balance attention between work and relationships to keep energy steady.');
  list.push('Use seasonal changes as checkpoints; adjust routines instead of forcing big swings.');
  list.push('Create one weekly ritual that grounds your mind and body.');
  return list;
}

function quickForecast(e) {
  const top = Object.entries(e||{}).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const names = { wood:'growth and learning', fire:'visibility and momentum', earth:'stability and follow-through', metal:'focus and refinement', water:'reflection and planning' };
  return top ? `Near-term vibe favors ${names[top]}.` : 'Near-term vibe favors steady, balanced effort.';
}

function sanitizeBullets(b) {
  if (!Array.isArray(b)) return [];
  return b.map(x=>String(x||'').replace(/^[•\-\d\.\s]+/,'').trim()).filter(Boolean);
}

function safeJSON(x) {
  try { return JSON.stringify(x, null, 2); } catch { return String(x); }
}
