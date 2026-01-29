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

        // 2. บีบอัดไฟล์ PDF
        const pdfDoc = await PDFDocument.load(response.data);
        const compressedPdfBytes = await pdfDoc.save({ 
          useObjectStreams: true,
          addDefaultMetadata: false
        });

        // 3. Upload ไป Vercel Blob (ใช้ชื่อไฟล์ภาษาอังกฤษเพื่อความปลอดภัย)
        const blob = await put(`pdf_${messageId}.pdf`, Buffer.from(compressedPdfBytes), {
          access: 'public',
          contentType: 'application/pdf',
          addRandomSuffix: false
        });

        // 4. ตอบกลับด้วย Template (เสถียรกว่าการส่งไฟล์ตรงๆ)
        await client.replyMessage(event.replyToken, [
          {
            type: 'template',
            altText: 'บีบอัดไฟล์ PDF สำเร็จ!',
            template: {
              type: 'buttons',
              title: 'บีบอัดสำเร็จ!',
              text: `ไฟล์: ${originalFileName.substring(0, 40)}`,
              actions: [
                {
                  type: 'uri',
                  label: 'ดาวน์โหลดไฟล์ (PDF)',
                  uri: blob.url
                }
              ]
            }
          }
        ]);

      } catch (error) {
        console.error("API Error:", error.response ? JSON.stringify(error.response.data) : error.message);
        // แจ้งเตือนข้อผิดพลาดกลับไป
        await client.pushMessage(event.source.userId, {
          type: 'text',
          text: `เกิดข้อผิดพลาด: ${error.message}`
        }).catch(() => {});
      }
    }
  }
  return res.status(200).send('OK');
};
