import { createHash, randomUUID } from 'node:crypto';

const BUCKET = 'nomst-private-documents';
const MAX_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/i;
const sha = value => createHash('sha256').update(value).digest('hex');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});
  }
  if (process.env.NOMST_ENABLE_DOCUMENT_UPLOAD !== 'true') {
    return res.status(503).json({ok:false,code:'DOCUMENT_UPLOAD_DISABLED'});
  }
  // An additional independent deployment gate prevents accidental enablement.
  if (process.env.NOMST_UPLOAD_INTEGRATION_APPROVED !== 'true') {
    return res.status(503).json({ok:false,code:'INTEGRATION_NOT_APPROVED'});
  }
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !/^https:\/\//.test(SUPABASE_URL)) {
    return res.status(503).json({ok:false,code:'CONFIGURATION_ERROR'});
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ok:false,code:'JSON_REQUIRED'});
  }
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b) ||
      Object.keys(b).some(k => !['requestId','uploadToken','documentType','fileBase64'].includes(k))) {
    return res.status(400).json({ok:false,code:'INVALID_REQUEST'});
  }
  const { requestId, uploadToken, documentType, fileBase64 } = b;
  if (!UUID.test(requestId || '') || !TOKEN.test(uploadToken || '') ||
      !['identity','secondary'].includes(documentType)) {
    return res.status(400).json({ok:false,code:'INVALID_AUTH_OR_TYPE'});
  }
  if (typeof fileBase64 !== 'string' || fileBase64.length > Math.ceil(MAX_BYTES / 3) * 4 + 4 ||
      fileBase64.length < 8 || fileBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(fileBase64)) {
    return res.status(413).json({ok:false,code:'INVALID_FILE_SIZE_OR_ENCODING'});
  }
  const bytes = Buffer.from(fileBase64, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== fileBase64) {
    return res.status(413).json({ok:false,code:'INVALID_FILE_SIZE_OR_ENCODING'});
  }
  const jpeg = bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  const png = bytes.length >= 45 &&
    bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) &&
    bytes.subarray(12,16).toString('ascii') === 'IHDR' &&
    bytes.subarray(bytes.length-12,bytes.length-8).equals(Buffer.alloc(4)) &&
    bytes.subarray(bytes.length-8,bytes.length-4).toString('ascii') === 'IEND' &&
    bytes.subarray(bytes.length-4).equals(Buffer.from('ae426082','hex'));
  if (!jpeg && !png) return res.status(415).json({ok:false,code:'JPEG_OR_PNG_ONLY'});
  const mime = jpeg ? 'image/jpeg' : 'image/png';
  const base = SUPABASE_URL.replace(/\/$/, '');
  const authHeaders = {apikey:SUPABASE_SECRET_KEY,Authorization:`Bearer ${SUPABASE_SECRET_KEY}`};
  const attemptId = randomUUID();
  const storagePath = `temporary/${attemptId}`;
  let reserved = false;
  let uploaded = false;
  let documented = false;
  let processingStarted = false;
  let processingRequested = false;
  const rpc = async (name, payload) => {
    const r = await fetch(`${base}/rest/v1/rpc/${name}`, {method:'POST',
      headers:{...authHeaders,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if (!r.ok) throw new Error(`${name} HTTP ${r.status}`);
    return r.json();
  };
  try {
    reserved = await rpc('reserve_document_upload_attempt', {
      p_token_hash:sha(uploadToken.toLowerCase()),p_request_id:requestId,p_attempt_id:attemptId
    });
    if (reserved !== true) return res.status(403).json({ok:false,code:'UPLOAD_NOT_AUTHORIZED'});
    // A timeout does not prove the RPC failed. Once sent, never auto-refund.
    processingRequested = true;
    const started = await rpc('start_document_upload_processing',{p_attempt_id:attemptId});
    if (started !== true) throw new Error('PROCESSING_NOT_STARTED');
    processingStarted = true;
    const storageResponse = await fetch(`${base}/storage/v1/object/${BUCKET}/${storagePath}`,{
      method:'POST',headers:{...authHeaders,'Content-Type':mime,'x-upsert':'false'},body:bytes
    });
    if (!storageResponse.ok) throw new Error(`STORAGE_HTTP_${storageResponse.status}`);
    uploaded = true;
    // Resolve the session from the server-created reservation, never from user input.
    const attemptResponse = await fetch(
      `${base}/rest/v1/document_upload_attempts?id=eq.${attemptId}&select=upload_session_id,request_id,status`,
      { headers: authHeaders }
    );
    if (!attemptResponse.ok) throw new Error(`ATTEMPT_LOOKUP_HTTP_${attemptResponse.status}`);
    const attempts = await attemptResponse.json();
    if (attempts.length !== 1 || attempts[0].request_id !== requestId ||
        attempts[0].status !== 'processing' || !UUID.test(attempts[0].upload_session_id || '')) {
      throw new Error('ATTEMPT_SESSION_MISMATCH');
    }
    const documentId = randomUUID();
    const record = await fetch(`${base}/rest/v1/rental_document_uploads`,{
      method:'POST',headers:{...authHeaders,'Content-Type':'application/json',Prefer:'return=minimal'},
      body:JSON.stringify({id:documentId,request_id:requestId,upload_session_id:attempts[0].upload_session_id,storage_path:storagePath,
        status:'temporary',document_type:documentType,expires_at:new Date(Date.now()+60*60*1000).toISOString()})
    });
    if (!record.ok) throw new Error(`DOCUMENT_RECORD_HTTP_${record.status}`);
    documented = true;
    const confirmed = await rpc('confirm_document_upload_attempt',{
      p_attempt_id:attemptId,p_document_id:documentId
    });
    if (confirmed !== true) throw new Error('CONFIRMATION_FAILED');
    return res.status(200).json({ok:true,documentType,attemptId});
  } catch (e) {
    console.error('Document upload failure',e?.message,attemptId);
    // Never refund after storage write: storage/database state must be reconciled first.
    if (reserved && !processingRequested && !processingStarted && !uploaded && !documented) {
      try { await rpc('refund_document_upload_attempt_safe',{p_attempt_id:attemptId}); }
      catch (refundError) { console.error('Refund needs reconciliation',attemptId,refundError?.message); }
    }
    return res.status(503).json({ok:false,code:'UPLOAD_REQUIRES_REVIEW',attemptId,
      error:'上傳未確認成功，請勿重複提交，請聯絡店家核對'});
  }
}
