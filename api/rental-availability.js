
const DEVICE_CODE = 'VIVO-X300-PRO-1TB-001';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) &&
    new Date(t).toISOString().slice(0, 10) === value ? t : null;
}

function reply(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return reply(res, 405, {
      ok: false,
      code: 'METHOD_NOT_ALLOWED'
    });
  }

  const { start, end } = req.query || {};
  const startMs = parseDay(start);
  const endMs = parseDay(end);

  if (
    startMs === null ||
    endMs === null ||
    endMs < startMs ||
    (endMs - startMs) / 86400000 + 1 > 30
  ) {
    return reply(res, 400, {
      ok: false,
      code: 'INVALID_DATE_RANGE'
    });
  }

  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !base ||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base) ||
    !key
  ) {
    return reply(res, 503, {
      ok: false,
      code: 'CONFIG_MISSING'
    });
  }

  const params = new URLSearchParams({
    select: 'id',
    device_code: `eq.${DEVICE_CODE}`,
    status: 'in.(pending,confirmed)',
    start_date: `lte.${end}`,
    end_date: `gte.${start}`,
    limit: '1'
  });

  try {
    const upstream = await fetch(
      `${base.replace(/\/$/, '')}/rest/v1/nomst_rental_inventory?${params}`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`
        },
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!upstream.ok) {
      return reply(res, 503, {
        ok: false,
        code: 'AVAILABILITY_UNAVAILABLE'
      });
    }

    const rows = await upstream.json();

    if (!Array.isArray(rows)) {
      return reply(res, 503, {
        ok: false,
        code: 'AVAILABILITY_UNAVAILABLE'
      });
    }

    return reply(res, 200, {
      ok: true,
      available: rows.length === 0,
      device_code: DEVICE_CODE,
      start,
      end
    });
  } catch {
    return reply(res, 503, {
      ok: false,
      code: 'AVAILABILITY_UNAVAILABLE'
    });
  }
}
