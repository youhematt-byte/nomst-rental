import { createHmac, timingSafeEqual } from 'node:crypto';

const reply = async (token, messages) => {
  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken: token, messages })
  });
  if (!response.ok) console.error('LINE reply failed', response.status);
};
const textMessage = text => ({ type: 'text', text });
const menu = 'NOM.ST_ 手機租借服務\n請輸入：預約、價格、檔期、取還機、客服。\n正式預約與付款須經店家確認。';
const price = '租借價格：1–2天 NT$800/日；3–4天 NT$700/日；5–30天 NT$600/日。訂金 NT$500，押金依核實方式另計。';
function responseFor(input) {
  const value = input.trim();
  if (/價格|費用|租金/.test(value)) return price;
  if (/預約|租借/.test(value)) return '請提供希望租借的起訖日期（YYYY-MM-DD）及取機方式（捷運藍線面交／7-11寄送）。目前由客服確認檔期，尚未成立訂單；請勿傳送身分證件或付款資料。';
  if (/檔期|日期|空檔/.test(value)) return '請提供租借起日及迄日（YYYY-MM-DD）。目前檔期需由客服確認，請勿將此回覆視為可預約保證。';
  if (/取機|還機|寄送|面交/.test(value)) return '可選捷運藍線面交或7-11店到店寄送（請至少提前4天洽詢）。實際交付安排以客服確認為準。';
  if (/客服|人工/.test(value)) return '已收到客服需求。請留言說明問題，店家會於服務時間內回覆。';
  return menu;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.LINE_CHANNEL_SECRET;
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!secret || !token) return res.status(503).json({ error: 'Not configured' });
  const chunks = []; for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); const raw = Buffer.concat(chunks).toString('utf8');
  // Require raw body; parsed JSON cannot safely be used for LINE signature verification.
  if (!raw) return res.status(400).json({ error: 'Raw body required' });
  const supplied = req.headers['x-line-signature'];
  const expected = createHmac('sha256', secret).update(raw).digest();
  const received = typeof supplied === 'string' ? Buffer.from(supplied, 'base64') : Buffer.alloc(0);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return res.status(401).json({ error: 'Invalid signature' });
  let body;
  try { body = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  for (const event of body.events || []) {
    if (!event.replyToken) continue;
    if (event.type === 'follow') await reply(event.replyToken, [textMessage(menu)]);
    else if (event.type === 'message' && event.message?.type === 'text') await reply(event.replyToken, [textMessage(responseFor(event.message.text || ''))]);
  }
  return res.status(200).json({ ok: true });
}
export const config = { api: { bodyParser: false } };
