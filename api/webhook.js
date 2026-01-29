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

        // 2. ดึงไฟล์ (เหมือนเดิม)
        const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
          responseType: 'arraybuffer' 
        });

        // 3. บีบอัดระดับโครงสร้างขั้นสูง (ส่วนที่ปรับปรุงใหม่)
        const pdfDoc = await PDFDocument.load(response.data);

        // เทคนิค: Copy เฉพาะหน้าออกมาสร้างไฟล์ใหม่ 
        // วิธีนี้จะช่วยล้างพวก Metadata หนาๆ หรือ Objects ที่ตกค้างในไฟล์เดิมออกไปได้ดีมาก
        const compressedPdfDoc = await PDFDocument.create();
        const pages = await compressedPdfDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());
        pages.forEach((page) => compressedPdfDoc.addPage(page));

        // เซฟแบบเน้นบีบอัดสูงสุดเท่าที่เทคนิคแบบ Non-Canvasจะทำได้
        const compressedBytes = await compressedPdfDoc.save({ 
          useObjectStreams: true,       // บีบอัดกลุ่มข้อมูล Object
          addDefaultMetadata: false,    // ไม่ใส่ Metadata พื้นฐานเพิ่ม
          updateFieldAppearances: false // ไม่ต้องสร้างหน้าตาฟอร์มใหม่
        });

        // 4. Upload ไป Vercel Blob (เหมือนเดิม)
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
