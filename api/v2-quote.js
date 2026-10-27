// NOM.ST_ 2.0 — server-side quote. No customer data is accepted or stored.
const DAY = 86400000;
function parseDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0,10) === s ? t : null;
}
export default function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method !== 'POST') {res.setHeader('Allow','POST');return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});}
  if(!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return res.status(415).json({ok:false,code:'JSON_REQUIRED'});
  const b=req.body;
  if(!b || typeof b!=='object' || Array.isArray(b) || Object.keys(b).some(k=>!['start','end','delivery','verification','lens','grip'].includes(k)))
    return res.status(400).json({ok:false,code:'INVALID_REQUEST'});
  const a=parseDate(b.start),z=parseDate(b.end);
  if(a===null || z===null) return res.status(400).json({ok:false,code:'INVALID_DATE'});
  const days=(z-a)/DAY+1;
  if(!Number.isInteger(days)||days<1||days>30) return res.status(400).json({ok:false,code:'INVALID_DURATION'});
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=t=>parts.find(x=>x.type===t)?.value;
  const today=parseDate(get('year')+'-'+get('month')+'-'+get('day'));
  if(a<today) return res.status(400).json({ok:false,code:'PAST_DATE'});
  if(!['meet','ship'].includes(b.delivery)||typeof b.lens!=='boolean'||typeof b.grip!=='boolean') return res.status(400).json({ok:false,code:'INVALID_OPTIONS'});
  if(b.delivery==='ship' && (!['docs','phone','none'].includes(b.verification)||(a-today)/DAY<4)) return res.status(400).json({ok:false,code:'INVALID_SHIPPING_OPTIONS'});
  if(b.delivery==='meet' && b.verification!==null && b.verification!==undefined) return res.status(400).json({ok:false,code:'INVALID_MEET_OPTIONS'});
  const dailyRate=days<=2?800:days<=4?700:600;
  const rental=days*dailyRate, accessories=(b.lens?300:0)+(b.grip?200:0);
  const deposit=b.delivery==='meet'?3000:{docs:3000,phone:6000,none:10000}[b.verification];
  return res.status(200).json({ok:true,mode:'quote-only',currency:'TWD',days,dailyRate,rental,accessories,rentalTotal:rental+accessories,bookingDeposit:500,refundableSecurityDeposit:deposit,estimatedTotalIncludingSecurityDeposit:rental+accessories+deposit,availabilityConfirmed:false,bookingCreated:false,paymentAccepted:false});
}