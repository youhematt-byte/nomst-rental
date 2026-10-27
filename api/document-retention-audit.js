
import { createHash, timingSafeEqual } from 'node:crypto';

const PAGE_LIMIT = 100;
const MAX_PAGES = 10;
const DAY_MS = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const digest = value =>
  createHash('sha256').update(value).digest();

function parseDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return null;
  }
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) &&
    new Date(ms).toISOString().slice(0, 10) === value
    ? ms : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      ok: false, code: 'METHOD_NOT_ALLOWED'
    });
  }

  const secret = process.env.RETENTION_AUDIT_SECRET;
  const supplied = req.headers.authorization;

  if (
    !secret ||
    typeof supplied !== 'string' ||
    !supplied.startsWith('Bearer ') ||
    !timingSafeEqual(digest(supplied.slice(7)), digest(secret))
  ) {
    return res.status(401).json({
      ok: false, code: 'UNAUTHORIZED'
    });
  }

  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

  if (
    !SUPABASE_URL ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL) ||
    !SUPABASE_SECRET_KEY
  ) {
    return res.status(503).json({
      ok: false, code: 'CONFIGURATION_ERROR'
    });
  }

  const base = SUPABASE_URL.replace(/\/$/, '');
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`
  };

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const todayMs = parseDate(today);

  if (todayMs === null) {
    return res.status(503).json({
      ok: false, code: 'DATE_ERROR'
    });
  }

  async function getRows(path) {
    const response = await fetch(`${base}/rest/v1/${path}`, {
      headers,
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      throw new Error(`SUPABASE_HTTP_${response.status}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) {
      throw new Error('INVALID_QUERY_RESULT');
    }
    return rows;
  }

  try {
    let scanned = 0;
    let reached30Days = 0;
    let needsReview = 0;
    let cancelledExcluded = 0;
    let moreMayExist = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        select: 'request_id,end_date,status',
        end_date: `lte.${today}`,
        order: 'end_date.asc,request_id.asc',
        limit: String(PAGE_LIMIT),
        offset: String(page * PAGE_LIMIT)
      });

      const inventory = await getRows(
        `nomst_rental_inventory?${params}`
      );

      scanned += inventory.length;

      for (const item of inventory) {
        if (
          !UUID_RE.test(item.request_id || '') ||
          parseDate(item.end_date) === null
        ) {
          needsReview++;
          continue;
        }

        if (item.status === 'cancelled') {
          cancelledExcluded++;
          continue;
        }

        if (!['pending', 'confirmed', 'completed'].includes(item.status)) {
          needsReview++;
          continue;
        }

        const bookingParams = new URLSearchParams({
          select: 'booking_status',
          request_id: `eq.${item.request_id}`,
          limit: '2'
        });

        const bookings = await getRows(
          `rental_bookings?${bookingParams}`
        );

        if (bookings.length !== 1) {
          needsReview++;
          continue;
        }

        if (bookings[0].booking_status === 'cancelled') {
          cancelledExcluded++;
          continue;
        }

        if (!['pending', 'confirmed'].includes(
          bookings[0].booking_status
        )) {
          needsReview++;
          continue;
        }

        const endMs = parseDate(item.end_date);

        // Calendar-day threshold in Asia/Taipei.
        // This is an audit signal, never deletion approval.
        if (todayMs - endMs >= 30 * DAY_MS) {
          reached30Days++;
        }
      }

      if (inventory.length < PAGE_LIMIT) break;

      if (page === MAX_PAGES - 1) {
        moreMayExist = true;
      }
    }

    return res.status(200).json({
      ok: true,
      mode: 'read-only',
      scannedInventory: scanned,
      bookingsPast30DayThreshold: reached30Days,
      cancelledExcluded,
      recordsNeedingReview: needsReview,
      moreMayExist,
      deletionAuthorized: false,
      note: 'Audit only. Closure, disputes, holds and document retention must be verified separately. No files were read or deleted.'
    });

  } catch (error) {
    console.error('Retention audit failed', error?.message);
    return res.status(502).json({
      ok: false,
      code: 'RETENTION_AUDIT_FAILED'
    });
  }
}
