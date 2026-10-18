
import { createHash, timingSafeEqual } from 'node:crypto';

const hash = value =>
  createHash('sha256').update(value).digest();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'GET') {
    if (process.env.VERCEL_ENV !== 'preview') {
      return res.status(404).json({
        error: 'Not found'
      });
    }

    const url = process.env.SUPABASE_URL;
    const publishableKey =
      process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!url || !publishableKey) {
      return res.status(503).json({
        error: 'Preview configuration missing'
      });
    }

    try {
      const parsed = new URL(url);

      if (
        parsed.protocol !== 'https:' ||
        !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) ||
        !publishableKey.startsWith('sb_publishable_')
      ) {
        throw new Error('Invalid configuration');
      }

      return res.status(200).json({
        environment: 'preview',
        url: parsed.origin,
        publishableKey
      });
    } catch {
      return res.status(503).json({
        error: 'Invalid Preview configuration'
      });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const {
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    NOMST_UPLOAD_ADMIN_SECRET
  } = process.env;

  if (
    !SUPABASE_URL ||
    !SUPABASE_SECRET_KEY ||
    !NOMST_UPLOAD_ADMIN_SECRET
  ) {
    return res.status(503).json({
      error: '管理服務尚未完成設定'
    });
  }

  const supplied = req.headers['x-nomst-admin-secret'];

  if (typeof supplied !== 'string') {
    return res.status(403).json({
      error: '未授權'
    });
  }

  if (!timingSafeEqual(
    hash(supplied),
    hash(NOMST_UPLOAD_ADMIN_SECRET)
  )) {
    return res.status(403).json({
      error: '未授權'
    });
  }

  try {
    const base = SUPABASE_URL.replace(/\/$/, '');

    const response = await fetch(
      base +
      '/rest/v1/document_upload_storage_audit' +
      '?select=attempt_id,status,storage_check,' +
      'reconciliation_required,created_at&limit=100',
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`
        },
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!response.ok) {
      return res.status(502).json({
        error: '無法查詢上傳異常紀錄'
      });
    }

    const records = await response.json();

    return res.status(200).json({
      ok: true,
      count: records.length,
      records
    });

  } catch {
    return res.status(503).json({
      error: '核對服務暫時無法使用'
    });
  }
}
