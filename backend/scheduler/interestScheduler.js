const cron = require('node-cron');
const { db } = require('../config/database');
const { sendInterestCreditEmail } = require('../utils/emailService');
const { shouldAccrueInterest } = require('../utils/growthTermDeposits');

// Run on the last day of every month at 11:59 PM to calculate monthly interest
cron.schedule('59 23 28-31 * *', () => {
  console.log('[INTEREST SCHEDULER] Running monthly interest calculation at', new Date().toISOString());
  calculateMonthlyInterest();
});

// Calculate monthly interest for all active savings accounts
function calculateMonthlyInterest() {
  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  
  // Check if today is the last day of the month
  if (today.getDate() !== lastDay.getDate()) {
    console.log('[INTEREST SCHEDULER] Today is not the last day of the month, skipping interest calculation');
    return;
  }

  console.log('[INTEREST SCHEDULER] Starting monthly interest calculation for all active savings accounts');

  db.all(
    `SELECT *
     FROM savings_accounts
     WHERE status = ?`,
    ['Active'],
    (err, accounts) => {
      if (err) {
        console.error('[INTEREST SCHEDULER] Error fetching accounts:', err);
        return;
      }

      console.log(`[INTEREST SCHEDULER] Found ${accounts.length} active savings accounts`);

      accounts.forEach((account) => {
        calculateAccountInterest(account);
      });
    }
  );
}

// Calculate interest for a single account
async function calculateAccountInterest(account) {
  const canAccrue = await shouldAccrueInterest(account);
  if (!canAccrue) {
    console.log(`[INTEREST SCHEDULER] Skipping account ${account.id} - interest accrual paused (missed Growth Term deposit)`);
    return;
  }

  const interestRate = account.interest_rate || 0;
  const balance = Number(account.amount || 0);
  
  if (interestRate <= 0 || balance <= 0) {
    console.log(`[INTEREST SCHEDULER] Skipping account ${account.id} - no interest or zero balance`);
    return;
  }

  // Calculate monthly interest: (Balance * Annual Rate) / 12
  const monthlyInterest = (balance * (interestRate / 100)) / 12;
  const interestAmount = Math.round(monthlyInterest * 100) / 100; // Round to 2 decimal places

  const balanceBefore = balance;
  const balanceAfter = balance + interestAmount;

  // Update account balance
  db.run(
    'UPDATE savings_accounts SET amount = ? WHERE id = ?',
    [balanceAfter, account.id],
    function(err) {
      if (err) {
        console.error(`[INTEREST SCHEDULER] Error updating balance for account ${account.id}:`, err);
        return;
      }

      // Create transaction record for interest
      const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
      db.run(
        `INSERT INTO transactions
         (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [transactionId, account.id, 'savings', 'interest', interestAmount, balanceBefore, balanceAfter, 'Monthly Interest Credit', new Date().toISOString(), 0],
        function(txnErr) {
          if (txnErr) {
            console.error(`[INTEREST SCHEDULER] Error creating transaction for account ${account.id}:`, txnErr);
          } else {
            console.log(`[INTEREST SCHEDULER] Interest calculated for account ${account.id}: ${interestAmount.toFixed(2)} ETB`);
            
            // Log to audit trail
            db.run(
              'INSERT INTO audit_trail (action, entity_type, entity_id, user_id, user_role, details, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
              ['INTEREST_CALCULATED', 'account', account.id, 0, 'SYSTEM', JSON.stringify({
                account_id: account.id,
                interest_amount: interestAmount,
                interest_rate: interestRate,
                balance_before: balanceBefore,
                balance_after: balanceAfter
              }), new Date().toISOString()],
              (auditErr) => {
                if (auditErr) console.error('[INTEREST SCHEDULER] Error logging to audit trail:', auditErr);
              }
            );

            // Notify client by email that interest was credited.
            db.get(
              'SELECT c.name as client_name, c.email as client_email FROM clients c WHERE c.id = ?',
              [account.client_id],
              async (clientErr, client) => {
                if (clientErr) {
                  console.error('[INTEREST SCHEDULER] Error loading client for interest email:', clientErr);
                  return;
                }

                if (!client?.client_email) {
                  console.log(`[INTEREST SCHEDULER] No email configured for client ${account.client_id}; skipping interest email`);
                  return;
                }

                const result = await sendInterestCreditEmail({
                  account_id: account.id,
                  client_name: client.client_name || 'Client',
                  client_email: client.client_email,
                  interest_amount: interestAmount,
                  interest_rate: interestRate,
                  balance_after: balanceAfter
                });

                db.run(
                  'INSERT INTO email_log (recipient_email, subject, body, status) VALUES (?, ?, ?, ?)',
                  [
                    client.client_email,
                    `Interest Credit Notification - ${account.id}`,
                    `Interest credit of ${interestAmount.toFixed(2)} ETB posted to account ${account.id}.`,
                    result?.success ? 'Sent' : 'Failed'
                  ],
                  (logErr) => {
                    if (logErr) {
                      console.error('[INTEREST SCHEDULER] Error logging interest credit email:', logErr);
                    }
                  }
                );
              }
            );
          }
        }
      );
    }
  );
}

// Manual trigger for testing (can be called via API)
function triggerInterestCalculation() {
  console.log('[INTEREST SCHEDULER] Manual trigger of interest calculation');
  calculateMonthlyInterest();
}

module.exports = { triggerInterestCalculation };
