// api/echo.js
module.exports = async (req, res) => {
  // 쿼리스트링 ?name=Sura 처럼 GET 테스트도 가능하게
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      method: 'GET',
      query: req.query || {},
      time: new Date().toISOString()
    });
  }

  // POST(JSON) 테스트
  if (req.method === 'POST') {
    try {
      // Vercel 서버리스는 body 이미 파싱됨
      const body = req.body || {};
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

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Use GET or POST' });
};
