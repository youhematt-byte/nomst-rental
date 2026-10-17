import { createHash, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = v => createHash('sha256').update(v).digest();
const allowed = new Set(['mark_returned','close','open_dispute','resolve_dispute','hold','release_hold']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});
  }
  // Explicit second gate. This endpoint cannot be activated by the upload flag.
  if (process.env.NOMST_ENABLE_CLOSURE_ADMIN !== 'true')
    return res.status(503).json({ok:false,code:'CLOSURE_ADMIN_DISABLED'});
  const secret = process.env.NOMST_CLOSURE_ADMIN_SECRET;
  const authorization = req.headers?.authorization;
  if (!secret || secret.length < 32 || typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ') ||
      !timingSafeEqual(sha(secret),sha(authorization.slice(7)))) {
    return res.status(403).json({ok:false,code:'FORBIDDEN'});
  }
  const body=req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      !UUID.test(body.requestId || '') || !allowed.has(body.action)) {
    return res.status(400).json({ok:false,code:'INVALID_REQUEST'});
  }
  const {SUPABASE_URL,SUPABASE_SECRET_KEY}=process.env;
  if (!SUPABASE_URL || !/^https:\/\//.test(SUPABASE_URL) || !SUPABASE_SECRET_KEY)
    return res.status(503).json({ok:false,code:'CONFIGURATION_ERROR'});
  try {
    const response=await fetch(`${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/rpc/nomst_apply_closure_action`,{
      method:'POST',
      headers:{
        apikey:SUPABASE_SECRET_KEY,Authorization:`Bearer ${SUPABASE_SECRET_KEY}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({p_request_id:body.requestId,p_action:body.action})
    });
    if (!response.ok) throw new Error(`RPC_HTTP_${response.status}`);
    const accepted=await response.json();
    if (accepted !== true)
      return res.status(409).json({ok:false,code:'TRANSITION_NOT_ALLOWED'});
    return res.status(200).json({ok:true,code:'CLOSURE_UPDATED'});
  } catch(err) {
    console.error('Closure update failed',err?.message);
    return res.status(503).json({ok:false,code:'CLOSURE_UPDATE_UNAVAILABLE'});
  }
}
