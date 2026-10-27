import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';

// Staging-only reservation test endpoint. NOT a public customer booking API.
// Requires explicit staging enablement and a server-side operator secret.
const DEVICE = 'VIVO-X300-PRO-1TB-001';
const DAY = 86400000;
const digest = x => createHash('sha256').update(x).digest();
function date(s) {
  if(typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(s+'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0,10)===s ? t : null;
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') {res.setHeader('Allow','POST');return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});}
  if(process.env.NOMST_V2_STAGING_WRITES!=='true') return res.status(503).json({ok:false,code:'STAGING_WRITES_DISABLED'});
  const secret=process.env.NOMST_V2_OPERATOR_SECRET;
  const supplied=req.headers.authorization;
  if(!secret || typeof supplied!=='string' || !supplied.startsWith('Bearer ') ||
    !timingSafeEqual(digest(supplied.slice(7)),digest(secret)))
    return res.status(401).json({ok:false,code:'UNAUTHORIZED'});
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))
    return res.status(415).json({ok:false,code:'JSON_REQUIRED'});
  const b=req.body;
  if(!b || typeof b!=='object' || Array.isArray(b) || Object.keys(b).some(k=>!['start','end'].includes(k)))
    return res.status(400).json({ok:false,code:'INVALID_REQUEST'});
  const a=date(b.start),z=date(b.end);
  if(a===null || z===null || z<a || (z-a)/DAY>=30)
    return res.status(400).json({ok:false,code:'INVALID_DATES'});
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const p=k=>parts.find(x=>x.type===k)?.value;
  if(a<date(p('year')+'-'+p('month')+'-'+p('day')))
    return res.status(400).json({ok:false,code:'PAST_DATE'});
  const {SUPABASE_URL,SUPABASE_SECRET_KEY}=process.env;
  if(!SUPABASE_URL || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL) || !SUPABASE_SECRET_KEY)
    return res.status(503).json({ok:false,code:'CONFIGURATION_ERROR'});
  const id=randomUUID();
  try {
    const r=await fetch(SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/nomst_v2_reservations',{
      method:'POST',
      headers:{apikey:SUPABASE_SECRET_KEY,Authorization:'Bearer '+SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'return=minimal'},
      body:JSON.stringify({id,device_code:DEVICE,start_date:b.start,end_date:b.end,status:'pending'}),
      signal:AbortSignal.timeout(8000)
    });
    if(r.status===409) return res.status(409).json({ok:false,code:'DATE_UNAVAILABLE'});
    if(!r.ok){console.error('V2 staging reservation HTTP',r.status);return res.status(503).json({ok:false,code:'RESERVATION_UNAVAILABLE'});}
    return res.status(201).json({ok:true,mode:'staging-only',reservationId:id,status:'pending',customerBooking:false,paymentAccepted:false});
  }catch(e){console.error('V2 staging reservation uncertain',e?.name);return res.status(503).json({ok:false,code:'RESERVATION_RESULT_UNCERTAIN',reservationId:id,message:'Do not retry without reconciling this ID.'});}
}