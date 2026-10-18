
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const allowed = new Set([
  'mark_returned',
  'mark_charges_settled',
  'mark_contract_ended',
  'confirm_no_dispute',
  'open_dispute',
  'resolve_dispute',
  'close',
  'hold',
  'release_hold'
]);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      code: 'METHOD_NOT_ALLOWED'
    });
  }

  if (process.env.NOMST_ENABLE_CLOSURE_ADMIN !== 'true') {
    return res.status(503).json({
      ok: false,
      code: 'CLOSURE_ADMIN_DISABLED'
    });
  }

  const token = req.headers.authorization;

  if (
    typeof token !== 'string' ||
    !/^Bearer [A-Za-z0-9._~-]+$/.test(token)
  ) {
    return res.status(401).json({
      ok: false,
      code: 'AUTH_REQUIRED'
    });
  }

  const body = req.body || {};

  if (
    !UUID.test(body.requestId || '') ||
    !allowed.has(body.action)
  ) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_REQUEST'
    });
  }

  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!base || !key) {
    return res.status(503).json({
      ok: false,
      code: 'CONFIG_MISSING'
    });
  }

  try {
    const response = await fetch(
      `${base.replace(/\/$/, '')}/rest/v1/rpc/nomst_apply_closure_action`,
      {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_request_id: body.requestId,
          p_action: body.action
        }),
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        code: 'CLOSURE_RPC_FAILED'
      });
    }

    const success = await response.json();

    return res.status(success === true ? 200 : 403).json({
      ok: success === true,
      code: success === true
        ? 'CLOSURE_UPDATED'
        : 'CLOSURE_DENIED'
    });

  } catch {
    return res.status(503).json({
      ok: false,
      code: 'CLOSURE_SERVICE_UNAVAILABLE'
    });
  }
}
