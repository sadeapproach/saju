// api/hello.js
module.exports = async (req, res) => {
  res.status(200).json({
    ok: true,
    message: "Hello from Vercel 👋",
    time: new Date().toISOString()
  });
};
