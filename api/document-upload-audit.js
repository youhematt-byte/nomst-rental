
import { createHash, timingSafeEqual } from 'node:crypto';

const hash = value =>
  createHash('sha256').update(value).digest();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: '僅接受 POST'
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

  const a = hash(supplied);
  const b = hash(NOMST_UPLOAD_ADMIN_SECRET);

  if (!timingSafeEqual(a, b)) {
    return res.status(403).json({
      error: '未授權'
    });
  }

  try {
    const base = SUPABASE_URL.replace(/\/$/, '');

    const response = await fetch(
      `${base}/rest/v1/document_upload_storage_audit` +
      '?select=attempt_id,status,storage_check,' +
      'reconciliation_required,created_at' +
      '&limit=100',
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`
        }
      }
    );

    if (!response.ok) {
      console.error('Audit query failed', response.status);
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

  } catch (error) {
    console.error('Audit service error', error?.message);
    return res.status(500).json({
      error: '核對服務暫時無法使用'
    });
  }
}
