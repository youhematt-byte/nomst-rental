import { createHash, timingSafeEqual } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest();
const isUuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});
  }
  const secret = process.env.RETENTION_AUDIT_SECRET;
  const header = req.headers.authorization;
  if (!secret || typeof header !== 'string' || !header.startsWith('Bearer ') ||
      !timingSafeEqual(digest(header.slice(7)), digest(secret))) {
    return res.status(401).json({ok:false,code:'UNAUTHORIZED'});
  }
  const {SUPABASE_URL, SUPABASE_SECRET_KEY} = process.env;
  if (!SUPABASE_URL || !/^https:\/\//.test(SUPABASE_URL) || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({ok:false,code:'CONFIGURATION_ERROR'});
  }
  // No file contents, storage paths or customer identifiers are returned.
  // This is a conservative audit, NOT a deletion authorization.
  const base = SUPABASE_URL.replace(/\/$/, '');
  const headers = {apikey:SUPABASE_SECRET_KEY,Authorization:`Bearer ${SUPABASE_SECRET_KEY}`};
  const taipeiDate = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date());
  const today = taipeiDate;
  try {
    let scanned = 0;
    let reached30Days = 0;
    let needsReview = 0;
    let moreMayExist = false;
    for (let page=0; page<MAX_PAGES; page++) {
      const offset = page * PAGE_LIMIT;
      const url = `${base}/rest/v1/rental_bookings?select=request_id,rental_end` +
        `&rental_end=lte.${today}&order=rental_end.asc,request_id.asc` +
        `&limit=${PAGE_LIMIT}&offset=${offset}`;
      const r = await fetch(url, {headers});
      if (!r.ok) throw new Error(`BOOKINGS_HTTP_${r.status}`);
      const bookings = await r.json();
      if (!Array.isArray(bookings)) throw new Error('INVALID_BOOKINGS');
      scanned += bookings.length;
      for (const b of bookings) {
        if (!isUuid(b.request_id) || !/^\d{4}-\d{2}-\d{2}$/.test(b.rental_end || '')) {
          needsReview++; continue;
        }
        const end = Date.parse(`${b.rental_end}T16:00:00Z`);
        if (!Number.isFinite(end)) { needsReview++; continue; }
        if (Date.now() >= end + 30*86400000) reached30Days++;
      }
      if (bookings.length < PAGE_LIMIT) break;
      if (page === MAX_PAGES - 1) moreMayExist = true;
    }
    return res.status(200).json({
      ok:true, mode:'read-only',
      scannedBookings:scanned,
      bookingsPast30DayThreshold:reached30Days,
      malformedRecords:needsReview,
      moreMayExist,
      deletionAuthorized:false,
      note:'Dates alone do not prove return, closure or absence of disputes. No documents were read or deleted.'
    });
  } catch (error) {
    console.error('Retention audit failed',error?.message);
    return res.status(502).json({ok:false,code:'RETENTION_AUDIT_FAILED'});
  }
}
