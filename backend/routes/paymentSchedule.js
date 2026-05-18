const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { db } = require('../config/database');
const { buildRepaymentSchedule } = require('../utils/loanWorkflow');
const { buildPenaltySchedule } = require('../utils/loanPenalties');

// Get payment schedule for a loan
router.get('/loan/:loanId', authenticateToken, (req, res) => {
  const { loanId } = req.params;
  
  db.all(
    'SELECT * FROM payment_schedule WHERE loan_id = ? ORDER BY due_date ASC',
    [loanId],
    (err, schedule) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      const penaltySchedule = buildPenaltySchedule(schedule || []);
      res.json({
        schedule: penaltySchedule.schedule,
        penalty_schedule: {
          penalty_rate_percent: penaltySchedule.penalty_rate_percent,
          description: penaltySchedule.description,
          total_penalty_outstanding: penaltySchedule.total_penalty_outstanding,
          total_installments_overdue: penaltySchedule.total_installments_overdue
        }
      });
    }
  );
});

// Penalty schedule for a loan (late fees + partial balances)
router.get('/loan/:loanId/penalties', authenticateToken, (req, res) => {
  const { loanId } = req.params;

  db.all(
    'SELECT * FROM payment_schedule WHERE loan_id = ? ORDER BY due_date ASC',
    [loanId],
    (err, schedule) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(buildPenaltySchedule(schedule || []));
    }
  );
});

// Generate payment schedule for a loan
router.post('/generate', authenticateToken, async (req, res) => {
  const { loan_id, principal_amount, interest_rate, term_months, start_date, payment_frequency } = req.body;
  const userId = req.user.id;

  if (!loan_id || !principal_amount || !interest_rate || !term_months || !start_date) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const { schedule, monthlyPayment } = buildRepaymentSchedule({
      loanId: loan_id,
      principal: Number(principal_amount),
      interestRate: Number(interest_rate),
      termMonths: Number(term_months),
      paymentFrequency: payment_frequency || 'Monthly',
      originationDate: start_date
    });

    await new Promise((resolve, reject) => {
      db.run('DELETE FROM payment_schedule WHERE loan_id = ?', [loan_id], (err) => (err ? reject(err) : resolve()));
    });

    for (const payment of schedule) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO payment_schedule (id, loan_id, due_date, principal_amount, interest_amount, total_amount, balance_remaining, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            payment.id,
            payment.loan_id,
            payment.due_date,
            payment.principal_amount,
            payment.interest_amount,
            payment.total_amount,
            payment.balance_remaining,
            payment.status
          ],
          (err) => (err ? reject(err) : resolve())
        );
      });
    }

    console.log(`[AUDIT] Payment schedule generated for loan ${loan_id} by user ${userId} at ${new Date().toISOString()}`);

    res.json({
      message: 'Payment schedule generated successfully',
      schedule,
      total_payments: schedule.length,
      monthly_payment: monthlyPayment
    });
  } catch (error) {
    console.error('Payment schedule generation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark payment as paid
router.post('/:id/pay', authenticateToken, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  db.run(
    'UPDATE payment_schedule SET status = "Paid", paid_date = CURRENT_TIMESTAMP WHERE id = ?',
    [id],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      console.log(`[AUDIT] Payment ${id} marked as paid by user ${userId} at ${new Date().toISOString()}`);
      
      res.json({ message: 'Payment marked as paid successfully' });
    }
  );
});

// Make advance payment (handles multi-month payments)
router.post('/advance-payment', authenticateToken, async (req, res) => {
  const { loan_id, amount } = req.body;
  const userId = req.user.id;

  if (!loan_id || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid loan ID and positive amount are required' });
  }

  try {
    // Get all pending payments for the loan
    db.all(
      'SELECT * FROM payment_schedule WHERE loan_id = ? AND status = "Pending" ORDER BY due_date ASC',
      [loan_id],
      async (err, payments) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (payments.length === 0) {
          return res.status(400).json({ error: 'No pending payments found for this loan' });
        }

        let remainingAmount = amount;
        const paymentsMarked = [];
        let totalApplied = 0;

        // Apply payment to scheduled payments in chronological order
        for (const payment of payments) {
          if (remainingAmount <= 0) break;

          const paymentAmount = payment.total_amount;
          
          if (remainingAmount >= paymentAmount) {
            // Full payment for this schedule
            await new Promise((resolve, reject) => {
              db.run(
                'UPDATE payment_schedule SET status = "Paid", paid_date = CURRENT_TIMESTAMP WHERE id = ?',
                [payment.id],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
            
            remainingAmount -= paymentAmount;
            totalApplied += paymentAmount;
            paymentsMarked.push({
              id: payment.id,
              due_date: payment.due_date,
              amount: paymentAmount,
              status: 'Paid'
            });
          } else {
            // Partial payment - create a partial payment record
            const partialAmount = remainingAmount;
            await new Promise((resolve, reject) => {
              db.run(
                'UPDATE payment_schedule SET status = "Partial", balance_remaining = balance_remaining - ?, paid_date = CURRENT_TIMESTAMP WHERE id = ?',
                [partialAmount, payment.id],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
            
            totalApplied += partialAmount;
            paymentsMarked.push({
              id: payment.id,
              due_date: payment.due_date,
              amount: partialAmount,
              status: 'Partial'
            });
            remainingAmount = 0;
          }
        }

        // Update loan balance
        db.get(
          'SELECT * FROM loan_accounts WHERE id = ?',
          [loan_id],
          async (err, loan) => {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Database error' });
            }

            const newBalance = loan.balance - totalApplied;
            await new Promise((resolve, reject) => {
              db.run(
                'UPDATE loan_accounts SET balance = ? WHERE id = ?',
                [newBalance, loan_id],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });

            // Record transaction
            const transactionId = 'TXN-' + Date.now();
            await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [transactionId, loan_id, 'loan', 'advance_payment', totalApplied, loan.balance, newBalance, 'Advance payment', userId],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });

            console.log(`[AUDIT] Advance payment: ${totalApplied} ETB for loan ${loan_id} by user ${userId} at ${new Date().toISOString()}`);
            console.log(`[AUDIT] Payments marked: ${JSON.stringify(paymentsMarked)}`);

            res.json({
              message: 'Advance payment processed successfully',
              total_applied: totalApplied,
              remaining_balance: remainingAmount,
              payments_marked: paymentsMarked,
              loan_balance: newBalance
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('Advance payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
