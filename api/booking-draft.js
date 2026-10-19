

const { randomBytes, randomUUID, createHash } = require('node:crypto');

const hash = value =>
  createHash('sha256').update(value).digest('hex');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: '僅接受 POST'
    });
  }

  // 安全開關：測試完成前不開放


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

    // 從 Vercel 提供的請求資訊取得來源 IP
    const ip = req.headers['x-vercel-forwarded-for'];

    if (typeof ip !== 'string' || !ip.trim()) {
      return res.status(403).json({
        error: '無法驗證請求來源'
      });
    }

    // 避免在資料庫儲存原始 IP
    const ipHash = createHash('sha256')
      .update(ip.trim())
      .digest('hex');

    // 呼叫 Supabase 原子性限流函式
    const limitResponse = await fetch(
      `${base}/rest/v1/rpc/check_rental_draft_rate_limit`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_ip_hash: ipHash
        })
      }
    );

    if (!limitResponse.ok) {
      return res.status(503).json({
        error: '預約驗證服務暫時無法使用'
      });
    }

    const allowed = await limitResponse.json();

    if (allowed !== true) {
      return res.status(429).json({
        error: '操作過於頻繁，請 10 分鐘後再試'
      });
    }

    const response = await fetch(
      `${base}/rest/v1/rental_booking_drafts`,
      {
        method: 'POST',
        headers: {
apikey: SUPABASE_SECRET_KEY,
'Content-Type': 'application/json'
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
