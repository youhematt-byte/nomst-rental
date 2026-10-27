import { createHash, timingSafeEqual } from 'node:crypto';

// Only expired *temporary* uploads are eligible. Confirmed rental documents
// must use a separate retention policy tied to a verified rental end date.
const BUCKET = 'nomst-private-documents';
const LIMIT = 50;
const sha = value => createHash('sha256').update(value).digest();
const validPath = path => typeof path === 'string' &&
  /^temporary\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});
  }
  const secret = process.env.CLEANUP_SECRET;
  const supplied = req.headers.authorization;
  if (!secret || typeof supplied !== 'string' || !supplied.startsWith('Bearer ') ||
      !timingSafeEqual(sha(supplied.slice(7)), sha(secret))) {
    return res.status(401).json({ok:false,code:'UNAUTHORIZED'});
  }
  // Destructive mode is intentionally blocked pending atomic DB claim/lock.
  // Prevent deletion racing with a document being promoted to a confirmed rental.
  if (req.body?.execute === true) {
    return res.status(503).json({ok:false,code:'ATOMIC_CLEANUP_NOT_IMPLEMENTED'});
  }
  const {SUPABASE_URL, SUPABASE_SECRET_KEY} = process.env;
  if (!SUPABASE_URL || !/^https:\/\//.test(SUPABASE_URL) || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({ok:false,code:'CONFIGURATION_ERROR'});
  }
  // This endpoint is deliberately read-only until an atomic cleanup protocol
  // has been verified against the live database schema.
  const base = SUPABASE_URL.replace(/\/$/, '');
  const headers = {apikey:SUPABASE_SECRET_KEY, Authorization:`Bearer ${SUPABASE_SECRET_KEY}`};
  const now = new Date().toISOString();
  try {
    const url = `${base}/rest/v1/rental_document_uploads?status=eq.temporary` +
      `&expires_at=lte.${encodeURIComponent(now)}&deleted_at=is.null` +
      `&select=id,expires_at&order=expires_at.asc&limit=${LIMIT}`;
    const r = await fetch(url, {headers});
    if (!r.ok) throw new Error(`QUERY_HTTP_${r.status}`);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error('INVALID_QUERY_RESULT');
    return res.status(200).json({
      ok:true,mode:'dry-run',count:rows.length,
      moreMayExist:rows.length===LIMIT,
      note:'No files or records were deleted.'
    });
  } catch (e) {
    console.error('Temporary cleanup audit failed',e?.message);
    return res.status(502).json({ok:false,code:'CLEANUP_AUDIT_FAILED'});
  }
}
