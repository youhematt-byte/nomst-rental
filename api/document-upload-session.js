
import { randomBytes, randomUUID, createHash } from 'node:crypto';

const hashToken = value =>
  createHash('sha256').update(value).digest('hex');

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: '僅接受 POST'
    });
  }

  // 正式啟用前保持關閉
  if (process.env.NOMST_ENABLE_DOCUMENT_UPLOAD !== 'true') {
    return res.status(503).json({
      error: '證件上傳功能尚未開放'
    });
  }

  const {
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({
      error: '服務設定不完整'
    });
  }

  const requestId = req.body?.requestId;
  const authorizationToken = req.body?.authorizationToken;

  if (typeof requestId !== 'string' ||
      !UUID_V4.test(requestId)) {
    return res.status(400).json({
      error: '預約編號格式錯誤'
    });
  }

  if (typeof authorizationToken !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(authorizationToken)) {
    return res.status(403).json({
      error: '預約草稿授權憑證無效'
    });
  }

  const base = SUPABASE_URL.replace(/\/$/, '');
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    const authorizationHash = hashToken(authorizationToken);

    // 原子性核發必須由資料庫函式完成：
    // 同時驗證草稿、消耗授權並建立工作階段。
    // 在該函式完成前，禁止核發憑證。
    const response = await fetch(
      `${base}/rest/v1/rpc/issue_document_upload_session`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_request_id: requestId,
          p_authorization_hash: authorizationHash,
          p_session_id: randomUUID(),
          p_token_hash: hashToken(
            authorizationToken + ':session'
          )
        })
      }
    );

    if (!response.ok) {
      console.error('Session issuance failed', response.status);
      return res.status(503).json({
        error: '上傳授權服務尚未準備完成'
      });
    }

    // 目前不回傳上傳憑證：
    // 等資料庫函式完成並驗證回傳契約後再開放。
    return res.status(503).json({
      error: '上傳授權流程尚未正式開放'
    });

  } catch (error) {
    console.error('Upload session error', error?.message);
    return res.status(500).json({
      error: '上傳授權服務暫時無法使用'
    });
  }
}
