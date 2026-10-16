
import { randomBytes, randomUUID, createHash } from 'node:crypto';

const hash = value =>
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

  if (process.env.NOMST_ENABLE_DOCUMENT_UPLOAD !== 'true') {
    return res.status(503).json({
      error: '證件上傳功能尚未開放'
    });
  }

  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({
      error: '服務設定不完整'
    });
  }

  const requestId = req.body?.requestId;
  const authorizationToken = req.body?.authorizationToken;

  if (typeof requestId !== 'string' || !UUID_V4.test(requestId)) {
    return res.status(400).json({
      error: '預約編號格式錯誤'
    });
  }

  if (
    typeof authorizationToken !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(authorizationToken)
  ) {
    return res.status(403).json({
      error: '預約草稿授權憑證無效'
    });
  }

  const uploadToken = randomBytes(32).toString('hex');
  const sessionId = randomUUID();
  const base = SUPABASE_URL.replace(/\/$/, '');

  try {
    const response = await fetch(
      `${base}/rest/v1/rpc/issue_document_upload_session`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_request_id: requestId,
          p_authorization_hash: hash(authorizationToken),
          p_session_id: sessionId,
          p_token_hash: hash(uploadToken)
        })
      }
    );

    if (!response.ok) {
      console.error('Session issuance failed', response.status);
      return res.status(503).json({
        error: '上傳授權服務暫時無法使用'
      });
    }

    const issued = await response.json();

    if (issued !== true) {
      return res.status(403).json({
        error: '草稿授權無效、已過期或已使用'
      });
    }

    return res.status(200).json({
      ok: true,
      requestId,
      uploadToken,
      expiresAt: new Date(
        Date.now() + 15 * 60 * 1000
      ).toISOString()
    });

  } catch (error) {
    console.error('Upload session error', error?.message);
    return res.status(500).json({
      error: '上傳授權服務暫時無法使用'
    });
  }
}
