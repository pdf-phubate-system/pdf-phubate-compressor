const { PDFDocument } = require('pdf-lib');
const axios = require('axios');
const { put } = require('@vercel/blob');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const events = req.body.events || [];
  for (let event of events) {
    if (event.type === 'message' && event.message.type === 'file') {
      const { id: messageId, fileName: originalFileName } = event.message;
      const replyToken = event.replyToken;

      if (!originalFileName.toLowerCase().endsWith('.pdf')) continue;

      try {
        // 1. แสดง Loading ทันที (ใช้ axios ยิงตรง ไม่ผ่าน SDK)
        await axios.post('https://api.line.me/v2/bot/chat/loading/start', 
          { chatId: event.source.userId, loadingSeconds: 30 },
          { headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` } }
        ).catch(() => {});

        // 2. ดึงไฟล์ PDF จาก LINE
        const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
          responseType: 'arraybuffer' 
        });

        // 3. บีบอัดไฟล์
        const pdfDoc = await PDFDocument.load(response.data);
        const compressedBytes = await pdfDoc.save({ useObjectStreams: true });

        // 4. ฝากไฟล์ที่ Vercel Blob (ใช้ชื่อสั้นๆ ป้องกัน URL พัง)
        const blob = await put(`f_${Date.now()}.pdf`, Buffer.from(compressedBytes), {
          access: 'public',
          contentType: 'application/pdf',
        });

        // 5. ส่งไฟล์กลับ (หัวใจสำคัญ: ไม่ใส่ fileSize และใช้ชื่อไฟล์ที่ Clean แล้ว)
        // การยิง JSON ตรงแบบนี้จะเสถียรกว่าการใช้ SDK ในบางกรณีครับ
        await axios.post('https://api.line.me/v2/bot/message/reply', {
          replyToken: replyToken,
          messages: [{
            type: 'file',
            originalContentUrl: blob.url,
            fileName: `Compressed_${originalFileName.replace(/[^\x20-\x7E]/g, '') || 'document.pdf'}`
          }]
        }, {
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` 
          }
        });

      } catch (error) {
        console.error("Final Attempt Error:", error.response ? error.response.data : error.message);
      }
    }
  }
  return res.status(200).send('OK');
};
