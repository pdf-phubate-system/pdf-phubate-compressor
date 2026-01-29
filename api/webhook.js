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
        // 1. Start Loading Animation
        await axios.post('https://api.line.me/v2/bot/chat/loading/start', 
          { chatId: event.source.userId, loadingSeconds: 60 },
          { headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` } }
        ).catch(() => {});

        // 2. Download PDF from LINE
        const lineRes = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` },
          responseType: 'arraybuffer' 
        });

        // 3. iLovePDF Processing
        // 3.1 Authenticate
        const authRes = await axios.post('https://api.ilovepdf.com/v1/auth', {
          public_key: process.env.ILOVEPDF_PUBLIC_KEY
        });
        const token = authRes.data.token;

        // 3.2 Start Task
        const startRes = await axios.get('https://api.ilovepdf.com/v1/start/compress', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const { server, task } = startRes.data;

        // 3.3 Upload (บังคับชื่อไฟล์เป็น input.pdf เพื่อป้องกันปัญหา Encoding)
        const form = new FormData();
        form.append('task', task);
        form.append('file', Buffer.from(lineRes.data), {
            filename: 'input.pdf',
            contentType: 'application/pdf',
        });

        await axios.post(`https://${server}/v1/upload`, form, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                ...form.getHeaders() 
            }
        });

        // 3.4 Process (ใช้ระดับ recommended เพื่อความคมชัดที่สมดุล)
        await axios.post(`https://${server}/v1/process`, {
            task: task,
            tool: 'compress',
            compression_level: 'recommended'
        }, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        // 3.5 Download the result
        const downloadRes = await axios.get(`https://${server}/v1/download/${task}`, {
            headers: { 'Authorization': `Bearer ${token}` },
            responseType: 'arraybuffer'
        });

        // 4. Store in Vercel Blob (ใช้ชื่อไฟล์เดิมของ User)
        const blob = await put(originalFileName, Buffer.from(downloadRes.data), {
          access: 'public',
          contentType: 'application/pdf',
        });

        // 5. Reply to User
        await axios.post('https://api.line.me/v2/bot/message/reply', {
          replyToken: event.replyToken,
          messages: [{
            type: 'template',
            altText: 'บีบอัดไฟล์สำเร็จ',
            template: {
              type: 'buttons',
              thumbnailImageUrl: 'https://cdn-icons-png.flaticon.com/512/337/337946.png',
              title: 'บีบอัดสำเร็จ!',
              text: `ลดขนาดไฟล์เรียบร้อยแล้วครับ`,
              actions: [{ type: 'uri', label: 'ดาวน์โหลดไฟล์ (PDF)', uri: blob.url }]
            }
          }]
        }, {
          headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` }
        });

      } catch (error) {
        // --- ส่วน Debugging ขั้นละเอียด ---
        console.error("--- Error Details ---");
        if (error.response && error.response.data) {
          // นี่คือจุดที่คุณจะเห็นว่า iLovePDF ปฏิเสธเพราะอะไรใน Vercel Logs
          console.error(JSON.stringify(error.response.data, null, 2));
        } else {
          console.error(error.message);
        }

        // แจ้งเตือน User เล็กน้อย
        await axios.post('https://api.line.me/v2/bot/message/reply', {
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: 'เกิดข้อผิดพลาดในการบีบอัด กรุณาลองใหม่อีกครั้งครับ' }]
        }, { headers: { 'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}` } }).catch(() => {});
      }
    }
  }
  return res.status(200).send('OK');
};
