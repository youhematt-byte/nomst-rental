// NOM.ST_ v2 availability: fail closed if database cannot be checked.
// This endpoint is informational; booking must use an atomic DB constraint.
const DEVICE='VIVO-X300-PRO-1TB-001';
function day(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const t=Date.parse(s+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?t:null;}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});}
 const {start,end}=req.query||{},a=day(start),z=day(end);
 if(a===null||z===null||z<a||(z-a)/86400000>=30)return res.status(400).json({ok:false,code:'INVALID_DATES'});
 const {SUPABASE_URL,SUPABASE_SECRET_KEY}=process.env;
 if(!SUPABASE_URL||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL)||!SUPABASE_SECRET_KEY)return res.status(503).json({ok:false,code:'AVAILABILITY_UNAVAILABLE'});
 const params=new URLSearchParams({select:'id',device_code:'eq.'+DEVICE,status:'in.(pending,confirmed)',start_date:'lte.'+end,end_date:'gte.'+start,limit:'1'});
 try{
 const response=await fetch(SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/nomst_rental_inventory?'+params,{headers:{apikey:SUPABASE_SECRET_KEY,Authorization:'Bearer '+SUPABASE_SECRET_KEY},signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('UPSTREAM_'+response.status);
 const rows=await response.json();if(!Array.isArray(rows))throw new Error('INVALID_RESPONSE');
 return res.status(200).json({ok:true,available:rows.length===0,start,end,availabilityOnly:true,bookingCreated:false});
 }catch(e){console.error('V2 availability unavailable',e.message);return res.status(503).json({ok:false,code:'AVAILABILITY_UNAVAILABLE'});}
}