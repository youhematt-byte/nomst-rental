
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: '僅接受 POST 請求'
    });
  }

  return res.status(503).json({
    ok: false,
    error: '證件上傳授權尚未開放'
  });
}
