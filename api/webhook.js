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
      
      const messageId = event.message.id;
      const userId = event.source.userId;
      const originalFileName = event.message.fileName;

      if (!originalFileName.toLowerCase().endsWith('.pdf')) {
        await client.replyMessage(event.replyToken, { type: 'text', text: 'กรุณาส่งไฟล์ PDF เท่านั้นครับ' });
        continue;
      }

      try {
        // 1. ตอบกลับทันที (ใช้ Reply Token)
        await client.replyMessage(event.replyToken, { 
          type: 'text', 
          text: `ได้รับไฟล์ "${originalFileName}" แล้วครับ กำลังบีบอัดไฟล์ให้ รอสักครู่...` 
        });

        // 2. ดึงไฟล์จาก LINE
        const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
          responseType: 'arraybuffer' 
        });

        // 3. บีบอัดไฟล์ PDF
        const pdfDoc = await PDFDocument.load(response.data);
        const compressedPdfBytes = await pdfDoc.save({ useObjectStreams: true });

        // 4. Upload ไป Vercel Blob (ใช้ชื่อภาษาอังกฤษเพื่อความเสถียรของ URL)
        const blob = await put(`out_${messageId}.pdf`, Buffer.from(compressedPdfBytes), {
          access: 'public',
          contentType: 'application/pdf',
          addRandomSuffix: false
        });

        // 5. ส่งไฟล์กลับ (ใช้ Push Message เพราะ Reply Token ถูกใช้ไปแล้ว)
        await client.pushMessage(userId, {
          type: 'file',
          originalContentUrl: blob.url,
          fileName: `Compressed_${originalFileName.replace(/[^\x00-\x7F]/g, "") || "file"}.pdf`, // ตัดตัวอักษรพิเศษในชื่อไฟล์ออกชั่วคราวเพื่อกัน Error
          fileSize: compressedPdfBytes.length
        });

        // ส่งข้อความปิดท้าย
        await client.pushMessage(userId, { type: 'text', text: 'บีบอัดไฟล์เสร็จเรียบร้อยครับ!' });

      } catch (error) {
        console.error("Error:", error.message);
        await client.pushMessage(userId, { type: 'text', text: `เกิดข้อผิดพลาด: ${error.message}` });
      }
    }
  }
  return res.status(200).send('OK');
};
