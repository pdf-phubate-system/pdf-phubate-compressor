const line = require('@line/bot-sdk');
const { PDFDocument } = require('pdf-lib');
const axios = require('axios');

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
      if (!event.message.fileName.toLowerCase().endsWith('.pdf')) {
          await client.replyMessage(event.replyToken, { type: 'text', text: 'กรุณาส่งไฟล์ PDF เท่านั้นครับ' });
          continue;
      }
      await client.replyMessage(event.replyToken, { type: 'text', text: 'ได้รับไฟล์แล้ว กำลังบีบอัด... (เวอร์ชันเต็มจะบีบและส่งกลับทันที)' });
    }
  }
  return res.status(200).send('OK');
};
