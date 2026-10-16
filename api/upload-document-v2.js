
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      ok: false,
      error: '僅接受 POST 請求'
    });
  }

  // NOM.ST_ 證件上傳安全測試版
  //
  // 目前尚未完成：
  // 1. 預約草稿授權與身分核實
  // 2. 上傳次數預留與成功確認
  // 3. 失敗補償及重試
  // 4. 證件與預約安全綁定
  // 5. 過期證件自動刪除
  //
  // 在所有功能完成並通過測試前，
  // 一律禁止接收真實身分證件。
  //
  // 不讀取、不儲存、不記錄上傳檔案，
  // 也不呼叫 Supabase Storage。

  return res.status(503).json({
    ok: false,
    code: 'DOCUMENT_UPLOAD_DISABLED',
    error: '證件上傳功能尚未正式開放',
    message: '目前暫停證件上傳，請聯絡店家。'
  });
}
