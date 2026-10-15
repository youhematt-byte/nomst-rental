
const BUCKET = 'nomst-private-documents';
const MAX_SIZE = 5 * 1024 * 1024;
const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf'
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '僅接受 POST 請求' });
  }

  try {
    const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
      return res.status(503).json({
        error: '安全上傳服務尚未完成設定'
      });
    }

    const { fileName, fileType, fileBase64 } = req.body || {};

    if (
      typeof fileName !== 'string' ||
      typeof fileType !== 'string' ||
      typeof fileBase64 !== 'string' ||
      !TYPES[fileType]
    ) {
      return res.status(400).json({
        error: '請上傳 JPG、PNG 或 PDF 檔案'
      });
    }

    if (fileBase64.length > 7_000_000) {
      return res.status(413).json({
        error: '檔案不可超過 5MB'
      });
    }

    const buffer = Buffer.from(fileBase64, 'base64');

    if (!buffer.length || buffer.length > MAX_SIZE) {
      return res.status(413).json({
        error: '檔案不可超過 5MB'
      });
    }

    const jpg = buffer[0] === 0xff &&
      buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );
    const pdf = buffer.subarray(0, 5).toString() === '%PDF-';

    if (!(
      (fileType === 'image/jpeg' && jpg) ||
      (fileType === 'image/png' && png) ||
      (fileType === 'application/pdf' && pdf)
    )) {
      return res.status(400).json({
        error: '檔案內容與格式不符'
      });
    }

    const id = crypto.randomUUID();
    const path = `${id}.${TYPES[fileType]}`;
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${path}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        'Content-Type': fileType,
        'x-upsert': 'false'
      },
      body: buffer
    });

    if (!response.ok) {
      console.error('Supabase upload failed:', response.status);
      return res.status(502).json({
        error: '檔案儲存失敗，請稍後再試'
      });
    }

    return res.status(200).json({
      ok: true,
      documentId: id,
      message: '檔案已儲存至私人空間'
    });
  } catch (error) {
    console.error('Upload error:', error.message);
    return res.status(500).json({
      error: '上傳服務暫時無法使用'
    });
  }
}
