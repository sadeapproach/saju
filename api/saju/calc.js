// api/saju/calc.js
// 클라이언트가 보낸 생년월일/시간/좌표/타임존을 받아
// (나중에) 외부 사주 API에 전달할 "프록시" 뼈대입니다.
// 지금은 모의 응답(Mock)을 돌려서 형식/흐름만 확인합니다.
// CORS 및 OPTIONS(사전검사) 처리 포함.

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // 필요시 특정 도메인으로 변경
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  setCORS(res);

  // 브라우저의 사전검사(OPTIONS) 요청 허용
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }

  // JSON 본문 받기 (Hoppscotch에서 Content-Type: application/json 필요)
  const { birthDateISO, birthTime, lat, lng, tzId, timeAccuracy = 'exact' } = req.body || {};

  // 필수값 체크
  if (!birthDateISO || lat == null || lng == null || !tzId) {
    return res.status(400).json({
      ok: false,
      error: 'Missing fields: birthDateISO, lat, lng, tzId'
    });
  }

  // TODO: 여기서 실제 사주 API를 fetch로 호출하면 됩니다.
  // 예시:
  // const r = await fetch(process.env.RAPIDAPI_SAJU_URL, {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'X-RapidAPI-Key': process.env.RAPIDAPI_KEY
  //   },
  //   body: JSON.stringify({ birthDateISO, birthTime, lat, lng, tzId, timeAccuracy })
  // });
  // const data = await r.json();

  // ---- 모의 응답(Mock) : 지금은 형태/흐름 테스트용 ----
  const data = {
    pillars: {
      year:  { stem: '壬', branch: '申' },
      month: { stem: '丙', branch: '午' },
      day:   { stem: '乙', branch: '巳' },
      hour:  { stem: birthTime ? '癸' : '—', branch: birthTime ? '巳' : '—' }
    },
    elements: { wood: 0.32, fire: 0.28, earth: 0.14, metal: 0.16, water: 0.10 },
    bigLuck: [{ startYear: 2026, note: 'Growth cycle begins' }]
  };

  return res.status(200).json({
    ok: true,
    input: { birthDateISO, birthTime, lat, lng, tzId, timeAccuracy },
    data
  });
};
