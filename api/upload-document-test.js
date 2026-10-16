
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  // 此測試端點始終禁止實際上傳
  // 即使正式上傳開關被誤設為 true
  if (
    process.env.NOMST_ENABLE_DOCUMENT_UPLOAD
      !== 'true'
  ) {
    return res.status(503).json({
      ok: false,
      code: 'DOCUMENT_UPLOAD_DISABLED',
      error: '證件上傳測試功能尚未開放'
    });
  }

  const { SUPABASE_URL, SUPABASE_SECRET_KEY } =
    process.env;

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({
      ok: false,
      error: '服務設定不完整'
    });
  }

  const { requestId, uploadToken } = req.body || {};

  if (
    typeof requestId !== 'string' ||
    !UUID_V4.test(requestId)
  ) {
    return res.status(400).json({
      ok: false,
      error: '預約編號格式錯誤'
    });
  }

  if (
    typeof uploadToken !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(uploadToken)
  ) {
    return res.status(401).json({
      ok: false,
      error: '上傳授權憑證格式錯誤'
    });
  }

  // 目前不呼叫資料庫，也不接收證件
  return res.status(503).json({
    ok: false,
    code: 'UPLOAD_NOT_IMPLEMENTED',
    error: '尚未啟用實際證件上傳'
  });
}
