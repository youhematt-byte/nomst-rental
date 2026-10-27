// NOM.ST_ 2.0: staging inventory availability only.
// Uses the SAME v2 table and device as the staging reservation writer.
// Never use this result to claim production inventory availability.
const DEVICE='VIVO-X300-PRO-1TB-001';
const DAY=86400000;
function day(s){
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
  const t=Date.parse(s+'T00:00:00Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?t:null;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});}
  if(process.env.NOMST_V2_STAGING_WRITES!=='true')
    return res.status(503).json({ok:false,code:'V2_STAGING_NOT_ENABLED'});
  const {start,end}=req.query||{},a=day(start),z=day(end);
  if(a===null||z===null||z<a||(z-a)/DAY>=30)
    return res.status(400).json({ok:false,code:'INVALID_DATES'});
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=k=>parts.find(x=>x.type===k)?.value;
  if(a<day(part('year')+'-'+part('month')+'-'+part('day')))
    return res.status(400).json({ok:false,code:'PAST_DATE'});
  const {SUPABASE_URL,SUPABASE_SECRET_KEY}=process.env;
  if(!SUPABASE_URL||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL)||!SUPABASE_SECRET_KEY)
    return res.status(503).json({ok:false,code:'AVAILABILITY_UNAVAILABLE'});
  const params=new URLSearchParams({
    select:'id',device_code:'eq.'+DEVICE,status:'in.(pending,confirmed)',
    start_date:'lte.'+end,end_date:'gte.'+start,limit:'1'
  });
  try{
    const response=await fetch(SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/nomst_v2_reservations?'+params,{
      headers:{apikey:SUPABASE_SECRET_KEY,Authorization:'Bearer '+SUPABASE_SECRET_KEY},
      signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)throw new Error('UPSTREAM_'+response.status);
    const rows=await response.json();
    if(!Array.isArray(rows))throw new Error('INVALID_RESPONSE');
    return res.status(200).json({
      ok:true,mode:'staging-only',available:rows.length===0,start,end,
      availabilityOnly:true,productionAvailabilityConfirmed:false,bookingCreated:false
    });
  }catch(e){
    console.error('V2 staging availability unavailable',e?.message);
    return res.status(503).json({ok:false,code:'AVAILABILITY_UNAVAILABLE'});
  }
}