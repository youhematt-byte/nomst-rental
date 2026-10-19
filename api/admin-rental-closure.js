import {verifyAdminAal2} from '../lib/admin-aal2.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions=new Set(['mark_returned','mark_charges_settled','mark_contract_ended','confirm_no_dispute','open_dispute','resolve_dispute','close','hold','release_hold']);
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'});}
  if(process.env.NOMST_ENABLE_CLOSURE_ADMIN!=='true')
    return res.status(503).json({ok:false,code:'CLOSURE_ADMIN_DISABLED'});
  const auth=await verifyAdminAal2(req);
  if(!auth.ok)return res.status(auth.status).json({ok:false,code:auth.code});
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||
     !UUID.test(body.requestId||'')||!actions.has(body.action))
    return res.status(400).json({ok:false,code:'INVALID_REQUEST'});
  try {
    // RPC checks auth.uid(), so pass the authenticated user JWT, not service_role.
    const response=await fetch(`${auth.base}/rest/v1/rpc/nomst_apply_closure_action`,{
      method:'POST',
      headers:{apikey:auth.key,Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_request_id:body.requestId,p_action:body.action}),
      signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)return res.status(502).json({ok:false,code:'CLOSURE_RPC_FAILED'});
    const success=await response.json();
    return res.status(success===true?200:403).json({
      ok:success===true,code:success===true?'CLOSURE_UPDATED':'CLOSURE_DENIED'
    });
  }catch{return res.status(503).json({ok:false,code:'CLOSURE_SERVICE_UNAVAILABLE'});}
}
