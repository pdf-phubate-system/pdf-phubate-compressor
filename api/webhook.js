const line = require('@line/bot-sdk');
const { PDFDocument } = require('pdf-lib');
const axios = require('axios');
const { put } = require('@vercel/blob'); // แนะนำใช้เวอร์ชันล่าสุด

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
      const fileName = event.message.fileName;

      if (!fileName.toLowerCase().endsWith('.pdf')) {
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

        // 2. บีบอัด (pdf-lib ทำได้จำกัด แนะนำเช็คความจุด้วย)
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const compressedPdfBytes = await pdfDoc.save({ useObjectStreams: true });

        // 3. Upload ไป Vercel Blob
        const blob = await put(`compressed_${fileName}`, compressedPdfBytes, {
          access: 'public',
          contentType: 'application/pdf',
        });

        // 4. ตอบกลับด้วย Array (ส่งทีเดียว 2 ข้อความ)
        await client.replyMessage(event.replyToken, [
          { type: 'text', text: 'บีบอัดไฟล์สำเร็จแล้วครับ!' },
          {
            type: 'file',
            originalContentUrl: blob.url,
            fileName: `Compressed_${fileName}`,
            fileSize: compressedPdfBytes.length
          }
        ]);

      } catch (error) {
        console.error(error);
        // ถ้าตอบ replyToken ไปแล้วในจุดอื่น ตรงนี้อาจต้องใช้ pushMessage แทน
      }
    }
  }
  return res.status(200).send('OK');
};
