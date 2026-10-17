import {createHash,timingSafeEqual} from 'node:crypto';

const digest = x => createHash('sha256').update(x).digest();
const LIMIT = 100;
const MAX_PAGES = 10;

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});
  }
  const secret=process.env.RETENTION_AUDIT_SECRET;
  const authorization=req.headers?.authorization;
  if(!secret || secret.length<32 || typeof authorization!=='string' ||
     !authorization.startsWith('Bearer ') ||
     !timingSafeEqual(digest(secret),digest(authorization.slice(7)))) {
    return res.status(401).json({ok:false,code:'UNAUTHORIZED'});
  }
  const {SUPABASE_URL,SUPABASE_SECRET_KEY}=process.env;
  if(!SUPABASE_URL || !/^https:\/\//.test(SUPABASE_URL) || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({ok:false,code:'CONFIGURATION_ERROR'});
  }
  const base=SUPABASE_URL.replace(/\/$/,'');
  const headers={apikey:SUPABASE_SECRET_KEY,Authorization:`Bearer ${SUPABASE_SECRET_KEY}`};
  // Conservative: 30 days after the later of closure and dispute resolution.
  const threshold=new Date(Date.now()-30*86400000).toISOString();
  let scanned=0,eligible=0,invalid=0,moreMayExist=false;
  try {
    for(let page=0;page<MAX_PAGES;page++) {
      const params=new URLSearchParams({
        select:'request_id,returned_at,closed_at,dispute_open,dispute_resolved_at,retention_hold',
        closed_at:`lte.${threshold}`,dispute_open:'eq.false',retention_hold:'eq.false',
        order:'closed_at.asc,request_id.asc',limit:String(LIMIT),
        offset:String(page*LIMIT)
      });
      const response=await fetch(`${base}/rest/v1/nomst_rental_closure?${params}`,{headers});
      if(!response.ok) throw new Error(`CLOSURE_HTTP_${response.status}`);
      const rows=await response.json();
      if(!Array.isArray(rows)) throw new Error('INVALID_ROWS');
      scanned+=rows.length;
      for(const row of rows) {
        const returned=Date.parse(row.returned_at);
        const closed=Date.parse(row.closed_at);
        const resolved=Date.parse(row.dispute_resolved_at);
        if(!row.returned_at || !row.closed_at || !row.dispute_resolved_at ||
           !Number.isFinite(returned) || !Number.isFinite(closed) ||
           !Number.isFinite(resolved) || row.dispute_open!==false ||
           row.retention_hold!==false || closed<returned || resolved<returned) {
          invalid++;continue;
        }
        if(Math.max(closed,resolved)+30*86400000<=Date.now()) eligible++;
      }
      if(rows.length<LIMIT) break;
      if(page===MAX_PAGES-1) moreMayExist=true;
    }
    return res.status(200).json({
      ok:true,mode:'read-only',scannedClosures:scanned,
      candidateClosures:eligible,requiresManualReview:invalid,
      moreMayExist,deletionAuthorized:false,
      note:'No document identifiers returned. This is not a deletion authorization.'
    });
  } catch(error) {
    console.error('Eligibility audit failed',error?.message);
    return res.status(503).json({ok:false,code:'ELIGIBILITY_AUDIT_UNAVAILABLE'});
  }
}
