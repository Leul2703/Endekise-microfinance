const cron = require('node-cron');
const { db } = require('../config/database');
const { sendEmailReminder, sendSMSReminder } = require('../utils/notificationService');

// Run every day at 8:00 AM to check for upcoming and late payments
cron.schedule('0 8 * * *', () => {
  console.log('[SCHEDULER] Running payment check at', new Date().toISOString());
  checkUpcomingPayments();
  checkLatePayments();
});

// Check for payments due in the next 7 days (multiple reminder intervals)
function checkUpcomingPayments() {
  const today = new Date();
  const reminderIntervals = [1, 3, 7]; // Days before due date

  for (const days of reminderIntervals) {
    const reminderDate = new Date(today);
    reminderDate.setDate(today.getDate() + days);
    const dueDate = reminderDate.toISOString().split('T')[0];

    db.all(
      `SELECT ps.*, la.client_id, c.name as client_name, c.email, c.phone
       FROM payment_schedule ps
       JOIN loan_accounts la ON ps.loan_id = la.id
       JOIN clients c ON la.client_id = c.id
       WHERE ps.due_date = ? AND ps.status = 'Pending'`,
      [dueDate],
      async (err, payments) => {
        if (err) {
          console.error('[SCHEDULER] Error checking upcoming payments:', err);
          return;
        }

        if (payments.length > 0) {
          console.log(`[SCHEDULER] Found ${payments.length} payments due in ${days} day(s)`);

          for (const payment of payments) {
            const subject = days === 0
              ? `Payment Due Today - Loan ${payment.loan_id}`
              : `Payment Reminder (${days} day${days > 1 ? 's' : ''}) - Loan ${payment.loan_id}`;
            const text = `Dear ${payment.client_name},

Your payment of ${payment.total_amount} ETB for loan ${payment.loan_id} is ${days === 0 ? 'due today' : `due in ${days} day(s)`} on ${payment.due_date}.
Please ensure the linked savings account has enough balance.

Edekise Microfinance`;

            await sendEmailReminder({
              to: payment.email,
              subject,
              text,
              category: 'payment_reminder',
              clientId: payment.client_id,
              metadata: { loan_id: payment.loan_id, due_date: payment.due_date, days_before: days, client_id: payment.client_id }
            });
            await sendSmsReminder(payment, days);
          }
        }
      }
    );
  }

  // Due today reminder
  const dueToday = today.toISOString().split('T')[0];
  db.all(
    `SELECT ps.*, la.client_id, c.name as client_name, c.email, c.phone
     FROM payment_schedule ps
     JOIN loan_accounts la ON ps.loan_id = la.id
     JOIN clients c ON la.client_id = c.id
     WHERE ps.due_date = ? AND ps.status IN ('Pending', 'Partial')`,
    [dueToday],
    async (err, payments) => {
      if (err) {
        console.error('[SCHEDULER] Error checking due-today payments:', err);
        return;
      }
      for (const payment of payments) {
        await sendEmailReminder({
          to: payment.email,
          subject: `Payment Due Today - Loan ${payment.loan_id}`,
          text: `Dear ${payment.client_name}, your payment of ${payment.total_amount} ETB is due today (${payment.due_date}).`,
          category: 'payment_reminder',
          clientId: payment.client_id,
          metadata: { loan_id: payment.loan_id, due_date: payment.due_date, client_id: payment.client_id }
        });
        await sendSmsReminder(payment, 0);
      }
    }
  );
}

// Check for late (overdue) payments
function checkLatePayments() {
  const today = new Date().toISOString().split('T')[0];

  db.all(
    `SELECT ps.*, la.client_id, c.name as client_name, c.email, c.phone 
     FROM payment_schedule ps
     JOIN loan_accounts la ON ps.loan_id = la.id
     JOIN clients c ON la.client_id = c.id
     WHERE ps.due_date < ? AND ps.status = 'Pending'`,
    [today],
    async (err, payments) => {
      if (err) {
        console.error('[SCHEDULER] Error checking late payments:', err);
        return;
      }

      console.log(`[SCHEDULER] Found ${payments.length} overdue payments`);

      for (const payment of payments) {
        // Update payment status to Overdue
        await new Promise((resolve, reject) => {
          db.run(
            "UPDATE payment_schedule SET status = 'Overdue' WHERE id = ?",
            [payment.id],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        // Send late payment notification
        await sendLatePaymentNotification(payment);
      }
    }
  );
}

// Send late payment notification
async function sendLatePaymentNotification(payment) {
  const subject = `URGENT: Late Payment - Loan ${payment.loan_id}`;
  const text = `Dear ${payment.client_name},

This is an urgent notification that your payment of ${payment.total_amount} ETB for loan ${payment.loan_id} was due on ${payment.due_date} and is now OVERDUE.

Please make payment immediately to avoid additional late fees and potential impact on your credit standing.

Loan Details:
- Loan ID: ${payment.loan_id}
- Payment Amount: ${payment.total_amount} ETB
- Due Date: ${payment.due_date} (OVERDUE)

If you have already made this payment, please disregard this notice.

Thank you,
Edekise Microfinance Team`;

  console.log(`[SCHEDULER] Late payment notification for ${payment.loan_id}: ${payment.client_name}`);
  await sendEmailReminder({
    to: payment.email,
    subject,
    text,
    category: 'payment_reminder',
    clientId: payment.client_id,
    metadata: { loan_id: payment.loan_id, due_date: payment.due_date, client_id: payment.client_id }
  });

  // Send SMS for late payment
  if (payment.phone) {
    await sendSmsReminder(payment, 0, true);
  }
}

// Send SMS reminder for upcoming payment
async function sendSmsReminder(payment, daysBefore, isLate = false) {
  if (!payment.phone) {
    console.log(`[SCHEDULER] No phone number for client ${payment.client_name}, skipping SMS`);
    return;
  }

  let message;
  if (isLate) {
    message = `URGENT: Your loan payment of ${payment.total_amount} ETB for loan ${payment.loan_id} was due on ${payment.due_date} and is OVERDUE. Please pay immediately to avoid fees.`;
  } else {
    message = `Reminder: Your loan payment of ${payment.total_amount} ETB for loan ${payment.loan_id} is due in ${daysBefore} day(s) on ${payment.due_date}. Please ensure sufficient balance in your account.`;
  }

  await sendSMSReminder({
    client_id: payment.client_id,
    phone: payment.phone,
    message,
    event_type: isLate ? 'late_payment_reminder' : 'payment_reminder',
    related_account_id: payment.loan_id,
    related_transaction_id: payment.id
  });
  console.log(`[SCHEDULER] SMS reminder logged for ${payment.client_name} (${payment.phone}) - ${daysBefore} days before due date`);
}

console.log('[SCHEDULER] Payment reminder and late payment scheduler initialized');
