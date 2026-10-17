
import { createHash } from 'node:crypto';

const MAX_PDF = 4 * 1024 * 1024;
const clean = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const esc = v => String(v).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
);
const dateOK = s =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) &&
  new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const dayNum = s => Date.parse(`${s}T12:00:00Z`) / 86400000;
const emailOK = s =>
  s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const reply = (res, code, error) =>
  res.status(code).json({ok:false,error});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(res, 405, '僅接受 POST');
  }

  const {
    RESEND_API_KEY,
    RESEND_FROM_EMAIL,
    BOOKING_NOTIFICATION_EMAIL,
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
  } = process.env;

  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL ||
      !BOOKING_NOTIFICATION_EMAIL || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return reply(res, 503, '網站寄信設定尚未完成');
  }

  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    return reply(res, 400, '資料格式錯誤');
  }

  const requestId = clean(b.requestId, 40);
  
const uploadToken =
  typeof b.uploadToken === 'string'
    ? b.uploadToken.trim()
    : '';

if (uploadToken && !/^[0-9a-f]{64}$/i.test(uploadToken)) {
  return reply(res, 400, '上傳憑證格式錯誤');
}

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return reply(res, 400, '預約識別碼不正確，請重新整理後再試');
  }
  const name = clean(b.name, 80);
  const ig = clean(b.ig, 80);
  const phone = clean(b.phone, 40);
  const email = clean(b.email, 254);
  const purpose = clean(b.purpose, 80);
  const start = clean(b.start, 10);
  const end = clean(b.end, 10);
  const delivery = b.delivery;

  if (
    !name || !ig ||
    !/^09\d{8}$/.test(phone.replace(/[\s-]/g, '')) ||
    !emailOK(email) || !purpose ||
    !['meet', 'ship'].includes(delivery) ||
    !dateOK(start) || !dateOK(end) ||
    b.contractSigned !== true ||
    b.contractAgreed !== true
  ) {
    return reply(res, 400, '請確認必填欄位、日期與合約勾選');
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const part = type => parts.find(p => p.type === type)?.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const days = dayNum(end) - dayNum(start) + 1;

  if (start < today || days < 1 || days > 30) {
    return reply(res, 400, '日期不正確，租期最多 30 天');
  }

  if (delivery === 'ship' && dayNum(start) - dayNum(today) < 4) {
    return reply(res, 400, '寄送須提前四天預約');
  }

  const station = clean(b.station, 100);
  const store = clean(b.store, 150);
  const verify = clean(b.verify, 20);

  if (
    (delivery === 'meet' && !station) ||
    (delivery === 'ship' &&
      (!store || !['id','phone','none'].includes(verify)))
  ) {
    return reply(res, 400, '請填寫面交站點或寄送資料');
  }

  // Shipping + ID verification must never silently skip document linkage.
  if (delivery === 'ship' && verify === 'id' &&
      (process.env.NOMST_ENABLE_DOCUMENT_UPLOAD !== 'true' ||
       process.env.NOMST_UPLOAD_INTEGRATION_APPROVED !== 'true')) {
    return reply(res, 503, '雙證件安全上傳尚未開放，請改選電話核實或不提供證件');
  }
  if (delivery === 'ship' && verify === 'id' && !uploadToken) {
    return reply(res, 400, '請先完成兩份證件安全上傳');
  }
  if ((delivery !== 'ship' || verify !== 'id') && uploadToken) {
    return reply(res, 400, '此核實方式不接受證件上傳憑證');
  }

  const encoded = b.contractBase64;

  if (
    typeof encoded !== 'string' ||
    !encoded.length ||
    encoded.length > Math.ceil(MAX_PDF / 3) * 4 + 8 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    encoded.length % 4 !== 0
  ) {
    return reply(res, 400, '請提供 4MB 以下的簽署 PDF');
  }

  const pdf = Buffer.from(encoded, 'base64');

  if (
    !pdf.length ||
    pdf.length > MAX_PDF ||
    pdf.subarray(0, 5).toString('ascii') !== '%PDF-'
  ) {
    return reply(res, 400, '合約 PDF 格式不正確');
  }

  const rate = days <= 2 ? 800 : days <= 4 ? 700 : 600;
  const rent = days * rate;
  const extras =
    (b.lens === true ? 300 : 0) +
    (b.grip === true ? 200 : 0);
  const total = rent + extras;

  const deposit = delivery === 'meet' || verify === 'id'
    ? 3000 : verify === 'phone' ? 6000 : 10000;

  const fields = [
    ['姓名', name],
    ['IG 帳號', ig],
    ['電話', phone],
    ['客戶 Email', email],
    ['租借用途', purpose],
    ['取機方式', delivery === 'meet'
      ? '捷運藍線面交' : '7-11 店到店'],
    [delivery === 'meet' ? '面交站點' : '7-11 門市',
      delivery === 'meet' ? station : store],
    ['身分核實', delivery === 'meet' ? '面交核對'
      : ({id:'雙證件',phone:'電話核實',none:'不提供'}[verify])],
    ['取機日期', start],
    ['歸還日期', end],
    ['租借天數', `${days} 天`],
    ['增距鏡', b.lens === true ? '需要' : '不需要'],
    ['手持握把', b.grip === true ? '需要' : '不需要'],
    ['掛繩', b.strap === true ? '需要' : '不需要'],
    ['充電線', b.cable === true ? '需要' : '不需要'],
    ['租金', `NT$ ${rent}`],
    ['配件費', `NT$ ${extras}`],
    ['租金總額', `NT$ ${total}`],
    ['訂金', 'NT$ 500'],
    ['尾款', `NT$ ${Math.max(0, total - 500)}`],
    ['押金', `NT$ ${deposit}`],
    ['備註', clean(b.memo, 1500) || '無']
  ];

  const rows = fields.map(([k, v]) =>
    `<tr>
      <td style="padding:8px;border-bottom:1px solid #ddd">
        ${esc(k)}
      </td>
      <td style="padding:8px;border-bottom:1px solid #ddd">
        ${esc(v)}
      </td>
    </tr>`
  ).join('');

  const attachment = [{
    filename: 'NOM-ST-signed-contract.pdf',
    content: encoded
  }];

  const common = {
    from: RESEND_FROM_EMAIL,
    attachments: attachment
  };

  const messages = [
    {
      ...common,
      to: [BOOKING_NOTIFICATION_EMAIL],
      subject: `【NOM.ST_ 新預約】${start}～${end}｜${name}`,
      html: `<h2>NOM.ST_｜新預約申請</h2>
        <p>尚未確認檔期、付款或預約成立。</p>
        <p>附件為客戶提交的簽署 PDF，請人工核對。</p>
        <table>${rows}</table>`
    },
    {
      ...common,
      to: [email],
      subject: '【NOM.ST_】預約申請與簽署合約副本',
      html: `<h2>NOM.ST_｜預約申請收件通知</h2>
        <p>您好 ${esc(name)}，我們已收到您的預約申請。</p>
        <p>附件為您提交的合約 PDF。</p>
        <p>租借日期：${esc(start)} 至 ${esc(end)}
        （${days} 天）</p>
        <p>租金總額：NT$ ${total}</p>
        <p>本信不代表檔期確認、訂金入帳或預約成立。</p>
        <p>請等候店家透過官方 IG 確認。</p>`
    }
  ];

  // 先登記唯一 requestId；失敗時不寄信，避免資料庫失效造成無紀錄寄送。
  // 不自動重試：寄信服務可能已接受請求，即使網路回應失敗。
  const requestHash = createHash('sha256').update(JSON.stringify({
    name, ig, phone, email, purpose, start, end, delivery, station, store,
    verify, lens:b.lens===true, grip:b.grip===true,
    pdfHash:createHash('sha256').update(pdf).digest('hex')
  })).digest('hex');
  const baseUrl = SUPABASE_URL.replace(/\/$/, '');
  const dbHeaders = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
  const dbUpdate = async (patch) => {
    const r = await fetch(`${baseUrl}/rest/v1/rental_bookings?request_id=eq.${encodeURIComponent(requestId)}`, {
      method:'PATCH', headers:{...dbHeaders,Prefer:'return=minimal'},
      body:JSON.stringify({...patch,updated_at:new Date().toISOString()})
    });
    if (!r.ok) throw new Error(`資料庫更新失敗 ${r.status}`);
  };
  try {
    const db = await fetch(`${baseUrl}/rest/v1/rental_bookings`, {
      method:'POST', headers:{...dbHeaders,Prefer:'return=minimal'},
      body:JSON.stringify({request_id:requestId,request_hash:requestHash,
        customer_name:name,customer_email:email,rental_start:start,
        rental_end:end,rental_days:days,rental_total:total})
    });
    if (db.status===409) return reply(res,409,'此筆申請已受理或正在處理，請勿重複送出；如需確認請聯絡店家');
    if (!db.ok) {
      console.error('Booking database insert failed',db.status);
      return reply(res,503,'預約紀錄服務暫時無法使用，請稍後再試');
    }
  } catch(e) {
    console.error('Booking database error',e?.message);
    return reply(res,503,'預約紀錄服務暫時無法連線，請稍後再試');
  }

  // Fail closed: never accept a booking as fully submitted when the document link fails.
  if (uploadToken) {
    try {
      const linkResponse = await fetch(`${baseUrl}/rest/v1/rpc/link_rental_documents_by_session`, {
        method:'POST', headers:dbHeaders,
        body:JSON.stringify({p_request_id:requestId,p_token_hash:createHash('sha256').update(uploadToken).digest('hex')})
      });
      if (!linkResponse.ok || await linkResponse.json() !== 2) {
        await dbUpdate({last_error:'Document linking requires manual review'}).catch(()=>{});
        return reply(res,409,'證件尚未完成核對，請聯絡店家，勿重新提交');
      }
    } catch(error) {
      console.error('Document linking failed',error?.message);
      await dbUpdate({last_error:'Document linking requires manual review'}).catch(()=>{});
      return reply(res,503,'證件綁定未完成，請聯絡店家核對');
    }
  }

  try {
    let sent = 0;

    for (const [index, msg] of messages.entries()) {
      const prefix = index===0 ? 'shop' : 'customer';
      // sending 是不確定狀態：不自動重試，以免重複寄出。
      await dbUpdate({[`${prefix}_email_status`]:'sending'});
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `${requestId}-${index===0?'shop':'customer'}`
        },
        body: JSON.stringify(msg)
      });

      if (!response.ok) {
        console.error(
          'Resend failed',
          response.status,
          await response.text().catch(() => '')
        );

        await dbUpdate({[`${prefix}_email_status`]:'failed',last_error:`Resend HTTP ${response.status}`}).catch(()=>{});
        return reply(
          res,
          502,
          sent
            ? '店家通知可能已寄出，但客戶副本寄送失敗；請勿重複提交，請聯絡店家確認'
            : '寄信失敗，請聯絡店家確認'
        );
      }

      const result = await response.json().catch(()=>({}));
      await dbUpdate({[`${prefix}_email_status`]:'sent', [`${prefix}_email_id`]:result.id||null});
      sent++;
    }

    return res.status(200).json({
      ok: true,
      message: '預約申請已寄送，尚待店家確認'
    });

  } catch (e) {
    console.error('Booking mail error', e?.message);
    return reply(
      res,
      502,
      '寄信狀態未能確認，請勿重複提交，請聯絡店家'
    );
  }
}
