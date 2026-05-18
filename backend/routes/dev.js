const express = require('express');
const router = express.Router();
const { testEmailConfig, sendEmail } = require('../utils/emailService');
const { sendEmailReminder } = require('../utils/notificationService');

// Development-only endpoints to inspect in-memory product definitions
const savingsModule = require('./savings');
// Inline loan type metadata (duplicate of backend policy) — dev-only
const LOAN_TYPE_RULES = {
  'Micro Enterprise Loan': Number(process.env.LOAN_RATE_MICRO_ENTERPRISE || 8),
  'Individual Business Loan': Number(process.env.LOAN_RATE_INDIVIDUAL_BUSINESS || 7.5),
  'Consumption Loan': Number(process.env.LOAN_RATE_CONSUMPTION || 9),
  'Construction Loan': Number(process.env.LOAN_RATE_CONSTRUCTION || 12),
  'Agricultural Business Loan': Number(process.env.LOAN_RATE_AGRICULTURAL_BUSINESS || 10)
};

const LOAN_TYPE_META = {
  'Micro Enterprise Loan': { min_amount: 50000, max_amount: 90000, repayment_min_months: 12, repayment_max_months: 24, description: 'Small business support' },
  'Individual Business Loan': { min_amount: 10000, max_amount: 50000, repayment_min_months: 1, repayment_max_months: 1, description: 'Short-term business loan' },
  'Consumption Loan': { min_amount: 10000, max_amount: 100000, organization_letter_required: true, description: 'Personal use loan' },
  'Construction Loan': { min_amount: 100000, max_amount: 500000, description: 'Housing/construction financing' },
  'Agricultural Business Loan': { min_amount: 100000, max_amount: 300000, description: 'Farming/agriculture support' }
};

router.get('/savings-options', (req, res) => {
  res.json(savingsModule.SAVINGS_OPTIONS || []);
});

router.get('/loan-types', (req, res) => {
  res.json({ rules: LOAN_TYPE_RULES, meta: LOAN_TYPE_META });
});

router.get('/email/status', async (req, res) => {
  const smtpCheck = await testEmailConfig();
  const smtpHost = process.env.EMAIL_HOST || process.env.MAIL_HOST || 'smtp-relay.brevo.com';
  const smtpPort = process.env.EMAIL_PORT || process.env.MAIL_PORT || 587;
  const smtpSecure = process.env.EMAIL_SECURE ?? process.env.MAIL_SECURE ?? String(Number(smtpPort) === 465);

  res.json({
    smtp: {
      configured: Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS),
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      from: process.env.EMAIL_FROM || process.env.SMTP_FROM || null,
      verify: smtpCheck
    },
    brevoApi: {
      configured: Boolean(process.env.BREVO_API_KEY),
      senderEmail: process.env.BREVO_SENDER_EMAIL || null,
      senderName: process.env.BREVO_SENDER_NAME || null
    }
  });
});

router.post('/email/test', async (req, res) => {
  const {
    to,
    subject = 'Edekise email test',
    message = 'This is a development email test from Edekise Microfinance.',
    mode = 'smtp'
  } = req.body || {};

  if (!to) {
    return res.status(400).json({ error: 'Recipient email is required' });
  }

  try {
    if (mode === 'brevo') {
      const result = await sendEmailReminder({
        to,
        subject,
        text: message,
        html: `<p>${String(message).replace(/\n/g, '<br/>')}</p>`,
        category: 'dev-test'
      });

      return res.json({ mode, result });
    }

    const result = await sendEmail(
      to,
      subject,
      message,
      `<p>${String(message).replace(/\n/g, '<br/>')}</p>`
    );

    return res.json({ mode: 'smtp', result });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Email test failed',
      mode
    });
  }
});

module.exports = router;
