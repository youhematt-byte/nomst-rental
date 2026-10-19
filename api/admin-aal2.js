const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function verifyAdminAal2(req, env=process.env, fetchImpl=fetch) {
  const header=req.headers?.authorization;
  if(typeof header!=='string'||!/^Bearer [A-Za-z0-9._~-]+$/.test(header))
    return {ok:false,status:401,code:'AUTH_REQUIRED'};
  const {SUPABASE_URL:base,SUPABASE_PUBLISHABLE_KEY:key}=env;
  if(!base||!key||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base))
    return {ok:false,status:503,code:'CONFIG_MISSING'};
  const token=header.slice(7);
  let claims;
  try {
    const parts=token.split('.');
    if(parts.length!==3) throw Error('not jwt');
    claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  }catch{return {ok:false,status:401,code:'INVALID_TOKEN'};}
  if(claims.aal!=='aal2'||!UUID.test(claims.sub||'')||
     typeof claims.exp!=='number'||claims.exp<=Math.floor(Date.now()/1000))
    return {ok:false,status:403,code:'MFA_REQUIRED'};
  try {
    const url=base.replace(/\/$/,'');
    // Auth verifies the token signature, expiry and user identity.
    const auth=await fetchImpl(`${url}/auth/v1/user`,{
      headers:{apikey:key,Authorization:`Bearer ${token}`},
      signal:AbortSignal.timeout(8000)
    });
    if(!auth.ok) return {ok:false,status:401,code:'INVALID_TOKEN'};
    const user=await auth.json();
    if(!UUID.test(user.id||'')||user.id.toLowerCase()!==claims.sub.toLowerCase()||
       !user.email_confirmed_at)
      return {ok:false,status:403,code:'UNVERIFIED_USER'};
    const params=new URLSearchParams({select:'user_id',user_id:`eq.${user.id}`,enabled:'eq.true',limit:'2'});
    const permission=await fetchImpl(`${url}/rest/v1/nomst_admin_members?${params}`,{
      headers:{apikey:key,Authorization:`Bearer ${token}`},
      signal:AbortSignal.timeout(8000)
    });
    if(!permission.ok) return {ok:false,status:503,code:'ADMIN_CHECK_FAILED'};
    const rows=await permission.json();
    if(!Array.isArray(rows)||rows.length!==1||rows[0].user_id!==user.id)
      return {ok:false,status:403,code:'FORBIDDEN'};
    return {ok:true,userId:user.id,token,base:url,key};
  }catch{return {ok:false,status:503,code:'AUTH_UNAVAILABLE'};}
}
