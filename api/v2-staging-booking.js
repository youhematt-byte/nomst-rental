import { createHash, timingSafeEqual } from 'node:crypto';

// NOM.ST_ V2 STAGING ONLY. Not a public customer submission endpoint.
// Requires staging gate, operator bearer secret AND single-use submission token. Never expose operator secret in browser.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=s=>createHash('sha256').update(s).digest();
const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});}
  if(process.env.NOMST_V2_STAGING_WRITES!=='true')return res.status(503).json({ok:false,code:'STAGING_DISABLED'});
  const secret=process.env.NOMST_V2_OPERATOR_SECRET;
  const auth=req.headers.authorization;
  if(!secret||typeof auth!=='string'||!auth.startsWith('Bearer ')||
    !timingSafeEqual(hash(auth.slice(7)),hash(secret)))
    return res.status(401).json({ok:false,code:'UNAUTHORIZED'});
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))
    return res.status(415).json({ok:false,code:'JSON_REQUIRED'});
  const b=req.body;
  const keys=['submissionToken','requestId','start','end','name','email','phone','ig','purpose','delivery','location','verification','lens','grip','policyVersion'];
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!keys.includes(k)))
    return res.status(400).json({ok:false,code:'INVALID_REQUEST'});
  const string=(x,n)=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=n;
  if(typeof b.submissionToken!=='string'||!/^[0-9a-f]{64}$/i.test(b.submissionToken)||!UUID.test(b.requestId||'')||!day(b.start)||!day(b.end)||b.end<b.start||
     (Date.parse(b.end+'T00:00:00Z')-Date.parse(b.start+'T00:00:00Z'))/86400000>=30||
     !string(b.name,80)||!string(b.email,254)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)||
     !/^09\d{8}$/.test(b.phone||'')||!string(b.ig,80)||!string(b.purpose,160)||
     !string(b.location,200)||!string(b.policyVersion,40)||
     typeof b.lens!=='boolean'||typeof b.grip!=='boolean'||
     !((b.delivery==='meet'&&b.verification==='in_person')||
       (b.delivery==='ship'&&['docs','phone','none'].includes(b.verification))))
    return res.status(400).json({ok:false,code:'INVALID_FIELDS'});
  const {SUPABASE_URL,SUPABASE_SECRET_KEY}=process.env;
  if(!SUPABASE_URL||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL)||!SUPABASE_SECRET_KEY)
    return res.status(503).json({ok:false,code:'CONFIGURATION_ERROR'});
  try{
    const upstream=await fetch(SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/nomst_v2_submit_authorized',{
      method:'POST',headers:{apikey:SUPABASE_SECRET_KEY,Authorization:'Bearer '+SUPABASE_SECRET_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        p_token_hash:hash(b.submissionToken.toLowerCase()).toString('hex'),
        p_id:b.requestId,p_device_code:'VIVO-X300-PRO-1TB-001',
        p_start:b.start,p_end:b.end,p_name:b.name,p_email:b.email,p_phone:b.phone,
        p_ig:b.ig,p_purpose:b.purpose,p_fulfillment:b.delivery,p_location:b.location,
        p_verification:b.verification,p_lens:b.lens,p_grip:b.grip,p_policy_version:b.policyVersion
      }),signal:AbortSignal.timeout(10000)
    });
    if(upstream.status===409)return res.status(409).json({ok:false,code:'DATE_UNAVAILABLE_OR_DUPLICATE',requestId:b.requestId});
    if(!upstream.ok){
      // PostgreSQL exclusion violation 23P01 can be surfaced as HTTP 400.
      const err=await upstream.json().catch(()=>({}));
      if(err.code==='23P01'||err.code==='23505')return res.status(409).json({ok:false,code:'DATE_UNAVAILABLE_OR_DUPLICATE',requestId:b.requestId});
      if(err.code==='22023'||err.code==='23514')return res.status(403).json({ok:false,code:'INVALID_OR_EXPIRED_SUBMISSION',requestId:b.requestId});
      console.error('V2 staging booking RPC',upstream.status,err.code);
      return res.status(503).json({ok:false,code:'BOOKING_UNAVAILABLE',requestId:b.requestId});
    }
    const id=await upstream.json();
    if(id!==b.requestId)return res.status(503).json({ok:false,code:'RESULT_UNCERTAIN',requestId:b.requestId});
    return res.status(201).json({ok:true,mode:'staging-only',requestId:id,bookingStatus:'pending',customerBookingEnabled:false,paymentAccepted:false});
  }catch(e){
    console.error('V2 booking result uncertain',e?.name);
    return res.status(503).json({ok:false,code:'RESULT_UNCERTAIN',requestId:b.requestId,message:'Reconcile by requestId; do not retry blindly.'});
  }
}