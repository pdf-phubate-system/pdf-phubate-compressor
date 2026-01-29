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
      const originalFileName = event.message.fileName;

      // ตรวจสอบว่าเป็น PDF หรือไม่
      if (!originalFileName.toLowerCase().endsWith('.pdf')) {
        await client.replyMessage(event.replyToken, { type: 'text', text: 'กรุณาส่งไฟล์ PDF เท่านั้นครับ' });
        continue;
      }

      try {
        // 1. ดึงไฟล์จาก LINE
        const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
          responseType: 'arraybuffer' 
        });
        const pdfBuffer = response.data;

        // 2. บีบอัดไฟล์ PDF
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const compressedPdfBytes = await pdfDoc.save({ 
          useObjectStreams: true,
          addDefaultMetadata: false 
        });

        // 3. Upload ไป Vercel Blob (ใช้ชื่อไฟล์ภาษาอังกฤษเพื่อความปลอดภัยของ URL)
        const safeFileName = `compressed_${messageId}.pdf`;
        const blob = await put(safeFileName, Buffer.from(compressedPdfBytes), {
          access: 'public',
          contentType: 'application/pdf',
          addRandomSuffix: false
        });

        // 4. ตอบกลับด้วย Array (ส่งข้อความพร้อมไฟล์)
        // หมายเหตุ: fileName ในส่วนนี้ LINE อนุญาตให้เป็นภาษาไทยได้ แต่แนะนำให้ตัดคำนำหน้าออกสั้นๆ
        await client.replyMessage(event.replyToken, [
          { type: 'text', text: 'บีบอัดไฟล์สำเร็จแล้วครับ! กำลังส่งไฟล์ให้...' },
          {
            type: 'file',
            originalContentUrl: blob.url,
            fileName: `Compressed_${originalFileName.replace(/\s+/g, '_')}`,
            fileSize: compressedPdfBytes.length
          }
        ]);

        console.log(`Success: ${blob.url}`);

      } catch (error) {
        console.error("Detailed Error:", error.response ? error.response.data : error.message);
        // พยายามแจ้งเตือนผู้ใช้หากยังใช้ replyToken ได้
        try {
          await client.pushMessage(event.source.userId, { 
            type: 'text', 
            text: `ขออภัย เกิดข้อผิดพลาด: ${error.message}` 
          });
        } catch (e) {
          console.error("Could not send error message to user");
        }
      }
    }
  }
  return res.status(200).send('OK');
};
