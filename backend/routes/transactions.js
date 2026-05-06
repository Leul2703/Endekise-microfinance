const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { db } = require('../config/database');
const { getUserRecord, resolveClientProfileByUser } = require('../utils/clientProfile');
const { withTransaction } = require('../utils/transactionWrapper');
const { createApprovalRequest } = require('./approvals');
const { assertClientKycEligible, evaluateAmlAlerts, LARGE_TRANSACTION_THRESHOLD } = require('../utils/compliance');
const { recordAuditEvent } = require('../utils/auditTrail');
const { sendEmailReminder } = require('../utils/notificationService');
const { emitLoanUpdated, emitBalanceUpdated } = require('../utils/realtime');

const MINIMUM_SAVING_DEPOSIT = 100;
const LATE_PENALTY_RATE = Number(process.env.LOAN_LATE_PENALTY_RATE || 1);

const runGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});

const runAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const runExec = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) reject(err);
    else resolve({ lastID: this.lastID, changes: this.changes });
  });
});

const ensureClientOwnsSavingsAccount = async (user, accountId) => {
  if (user.role !== 'client') {
    return null;
  }

  const client = await resolveClientProfileByUser(user);
  if (!client) {
    return { error: 'Client profile not found' };
  }

  const account = await runGet('SELECT * FROM savings_accounts WHERE id = ?', [accountId]);
  if (!account || account.client_id !== client.id) {
    return { error: 'You can only transact on your own active savings accounts.' };
  }

  return account;
};

const findExistingTransactionByIdempotency = async (idempotencyKey) => {
  if (!idempotencyKey) {
    return null;
  }
  return runGet('SELECT * FROM transactions WHERE idempotency_key = ?', [idempotencyKey]);
};

const buildIdempotencyKey = (req) => req.headers['x-idempotency-key'] || req.body.idempotency_key || null;

const buildTransactionReference = (transactionType) => `${transactionType.toUpperCase()}-${Date.now()}`;

const ensureUserCanTransact = async (req, accountId) => {
  const userRecord = await getUserRecord(req.user.id);
  if (!userRecord || userRecord.status !== 'Active') {
    const error = new Error('Your account is inactive or invalid. The transaction has been halted.');
    error.statusCode = 403;
    throw error;
  }

  if (req.user.role === 'client') {
    const ownershipCheck = await ensureClientOwnsSavingsAccount(req.user, accountId);
    if (ownershipCheck?.error) {
      const error = new Error(ownershipCheck.error);
      error.statusCode = 403;
      throw error;
    }
  }
};

const maybeCreateApprovalInsteadOfPosting = async ({ type, accountId, amount, description, userId, extraDetails = {} }) => {
  if (amount < LARGE_TRANSACTION_THRESHOLD) {
    return null;
  }

  const approvalRequestId = await createApprovalRequest(type, accountId, amount, userId, {
    accountId,
    amount,
    description,
    ...extraDetails
  });

  return approvalRequestId;
};

router.get('/my-savings', authenticateToken, async (req, res) => {
  try {
    const client = await resolveClientProfileByUser(req.user);
    if (!client) {
      return res.json([]);
    }

    const transactions = await runAll(
      `SELECT t.*
       FROM transactions t
       JOIN savings_accounts s ON s.id = t.account_id
       WHERE t.account_type = 'savings' AND s.client_id = ?
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 25`,
      [client.id]
    );
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching savings transactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/account/:accountId', authenticateToken, async (req, res) => {
  const { accountId } = req.params;

  try {
    const transactions = await runAll(
      'SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT 100',
      [accountId]
    );
    res.json(transactions);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/', authenticateToken, authorizeRoles('admin', 'branch_manager', 'loan_staff', 'saving_staff', 'client'), async (req, res) => {
  const { account_type, transaction_type } = req.body || {};
  const normalizedAccountType = String(account_type || '').toLowerCase();
  const normalizedTransactionType = String(transaction_type || '').toLowerCase();

  if (normalizedAccountType === 'savings' && normalizedTransactionType === 'deposit') {
    req.url = '/deposit';
    return router.handle(req, res);
  }

  if (normalizedAccountType === 'savings' && ['withdraw', 'withdrawal'].includes(normalizedTransactionType)) {
    req.url = '/withdraw';
    return router.handle(req, res);
  }

  if (normalizedAccountType === 'loan' && ['payment', 'repayment'].includes(normalizedTransactionType)) {
    req.url = '/payment';
    return router.handle(req, res);
  }

  return res.status(400).json({ error: 'Unsupported transaction type' });
});

router.post('/deposit', authenticateToken, authorizeRoles('admin', 'branch_manager', 'saving_staff'), async (req, res) => {
  const { account_id, amount, description } = req.body;
  const numericAmount = parseFloat(amount);

  if (!account_id || Number.isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'Valid account ID and positive amount are required' });
  }

  if (numericAmount < MINIMUM_SAVING_DEPOSIT) {
    return res.status(400).json({ error: `Minimum saving amount is ${MINIMUM_SAVING_DEPOSIT} ETB.` });
  }

  try {
    await ensureUserCanTransact(req, account_id);

    // Saving Staff is maker-only for savings transactions: always create approval requests.
    const mustGoThroughApproval = req.user.role === 'saving_staff';
    const approvalRequestId = mustGoThroughApproval
      ? await createApprovalRequest('transaction_deposit', account_id, numericAmount, req.user.id, {
        accountId: account_id,
        amount: numericAmount,
        description
      })
      : await maybeCreateApprovalInsteadOfPosting({
      type: 'transaction_deposit',
      accountId: account_id,
      amount: numericAmount,
      description,
      userId: req.user.id
    });
    if (approvalRequestId) {
      await recordAuditEvent({
        action: 'DEPOSIT_SUBMITTED_FOR_APPROVAL',
        entityType: 'account',
        entityId: account_id,
        user: req.user,
        details: { amount: numericAmount, approval_request_id: approvalRequestId }
      });
      return res.status(202).json({
        message: 'Deposit submitted for approval',
        approval_request_id: approvalRequestId,
        status: 'Pending Approval'
      });
    }

    const idempotencyKey = buildIdempotencyKey(req);
    const existingTransaction = await findExistingTransactionByIdempotency(idempotencyKey);
    if (existingTransaction) {
      return res.json({
        message: 'Deposit already processed',
        transaction: existingTransaction,
        duplicate: true
      });
    }

    const account = await runGet('SELECT * FROM savings_accounts WHERE id = ?', [account_id]);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    if (account.status !== 'Active') {
      return res.status(400).json({ error: 'The selected savings account is inactive or invalid.' });
    }

    await assertClientKycEligible(account.client_id);

    if (numericAmount > Number(account.deposit_limit || 0)) {
      return res.status(400).json({ error: `Deposit amount exceeds the limit of ${account.deposit_limit} ETB` });
    }

    const balanceBefore = Number(account.amount || 0);
    const balanceAfter = balanceBefore + numericAmount;
    const transactionId = `TXN-${Date.now()}`;
    const transactionReference = buildTransactionReference('deposit');
    const transactionTimestamp = new Date().toISOString();

    await withTransaction(async () => {
      await runExec('UPDATE savings_accounts SET amount = ? WHERE id = ?', [balanceAfter, account_id]);
      await runExec(
        `INSERT INTO transactions
         (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, transaction_reference, idempotency_key, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [transactionId, account_id, 'savings', 'deposit', numericAmount, balanceBefore, balanceAfter, description || 'Deposit', transactionReference, idempotencyKey, req.user.id, transactionTimestamp]
      );
    });

    await evaluateAmlAlerts({
      accountId: account_id,
      accountType: 'savings',
      clientId: account.client_id,
      amount: numericAmount,
      transactionType: 'deposit',
      transactionId
    });

    await recordAuditEvent({
      action: 'DEPOSIT_POSTED',
      entityType: 'transaction',
      entityId: transactionId,
      user: req.user,
      beforeState: { account_id, balance: balanceBefore },
      afterState: { account_id, balance: balanceAfter },
      details: { amount: numericAmount, transaction_reference: transactionReference }
    });

    emitBalanceUpdated({
      savingsAccountId: account_id,
      balance: balanceAfter
    });

    const client = await runGet('SELECT name, email FROM clients WHERE id = ?', [account.client_id]);
    if (client?.email) {
      await sendEmailReminder({
        to: client.email,
        subject: `Deposit Received - ${account_id}`,
        text: `Dear ${client.name}, a deposit of ${numericAmount} ETB has been posted to savings account ${account_id}. New balance: ${balanceAfter} ETB.`,
        category: 'deposit_posted'
      });
    }

    res.json({
      message: 'Deposit successful',
      transaction: {
        id: transactionId,
        account_id,
        amount: numericAmount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        created_at: transactionTimestamp,
        transaction_type: 'deposit',
        account_type: 'savings',
        transaction_reference: transactionReference
      }
    });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error', code: error.code || 'INTERNAL_ERROR', details: error.details || null });
  }
});

router.post('/withdraw', authenticateToken, authorizeRoles('admin', 'branch_manager', 'saving_staff', 'client'), async (req, res) => {
  const { account_id, amount, description } = req.body;
  const numericAmount = parseFloat(amount);

  if (!account_id || Number.isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'Valid account ID and positive amount are required' });
  }

  try {
    await ensureUserCanTransact(req, account_id);

    // Saving Staff is maker-only for savings transactions: always create approval requests.
    const mustGoThroughApproval = req.user.role === 'saving_staff';
    const approvalRequestId = mustGoThroughApproval
      ? await createApprovalRequest('transaction_withdraw', account_id, numericAmount, req.user.id, {
        accountId: account_id,
        amount: numericAmount,
        description
      })
      : await maybeCreateApprovalInsteadOfPosting({
      type: 'transaction_withdraw',
      accountId: account_id,
      amount: numericAmount,
      description,
      userId: req.user.id
    });
    if (approvalRequestId) {
      await recordAuditEvent({
        action: 'WITHDRAWAL_SUBMITTED_FOR_APPROVAL',
        entityType: 'account',
        entityId: account_id,
        user: req.user,
        details: { amount: numericAmount, approval_request_id: approvalRequestId }
      });
      return res.status(202).json({
        message: 'Withdrawal submitted for approval',
        approval_request_id: approvalRequestId,
        status: 'Pending Approval'
      });
    }

    const idempotencyKey = buildIdempotencyKey(req);
    const existingTransaction = await findExistingTransactionByIdempotency(idempotencyKey);
    if (existingTransaction) {
      return res.json({
        message: 'Withdrawal already processed',
        transaction: existingTransaction,
        duplicate: true
      });
    }

    const account = await runGet('SELECT * FROM savings_accounts WHERE id = ?', [account_id]);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    if (account.status !== 'Active') {
      return res.status(400).json({ error: 'The selected savings account is inactive or invalid.' });
    }

    await assertClientKycEligible(account.client_id);

    const balanceBefore = Number(account.amount || 0);
    if (numericAmount > balanceBefore) {
      return res.status(400).json({ error: 'Insufficient balance. Withdrawal amount exceeds current balance.' });
    }

    const balanceAfter = balanceBefore - numericAmount;
    const transactionId = `TXN-${Date.now()}`;
    const transactionReference = buildTransactionReference('withdrawal');
    const transactionTimestamp = new Date().toISOString();

    await withTransaction(async () => {
      await runExec('UPDATE savings_accounts SET amount = ? WHERE id = ?', [balanceAfter, account_id]);
      await runExec(
        `INSERT INTO transactions
         (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, transaction_reference, idempotency_key, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [transactionId, account_id, 'savings', 'withdrawal', numericAmount, balanceBefore, balanceAfter, description || 'Withdrawal', transactionReference, idempotencyKey, req.user.id, transactionTimestamp]
      );
    });

    await evaluateAmlAlerts({
      accountId: account_id,
      accountType: 'savings',
      clientId: account.client_id,
      amount: numericAmount,
      transactionType: 'withdrawal',
      transactionId
    });

    await recordAuditEvent({
      action: 'WITHDRAWAL_POSTED',
      entityType: 'transaction',
      entityId: transactionId,
      user: req.user,
      beforeState: { account_id, balance: balanceBefore },
      afterState: { account_id, balance: balanceAfter },
      details: { amount: numericAmount, transaction_reference: transactionReference }
    });

    emitBalanceUpdated({
      savingsAccountId: account_id,
      balance: balanceAfter
    });

    const client = await runGet('SELECT name, email FROM clients WHERE id = ?', [account.client_id]);
    if (client?.email) {
      await sendEmailReminder({
        to: client.email,
        subject: `Withdrawal Posted - ${account_id}`,
        text: `Dear ${client.name}, a withdrawal of ${numericAmount} ETB has been posted from savings account ${account_id}. New balance: ${balanceAfter} ETB.`,
        category: 'withdrawal_posted'
      });
    }

    res.json({
      message: 'Withdrawal successful',
      transaction: {
        id: transactionId,
        account_id,
        amount: numericAmount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        created_at: transactionTimestamp,
        transaction_type: 'withdrawal',
        account_type: 'savings',
        transaction_reference: transactionReference
      }
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error', code: error.code || 'INTERNAL_ERROR', details: error.details || null });
  }
});

router.post('/payment', authenticateToken, authorizeRoles('admin', 'branch_manager', 'loan_staff', 'client'), async (req, res) => {
  const { account_id, savings_account_id, amount, description } = req.body;
  const numericAmount = parseFloat(amount);

  if (!account_id || Number.isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'Valid account ID and positive amount are required' });
  }

  try {
    const userRecord = await getUserRecord(req.user.id);
    if (!userRecord || userRecord.status !== 'Active') {
      return res.status(403).json({ error: 'Your account is inactive or invalid. The transaction has been halted.' });
    }

    const account = await runGet('SELECT * FROM loan_accounts WHERE id = ?', [account_id]);
    if (!account) {
      return res.status(404).json({ error: 'Loan account not found' });
    }

    await assertClientKycEligible(account.client_id);

    if (String(account.status || '').toLowerCase() === 'completed') {
      return res.status(400).json({ error: 'Cannot pay a closed loan account.' });
    }
    const balanceBefore = Number(account.balance || 0);

    // Loan repayment MUST be paid from the linked savings account (per spec).
    const linkedSavingsAccountId = savings_account_id || account.savings_account_id;
    if (!linkedSavingsAccountId) {
      return res.status(400).json({ error: 'Loan repayment requires a linked savings account.' });
    }

    const idempotencyKey = buildIdempotencyKey(req);
    const existingTransaction = await findExistingTransactionByIdempotency(idempotencyKey);
    if (existingTransaction) {
      return res.json({
        message: 'Payment already processed',
        transaction: existingTransaction,
        duplicate: true
      });
    }

    const savingsAccount = await runGet(
      'SELECT * FROM savings_accounts WHERE id = ? AND client_id = ?',
      [linkedSavingsAccountId, account.client_id]
    );
    if (!savingsAccount) {
      return res.status(400).json({ error: 'Linked savings account not found for this client.' });
    }
    if (savingsAccount.status !== 'Active') {
      return res.status(400).json({ error: 'Linked savings account is inactive or not approved.' });
    }

    const savingsBalanceBefore = Number(savingsAccount.amount || 0);
    if (numericAmount > savingsBalanceBefore) {
      return res.status(400).json({ error: 'Insufficient savings balance for loan repayment.' });
    }

    const effectivePaymentAmount = Math.min(numericAmount, balanceBefore);
    const overpaymentAmount = Math.max(0, numericAmount - effectivePaymentAmount);
    const balanceAfter = Math.max(0, balanceBefore - effectivePaymentAmount);
    const transactionId = `TXN-${Date.now()}`;
    const transferReference = buildTransactionReference('loan_repayment');
    const transactionTimestamp = new Date().toISOString();
    const savingsBalanceAfter = savingsBalanceBefore - effectivePaymentAmount;
    const scheduledPayments = await runAll(
      `SELECT *
       FROM payment_schedule
       WHERE loan_id = ?
         AND status IN ('Pending', 'Partial')
       ORDER BY due_date ASC, created_at ASC`,
      [account_id]
    );

    let remainingAmount = effectivePaymentAmount;
    let totalPrincipalApplied = 0;
    let totalInterestApplied = 0;
    let totalPenaltyApplied = 0;

    await withTransaction(async () => {
      // Update savings first (source of funds)
      await runExec('UPDATE savings_accounts SET amount = ? WHERE id = ?', [savingsBalanceAfter, linkedSavingsAccountId]);

      await runExec(
        'UPDATE loan_accounts SET balance = ?, status = ? WHERE id = ?',
        [balanceAfter, balanceAfter <= 0 ? 'Completed' : account.status, account_id]
      );

      // Record paired transactions for auditability and statement consistency
      await runExec(
        `INSERT INTO transactions
         (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, transaction_reference, idempotency_key, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transactionId,
          account_id,
          'loan',
          'repayment',
          effectivePaymentAmount,
          balanceBefore,
          balanceAfter,
          description || 'Loan repayment (paid from savings)',
          transferReference,
          idempotencyKey,
          req.user.id,
          transactionTimestamp
        ]
      );

      await runExec(
        `INSERT INTO transactions
         (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, transaction_reference, idempotency_key, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `TXN-${Date.now()}-SV`,
          linkedSavingsAccountId,
          'savings',
          'withdrawal',
          effectivePaymentAmount,
          savingsBalanceBefore,
          savingsBalanceAfter,
          `Loan repayment transfer to ${account_id}`,
          transferReference,
          idempotencyKey,
          req.user.id,
          transactionTimestamp
        ]
      );

      for (const payment of scheduledPayments) {
        if (remainingAmount <= 0) {
          break;
        }

        const principalPaid = Number(payment.principal_paid || 0);
        const interestPaid = Number(payment.interest_paid || 0);
        const paidAmount = Number(payment.paid_amount || 0);
        const dueDate = payment.due_date ? new Date(payment.due_date) : null;
        const isOverdue = dueDate ? dueDate < new Date(new Date().toDateString()) : false;
        const expectedPenalty = isOverdue ? (Number(payment.total_amount || 0) * (LATE_PENALTY_RATE / 100)) : 0;
        const penaltyPaid = Number(payment.penalty_paid || 0);
        const outstandingPenalty = Math.max(0, expectedPenalty - penaltyPaid);
        const outstandingInterest = Math.max(0, Number(payment.interest_amount || 0) - interestPaid);
        const outstandingPrincipal = Math.max(0, Number(payment.principal_amount || 0) - principalPaid);
        const outstandingTotal = Math.max(0, Number(payment.total_amount || 0) + expectedPenalty - paidAmount);

        if (outstandingTotal <= 0) {
          continue;
        }

        const paymentApplied = Math.min(remainingAmount, outstandingTotal);
        const penaltyApplied = Math.min(paymentApplied, outstandingPenalty);
        const afterPenalty = paymentApplied - penaltyApplied;
        const interestApplied = Math.min(afterPenalty, outstandingInterest);
        const principalApplied = Math.min(afterPenalty - interestApplied, outstandingPrincipal);
        const nextPaidAmount = paidAmount + paymentApplied;
        const nextPrincipalPaid = principalPaid + principalApplied;
        const nextInterestPaid = interestPaid + interestApplied;
        const nextPenaltyPaid = penaltyPaid + penaltyApplied;
        const nextStatus = nextPaidAmount + 0.005 >= (Number(payment.total_amount || 0) + expectedPenalty) ? 'Paid' : 'Partial';

        await runExec(
          `UPDATE payment_schedule
           SET principal_paid = ?, interest_paid = ?, penalty_amount = ?, penalty_paid = ?, paid_amount = ?, status = ?, paid_date = ?
           WHERE id = ?`,
          [
            nextPrincipalPaid,
            nextInterestPaid,
            expectedPenalty,
            nextPenaltyPaid,
            nextPaidAmount,
            nextStatus,
            nextStatus === 'Paid' ? transactionTimestamp : payment.paid_date || null,
            payment.id
          ]
        );

        totalPenaltyApplied += penaltyApplied;
        totalPrincipalApplied += principalApplied;
        totalInterestApplied += interestApplied;
        remainingAmount -= paymentApplied;
      }

      await runExec(
        `INSERT INTO loan_payments
         (id, loan_id, amount, principal_amount, interest_amount, balance_before, balance_after, payment_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `LPM-${Date.now()}`,
          account_id,
          effectivePaymentAmount,
          Math.round(totalPrincipalApplied * 100) / 100,
          Math.round(totalInterestApplied * 100) / 100,
          balanceBefore,
          balanceAfter,
          transactionTimestamp,
          transactionTimestamp
        ]
      );
    });

    await evaluateAmlAlerts({
      accountId: account_id,
      accountType: 'loan',
      clientId: account.client_id,
      amount: numericAmount,
      transactionType: 'repayment',
      transactionId
    });

    await recordAuditEvent({
      action: 'LOAN_PAYMENT_POSTED',
      entityType: 'transaction',
      entityId: transactionId,
      user: req.user,
      beforeState: {
        loan_account_id: account_id,
        loan_balance: balanceBefore,
        savings_account_id: linkedSavingsAccountId,
        savings_balance: savingsBalanceBefore
      },
      afterState: {
        loan_account_id: account_id,
        loan_balance: balanceAfter,
        savings_account_id: linkedSavingsAccountId,
        savings_balance: savingsBalanceAfter
      },
      details: { amount: numericAmount, transfer_reference: transferReference }
    });

    emitLoanUpdated({
      loanId: account_id,
      status: balanceAfter <= 0 ? 'Completed' : account.status,
      balance: balanceAfter,
      paidAmount: effectivePaymentAmount
    });
    emitBalanceUpdated({
      savingsAccountId: linkedSavingsAccountId,
      balance: savingsBalanceAfter
    });

    if (balanceAfter <= 0 || totalPenaltyApplied > 0) {
      const client = await runGet('SELECT name, email FROM clients WHERE id = ?', [account.client_id]);
      if (client?.email) {
        await sendEmailReminder({
          to: client.email,
          subject: balanceAfter <= 0 ? `Loan Closed - ${account_id}` : `Repayment Received - ${account_id}`,
          text: balanceAfter <= 0
            ? `Dear ${client.name}, your loan ${account_id} is now fully paid and closed.`
            : `Dear ${client.name}, we received a repayment of ${effectivePaymentAmount} ETB for loan ${account_id}. Penalty applied: ${totalPenaltyApplied.toFixed(2)} ETB.`,
          category: 'repayment_posted'
        });
      }
    }

    res.json({
      message: overpaymentAmount > 0 ? 'Payment successful. Overpayment amount was not deducted.' : 'Payment successful',
      transaction: {
        id: transactionId,
        account_id,
        amount: effectivePaymentAmount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        created_at: transactionTimestamp,
        transaction_type: 'repayment',
        account_type: 'loan',
        transaction_reference: transferReference
      },
      savings_impact: {
        account_id: linkedSavingsAccountId,
        balance_before: savingsBalanceBefore,
        balance_after: savingsBalanceAfter
      },
      allocation: {
        penalty: Math.round(totalPenaltyApplied * 100) / 100,
        interest: Math.round(totalInterestApplied * 100) / 100,
        principal: Math.round(totalPrincipalApplied * 100) / 100
      },
      overpayment_amount: overpaymentAmount
    });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error', code: error.code || 'INTERNAL_ERROR', details: error.details || null });
  }
});

module.exports = router;
