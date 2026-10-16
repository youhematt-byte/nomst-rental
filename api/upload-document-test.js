
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

  if (process.env.NOMST_ENABLE_DOCUMENT_UPLOAD !== 'true') {
    return res.status(503).json({
      ok: false,
      code: 'DOCUMENT_UPLOAD_DISABLED',
      error: '證件上傳測試功能尚未開放'
    });
  }

  return res.status(503).json({
    ok: false,
    code: 'UPLOAD_NOT_IMPLEMENTED',
    error: '安全上傳流程尚未完成'
  });
}
