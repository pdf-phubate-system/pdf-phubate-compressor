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
        // 1. แสดง Loading
        await axios.post('https://api.line.me/v2/bot/chat/loading/start', 
          { chatId: event.source.userId, loadingSeconds: 30 },
          { headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` } }
        ).catch(() => {});

        // 2. ดึงไฟล์
        const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
          responseType: 'arraybuffer' 
        });

        // 3. บีบอัดระดับโครงสร้าง (Structure Compression)
        const pdfDoc = await PDFDocument.load(response.data);
        
        // ล้าง Metadata ที่ไม่จำเป็นออกเพื่อลดขนาด
        pdfDoc.setTitle('');
        pdfDoc.setAuthor('');
        pdfDoc.setSubject('');
        pdfDoc.setCreator('');
        
        // เซฟแบบบีบอัด Object Streams (หัวใจสำคัญของการลดขนาดแบบไม่ต้องใช้ Canvas)
        const compressedBytes = await pdfDoc.save({ 
          useObjectStreams: true, // รวม Object เล็กๆ เข้าด้วยกันเพื่อลดขนาด
          addDefaultMetadata: false // ตัด Metadata พื้นฐานออก
        });

        // 4. Upload ไป Vercel Blob
        const blob = await put(`comp_${Date.now()}.pdf`, Buffer.from(compressedBytes), {
          access: 'public',
          contentType: 'application/pdf',
        });

        // 5. ส่งกลับด้วยปุ่มดาวน์โหลด
        await axios.post('https://api.line.me/v2/bot/message/reply', {
          replyToken: replyToken,
          messages: [{
            type: 'template',
            altText: 'บีบอัดไฟล์สำเร็จ',
            template: {
              type: 'buttons',
              thumbnailImageUrl: 'https://cdn-icons-png.flaticon.com/512/337/337946.png',
              title: 'บีบอัดสำเร็จ!',
              text: `ขนาดเล็กลงแล้ว กดโหลดได้เลยครับ`,
              actions: [{ type: 'uri', label: 'ดาวน์โหลดไฟล์ (PDF)', uri: blob.url }]
            }
          }]
        }, {
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` 
          }
        });

      } catch (error) {
        console.error("Error:", error.message);
      }
    }
  }
  return res.status(200).send('OK');
};
