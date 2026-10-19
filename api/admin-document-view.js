import {verifyAdminAal2} from '../lib/admin-aal2.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});}
  if(process.env.NOMST_ENABLE_ADMIN_DOCUMENT_VIEW!=='true')
    return res.status(503).json({ok:false,code:'ADMIN_VIEW_DISABLED'});
  const auth=await verifyAdminAal2(req);
  if(!auth.ok)return res.status(auth.status).json({ok:false,code:auth.code});
  // Existing DB schema and audit fields do not match legacy signed-URL code.
  // Fail closed until booking linkage and actor-attributed audit are implemented.
  return res.status(503).json({ok:false,code:'DOCUMENT_VIEW_AUDIT_NOT_READY'});
}
