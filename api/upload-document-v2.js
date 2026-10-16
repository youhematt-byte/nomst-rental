
import { randomUUID, createHash } from 'node:crypto';

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
    return res.status(405).json({ error: '僅接受 POST' });
  }

  // 安全開關：正式完成授權前禁止公開上傳
  if (process.env.NOMST_ENABLE_DOCUMENT_UPLOAD !== 'true') {
    return res.status(503).json({
      error: '證件上傳功能尚未正式開放'
    });
  }

  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(503).json({ error: '服務設定不完整' });
  }

  try {
    const {   requestId,   fileType,   fileBase64,   uploadToken } = req.body || {};

    if (
      typeof requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    ) {
      return res.status(400).json({ error: '預約編號格式錯誤' });
    }

    if (!TYPES[fileType] || typeof fileBase64 !== 'string') {
      return res.status(400).json({ error: '檔案格式錯誤' });
    }

    if (
      fileBase64.length > 7000000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(fileBase64) ||
      fileBase64.length % 4 !== 0
    ) {
      return res.status(400).json({ error: '檔案資料不正確' });
    }

    const buffer = Buffer.from(fileBase64, 'base64');

    if (!buffer.length || buffer.length > MAX_SIZE) {
      return res.status(413).json({ error: '檔案不可超過 5MB' });
    }

    const valid =
      (fileType === 'image/jpeg' &&
        buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ||
      (fileType === 'image/png' &&
        buffer.subarray(0, 8).equals(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        )) ||
      (fileType === 'application/pdf' &&
        buffer.subarray(0, 5).toString() === '%PDF-');

    if (!valid) {
      return res.status(400).json({ error: '檔案內容與格式不符' });
    }

    const base = SUPABASE_URL.replace(/\/$/, '');
    
    if (
      typeof uploadToken !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(uploadToken)
    ) {
      return res.status(401).json({
        error: '缺少有效的上傳憑證'
      });
    }

    const tokenHash = createHash('sha256')
      .update(uploadToken)
      .digest('hex');

    const authResponse = await fetch(
      `${base}/rest/v1/rpc/consume_document_upload_session`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_token_hash: tokenHash,
          p_request_id: requestId
        })
      }
    );

    if (!authResponse.ok) {
      return res.status(502).json({
        error: '上傳授權驗證失敗'
      });
    }

    const authorized = await authResponse.json();
    
    if (authorized !== true) {
      return res.status(403).json({
        error: '上傳憑證已過期或次數已用完'
      });
    }

    const sessionResponse = await fetch(
      `${base}/rest/v1/document_upload_sessions` +
      `?token_hash=eq.${tokenHash}` +
      `&request_id=eq.${requestId}` +
      `&select=id&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`
        }
      }
    );

    if (!sessionResponse.ok) {
      return res.status(502).json({
        error: '無法查詢上傳工作階段'
      });
    }

    const sessions = await sessionResponse.json();

    if (sessions.length !== 1) {
      return res.status(403).json({
        error: '上傳工作階段不存在'
      });
    }

    const uploadSessionId = sessions[0].id;


    if (authorized !== true) {
      return res.status(403).json({
        error: '上傳憑證已過期或次數已用完'
      });
    }

    const headers = {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`
    };

    const id = randomUUID();
    const path = `temporary/${id}.${TYPES[fileType]}`;
    const hash = createHash('sha256').update(buffer).digest('hex');

    const upload = await fetch(
      `${base}/storage/v1/object/${BUCKET}/${path}`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': fileType,
          'x-upsert': 'false'
        },
        body: buffer
      }
    );

    if (!upload.ok) {
      return res.status(502).json({ error: '私人儲存空間上傳失敗' });
    }

    const record = await fetch(
      `${base}/rest/v1/rental_document_uploads`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          id,
          request_id: requestId,
          upload_session_id: uploadSessionId,
          storage_path: path,
          file_sha256: hash,
          file_size: buffer.length,
          mime_type: fileType,
          status: 'temporary'
        })
      }
    );

    if (!record.ok) {
      const cleanup = await fetch(
        `${base}/storage/v1/object/${BUCKET}/${path}`,
        { method: 'DELETE', headers }
      );

      if (!cleanup.ok) {
        console.error('Orphaned document cleanup failed', id);
      }

      return res.status(502).json({ error: '暫存紀錄建立失敗' });
    }

    return res.status(200).json({
      ok: true,
      documentId: id,
      message: '證件已暫存'
    });

  } catch (error) {
    console.error('Document upload failed', error?.message);
    return res.status(500).json({ error: '上傳服務暫時無法使用' });
  }
}
