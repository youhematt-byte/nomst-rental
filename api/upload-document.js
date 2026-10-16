
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      ok: false,
      error: '僅接受 POST'
    });
  }

  return res.status(503).json({
    ok: false,
    code: 'DOCUMENT_UPLOAD_DISABLED',
    error: '證件上傳功能尚未正式開放'
  });
}
