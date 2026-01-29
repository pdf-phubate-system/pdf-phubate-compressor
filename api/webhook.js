const { PDFDocument } = require('pdf-lib');
const axios = require('axios');
const { put } = require('@vercel/blob');
const { createCanvas, Image } = require('canvas'); // ต้องลงเพิ่ม
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const events = req.body.events || [];
  for (let event of events) {
    if (event.type === 'message' && event.message.type === 'file') {
      const { id: messageId, fileName: originalFileName } = event.message;
      if (!originalFileName.toLowerCase().endsWith('.pdf')) continue;

      try {
        // 1. แสดงสถานะกำลังคิด
        await axios.post('https://api.line.me/v2/bot/chat/loading/start', 
          { chatId: event.source.userId, loadingSeconds: 60 },
          { headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` } }
        ).catch(() => {});

        // 2. ดึงไฟล์จาก LINE
        const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
          responseType: 'arraybuffer' 
        });

        // 3. เริ่มกระบวนการบีบอัดแบบ Re-render (เหมือนใน HTML)
        const pdfData = new Uint8Array(response.data);
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdfDoc = await loadingTask.promise;
        
        const outPdfDoc = await PDFDocument.create();
        
        // วนลูปทุกหน้า
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const page = await pdfDoc.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 }); // เพิ่ม scale เพื่อความคมชัด

          const canvas = createCanvas(viewport.width, viewport.height);
          const context = canvas.getContext('2d');

          await page.render({ canvasContext: context, viewport }).promise;

          // แปลงเป็น JPEG (Quality 0.5 - 0.7 คือจุดที่ชัดแต่ไฟล์เล็ก)
          const jpegBuffer = canvas.toBuffer('image/jpeg', { quality: 0.6 });
          const embedImg = await outPdfDoc.embedJpg(jpegBuffer);

          const newPage = outPdfDoc.addPage([viewport.width, viewport.height]);
          newPage.drawImage(embedImg, {
            x: 0, y: 0,
            width: viewport.width,
            height: viewport.height,
          });
        }

        const compressedBytes = await outPdfDoc.save();

        // 4. Upload ไป Vercel Blob
        const blob = await put(`compressed_${Date.now()}.pdf`, Buffer.from(compressedBytes), {
          access: 'public',
          contentType: 'application/pdf',
        });

        // 5. ส่งปุ่มดาวน์โหลดกลับ
        await axios.post('https://api.line.me/v2/bot/message/reply', {
          replyToken: event.replyToken,
          messages: [{
            type: 'template',
            altText: 'บีบอัดไฟล์สำเร็จ',
            template: {
              type: 'buttons',
              thumbnailImageUrl: 'https://cdn-icons-png.flaticon.com/512/337/337946.png',
              title: 'บีบอัดระดับคมชัดสำเร็จ',
              text: `ขนาดเล็กลงอย่างเห็นได้ชัด!`,
              actions: [{ type: 'uri', label: 'ดาวน์โหลดไฟล์', uri: blob.url }]
            }
          }]
        }, {
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` 
          }
        });

      } catch (error) {
        console.error("Advanced Compress Error:", error);
      }
    }
  }
  return res.status(200).send('OK');
};
