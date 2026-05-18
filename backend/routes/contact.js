const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { sendEmailReminder } = require('../utils/notificationService');

const runGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});

const runAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const runExec = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) reject(err);
    else resolve({ changes: this.changes || 0, lastID: this.lastID || null });
  });
});

const {
  normalizeText,
  normalizeEmail,
  hasEmoji,
  validateEmail,
  validateEthiopianPhone
} = require('../utils/inputValidators');

router.post('/', async (req, res) => {
  const {
    name,
    email,
    phone,
    category,
    subject,
    message
  } = req.body || {};

  const normalizedMessage = normalizeText(message);
  if (!normalizedMessage) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const emailValidation = validateEmail(email, { required: true });
  const phoneValidation = validateEthiopianPhone(phone, { required: false });

  const payload = {
    name: normalizeText(name),
    email: emailValidation.normalized,
    phone: phoneValidation.normalized,
    category: normalizeText(category) || 'complaint',
    subject: normalizeText(subject),
    message: normalizedMessage
  };

  if (emailValidation.errors.length > 0) {
    return res.status(400).json({ error: emailValidation.errors[0], details: emailValidation.errors });
  }
  if (phoneValidation.errors.length > 0) {
    return res.status(400).json({ error: phoneValidation.errors[0], details: phoneValidation.errors });
  }
  if (
    hasEmoji(payload.name) ||
    hasEmoji(payload.email) ||
    hasEmoji(payload.phone) ||
    hasEmoji(payload.subject) ||
    hasEmoji(payload.message)
  ) {
    return res.status(400).json({ error: 'Emoji characters are not allowed in this form' });
  }

  try {
    let submittedByUserId = null;
    let clientId = null;

    // Optional auth (don't block public messages)
    try {
      const header = req.headers.authorization || '';
      if (String(header).startsWith('Bearer ')) {
        await new Promise((resolve) => authenticateToken(req, res, resolve));
        submittedByUserId = req.user?.id || null;
        if (req.user?.role === 'client') {
          const client = await runGet('SELECT id, name, email, phone FROM clients WHERE lower(name) = lower(?) ORDER BY id ASC LIMIT 1', [req.user.name]);
          clientId = client?.id || null;
          if (!payload.name) payload.name = client?.name || payload.name;
          if (!payload.phone) payload.phone = client?.phone || payload.phone;
        }
      }
    } catch (e) {
      // ignore auth failures
    }

    const id = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const createdAt = new Date().toISOString();

    await runExec(
      `INSERT INTO customer_messages
       (id, submitted_by_user_id, client_id, name, email, phone, category, subject, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        submittedByUserId,
        clientId,
        payload.name || null,
        payload.email || null,
        payload.phone || null,
        payload.category || 'complaint',
        payload.subject || null,
        payload.message,
        'Pending',
        createdAt
      ]
    );

    // Customer acknowledgement (best-effort)
    if (payload.email) {
      await sendEmailReminder({
        to: payload.email,
        subject: 'We received your message',
        text: `Hello ${payload.name || ''},\n\nWe received your message and our team will review it.\n\nCategory: ${payload.category}\nSubject: ${payload.subject || 'N/A'}\nReference: ${id}\n\nThank you,\nEdekise Microfinance`,
        category: 'contact_ack',
        metadata: { message_id: id, category: payload.category }
      });
    }

    // Notify admins (best-effort)
    try {
      const admins = await runAll("SELECT email FROM users WHERE role IN ('admin','branch_manager','ceo') AND email IS NOT NULL", []);
      const subjectLine = `Customer message (${payload.category}) - ${id}`;
      const body = [
        `Reference: ${id}`,
        `Category: ${payload.category}`,
        `Subject: ${payload.subject || 'N/A'}`,
        `From: ${payload.name || 'N/A'} (${payload.email || 'no email'}, ${payload.phone || 'no phone'})`,
        `Client ID: ${clientId || 'N/A'}`,
        '',
        payload.message
      ].join('\n');
      for (const admin of admins) {
        if (!admin?.email) continue;
        await sendEmailReminder({
          to: admin.email,
          subject: subjectLine,
          text: body,
          category: 'contact_staff_notify',
          metadata: { message_id: id, category: payload.category }
        });
      }
    } catch (e) {
      // ignore
    }

    return res.status(201).json({ message: 'Message received', id, status: 'Pending' });
  } catch (error) {
    console.error('Contact message error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', authenticateToken, authorizeRoles('admin', 'branch_manager', 'ceo'), async (req, res) => {
  try {
    const rows = await runAll(
      `SELECT *
       FROM customer_messages
       ORDER BY created_at DESC
       LIMIT 300`,
      []
    );
    res.json(rows || []);
  } catch (error) {
    console.error('Contact message list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/resolve', authenticateToken, authorizeRoles('admin', 'branch_manager', 'ceo'), async (req, res) => {
  const { id } = req.params;
  const { resolution_notes } = req.body || {};
  const resolvedAt = new Date().toISOString();

  try {
    await runExec(
      `UPDATE customer_messages
       SET status = 'Resolved',
           assigned_to = COALESCE(assigned_to, ?),
           resolved_at = ?,
           resolution_notes = ?
       WHERE id = ?`,
      [req.user.id, resolvedAt, normalizeText(resolution_notes) || null, id]
    );
    res.json({ message: 'Marked as resolved' });
  } catch (error) {
    console.error('Resolve contact message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

