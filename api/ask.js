// /api/ask.js
export const config = { runtime: 'edge' };

const LABELS = {
  wealth: 'Wealth & Money',
  love: 'Love & Relationships',
  career: 'Career & Growth',
  health: 'Health & Wellness',
  family: 'Family & Children',
  travel: 'Travel / Relocation',
  learning: 'Learning & Skills',
  timing: 'Timing & Windows',
};

function json(res, status = 200) {
  return new Response(JSON.stringify(res), {
    status, headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function topicPack(key) {
  // 토픽별 서로 다른 카피 (요약 + 포인트)
  switch (key) {
    case 'wealth':
      return {
        overview: 'Your chart supports steady growth when effort meets timing. Prioritize clear goals and simple money habits. 💰',
        phases:  '0–10 build money sense • 20s learn + small investments • 30s output-driven earnings • 40s partner leverage • 50–60s consolidation.',
        watch:   'Avoid overextending during “hot” periods. Be cautious with vague opportunities; confirm fit and risk.',
        tips:    'Make a monthly plan, keep a small buffer, diversify slowly, and review quarterly.'
      };
    case 'love':
      return {
        overview: 'Connection grows when warmth meets boundaries. Focus on shared rhythm, not perfection. ❤️',
        phases:  '0–10 family patterns • 20s explore timing/compatibility • 30s deepen trust • 40s peer support • 50–60s wisdom & care.',
        watch:   'Don’t rush commitment under pressure. Watch for energy imbalance: always giving vs always leading.',
        tips:    'Practice clear asks, plan light rituals (walks, meals), and give space for solo recharge.'
      };
    case 'career':
      return {
        overview: 'Pick a lane that uses your core strengths. Output brings momentum; craft brings depth. 🧰',
        phases:  '0–10 curiosity • 20s explore & learn • 30s ship work • 40s peers & leadership • 50–60s mentoring.',
        watch:   'Beware shiny pivots that reset progress. Validate before big moves.',
        tips:    'Track weekly wins, set one skill focus, and design feedback loops.'
      };
    case 'health':
      return {
        overview: 'Balance comes from small routines you can repeat. Pair steady movement with gentle rest. 🌿',
        phases:  '0–10 sleep rhythm • 20s metabolism care • 30s stress hygiene • 40s joints & posture • 50–60s recovery first.',
        watch:   'Overwork disguised as ambition. Notice signals early (sleep, mood, digestion).',
        tips:    'Light daily movement, hydration, and season-friendly meals; review every 4–6 weeks.'
      };
    case 'family':
      return {
        overview: 'Family dynamics improve with calm structure and shared check-ins. 👶',
        phases:  '0–10 attachment • 20s roles & boundaries • 30s caregiving & play • 40s teamwork • 50–60s legacy.',
        watch:   'Unclear roles create friction; set expectations kindly.',
        tips:    'Use simple rituals; write things down; celebrate small progress.'
      };
    case 'travel':
      return {
        overview: 'Moves go well when timing and support align. Choose windows that reduce friction. ✈️',
        phases:  '0–10 roots • 20s exploration • 30s output-linked trips • 40s peer networks • 50–60s purpose moves.',
        watch:   'Avoid peak-stress months. Have a Plan B for admin/logistics.',
        tips:    'Batch tasks, carry a buffer week, and confirm documents early.'
      };
    case 'learning':
      return {
        overview: 'Depth beats breadth. One clear theme each quarter builds real skill. 📘',
        phases:  '0–10 curiosity • 20s foundation • 30s output projects • 40s teach/peer review • 50–60s synthesis.',
        watch:   'Course hopping with no practice.',
        tips:    'Study 3h/wk minimum, ship tiny artifacts monthly, reflect quarterly.'
      };
    case 'timing':
      return {
        overview: 'Good windows feel lighter: fewer blockers, faster feedback. ⏱️',
        phases:  '0–10 habits • 20s support building • 30s momentum • 40s alliances • 50–60s authority.',
        watch:   'Don’t overbook “good” months. Pace yourself.',
        tips:    'Plan by quarters; add small checkpoints; keep flexibility in schedule.'
      };
    default:
      return { overview: 'General guidance', phases: '', watch: '', tips: '' };
  }
}

function looksNonsense(q='') {
  const s=q.trim();
  if (s.length < 3) return true;
  // 자음 반복/랜덤 문자열, 기호 위주 입력, 모음/자음만 등 간단 판정
  if (/^[^a-zA-Z가-힣0-9]+$/.test(s)) return true;
  if (/([a-zA-Z])\1{3,}/.test(s)) return true;
  if (/^[dfghjklqwertyuiopzxcvbnm]{6,}$/i.test(s)) return true;
  return false;
}

export default async function handler(req) {
  let body={};
  if (req.method === 'GET') {
    const url=new URL(req.url);
    body.topic=url.searchParams.get('topic');
    body.q=url.searchParams.get('q');
  } else if (req.method === 'POST') {
    try { body=await req.json(); } catch { body={}; }
  } else {
    return json({ ok:false, error:'Method not allowed' }, 405);
  }

  const topic=(body.topic||'').toLowerCase().trim();
  const q=(body.q||'').trim();

  // Topic 우선
  if (topic) {
    const label = LABELS[topic] || 'Your Topic';
    return json({ ok:true, label, topic, output: topicPack(topic) });
  }

  // 자유질문
  if (!q) return json({ ok:false, error:'Please provide a question.' });

  if (looksNonsense(q)) {
    return json({
      ok:true,
      output: "I couldn’t quite understand that. Could you ask in a short, clear sentence?\nFor example: “When is a good month to switch jobs?” or “What should I focus on this quarter?”"
    });
  }

  // 아주 가벼운 의도 분류 (키워드 매칭)
  const low = q.toLowerCase();
  let angle = 'general';
  if (/(money|income|salary|save|wealth|finance)/.test(low)) angle = 'money';
  else if (/(love|relationship|partner|marriage|dating)/.test(low)) angle = 'love';
  else if (/(job|career|work|promotion|switch|change)/.test(low)) angle = 'career';
  else if (/(health|wellness|sleep|diet|exercise)/.test(low)) angle = 'health';
  else if (/(move|relocat|travel|visa|city|country)/.test(low)) angle = 'travel';
  else if (/(study|learn|skill|course)/.test(low)) angle = 'learning';
  else if (/(when|month|timing|window|good time)/.test(low)) angle = 'timing';

  // 톤 통일된 짧은 답
  const replies = {
    money:   "Based on your chart, aim for simple money habits and clear goals. If you’re considering changes, plan by quarters and review monthly. Watch one risk: overextending during “hot” months. A small buffer helps you stay flexible. 💰",
    love:    "Connection improves with warm structure: clear asks, light rituals, and space to recharge. Avoid rushing big steps under pressure; let timing do some work for you. ❤️",
    career:  "Pick a lane that uses your core strengths. Ship small outcomes each week, and validate big moves before committing. If you plan a switch, target a lighter quarter for easier momentum. 🧰",
    health:  "Balance comes from repeatable routines: light daily movement, sleep rhythm, hydration, and season-friendly meals. Watch early signals (energy, mood, digestion) and adjust gently. 🌿",
    travel:  "Moves work best when frictions are low. Batch paperwork, keep a buffer week, and avoid your busiest months. If dates are flexible, choose windows with steady support. ✈️",
    learning:"Depth beats breadth. Choose one theme per quarter, practice weekly, and publish tiny artifacts. Review your focus every 4–6 weeks. 📘",
    timing:  "Think in quarters. Good windows feel lighter—fewer blockers, faster feedback. Don’t overbook “good” months; leave room to adapt. ⏱️",
    general: "Here’s a simple rule of thumb: pick one focus, plan by quarters, and keep a small buffer. Avoid overcommitting before you see real feedback. When in doubt, start with the smallest useful step."
  };
  return json({ ok:true, output: replies[angle] });
}
