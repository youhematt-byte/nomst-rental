
import { randomBytes, randomUUID, createHash } from 'node:crypto';

const hash = value =>
  createHash('sha256').update(value).digest('hex');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: '僅接受 POST'
    });
  }

  // 安全開關：測試完成前不開放
  if (process.env.NOMST_ENABLE_DOCUMENT_UPLOAD !== 'true') {
    return res.status(503).json({
      error: '預約證件上傳尚未開放'
    });
  }

  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({
      error: '服務設定不完整'
    });
  }

  try {
    const requestId = randomUUID();
    const authorizationToken = randomBytes(32).toString('hex');

    const base = SUPABASE_URL.replace(/\/$/, '');

    const response = await fetch(
      `${base}/rest/v1/rental_booking_drafts`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          request_id: requestId,
          authorization_hash: hash(authorizationToken),
          status: 'pending'
        })
      }
    );

    if (!response.ok) {
      console.error('Draft creation failed', response.status);
      return res.status(502).json({
        error: '無法建立預約草稿'
      });
    }

    return res.status(200).json({
      ok: true,
      requestId,
      authorizationToken,
      message: '預約草稿已建立'
    });

  } catch (error) {
    console.error('Draft creation error', error?.message);
    return res.status(500).json({
      error: '暫時無法建立預約草稿'
    });
  }
}
