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
  // รับเฉพาะ POST Request
  if (req.method !== 'POST') return res.status(200).send('OK');

  const events = req.body.events;
  for (let event of events) {
    // กรองเฉพาะ Message ที่เป็น File
    if (event.type === 'message' && event.message.type === 'file') {
      
      const { id: messageId, fileName: originalFileName } = event.message;

      // 1. ตรวจสอบนามสกุลไฟล์
      if (!originalFileName.toLowerCase().endsWith('.pdf')) {
        // ตอบกลับทันทีถ้าไม่ใช่ PDF
        await client.replyMessage(event.replyToken, { type: 'text', text: 'ส่งได้เฉพาะไฟล์ PDF เท่านั้นครับ' });
        continue;
      }

      try {
        // 2. แสดง Loading Animation (ฟีเจอร์ใหม่ของ LINE)
        // ใส่ไว้ใน try-catch เผื่อ SDK เวอร์ชั่นเก่าหรือมีปัญหา จะได้ไม่ทำให้บอทพัง
        try {
          if (event.source.userId) {
            await client.showLoadingAnimation({
              chatId: event.source.userId,
              loadingSeconds: 20 // แสดงสถานะโหลดนานสุด 20 วินาที
            });
          }
        } catch (animError) {
          console.log("Loading animation skipped:", animError.message);
        }

        // 3. เริ่มกระบวนการดาวน์โหลดไฟล์จาก LINE
        const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
          responseType: 'arraybuffer' 
        });

        // 4. บีบอัดไฟล์ PDF
        const pdfDoc = await PDFDocument.load(response.data);
        const compressedPdfBytes = await pdfDoc.save({ useObjectStreams: true });
        
        // 5. อัปโหลดไป Vercel Blob
        // สำคัญ: ตั้งชื่อไฟล์ใน Storage เป็นภาษาอังกฤษ/ตัวเลข เพื่อให้ URL ปลอดภัย 100%
        const safeStorageName = `compressed_${Date.now()}_${messageId}.pdf`;
        const blob = await put(safeStorageName, Buffer.from(compressedPdfBytes), {
          access: 'public',
          contentType: 'application/pdf',
          addRandomSuffix: false
        });

        // 6. ส่งไฟล์กลับ (Reply ครั้งเดียวจบ)
        // ใช้ชื่อไฟล์เดิมของผู้ใช้ในการแสดงผล (LINE รองรับภาษาไทยใน property นี้)
        await client.replyMessage(event.replyToken, {
          type: 'file',
          originalContentUrl: blob.url,
          fileName: `Compressed_${originalFileName}`, 
          // ไม่ใส่ fileSize เพื่อให้ LINE จัดการโหลด Header เอง (ลดโอกาส Error 400)
        });

      } catch (error) {
        console.error("Critical Error:", error);
        // กรณีเกิด Error จริงๆ และ Token ยังไม่ถูกใช้ ให้แจ้งเตือนกลับไป
        try {
          await client.replyMessage(event.replyToken, { 
            type: 'text', 
            text: `ขออภัย เกิดข้อผิดพลาด: ${error.message}` 
          });
        } catch (e) {
          // Token อาจจะหมดอายุแล้ว ทำอะไรไม่ได้
        }
      }
    }
  }
  
  return res.status(200).send('OK');
};
