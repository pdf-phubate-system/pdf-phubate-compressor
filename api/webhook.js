const line = require('@line/bot-sdk');
const { PDFDocument } = require('pdf-lib');
const axios = require('axios');
const { put } = require('@vercel/blob'); // นำเข้า Vercel Blob SDK

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
      
      // ตรวจสอบว่าเป็น PDF ไหม
      if (!event.message.fileName.toLowerCase().endsWith('.pdf')) {
          await client.replyMessage(event.replyToken, { type: 'text', text: 'กรุณาส่งไฟล์ PDF เท่านั้นครับ' });
          continue;
      }
      
      // ส่งข้อความแจ้งผู้ใช้ว่ากำลังดำเนินการ
      await client.replyMessage(event.replyToken, { type: 'text', text: 'ได้รับไฟล์ PDF แล้ว กำลังดำเนินการบีบอัดไฟล์ กรุณารอสักครู่...' });

      // เริ่มกระบวนการบีบอัดและอัปโหลด
      try {
        const messageId = event.message.id;
        const fileName = event.message.fileName;

        // --- 1. ดึงไฟล์จาก LINE API ---
        const response = await axios.get(`https://api-data.line.me{messageId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
          responseType: 'arraybuffer' 
        });
        const pdfBuffer = response.data;

        // --- 2. บีบอัดไฟล์ PDF ด้วย pdf-lib ---
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const compressedPdfBytes = await pdfDoc.save({
          useObjectStreams: true, 
          addDefaultMetadata: false
        });

        // --- 3. อัปโหลดไฟล์ที่บีบอัดแล้วไปที่ Vercel Blob Storage ---
        // ตั้งชื่อไฟล์ให้ไม่ซ้ำกัน
        const blob = await put(`compressed_${messageId}_${fileName}`, compressedPdfBytes, {
          access: 'public', 
          contentType: 'application/pdf',
          addRandomSuffix: false
        });

        // --- 4. ส่ง URL ของไฟล์กลับไปให้ผู้ใช้ใน LINE ---
        await client.replyMessage(event.replyToken, {
          type: 'file',
          originalContentUrl: blob.url, // URL ที่ได้จาก Vercel Blob
          fileName: `Compressed_${fileName}`,
          fileSize: compressedPdfBytes.length
        });

      } catch (error) {
        console.error("Error during compression or upload:", error);
        await client.replyMessage(event.replyToken, { type: 'text', text: 'เกิดข้อผิดพลาดในการบีบอัดไฟล์ครับ' });
      }
    }
  }
  return res.status(200).send('OK');
};
