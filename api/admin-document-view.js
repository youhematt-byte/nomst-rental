import {createHash, timingSafeEqual, randomUUID} from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'nomst-private-documents';
const PATH = /^temporary\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = value => createHash('sha256').update(value).digest();

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});
  }
  // Disabled by default, independently of customer upload feature.
  if(process.env.NOMST_ENABLE_ADMIN_DOCUMENT_VIEW !== 'true') {
    return res.status(503).json({ok:false,code:'ADMIN_VIEW_DISABLED'});
  }
  const secret = process.env.NOMST_UPLOAD_ADMIN_SECRET;
  const supplied = req.headers?.authorization;
  if(!secret || secret.length < 32 || typeof supplied !== 'string' ||
     !supplied.startsWith('Bearer ') ||
     !timingSafeEqual(hash(secret),hash(supplied.slice(7)))) {
    return res.status(403).json({ok:false,code:'FORBIDDEN'});
  }
  const {SUPABASE_URL,SUPABASE_SECRET_KEY} = process.env;
  if(!SUPABASE_URL || !/^https:\/\//.test(SUPABASE_URL) || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({ok:false,code:'CONFIGURATION_ERROR'});
  }
  const b = req.body;
  if(!b || typeof b !== 'object' || Array.isArray(b) ||
     Object.keys(b).length !== 2 || !UUID.test(b.documentId || '') ||
     !UUID.test(b.requestId || '')) {
    return res.status(400).json({ok:false,code:'INVALID_REQUEST'});
  }
  const base = SUPABASE_URL.replace(/\/$/,'');
  const headers = {apikey:SUPABASE_SECRET_KEY,Authorization:`Bearer ${SUPABASE_SECRET_KEY}`};
  try {
    const q = new URLSearchParams({
      id:`eq.${b.documentId}`,request_id:`eq.${b.requestId}`,
      deleted_at:'is.null',
      select:'id,request_id,storage_path,deleted_at,status,expires_at',
      limit:'2'
    });
    const response = await fetch(`${base}/rest/v1/rental_document_uploads?${q}`,{headers});
    if(!response.ok) throw new Error(`lookup HTTP ${response.status}`);
    const rows = await response.json();
    if(!Array.isArray(rows) || rows.length !== 1) {
      return res.status(404).json({ok:false,code:'DOCUMENT_NOT_FOUND'});
    }
    const record = rows[0];
    // Do not allow arbitrary bucket paths or deleted/unrecognized documents.
    if(!UUID.test(record.id || '') || !UUID.test(record.request_id || '') ||
       record.id.toLowerCase() !== b.documentId.toLowerCase() ||
       record.request_id.toLowerCase() !== b.requestId.toLowerCase() ||
       typeof record.storage_path !== 'string' ||
       !PATH.test(record.storage_path) ||
       !['attached','verified'].includes(record.status) ||
       (typeof record.expires_at !== 'string' ||
         !Number.isFinite(Date.parse(record.expires_at)) ||
         Date.parse(record.expires_at) <= Date.now())) {
      return res.status(409).json({ok:false,code:'DOCUMENT_NOT_VIEWABLE'});
    }
    // Write audit before issuing access. Missing table/privileges => fail closed.
    const audit = await fetch(`${base}/rest/v1/nomst_document_access_audit`,{
      method:'POST',
      headers:{...headers,'Content-Type':'application/json',Prefer:'return=minimal'},
      body:JSON.stringify({
        id:randomUUID(),document_id:b.documentId,request_id:b.requestId,
        action:'signed_url_issued'
      })
    });
    if(!audit.ok) throw new Error(`audit HTTP ${audit.status}`);
    const signed = await fetch(
      `${base}/storage/v1/object/sign/${BUCKET}/${record.storage_path}`,{
        method:'POST',
        headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({expiresIn:60})
      }
    );
    if(!signed.ok) throw new Error(`sign HTTP ${signed.status}`);
    const data = await signed.json();
    const signedPath = data.signedURL || data.signedUrl;
    if(typeof signedPath !== 'string' ||
       !signedPath.startsWith('/object/sign/') ||
       signedPath.includes('\\') || signedPath.includes('#') ||
       /%(?:2f|5c|2e)/i.test(signedPath) ||
       !signedPath.startsWith(`/object/sign/${BUCKET}/${record.storage_path}?`)) {
      throw new Error('invalid signed url');
    }
    const signedUrl = new URL(`/storage/v1${signedPath}`, base);
    if(signedUrl.origin !== new URL(base).origin || !signedUrl.searchParams.has('token')) {
      throw new Error('invalid signed token');
    }
    return res.status(200).json({
      ok:true,url:signedUrl.toString(),
      expiresInSeconds:60,
      warning:'此連結含敏感證件存取權限，請勿轉傳或記錄'
    });
  } catch(err) {
    console.error('Admin document view unavailable',err?.message);
    return res.status(503).json({ok:false,code:'ADMIN_VIEW_UNAVAILABLE'});
  }
}
