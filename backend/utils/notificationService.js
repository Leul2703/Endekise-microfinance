const https = require('https');
const { db } = require('../config/database');

const runExec = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) reject(err);
    else resolve({ lastID: this.lastID, changes: this.changes });
  });
});

const runGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});

const clientAllowsNotification = async (clientId, category = 'general') => {
  if (!clientId) return true;
  const row = await runGet(
    'SELECT notify_email, notify_sms, notify_payment_reminders FROM clients WHERE id = ?',
    [clientId]
  );
  if (!row) return true;
  if (category === 'payment_reminder' || category === 'deposit_reminder') {
    return Number(row.notify_payment_reminders ?? 1) === 1;
  }
  if (category === 'missed_deposit') {
    return true;
  }
  if (category === 'sms') {
    return Number(row.notify_sms ?? 1) === 1;
  }
  return Number(row.notify_email ?? 1) === 1;
};

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

const sendResendEmail = ({ to, subject, textContent, htmlContent }) => new Promise((resolve, reject) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    resolve({ success: false, skipped: true, error: 'RESEND_API_KEY not configured' });
    return;
  }

  const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'noreply@edekise.com';
  const payload = JSON.stringify({
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    text: textContent,
    html: htmlContent
  });

  const req = https.request(
    {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
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
          error: body || `Resend request failed with status ${res.statusCode}`
        });
      });
    }
  );

  req.on('error', (error) => reject(error));
  req.write(payload);
  req.end();
});

const getProviderOrder = () => {
  const provider = String(process.env.EMAIL_PROVIDER || 'auto').toLowerCase();
  if (provider === 'brevo') return ['brevo'];
  if (provider === 'resend') return ['resend'];
  return ['brevo', 'resend'];
};

const sendByProvider = async (provider, payload) => {
  if (provider === 'resend') {
    return sendResendEmail(payload);
  }
  return sendBrevoEmail(payload);
};

async function sendEmailReminder({ to, subject, text, html, category = 'general', metadata = {}, clientId = null }) {
  if (!to) {
    return { success: false, skipped: true, error: 'Recipient email is required' };
  }

  const resolvedClientId = clientId || metadata.client_id || metadata.clientId || null;
  const allowed = await clientAllowsNotification(resolvedClientId, category);
  if (!allowed) {
    return { success: false, skipped: true, error: 'Client has disabled this notification channel' };
  }

  const emailPayload = {
    to,
    subject,
    textContent: text,
    htmlContent: html || `<p>${String(text || '').replace(/\n/g, '<br/>')}</p>`
  };

  let result = { success: false, skipped: true, error: 'No email provider configured' };
  const attemptedProviders = [];
  for (const provider of getProviderOrder()) {
    attemptedProviders.push(provider);
    // Try the configured provider(s) in order, stop on first success.
    result = await sendByProvider(provider, emailPayload);
    if (result.success) {
      result.provider = provider;
      break;
    }
  }

  if (!result.provider && attemptedProviders.length) {
    result.provider = attemptedProviders.join(' -> ');
  }

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

  const allowed = await clientAllowsNotification(client_id, 'sms');
  if (!allowed) {
    return { success: false, skipped: true, error: 'Client has disabled SMS notifications' };
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
