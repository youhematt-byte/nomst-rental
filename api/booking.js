// Vercel /api/booking.js — requires RESEND_API_KEY, BOOKING_NOTIFICATION_EMAIL,
// RESEND_FROM_EMAIL (verified Resend domain). Never place secrets in index.html.
const clean=(v,max=200)=>String(v??'').trim().slice(0,max);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateOk=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const emailOk=s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)&&s.length<=254;
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'僅接受 POST'});}
 const {RESEND_API_KEY,BOOKING_NOTIFICATION_EMAIL,RESEND_FROM_EMAIL}=process.env;
 if(!RESEND_API_KEY||!BOOKING_NOTIFICATION_EMAIL||!RESEND_FROM_EMAIL)return res.status(503).json({ok:false,error:'寄信設定尚未完成'});
 const b=req.body;
 if(!b||typeof b!=='object'||Array.isArray(b))return res.status(400).json({ok:false,error:'資料格式錯誤'});
 const name=clean(b.name,80),ig=clean(b.ig,80),phone=clean(b.phone,40),purpose=clean(b.purpose,80),email=clean(b.email,254);
 const delivery=['meet','ship'].includes(b.delivery)?b.delivery:null,verify=clean(b.verify,20);
 const start=clean(b.start,10),end=clean(b.end,10),station=clean(b.station,100),store=clean(b.store,150);
 if(!name||!ig||!/^09[0-9\-\s]{8,15}$/.test(phone)||!purpose||!emailOk(email)||!delivery||!dateOk(start)||!dateOk(end)||end<start||b.contractSigned!==true||b.contractAgreed!==true)return res.status(400).json({ok:false,error:'請檢查姓名、Email、日期及合約確認'});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(start<today)return res.status(400).json({ok:false,error:'取機日期不可早於今天'});
 const days=Math.round((Date.parse(end+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000)+1;
 if(days<1||days>90)return res.status(400).json({ok:false,error:'租借天數不正確'});
 if(delivery==='ship'&&Math.round((Date.parse(start+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000)<4)return res.status(400).json({ok:false,error:'寄送須提前四天預約'});
 if((delivery==='meet'&&!station)||(delivery==='ship'&&!store))return res.status(400).json({ok:false,error:'請填寫面交站點或收件門市'});
 if(delivery==='ship'&&!['id','phone','none'].includes(verify))return res.status(400).json({ok:false,error:'身分核實方式不正確'});
 const base64=b.contractBase64;
 if(typeof base64!=='string'||base64.length>5_600_000||!base64.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)||base64.length%4!==0)return res.status(400).json({ok:false,error:'請附上 4MB 以下的 PDF 合約'});
 const pdf=Buffer.from(base64,'base64');
 if(!pdf.length||pdf.length>4*1024*1024||pdf.subarray(0,5).toString()!=='%PDF-')return res.status(400).json({ok:false,error:'合約 PDF 格式錯誤或超過 4MB'});
 const rate=days<=2?800:days<=4?700:600,rent=days*rate,extras=(b.lens===true?300:0)+(b.grip===true?200:0),total=rent+extras;
 const deposit=delivery==='meet'||verify==='id'?3000:verify==='phone'?6000:10000;
 const fields=[['姓名',name],['IG',ig],['電話',phone],['客戶 Email',email],['用途',purpose],['取機方式',delivery==='meet'?'捷運面交':'7-11 店到店'],['地點',delivery==='meet'?station:store],['核實方式',delivery==='ship'?verify:'面交核對'],['取機日期',start],['歸還日期',end],['天數',days+' 天'],['增距鏡',b.lens===true?'需要':'不需要'],['手持握把',b.grip===true?'需要':'不需要'],['掛繩',b.strap===true?'需要':'不需要'],['充電線',b.cable===true?'需要':'不需要'],['租金',`NT$ ${rent}`],['配件',`NT$ ${extras}`],['總額',`NT$ ${total}`],['訂金','NT$ 500'],['尾款',`NT$ ${Math.max(0,total-500)}`],['押金',`NT$ ${deposit}`],['備註',clean(b.memo,1500)||'無']];
 const rows=fields.map(([k,v])=>`<tr><td style="padding:8px;border-bottom:1px solid #ddd">${esc(k)}</td><td style="padding:8px;border-bottom:1px solid #ddd">${esc(v)}</td></tr>`).join('');
 const id=crypto.randomUUID();
 const attachment={filename:`NOMST-contract-${start}-${id.slice(0,8)}.pdf`,content:base64};
 async function send(to,subject,html){const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:RESEND_FROM_EMAIL,to:[to],subject,html,attachments:[attachment]})});const data=await r.json().catch(()=>({}));if(!r.ok){console.error('Resend failed',r.status,data);throw Error('寄信服務未接受郵件');}return data;}
 const html=`<div style="font-family:Arial,sans-serif;color:#26372c"><h2>NOM.ST_｜手機租借預約申請</h2><p>此為預約申請紀錄，<b>尚未確認檔期、付款或租借成立</b>。附件為客戶提供的簽署合約 PDF，身分尚未獨立核實。</p><table style="border-collapse:collapse">${rows}</table><p>申請編號：${esc(id)}</p></div>`;
 try{
  // Send to shop first; if customer delivery fails, respond with an explicit partial-failure error.
  await send(BOOKING_NOTIFICATION_EMAIL,`【NOM.ST_ 新預約】${start}～${end}｜${name}`,html);
  try{await send(email,`【NOM.ST_】預約申請與簽署合約副本｜${start}`,html);}
  catch(e){return res.status(502).json({ok:false,error:'店家已收到申請，但客戶合約副本寄送失敗。請聯絡店家確認，勿直接重複送出。',requestId:id});}
  return res.status(200).json({ok:true,requestId:id,message:'預約申請及合約寄送請求已送出'});
 }catch(e){console.error('Booking email error',e.message);return res.status(502).json({ok:false,error:'預約郵件寄送失敗，請透過 IG 聯絡店家'});}
}
