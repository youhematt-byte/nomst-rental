
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      ok: false,
      code: 'METHOD_NOT_ALLOWED'
    });
  }

  // 獨立測試開關，不使用正式上傳開關
  if (
    process.env.NOMST_ENABLE_AUTH_TEST !== 'true'
  ) {
    return res.status(503).json({
      ok: false,
      code: 'AUTH_TEST_DISABLED'
    });
  }

  // 禁止檔案資料進入此測試 API
  const body = req.body;

  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some(key =>
      !['requestId', 'uploadToken'].includes(key)
    )
  ) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_TEST_REQUEST'
    });
  }

  const { requestId, uploadToken } = body;

  if (
    typeof requestId !== 'string' ||
    !UUID_V4.test(requestId)
  ) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_REQUEST_ID'
    });
  }

  if (
    typeof uploadToken !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(uploadToken)
  ) {
    return res.status(401).json({
      ok: false,
      code: 'INVALID_TOKEN_FORMAT'
    });
  }

  // 僅驗證格式，不查詢憑證是否有效
  // 不預留次數、不寫入資料庫或 Storage
  return res.status(200).json({
    ok: true,
    code: 'FORMAT_VALID_ONLY',
    message: '格式正確，尚未驗證授權'
  });
}
