
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (process.env.VERCEL_ENV !== 'preview') {
    return res.status(404).json({
      ok: false,
      error: 'Not found'
    });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    return res.status(503).json({
      ok: false,
      database: 'not_configured'
    });
  }

  try {
    const parsed = new URL(url);

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
        method: 'GET',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      }
    );

    return res.status(response.ok ? 200 : 503).json({
      ok: response.ok,
      database: response.ok ? 'connected' : 'connection_failed',
      environment: 'preview'
    });
  } catch {
    return res.status(503).json({
      ok: false,
      database: 'connection_failed'
    });
  }
}
