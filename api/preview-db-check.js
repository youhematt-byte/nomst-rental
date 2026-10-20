
const { timingSafeEqual } = require('node:crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (process.env.VERCEL_ENV !== 'preview') {
    return res.status(404).json({ ok: false });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  const secret = process.env.NOMST_PREVIEW_DIAGNOSTIC_SECRET;
  const supplied = req.headers['x-nomst-diagnostic-secret'];

  if (!secret || typeof supplied !== 'string') {
    return res.status(403).json({ ok: false });
  }

  const a = Buffer.from(secret);
  const b = Buffer.from(supplied);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(403).json({ ok: false });
  }

  const url = process.env.SUPABASE_URL;
  const expected = process.env.NOMST_EXPECTED_STAGING_REF;

  if (!url || !expected) {
    return res.status(503).json({
      ok: false,
      error: '診斷設定不完整'
    });
  }

  try {
    const host = new URL(url).hostname;
    const actualRef = host.endsWith('.supabase.co')
      ? host.slice(0, -'.supabase.co'.length)
      : '';

    return res.status(200).json({
      ok: true,
      environment: 'preview',
      matchesExpectedStaging: actualRef === expected
    });
  } catch {
    return res.status(503).json({
      ok: false,
      error: '資料庫網址格式不正確'
    });
  }
};
