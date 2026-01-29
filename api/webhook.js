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

      // กรองเฉพาะไฟล์ PDF
      if (!originalFileName.toLowerCase().endsWith('.pdf')) continue;

      try {
        // 1. แสดง Loading Animation ทันที (ยิง API ตรง)
        await axios.post('https://api.line.me/v2/bot/chat/loading/start', 
          { chatId: event.source.userId, loadingSeconds: 30 },
          { headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` } }
        ).catch(() => {});

        // 2. ดึงไฟล์จาก LINE
        const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
          responseType: 'arraybuffer' 
        });

        // 3. บีบอัดไฟล์ PDF
        const pdfDoc = await PDFDocument.load(response.data);
        const compressedBytes = await pdfDoc.save({ useObjectStreams: true });
        const finalBuffer = Buffer.from(compressedBytes);

        // 4. Upload ไป Vercel Blob (ใช้ชื่อสั้นๆ เพื่อให้ URL ปลอดภัย)
        const blob = await put(`comp_${Date.now()}.pdf`, finalBuffer, {
          access: 'public',
          contentType: 'application/pdf',
        });

        // 5. ส่งไฟล์กลับแบบดิบ (Raw JSON) - ไม่ใส่ fileSize และล้างชื่อไฟล์ให้สะอาด
        // วิธีนี้จะลดโอกาสเกิด Error 400 ได้ดีที่สุด
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
        // บันทึก Log กรณีเกิดข้อผิดพลาดเพื่อดูสาเหตุที่แท้จริง
        console.error("API Error Response:", error.response ? JSON.stringify(error.response.data) : error.message);
      }
    }
  }
  return res.status(200).send('OK');
};
