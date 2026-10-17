
import { createHash, timingSafeEqual } from 'node:crypto';

const hash = value =>
  createHash('sha256').update(value).digest();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (process.env.VERCEL_ENV !== 'preview') {
    return res.status(404).json({
      ok: false,
      error: 'Not found'
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      ok: false,
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
      ok: false,
      database: 'not_configured'
    });
  }

  const supplied = req.headers['x-nomst-admin-secret'];

  if (typeof supplied !== 'string') {
    return res.status(403).json({
      ok: false,
      error: 'Unauthorized'
    });
  }

  const a = hash(supplied);
  const b = hash(NOMST_UPLOAD_ADMIN_SECRET);

  if (!timingSafeEqual(a, b)) {
    return res.status(403).json({
      ok: false,
      error: 'Unauthorized'
    });
  }

  try {
    const parsed = new URL(SUPABASE_URL);

    if (
      parsed.protocol !== 'https:' ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname)
    ) {
      return res.status(503).json({
        ok: false,
        database: 'invalid_configuration'
      });
    }

    const response = await fetch(
      `${parsed.origin}/rest/v1/rental_bookings?select=id&limit=0`,
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      }
    );

    return res.status(response.ok ? 200 : 503).json({
      ok: response.ok,
      database: response.ok
        ? 'connected'
        : 'connection_failed',
      environment: 'preview'
    });

  } catch {
    return res.status(503).json({
      ok: false,
      database: 'connection_failed'
    });
  }
}
