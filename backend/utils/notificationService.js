const https = require('https');
const { db } = require('../config/database');

const runExec = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) reject(err);
    else resolve({ lastID: this.lastID, changes: this.changes });
  });
});

const sendBrevoEmail = ({ to, subject, textContent, htmlContent }) => new Promise((resolve, reject) => {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    resolve({ success: false, skipped: true, error: 'BREVO_API_KEY not configured' });
    return;
  }

  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_FROM || 'noreply@edekise.com';
  const senderName = process.env.BREVO_SENDER_NAME || 'Edekise Microfinance';
  const payload = JSON.stringify({
    sender: { email: senderEmail, name: senderName },
    to: [{ email: to }],
    subject,
    textContent,
    htmlContent
  });

  const req = https.request(
    {
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
      }
    },
    (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, statusCode: res.statusCode, providerResponse: body });
          return;
        }
        resolve({
          success: false,
          statusCode: res.statusCode,
          error: body || `Brevo request failed with status ${res.statusCode}`
        });
      });
    }
  );

  req.on('error', (error) => reject(error));
  req.write(payload);
  req.end();
});

async function sendEmailReminder({ to, subject, text, html, category = 'general', metadata = {} }) {
  if (!to) {
    return { success: false, skipped: true, error: 'Recipient email is required' };
  }

  const result = await sendBrevoEmail({
    to,
    subject,
    textContent: text,
    htmlContent: html || `<p>${String(text || '').replace(/\n/g, '<br/>')}</p>`
  });

  await runExec(
    'INSERT INTO email_log (recipient_email, subject, body, status, error_message, sent_at) VALUES (?, ?, ?, ?, ?, ?)',
    [
      to,
      subject,
      text || '',
      result.success ? 'Sent' : 'Failed',
      result.success ? null : (result.error || null),
      new Date().toISOString()
    ]
  );

  return { ...result, category, metadata };
}

async function sendSMSReminder({ client_id, phone, message, event_type = 'reminder', related_account_id = null, related_transaction_id = null }) {
  if (!phone) {
    return { success: false, skipped: true, error: 'Phone number is required' };
  }

  await runExec(
    `INSERT INTO sms_notifications
     (client_id, phone_number, message_type, message, event_type, related_account_id, related_transaction_id, status, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      client_id || null,
      phone,
      event_type,
      message || '',
      event_type,
      related_account_id,
      related_transaction_id,
      'Pending',
      new Date().toISOString()
    ]
  );

  // SMS gateway integration is intentionally deferred; this keeps flow non-breaking.
  return { success: true, queued: true };
}

module.exports = {
  sendEmailReminder,
  sendSMSReminder
};
