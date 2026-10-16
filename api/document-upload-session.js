
import { randomBytes, createHash, randomUUID } from 'node:crypto';

const hashToken = token =>
  createHash('sha256').update(token).digest('hex');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '僅接受 POST' });
  }

  // 授權流程尚未整合完成，預設保持關閉
  if (process.env.NOMST_ENABLE_DOCUMENT_UPLOAD !== 'true') {
    return res.status(503).json({
      error: '證件上傳功能尚未開放'
    });
  }

  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({ error: '服務設定不完整' });
  }

  try {
    const requestId = req.body?.requestId;

    if (
      typeof requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    ) {
      return res.status(400).json({
        error: '預約編號格式錯誤'
      });
    }

    const token = randomBytes(32).toString('hex');
    const sessionId = randomUUID();
    const expiresAt = new Date(
      Date.now() + 15 * 60 * 1000
    ).toISOString();

    const base = SUPABASE_URL.replace(/\/$/, '');

    const response = await fetch(
      `${base}/rest/v1/document_upload_sessions`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          id: sessionId,
          request_id: requestId,
          token_hash: hashToken(token),
          max_uploads: 2,
          upload_count: 0,
          expires_at: expiresAt
        })
      }
    );

    if (!response.ok) {
      console.error('Upload session creation failed', response.status);
      return res.status(502).json({
        error: '無法建立上傳工作階段'
      });
    }

    return res.status(200).json({
      ok: true,
      requestId,
      uploadToken: token,
      expiresAt
    });

  } catch (error) {
    console.error('Upload session error', error?.message);
    return res.status(500).json({
      error: '暫時無法建立上傳工作階段'
    });
  }
}
