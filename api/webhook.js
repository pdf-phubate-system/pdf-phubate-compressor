const line = require('@line/bot-sdk');
const { PDFDocument } = require('pdf-lib');
const axios = require('axios');
const { put } = require('@vercel/blob');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const events = req.body.events;
  for (let event of events) {
    if (event.type === 'message' && event.message.type === 'file') {
      
      const { id: messageId, fileName: originalFileName } = event.message;
      const userId = event.source.userId;

      if (!originalFileName.toLowerCase().endsWith('.pdf')) {
        await client.replyMessage(event.replyToken, { type: 'text', text: 'ขออภัยครับ รับเฉพาะไฟล์ PDF เท่านั้น' });
        continue;
      }

      try {
        // 1. ตอบรับทันทีเพื่อจองคิว (Reply Token จะหมดอายุหลังบรรทัดนี้)
        await client.replyMessage(event.replyToken, { 
          type: 'text', 
          text: `ได้รับไฟล์ "${originalFileName}" แล้วครับ กำลังบีบอัดให้...` 
        });

        // 2. ดึงข้อมูลไฟล์
        const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
          responseType: 'arraybuffer' 
        });

        // 3. กระบวนการบีบอัด
        const pdfDoc = await PDFDocument.load(response.data);
        const compressedPdfBytes = await pdfDoc.save({ useObjectStreams: true });
        const finalBuffer = Buffer.from(compressedPdfBytes);

        // 4. อัปโหลดเข้า Vercel Blob (ใช้ชื่อไฟล์ที่ปลอดภัย)
        const storageName = `comp_${Date.now()}.pdf`;
        const blob = await put(storageName, finalBuffer, {
          access: 'public',
          contentType: 'application/pdf'
        });

        // 5. เตรียมชื่อไฟล์สำหรับส่งกลับ (ตัดภาษาไทยและอักขระพิเศษออกเพื่อความชัวร์ของ API)
        const safeDisplayTitle = originalFileName.replace(/[^\x20-\x7E]/g, 'file');
        
        // 6. ส่งไฟล์กลับแบบ Push Message
        await client.pushMessage(userId, {
          type: 'file',
          originalContentUrl: blob.url,
          fileName: `compressed_${safeDisplayTitle}`,
          fileSize: finalBuffer.length
        });

      } catch (error) {
        console.error("Critical Error:", error);
        // ส่งข้อความแจ้งเตือนความผิดพลาด
        await client.pushMessage(userId, { 
          type: 'text', 
          text: `เกิดข้อผิดพลาดขณะส่งไฟล์: ${error.message}` 
        }).catch(() => {});
      }
    }
  }
  return res.status(200).send('OK');
};
