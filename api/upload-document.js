
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      ok: false,
      error: '僅接受 POST 請求'
    });
  }

  // NOM.ST_ 正式網站安全保護
  // 證件上傳授權流程完成前，禁止公開上傳。
  // 不接收、不儲存任何證件檔案。

  return res.status(503).json({
    ok: false,
    code: 'DOCUMENT_UPLOAD_DISABLED',
    error: '證件上傳功能尚未正式開放',
    message: '請聯絡店家確認證件核實方式'
  });
}
