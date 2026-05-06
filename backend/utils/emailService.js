const nodemailer = require('nodemailer');

// Email configuration (can be overridden by environment variables)
const emailConfig = {
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER || process.env.SMTP_USER,
    pass: process.env.EMAIL_PASS || process.env.SMTP_PASS
  }
};

// Create transporter (lazy initialization)
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport(emailConfig);
  }
  return transporter;
}

/**
 * Send email
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} text - Plain text body
 * @param {string} html - HTML body (optional)
 * @returns {Promise} - Resolves with send result
 */
async function sendEmail(to, subject, text, html = null) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.SMTP_FROM || 'noreply@edekise.com',
      to,
      subject,
      text
    };

    if (html) {
      mailOptions.html = html;
    }

    const transporter = getTransporter();
    const info = await transporter.sendMail(mailOptions);
    
    console.log(`[EMAIL] Email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Error sending email:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send payment reminder email
 * @param {Object} payment - Payment object with client details
 * @returns {Promise} - Resolves with send result
 */
async function sendPaymentReminder(payment) {
  const subject = `Payment Reminder - Loan ${payment.loan_id}`;
  const text = `Dear ${payment.client_name},

This is a reminder that your payment of ${payment.total_amount} ETB for loan ${payment.loan_id} is due on ${payment.due_date}.

Please ensure timely payment to avoid late fees.

Loan Details:
- Loan ID: ${payment.loan_id}
- Payment Amount: ${payment.total_amount} ETB
- Due Date: ${payment.due_date}

Thank you,
Edekise Microfinance Team`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #667eea;">Payment Reminder</h2>
      <p>Dear ${payment.client_name},</p>
      <p>This is a reminder that your payment of <strong>${payment.total_amount} ETB</strong> for loan <strong>${payment.loan_id}</strong> is due on <strong>${payment.dueDate}</strong>.</p>
      
      <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Loan Details:</h3>
        <ul style="list-style: none; padding: 0;">
          <li><strong>Loan ID:</strong> ${payment.loan_id}</li>
          <li><strong>Payment Amount:</strong> ${payment.total_amount} ETB</li>
          <li><strong>Due Date:</strong> ${payment.dueDate}</li>
        </ul>
      </div>
      
      <p>Please ensure timely payment to avoid late fees.</p>
      
      <p style="margin-top: 30px;">Thank you,<br>Edekise Microfinance Team</p>
    </div>
  `;

  return sendEmail(payment.email, subject, text, html);
}

/**
 * Send welcome email to new client
 * @param {Object} client - Client object with details
 * @returns {Promise} - Resolves with send result
 */
async function sendWelcomeEmail(client) {
  const subject = 'Welcome to Edekise Microfinance';
  const text = `Dear ${client.name},

Welcome to Edekise Microfinance!

We are pleased to have you as our valued client. Our team is committed to providing you with excellent financial services tailored to your needs.

Your account has been successfully created. You can now access our services through our client portal.

If you have any questions or need assistance, please don't hesitate to contact us.

Best regards,
Edekise Microfinance Team`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #667eea;">Welcome to Edekise Microfinance!</h2>
      <p>Dear ${client.name},</p>
      <p>We are pleased to have you as our valued client. Our team is committed to providing you with excellent financial services tailored to your needs.</p>
      
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: white;">Account Created Successfully</h3>
        <p>Your account has been successfully created. You can now access our services through our client portal.</p>
      </div>
      
      <p>If you have any questions or need assistance, please don't hesitate to contact us.</p>
      
      <p style="margin-top: 30px;">Best regards,<br>Edekise Microfinance Team</p>
    </div>
  `;

  return sendEmail(client.email, subject, text, html);
}

/**
 * Send loan approval email
 * @param {Object} loan - Loan object with client details
 * @returns {Promise} - Resolves with send result
 */
async function sendLoanApprovalEmail(loan) {
  const subject = `Loan Application Approved - ${loan.id}`;
  const text = `Dear ${loan.client_name},

We are pleased to inform you that your loan application has been approved.

Loan Details:
- Loan ID: ${loan.id}
- Amount: ${parseFloat(loan.amount).toLocaleString()} ETB
- Interest Rate: ${loan.interest_rate}%
- Term: ${loan.term}
- Payment Frequency: ${loan.payment_frequency}

Your loan is now active and you can begin making repayments according to the schedule.

Thank you for choosing Edekise Microfinance.

Best regards,
Edekise Microfinance Team`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10b981;">Loan Application Approved!</h2>
      <p>Dear ${loan.client_name},</p>
      <p>We are pleased to inform you that your loan application has been approved.</p>
      
      <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #86efac;">
        <h3 style="margin-top: 0; color: #166534;">Loan Details:</h3>
        <ul style="list-style: none; padding: 0;">
          <li><strong>Loan ID:</strong> ${loan.id}</li>
          <li><strong>Amount:</strong> ${parseFloat(loan.amount).toLocaleString()} ETB</li>
          <li><strong>Interest Rate:</strong> ${loan.interest_rate}%</li>
          <li><strong>Term:</strong> ${loan.term}</li>
          <li><strong>Payment Frequency:</strong> ${loan.payment_frequency}</li>
        </ul>
      </div>
      
      <p>Your loan is now active and you can begin making repayments according to the schedule.</p>
      
      <p style="margin-top: 30px;">Thank you for choosing Edekise Microfinance.<br>Best regards,<br>Edekise Microfinance Team</p>
    </div>
  `;

  return sendEmail(loan.client_email, subject, text, html);
}

/**
 * Send loan rejection email
 * @param {Object} loan - Loan object with client details and rejection reason
 * @returns {Promise} - Resolves with send result
 */
async function sendLoanRejectionEmail(loan, reason) {
  const subject = `Loan Application Update - ${loan.id}`;
  const text = `Dear ${loan.client_name},

We regret to inform you that your loan application has been reviewed and could not be approved at this time.

Loan Details:
- Loan ID: ${loan.id}
- Amount: ${parseFloat(loan.amount).toLocaleString()} ETB
- Reason for Rejection: ${reason || 'Not specified'}

If you have any questions about this decision or would like to discuss alternative options, please contact our team.

Thank you for considering Edekise Microfinance.

Best regards,
Edekise Microfinance Team`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ef4444;">Loan Application Update</h2>
      <p>Dear ${loan.client_name},</p>
      <p>We regret to inform you that your loan application has been reviewed and could not be approved at this time.</p>
      
      <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #fca5a5;">
        <h3 style="margin-top: 0; color: #991b1b;">Loan Details:</h3>
        <ul style="list-style: none; padding: 0;">
          <li><strong>Loan ID:</strong> ${loan.id}</li>
          <li><strong>Amount:</strong> ${parseFloat(loan.amount).toLocaleString()} ETB</li>
          <li><strong>Reason for Rejection:</strong> ${reason || 'Not specified'}</li>
        </ul>
      </div>
      
      <p>If you have any questions about this decision or would like to discuss alternative options, please contact our team.</p>
      
      <p style="margin-top: 30px;">Thank you for considering Edekise Microfinance.<br>Best regards,<br>Edekise Microfinance Team</p>
    </div>
  `;

  return sendEmail(loan.client_email, subject, text, html);
}

/**
 * Send interest credit notification email
 * @param {Object} data - Object with account details and interest amount
 * @returns {Promise} - Resolves with send result
 */
async function sendInterestCreditEmail(data) {
  const subject = `Interest Credit Notification - ${data.account_id}`;
  const text = `Dear ${data.client_name},

We are pleased to inform you that interest has been credited to your account.

Account Details:
- Account ID: ${data.account_id}
- Interest Amount: ${data.interest_amount.toFixed(2)} ETB
- Interest Rate: ${data.interest_rate}%
- Current Balance: ${data.balance_after.toFixed(2)} ETB

This interest has been automatically calculated and credited to your account based on your account type and balance.

Thank you for banking with Edekise Microfinance.

Best regards,
Edekise Microfinance Team`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #8b5cf6;">Interest Credit Notification</h2>
      <p>Dear ${data.client_name},</p>
      <p>We are pleased to inform you that interest has been credited to your account.</p>
      
      <div style="background: #f5f3ff; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #d8b4fe;">
        <h3 style="margin-top: 0; color: #6b21a8;">Account Details:</h3>
        <ul style="list-style: none; padding: 0;">
          <li><strong>Account ID:</strong> ${data.account_id}</li>
          <li><strong>Interest Amount:</strong> ${data.interest_amount.toFixed(2)} ETB</li>
          <li><strong>Interest Rate:</strong> ${data.interest_rate}%</li>
          <li><strong>Current Balance:</strong> ${data.balance_after.toFixed(2)} ETB</li>
        </ul>
      </div>
      
      <p>This interest has been automatically calculated and credited to your account based on your account type and balance.</p>
      
      <p style="margin-top: 30px;">Thank you for banking with Edekise Microfinance.<br>Best regards,<br>Edekise Microfinance Team</p>
    </div>
  `;

  return sendEmail(data.client_email, subject, text, html);
}

/**
 * Send large transaction approval request email
 * @param {Object} data - Object with transaction details
 * @returns {Promise} - Resolves with send result
 */
async function sendApprovalRequestEmail(data) {
  const subject = `Transaction Approval Required - ${data.entity_id}`;
  const text = `Dear Manager,

A large transaction requires your approval for processing.

Transaction Details:
- Entity ID: ${data.entity_id}
- Type: ${data.type}
- Amount: ${parseFloat(data.amount).toLocaleString()} ETB
- Requested By: ${data.requested_by_name}
- Requested At: ${new Date(data.created_at).toLocaleString()}

Please review this transaction in the approval portal to approve or reject it.

Best regards,
Edekise Microfinance System`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #f59e0b;">Transaction Approval Required</h2>
      <p>Dear Manager,</p>
      <p>A large transaction requires your approval for processing.</p>
      
      <div style="background: #fefce8; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #fde047;">
        <h3 style="margin-top: 0; color: #854d0e;">Transaction Details:</h3>
        <ul style="list-style: none; padding: 0;">
          <li><strong>Entity ID:</strong> ${data.entity_id}</li>
          <li><strong>Type:</strong> ${data.type}</li>
          <li><strong>Amount:</strong> ${parseFloat(data.amount).toLocaleString()} ETB</li>
          <li><strong>Requested By:</strong> ${data.requested_by_name}</li>
          <li><strong>Requested At:</strong> ${new Date(data.created_at).toLocaleString()}</li>
        </ul>
      </div>
      
      <p>Please review this transaction in the approval portal to approve or reject it.</p>
      
      <p style="margin-top: 30px;">Best regards,<br>Edekise Microfinance System</p>
    </div>
  `;

  return sendEmail(data.manager_email, subject, text, html);
}

/**
 * Test email configuration
 * @returns {Promise} - Resolves with test result
 */
async function testEmailConfig() {
  try {
    const transporter = getTransporter();
    await transporter.verify();
    console.log('[EMAIL] Email configuration verified successfully');
    return { success: true, message: 'Email configuration verified' };
  } catch (error) {
    console.error('[EMAIL] Email configuration test failed:', error);
    return { success: false, error: error.message };
  }
}

const emailService = {
  sendEmail,
  sendPaymentReminder,
  sendWelcomeEmail,
  sendLoanApprovalEmail,
  sendLoanRejectionEmail,
  sendInterestCreditEmail,
  sendApprovalRequestEmail,
  testEmailConfig
};

module.exports = {
  ...emailService,
  emailService
};
