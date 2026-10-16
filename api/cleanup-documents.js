
const BUCKET = 'nomst-private-documents';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // 只允許後端管理員使用
  const secret = process.env.CLEANUP_SECRET;
  const auth = req.headers.authorization;

  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const {
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({
      error: 'Missing server configuration'
    });
  }

  try {
    const base = SUPABASE_URL.replace(/\/$/, '');

    const headers = {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`
    };

    const now = new Date().toISOString();

    // 取得已到期的暫存證件
    const temporaryUrl =
      `${base}/rest/v1/rental_document_uploads` +
      `?status=eq.temporary` +
      `&expires_at=lte.${encodeURIComponent(now)}` +
      `&deleted_at=is.null` +
      `&select=id,storage_path,expires_at` +
      `&limit=100`;

    const response = await fetch(temporaryUrl, {
      headers
    });

    if (!response.ok) {
      throw new Error('Database query failed');
    }

    const expired = await response.json();

    return res.status(200).json({
      ok: true,
      mode: 'dry-run',
      bucket: BUCKET,
      checkedAt: now,
      expiredTemporaryCount: expired.length,
      expiredTemporaryIds: expired.map(item => item.id),
      moreMayExist: expired.length === 100,
      note: 'No files or records were deleted.'
    });

  } catch (error) {
    console.error('Cleanup preview failed', error.message);

    return res.status(500).json({
      error: 'Cleanup preview failed'
    });
  }
}
