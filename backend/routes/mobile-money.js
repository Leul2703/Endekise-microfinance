const express = require('express');
const router = express.Router();
const db = require('../config/database.sqlite');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { generateTransactionId } = require('../utils/loanWorkflow');

// Process mobile money deposit
router.post('/deposit', authenticateToken, authorizeRoles('admin', 'branch_manager', 'saving_staff'), async (req, res) => {
  const { account_id, amount, platform, phone_number, reference_number, description } = req.body;
  const userId = req.user.id;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0' });
  }

  if (!platform || !phone_number) {
    return res.status(400).json({ error: 'Platform and phone number are required for mobile money' });
  }

  try {
    // Get account details
    const account = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM savings_accounts WHERE id = ?', [account_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (account.status !== 'Active') {
      return res.status(400).json({ error: 'Account is not active' });
    }

    const balanceBefore = account.amount;
    const balanceAfter = balanceBefore + amount;

    // Create transaction record
    const transactionId = generateTransactionId();
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [transactionId, account_id, 'savings', 'deposit', amount, balanceBefore, balanceAfter, description || 'Mobile money deposit', userId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Create mobile money transaction record
    const mobileMoneyId = `MM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO mobile_money_transactions (id, transaction_id, platform, phone_number, reference_number, amount, transaction_type, status, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [mobileMoneyId, transactionId, platform, phone_number, reference_number || null, amount, 'deposit', 'Completed', new Date().toISOString()],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Update account balance
    await new Promise((resolve, reject) => {
      db.run('UPDATE savings_accounts SET amount = ? WHERE id = ?', [balanceAfter, account_id], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    // Create SMS notification
    const client = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM clients WHERE id = ?', [account.client_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (client && client.phone) {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO sms_notifications (client_id, phone_number, message_type, message, event_type, related_account_id, related_transaction_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [client.id, client.phone, 'deposit_alert', `Deposit of ${amount} ETB received via ${platform}. New balance: ${balanceAfter} ETB`, 'deposit', account_id, transactionId, 'Pending'],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    res.json({
      message: 'Mobile money deposit successful',
      transaction: {
        id: transactionId,
        amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        platform,
        phone_number
      },
      account: {
        id: account.id,
        balance: balanceAfter
      }
    });
  } catch (error) {
    console.error('Mobile money deposit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Process mobile money withdrawal
router.post('/withdraw', authenticateToken, authorizeRoles('admin', 'branch_manager', 'saving_staff', 'client'), async (req, res) => {
  const { account_id, amount, platform, phone_number, description } = req.body;
  const userId = req.user.id;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0' });
  }

  if (!platform || !phone_number) {
    return res.status(400).json({ error: 'Platform and phone number are required for mobile money' });
  }

  try {
    // Get account details
    const account = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM savings_accounts WHERE id = ?', [account_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (account.status !== 'Active') {
      return res.status(400).json({ error: 'Account is not active' });
    }

    if (amount > account.amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const balanceBefore = account.amount;
    const balanceAfter = balanceBefore - amount;

    // Create transaction record
    const transactionId = generateTransactionId();
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [transactionId, account_id, 'savings', 'withdrawal', amount, balanceBefore, balanceAfter, description || 'Mobile money withdrawal', userId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Create mobile money transaction record
    const mobileMoneyId = `MM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO mobile_money_transactions (id, transaction_id, platform, phone_number, amount, transaction_type, status, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [mobileMoneyId, transactionId, platform, phone_number, amount, 'withdrawal', 'Completed', new Date().toISOString()],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Update account balance
    await new Promise((resolve, reject) => {
      db.run('UPDATE savings_accounts SET amount = ? WHERE id = ?', [balanceAfter, account_id], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    // Create SMS notification
    const client = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM clients WHERE id = ?', [account.client_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (client && client.phone) {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO sms_notifications (client_id, phone_number, message_type, message, event_type, related_account_id, related_transaction_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [client.id, client.phone, 'withdrawal_alert', `Withdrawal of ${amount} ETB sent via ${platform}. New balance: ${balanceAfter} ETB`, 'withdrawal', account_id, transactionId, 'Pending'],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    res.json({
      message: 'Mobile money withdrawal successful',
      transaction: {
        id: transactionId,
        amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        platform,
        phone_number
      },
      account: {
        id: account.id,
        balance: balanceAfter
      }
    });
  } catch (error) {
    console.error('Mobile money withdrawal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Process mobile money loan repayment
router.post('/repayment', authenticateToken, authorizeRoles('admin', 'branch_manager', 'loan_staff', 'client'), async (req, res) => {
  const { loan_id, savings_account_id, amount, platform, phone_number, due_date, description } = req.body;
  const userId = req.user.id;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0' });
  }

  if (!platform || !phone_number) {
    return res.status(400).json({ error: 'Platform and phone number are required for mobile money' });
  }

  try {
    // Get loan details
    const loan = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM loan_accounts WHERE id = ?', [loan_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'Active') {
      return res.status(400).json({ error: 'Loan is not active' });
    }

    if (amount > loan.balance) {
      return res.status(400).json({ error: 'Payment amount exceeds outstanding balance' });
    }

    // Get savings account for verification
    const savingsAccount = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM savings_accounts WHERE id = ?', [savings_account_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!savingsAccount) {
      return res.status(404).json({ error: 'Savings account not found' });
    }

    const balanceBefore = loan.balance;
    const balanceAfter = balanceBefore - amount;

    // Create transaction record
    const transactionId = generateTransactionId();
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [transactionId, loan_id, 'loan', 'repayment', amount, balanceBefore, balanceAfter, description || 'Mobile money loan repayment', userId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Create mobile money transaction record
    const mobileMoneyId = `MM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO mobile_money_transactions (id, transaction_id, platform, phone_number, amount, transaction_type, status, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [mobileMoneyId, transactionId, platform, phone_number, amount, 'repayment', 'Completed', new Date().toISOString()],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Update loan balance
    await new Promise((resolve, reject) => {
      db.run('UPDATE loan_accounts SET balance = ? WHERE id = ?', [balanceAfter, loan_id], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    // Update payment schedule
    const scheduledPayments = await new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM payment_schedule WHERE loan_id = ? AND status IN ("Pending", "Partial") ORDER BY due_date ASC',
        [loan_id],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    let remainingAmount = amount;
    const transactionTimestamp = new Date().toISOString();

    for (const payment of scheduledPayments) {
      if (remainingAmount <= 0) break;

      const principalPaid = Number(payment.principal_paid || 0);
      const interestPaid = Number(payment.interest_paid || 0);
      const paidAmount = Number(payment.paid_amount || 0);
      const outstandingInterest = Math.max(0, Number(payment.interest_amount || 0) - interestPaid);
      const outstandingPrincipal = Math.max(0, Number(payment.principal_amount || 0) - principalPaid);
      const outstandingTotal = Math.max(0, Number(payment.total_amount || 0) - paidAmount);

      const paymentApplied = Math.min(remainingAmount, outstandingTotal);
      const interestApplied = Math.min(paymentApplied, outstandingInterest);
      const principalApplied = Math.min(paymentApplied - interestApplied, outstandingPrincipal);
      const nextPaidAmount = paidAmount + paymentApplied;
      const nextStatus = nextPaidAmount + 0.005 >= Number(payment.total_amount || 0) ? 'Paid' : 'Partial';

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE payment_schedule
           SET principal_paid = principal_paid + ?,
               interest_paid = interest_paid + ?,
               paid_amount = paid_amount + ?,
               status = ?,
               paid_date = ?
           WHERE id = ?`,
          [principalApplied, interestApplied, paymentApplied, nextStatus, nextStatus === 'Paid' ? transactionTimestamp : payment.paid_date || null, payment.id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      remainingAmount -= paymentApplied;
    }

    // Check if loan is fully repaid and close it
    if (balanceAfter <= 0.01) {
      await new Promise((resolve, reject) => {
        db.run('UPDATE loan_accounts SET status = "Closed", closed_at = ? WHERE id = ?', [transactionTimestamp, loan_id], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // Create SMS notification
    const client = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM clients WHERE id = ?', [loan.client_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (client && client.phone) {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO sms_notifications (client_id, phone_number, message_type, message, event_type, related_account_id, related_transaction_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [client.id, client.phone, 'repayment_alert', `Loan repayment of ${amount} ETB received via ${platform}. Remaining balance: ${balanceAfter} ETB`, 'repayment', loan_id, transactionId, 'Pending'],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    res.json({
      message: 'Mobile money loan repayment successful',
      transaction: {
        id: transactionId,
        amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        platform,
        phone_number,
        due_date
      },
      loan: {
        id: loan.id,
        balance: balanceAfter,
        status: balanceAfter <= 0.01 ? 'Closed' : 'Active'
      }
    });
  } catch (error) {
    console.error('Mobile money repayment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
