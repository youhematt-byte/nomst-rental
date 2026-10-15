// Vercel Serverless Function — keep RESEND_API_KEY in Vercel Environment Variables only.
const clean = (value, max=200) => String(value ?? '').trim().slice(0,max);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value+'T12:00:00Z').getTime());
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'僅接受 POST'});}
  if(!process.env.RESEND_API_KEY || !process.env.BOOKING_NOTIFICATION_EMAIL) return res.status(503).json({ok:false,error:'網站寄信設定尚未完成'});
  const b=req.body || {};
  if(typeof b!=='object' || Array.isArray(b)) return res.status(400).json({ok:false,error:'資料格式錯誤'});
  const name=clean(b.name,80), ig=clean(b.ig,80), phone=clean(b.phone,40), purpose=clean(b.purpose,80);
  const delivery=b.delivery==='ship'?'ship':b.delivery==='meet'?'meet':null;
  const start=clean(b.start,10), end=clean(b.end,10);
  if(!name||!ig||!/^09[0-9\-\s]{8,15}$/.test(phone)||!purpose||!delivery||!validDate(start)||!validDate(end)||end<start||b.contractSigned!==true||b.contractAgreed!==true) return res.status(400).json({ok:false,error:'請確認必填欄位、日期與合約勾選'});
  const today=new Date();const tw=new Date(today.toLocaleString('en-US',{timeZone:'Asia/Taipei'}));const todayString=`${tw.getFullYear()}-${String(tw.getMonth()+1).padStart(2,'0')}-${String(tw.getDate()).padStart(2,'0')}`;
  if(start<todayString) return res.status(400).json({ok:false,error:'取機日期不可早於今天'});
  const days=Math.round((new Date(end+'T12:00:00Z')-new Date(start+'T12:00:00Z'))/86400000)+1;
  if(days<1||days>90) return res.status(400).json({ok:false,error:'租借天數不正確'});
  if(delivery==='ship' && (new Date(start+'T12:00:00Z')-new Date(todayString+'T12:00:00Z'))/86400000<4) return res.status(400).json({ok:false,error:'寄送須提前四天預約'});
  const station=clean(b.station,100),store=clean(b.store,150),verify=clean(b.verify,20);
  if((delivery==='meet'&&!station)||(delivery==='ship'&&!store))return res.status(400).json({ok:false,error:'請填寫面交站點或收件門市'});
  const rate=days<=2?800:days<=4?700:600,rent=days*rate,extras=(b.lens===true?300:0)+(b.grip===true?200:0),total=rent+extras;
  const deposit=delivery==='meet'||verify==='id'?3000:verify==='phone'?6000:10000;
  const fields=[['姓名',name],['IG 帳號',ig],['聯絡電話',phone],['租借用途',purpose],['取機方式',delivery==='meet'?'台北捷運藍線面交':'7-11 店到店'],[delivery==='meet'?'面交站點':'7-11 門市',delivery==='meet'?station:store],['身分核實方式',delivery==='ship'?({id:'雙證件',phone:'電話核實',none:'不提供'}[verify]||'未選'):'面交核對'],['取機日期',start],['歸還日期',end],['租借天數',days+' 天'],['增距鏡',b.lens?'需要':'不需要'],['手持握把',b.grip?'需要':'不需要'],['掛繩',b.strap?'需要':'不需要'],['充電線',b.cable?'需要':'不需要'],['手機租金','NT$ '+rent],['配件費','NT$ '+extras],['租金總額','NT$ '+total],['訂金','NT$ 500'],['租金尾款','NT$ '+Math.max(0,total-500)],['押金','NT$ '+deposit],['備註',clean(b.memo,1500)||'無'],['合約','使用者已選擇簽署檔案（檔案未上傳；需另行確認）']];
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html=`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#26372c"><h2>NOM.ST_｜新預約申請</h2><p>以下是客戶提交的預約資料。<b>尚未確認檔期、付款或合約檔案。</b></p><table style="width:100%;border-collapse:collapse">${fields.map(([k,v])=>`<tr><td style="padding:9px;border-bottom:1px solid #ddd;width:32%;color:#607063">${escape(k)}</td><td style="padding:9px;border-bottom:1px solid #ddd;white-space:pre-wrap">${escape(v)}</td></tr>`).join('')}</table><p>請透過官方 IG 與客戶確認。</p></div>`;
  try{
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'NOM.ST_ 預約通知 <onboarding@resend.dev>',to:[process.env.BOOKING_NOTIFICATION_EMAIL],subject:`【NOM.ST_ 新預約】${start}～${end}｜${name}`,html})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){console.error('Resend delivery failed',response.status,data);return res.status(502).json({ok:false,error:'寄信服務暫時無法寄送，請透過 IG 聯絡店家'});}
    return res.status(200).json({ok:true});
  }catch(e){console.error('Resend request failed',e);return res.status(502).json({ok:false,error:'寄信服務暫時無法連線，請透過 IG 聯絡店家'});}
}
