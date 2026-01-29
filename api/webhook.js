const axios = require('axios');
const { put } = require('@vercel/blob');
const FormData = require('form-data');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const events = req.body.events || [];
  for (let event of events) {
    if (event.type === 'message' && event.message.type === 'file') {
      const { id: messageId, fileName: originalFileName } = event.message;
      if (!originalFileName.toLowerCase().endsWith('.pdf')) continue;

      try {
        // 1. Loading
        await axios.post('https://api.line.me/v2/bot/chat/loading/start', 
          { chatId: event.source.userId, loadingSeconds: 60 },
          { headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` } }
        ).catch(() => {});

        // 2. ดึงไฟล์จาก LINE
        const lineRes = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
          responseType: 'arraybuffer' 
        });

        // 3. เริ่มกระบวนการ iLovePDF
        // 3.1 Auth
        const authRes = await axios.post('https://api.ilovepdf.com/v1/auth', {
          public_key: process.env.ILOVEPDF_PUBLIC_KEY
        });
        const token = authRes.data.token;

        // 3.2 Start Task
        const startRes = await axios.get('https://api.ilovepdf.com/v1/start/compress', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const { server, task } = startRes.data;

        // 3.3 Upload (ปรับปรุงใหม่ให้ระบุไฟล์ละเอียดขึ้น)
        const form = new FormData();
        form.append('task', task);
        
        // ระบุ filename และ contentType เพื่อให้ iLovePDF รู้ว่าเป็น PDF แน่นอน
        form.append('file', Buffer.from(lineRes.data), {
          filename: originalFileName || 'document.pdf',
          contentType: 'application/pdf',
        });

        await axios.post(`https://${server}/v1/upload`, form, {
          headers: { 
            'Authorization': `Bearer ${token}`,
            ...form.getHeaders() // ดึง Header ที่ถูกต้องของ FormData มาใช้
          }
        });

        // 3.4 Process (แนะนำให้ใช้ recommended เพื่อความปลอดภัย)
        await axios.post(`https://${server}/v1/process`, {
          task,
          tool: 'compress',
          compression_level: 'recommended' 
        }, { headers: { 'Authorization': `Bearer ${token}` } });

        // 3.5 Download
        const downloadRes = await axios.get(`https://${server}/v1/download/${task}`, {
          headers: { 'Authorization': `Bearer ${token}` },
          responseType: 'arraybuffer'
        });

        // 4. ฝากไฟล์ที่ Vercel Blob
        const blob = await put(`min_${Date.now()}.pdf`, Buffer.from(downloadRes.data), {
          access: 'public',
          contentType: 'application/pdf',
        });

        // 5. ตอบกลับ
        await axios.post('https://api.line.me/v2/bot/message/reply', {
          replyToken: event.replyToken,
          messages: [{
            type: 'template',
            altText: 'บีบอัดไฟล์สำเร็จ',
            template: {
              type: 'buttons',
              thumbnailImageUrl: 'https://cdn-icons-png.flaticon.com/512/337/337946.png',
              title: 'บีบอัดเสร็จแล้ว!',
              text: `ไฟล์: ${originalFileName.substring(0, 30)}`,
              actions: [{ type: 'uri', label: 'ดาวน์โหลด (เล็กลงมาก)', uri: blob.url }]
            }
          }]
        }, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` }
        });

      } catch (error) {
        console.error("iLovePDF Error:", error.response ? error.response.data : error.message);
      }
    }
  }
  return res.status(200).send('OK');
};
