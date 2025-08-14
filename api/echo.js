// api/echo.js
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // 특정 도메인만 허용하고 싶으면 * 대신 입력
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  setCORS(res);

  // 브라우저의 사전검사(OPTIONS) 요청 허용
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // GET: 쿼리로 테스트
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      method: 'GET',
      query: req.query || {},
      time: new Date().toISOString()
    });
  }

  // POST: JSON 본문 테스트
  if (req.method === 'POST') {
    try {
      const body = req.body || {}; // Vercel Node 핸들러는 body가 파싱되어 들어옵니다.
      return res.status(200).json({
        ok: true,
        method: 'POST',
        body,
        time: new Date().toISOString()
      });
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'Invalid JSON' });
    }
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return res.status(405).json({ ok: false, error: 'Use GET or POST' });
};
