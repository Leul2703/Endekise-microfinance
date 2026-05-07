const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { db } = require('../config/database');
const { createApprovalRequest } = require('./approvals');
const { withTransaction } = require('../utils/transactionWrapper');
const {
  HIGH_VALUE_THRESHOLD,
  activateLoanAccount,
  fetchLoanWithClient,
  generateLoanAccountNumber,
  logAudit,
  parseTermMonths,
  rejectLoanAccount,
  runExec,
  runMany,
  runQuery
} = require('../utils/loanWorkflow');
const { emitLoanUpdated } = require('../utils/realtime');

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
// Export loan type metadata for dev/test usage
module.exports.LOAN_TYPE_RULES = LOAN_TYPE_RULES;
module.exports.LOAN_TYPE_META = LOAN_TYPE_META;

const syncLoanStatusesFromSchedule = async () => {
  await runExec(
    `UPDATE loan_accounts
     SET status = 'Overdue'
     WHERE id IN (
       SELECT DISTINCT loan_id
       FROM payment_schedule
       WHERE status = 'Pending'
         AND date(due_date) < date('now')
         AND date(due_date) >= date('now', '-90 day')
     )
     AND status = 'Active'`
  );

  await runExec(
    `UPDATE loan_accounts
     SET status = 'Defaulted'
     WHERE id IN (
       SELECT DISTINCT loan_id
       FROM payment_schedule
       WHERE status = 'Pending'
         AND date(due_date) < date('now', '-90 day')
     )
     AND status IN ('Active', 'Overdue')`
  );
};

// Get all loans
router.get('/', authenticateToken, (req, res) => {
  (async () => {
    try {
      await syncLoanStatusesFromSchedule();
      let params = [];
      let whereClause = '';

      if (req.user.role === 'client') {
        const client = await runQuery(
          'SELECT id FROM clients WHERE name = ? ORDER BY id ASC LIMIT 1',
          [req.user.name]
        );

        if (!client) {
          return res.json([]);
        }

        whereClause = 'WHERE la.client_id = ?';
        params = [client.id];
      }

      const loans = await runMany(`
        SELECT la.*, c.name AS client_name, c.email AS client_email
        FROM loan_accounts la
        JOIN clients c ON c.id = la.client_id
        ${whereClause}
        ORDER BY la.created_at DESC
      `, params);

      const normalized = loans.map((loan) => ({
        ...loan,
        client: loan.client_name,
        interestRate: loan.interest_rate,
        submitted: loan.created_at,
        dueDate: loan.disbursement_date
      }));

      res.json(normalized);
    } catch (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
  })();
});

// Create new loan application workflow
router.post('/', authenticateToken, async (req, res) => {
  const {
    client_id,
    savings_account_id,
    clientName,
    type,
    amount,
    term,
    interestRate,
    paymentFrequency,
    originationDate,
    purpose,
    guarantors
  } = req.body;
  const userId = req.user.id;

  if (!client_id || !savings_account_id || !amount || !term || !interestRate) {
    return res.status(400).json({ error: 'Client ID, savings account ID, principal, term, and interest rate are required' });
  }

  const loanAmount = parseFloat(amount);
  if (isNaN(loanAmount) || loanAmount <= 0) {
    return res.status(400).json({ error: 'Principal must be a positive number' });
  }

  try {
    const client = await runQuery('SELECT * FROM clients WHERE id = ?', [client_id]);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    const duplicateLoan = await runQuery(
      `SELECT id FROM loan_accounts
       WHERE client_id = ?
         AND type = ?
         AND status IN ('Pending Branch Manager Review', 'Pending CEO Review', 'Active', 'Overdue')
       ORDER BY created_at DESC
       LIMIT 1`,
      [client_id, String(type || 'Business Loan')]
    );
    if (duplicateLoan) {
      return res.status(409).json({ error: `Client already has an open ${type || 'Business Loan'} loan (${duplicateLoan.id}).` });
    }

    // Check if client has active savings account
    const savingsAccount = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM savings_accounts WHERE id = ? AND client_id = ?',
        [savings_account_id, client_id],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!savingsAccount) {
      return res.status(400).json({ error: 'Selected savings account was not found for the client' });
    }

    if (savingsAccount.status !== 'Active') {
      return res.status(400).json({ error: 'Loan application requires an approved active savings account' });
    }

    const loanId = generateLoanAccountNumber();
    const parsedTerm = parseTermMonths(term);
    const normalizedType = String(type || 'Business Loan');
    if (!Object.keys(LOAN_TYPE_RULES).includes(normalizedType)) {
      return res.status(400).json({ error: `Unsupported loan type. Allowed types: ${Object.keys(LOAN_TYPE_RULES).join(', ')}` });
    }

    const parsedInterestRate = parseFloat(interestRate);
    const requiredRate = LOAN_TYPE_RULES[normalizedType];
    if (Number.isFinite(requiredRate) && Math.abs(parsedInterestRate - requiredRate) > 0.0001) {
      return res.status(400).json({
        error: `Interest rate for ${normalizedType} must match company policy (${requiredRate}%).`,
        expected_interest_rate: requiredRate
      });
    }
    // Validate amount and term against loan type metadata (min/max limits, repayment ranges)
    const typeMeta = LOAN_TYPE_META[normalizedType];
    if (typeMeta) {
      if (typeMeta.min_amount && loanAmount < typeMeta.min_amount) {
        return res.status(400).json({ error: `Minimum amount for ${normalizedType} is ${typeMeta.min_amount} ETB.` });
      }
      if (typeMeta.max_amount && loanAmount > typeMeta.max_amount) {
        return res.status(400).json({ error: `Maximum amount for ${normalizedType} is ${typeMeta.max_amount} ETB.` });
      }
      if (typeMeta.repayment_min_months && typeMeta.repayment_max_months && parsedTerm) {
        const termMonths = Number(parsedTerm);
        if (termMonths < typeMeta.repayment_min_months || termMonths > typeMeta.repayment_max_months) {
          return res.status(400).json({ error: `Repayment period for ${normalizedType} must be between ${typeMeta.repayment_min_months} and ${typeMeta.repayment_max_months} months.` });
        }
      }
      if (typeMeta.organization_letter_required) {
        // Accept explicit flags or a linked document id, or check uploaded documents for the client
        const orgProvided = req.body.organization_letter_provided;
        const orgDocId = req.body.organization_letter_document_id;
        let orgDocFound = false;

        if (orgProvided || orgDocId) {
          orgDocFound = true;
        } else {
          // Search documents table for likely organization letter for this client
          const doc = await runQuery(
            `SELECT id, type, file_name FROM documents WHERE client_id = ? AND (
              lower(type) LIKE '%organization%'
              OR lower(type) LIKE '%org%'
              OR lower(file_name) LIKE '%organization%'
              OR lower(file_name) LIKE '%org%'
              OR lower(type) LIKE '%letter%'
              OR lower(file_name) LIKE '%letter%'
            ) ORDER BY uploaded_at DESC LIMIT 1`,
            [client_id]
          );
          if (doc) orgDocFound = true;
        }

        if (!orgDocFound) {
          return res.status(400).json({ error: 'Organization letter is required for this loan type.' });
        }
      }
    }
    const isHighValueLoan = loanAmount > HIGH_VALUE_THRESHOLD;
    const createdByAdmin = req.user.role === 'admin';
    const initialStatus = createdByAdmin ? 'Active' : 'Pending Branch Manager Review';

    if (isHighValueLoan) {
      const guaranteeDocument = await runQuery(
        `SELECT id, type, status
         FROM documents
         WHERE client_id = ?
           AND (
             lower(type) LIKE '%trade%'
             OR lower(type) LIKE '%license%'
             OR lower(type) LIKE '%libre%'
             OR lower(type) LIKE '%lease%'
             OR lower(type) LIKE '%property%'
           )
         ORDER BY uploaded_at DESC
         LIMIT 1`,
        [client_id]
      );

      if (!guaranteeDocument) {
        return res.status(400).json({
          error: 'High-value loans require scanned guarantee documents (renewed trade license, libre, or lease/property document) for CEO review.'
        });
      }
    }

    let approvalRequestId = null;
    await withTransaction(async () => {
      await runExec(
        `INSERT INTO loan_accounts (id, client_id, savings_account_id, amount, balance, type, term, interest_rate, payment_frequency, status, disbursement_date, purpose)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          loanId,
          client_id,
          savings_account_id,
          loanAmount,
          loanAmount,
          normalizedType,
          String(parsedTerm),
          parsedInterestRate,
          paymentFrequency || 'Monthly',
          initialStatus,
          createdByAdmin ? (originationDate || new Date().toISOString().split('T')[0]) : null,
          purpose || null
        ]
      );

      // Add guarantors if provided
      if (guarantors && Array.isArray(guarantors) && guarantors.length > 0) {
        for (const guarantor of guarantors) {
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO loan_guarantors (loan_id, guarantor_id, guarantee_amount, status) VALUES (?, ?, ?, ?)',
              [loanId, guarantor.id, guarantor.amount || null, 'Active'],
              function(err) {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }
      }

      if (!createdByAdmin) {
        approvalRequestId = await createApprovalRequest(
          'loan_origination',
          loanId,
          loanAmount,
          userId,
          {
            client_id,
            client_name: clientName || client.name,
            savings_account_id,
            principal: loanAmount,
            interest_rate: parsedInterestRate,
            term_months: parsedTerm,
            payment_frequency: paymentFrequency || 'Monthly',
            origination_date: originationDate || new Date().toISOString().split('T')[0],
            purpose,
            guarantors
          }
        );
      }
    });

    let activationResult = null;
    if (createdByAdmin) {
      activationResult = await activateLoanAccount({
        loanId,
        activatedBy: req.user,
        activationReason: 'Administrative loan activation',
        originationDate: originationDate || new Date().toISOString().split('T')[0]
      });
    } else {
      await logAudit({
        action: 'LOAN_APPLICATION_SUBMITTED',
        entityId: loanId,
        user: req.user,
        details: {
          client_id,
          client_name: clientName || client.name,
          savings_account_id,
          high_value: isHighValueLoan,
          approval_request_id: approvalRequestId
        }
      });
    }

    const loan = await fetchLoanWithClient(loanId);
    emitLoanUpdated({
      loanId,
      status: loan.status,
      balance: Number(loan.balance || 0),
      type: loan.type
    });

    console.log(`[AUDIT] Loan workflow started: ${loanId} for client ${clientName || client.name} by user ${userId} at ${new Date().toISOString()}`);

    res.status(201).json({
      loan,
      approval_request_id: approvalRequestId,
      requires_branch_manager_review: !createdByAdmin,
      requires_ceo_review: isHighValueLoan,
      schedule: activationResult?.schedule || [],
      monthly_payment: activationResult?.monthlyPayment || null,
      message: createdByAdmin
        ? 'Loan created successfully and activated immediately.'
        : (isHighValueLoan
          ? 'High-value loan submitted for Branch Manager review and CEO escalation workflow.'
          : 'Loan submitted for Branch Manager approval.')
    });
  } catch (error) {
    console.error('Loan creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get pending loan approvals
router.get('/approvals/pending', authenticateToken, (req, res) => {
  const userRole = req.user.role;
  let query = `
    SELECT la.*, c.name AS client_name, c.email AS client_email
    FROM loan_accounts la
    JOIN clients c ON c.id = la.client_id
  `;
  let params = [];

  if (userRole === 'branch_manager') {
    query += ` WHERE la.status = 'Pending Branch Manager Review' `;
  } else if (userRole === 'ceo') {
    query += ` WHERE la.status = 'Pending CEO Review' `;
  } else {
    query += ` WHERE la.status IN ('Pending Branch Manager Review', 'Pending CEO Review') `;
  }

  query += ' ORDER BY la.created_at DESC';

  db.all(query, params, (err, loans) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json(loans.map((loan) => ({
      ...loan,
      client: loan.client_name,
      term: `${parseTermMonths(loan.term)} months`,
      amount: Number(loan.amount),
      submitted: loan.created_at
    })));
  });
});

// Approve loan
router.post('/:id/approve', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { justification } = req.body;

  if (!justification) {
    return res.status(400).json({ error: 'Justification is required' });
  }

  try {
    const loan = await fetchLoanWithClient(id);

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    const isHighValueLoan = Number(loan.amount) > HIGH_VALUE_THRESHOLD;

    if (!['branch_manager', 'ceo', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only Branch Manager, CEO, or Admin can approve loans.' });
    }

    if (req.user.role === 'branch_manager' && isHighValueLoan) {
      const requestId = await createApprovalRequest(
        'ceo_loan_approval',
        id,
        Number(loan.amount),
        req.user.id,
        {
          recommendation: justification,
          branch_manager_reviewed_at: new Date().toISOString()
        }
      );

      await runExec(
        `UPDATE loan_accounts SET status = 'Pending CEO Review' WHERE id = ?`,
        [id]
      );
      emitLoanUpdated({ loanId: id, status: 'Pending CEO Review' });

      await logAudit({
        action: 'LOAN_ESCALATED_TO_CEO',
        entityId: id,
        user: req.user,
        details: { justification, approval_request_id: requestId }
      });

      return res.json({
        message: 'High-value loan approved by Branch Manager and submitted for CEO approval.',
        request_id: requestId,
        status: 'Pending CEO Review'
      });
    }

    const activationResult = await activateLoanAccount({
      loanId: id,
      activatedBy: req.user,
      activationReason: justification,
      originationDate: loan.disbursement_date || new Date().toISOString().split('T')[0]
    });

    console.log(`[AUDIT] Loan ${id} approved with justification: ${justification} at ${new Date().toISOString()}`);
    emitLoanUpdated({
      loanId: id,
      status: activationResult.loan.status,
      balance: Number(activationResult.loan.balance || 0)
    });

    res.json({
      message: 'Loan approved successfully with payment schedule',
      schedule_generated: true,
      total_payments: activationResult.schedule.length,
      monthly_payment: activationResult.monthlyPayment,
      status: activationResult.loan.status
    });
  } catch (error) {
    console.error('Loan approval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticateToken, authorizeRoles('admin', 'loan_staff', 'branch_manager'), async (req, res) => {
  const { id } = req.params;
  const { amount, type, term, interestRate, paymentFrequency, originationDate, status } = req.body;

  try {
    const loan = await runQuery('SELECT * FROM loan_accounts WHERE id = ?', [id]);
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    await runExec(
      `UPDATE loan_accounts
       SET amount = ?, type = ?, term = ?, interest_rate = ?, payment_frequency = ?, disbursement_date = ?, status = ?
       WHERE id = ?`,
      [
        amount !== undefined ? Number(amount) : Number(loan.amount),
        type || loan.type,
        term !== undefined ? String(parseTermMonths(term)) : loan.term,
        interestRate !== undefined ? Number(interestRate) : Number(loan.interest_rate || 0),
        paymentFrequency || loan.payment_frequency || 'Monthly',
        originationDate || loan.disbursement_date,
        status || loan.status,
        id
      ]
    );

    const updatedLoan = await fetchLoanWithClient(id);
    res.json({
      message: 'Loan updated successfully',
      loan: updatedLoan
    });
  } catch (error) {
    console.error('Loan update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject loan
router.post('/:id/reject', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!reason) {
    return res.status(400).json({ error: 'Rejection reason is mandatory' });
  }

  try {
    await rejectLoanAccount({
      loanId: id,
      rejectedBy: req.user,
      reason
    });

    console.log(`[AUDIT] Loan ${id} rejected with reason: ${reason} at ${new Date().toISOString()}`);
    emitLoanUpdated({ loanId: id, status: 'Rejected' });
    res.json({ message: 'Loan rejected successfully', status: 'Rejected' });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Escalate loan to CEO (>100K)
router.post('/:id/escalate', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!reason) {
    return res.status(400).json({ error: 'Justification is mandatory for escalation' });
  }

  db.run("UPDATE loan_accounts SET status = 'Escalated' WHERE id = ?", [id], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    console.log(`[AUDIT] Loan ${id} escalated to CEO with reason: ${reason} at ${new Date().toISOString()}`);
    res.json({ message: 'Loan escalated to CEO successfully' });
  });
});

// Create new loan (legacy setup endpoint)
router.post('/setup', authenticateToken, async (req, res) => {
  const { client_id, savings_account_id, amount, interest_rate, duration, payment_frequency, document_ids, origination_date } = req.body;
  const userId = req.user.id;

  if (!client_id || !savings_account_id || !amount || !interest_rate || !duration) {
    return res.status(400).json({ error: 'Client ID, savings account ID, amount, interest rate, and duration are required' });
  }

  // Policy validation - Institutional limits
  const MAX_PRINCIPAL = 500000; // 500,000 ETB maximum
  const MAX_INTEREST_RATE = 25; // 25% maximum interest rate
  const MIN_INTEREST_RATE = 5; // 5% minimum interest rate

  if (amount > MAX_PRINCIPAL) {
    return res.status(400).json({
      error: 'Policy Violation: Principal amount exceeds institutional limit',
      violation_type: 'principal_limit',
      max_allowed: MAX_PRINCIPAL,
      requires_escalation: true
    });
  }

  if (interest_rate > MAX_INTEREST_RATE || interest_rate < MIN_INTEREST_RATE) {
    return res.status(400).json({
      error: 'Policy Violation: Interest rate outside allowed range',
      violation_type: 'interest_rate_limit',
      min_allowed: MIN_INTEREST_RATE,
      max_allowed: MAX_INTEREST_RATE,
      requires_escalation: true
    });
  }

  // Document validation
  if (!document_ids || document_ids.length < 2) {
    return res.status(400).json({
      error: 'Missing Documentation: At least 2 documents (KYC and collateral) are required before loan activation',
      violation_type: 'missing_documents',
      required_documents: 2,
      current_documents: document_ids ? document_ids.length : 0
    });
  }

  try {
    // Check if client exists
    const client = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM clients WHERE id = ?', [client_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Check if client has the selected approved savings account
    const savingsAccount = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM savings_accounts WHERE id = ? AND client_id = ?',
        [savings_account_id, client_id],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!savingsAccount) {
      return res.status(400).json({ error: 'Selected savings account was not found for the client' });
    }

    if (savingsAccount.status !== 'Active') {
      return res.status(400).json({ error: 'Loan application requires an approved active savings account' });
    }

    // Verify documents exist and belong to client
    const placeholders = document_ids.map(() => '?').join(',');
    const documents = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM documents WHERE id IN (${placeholders}) AND client_id = ?`,
        [...document_ids, client_id],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    if (documents.length < document_ids.length) {
      return res.status(400).json({ 
        error: 'Missing Documentation: Some documents are invalid or do not belong to this client',
        violation_type: 'invalid_documents'
      });
    }

    const loanId = `LN-${Date.now()}`;
    const loanStartDate = origination_date || new Date().toISOString().split('T')[0];
    
    // Insert loan account
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO loan_accounts
         (id, client_id, savings_account_id, amount, balance, type, term, interest_rate, payment_frequency, status, disbursement_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [loanId, client_id, savings_account_id, amount, amount, 'Business', duration, interest_rate, payment_frequency || 'Monthly', 'Active', loanStartDate],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Generate repayment schedule
    const scheduleData = await new Promise((resolve, reject) => {
      const monthlyInterestRate = interest_rate / 100 / 12;
      const termMonths = parseInt(duration);
      const monthlyPayment = amount * 
        (monthlyInterestRate * Math.pow(1 + monthlyInterestRate, termMonths)) / 
        (Math.pow(1 + monthlyInterestRate, termMonths) - 1);

      let balanceRemaining = amount;
      const schedule = [];
      const startDate = new Date(loanStartDate);

      for (let i = 1; i <= termMonths; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        
        const interestAmount = balanceRemaining * monthlyInterestRate;
        const principalAmount = monthlyPayment - interestAmount;
        balanceRemaining = balanceRemaining - principalAmount;
        
        const scheduleId = `PS-${loanId}-${i}`;
        
        schedule.push({
          id: scheduleId,
          loan_id: loanId,
          due_date: dueDate.toISOString().split('T')[0],
          principal_amount: Math.round(principalAmount * 100) / 100,
          interest_amount: Math.round(interestAmount * 100) / 100,
          total_amount: Math.round(monthlyPayment * 100) / 100,
          balance_remaining: Math.round(Math.max(0, balanceRemaining) * 100) / 100,
          status: 'Pending'
        });
      }

      // Insert payment schedules
      let insertedCount = 0;
      const insertPromises = schedule.map(payment => {
        return new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO payment_schedule (id, loan_id, due_date, principal_amount, interest_amount, total_amount, balance_remaining, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [payment.id, payment.loan_id, payment.due_date, payment.principal_amount, 
             payment.interest_amount, payment.total_amount, payment.balance_remaining, payment.status],
            (err) => {
              if (err) reject(err);
              else {
                insertedCount++;
                resolve();
              }
            }
          );
        });
      });

      Promise.all(insertPromises)
        .then(() => resolve({ schedule, insertedCount }))
        .catch(reject);
    });

    console.log(`[AUDIT] New loan account setup: ${loanId} for client ${client_id} by user ${userId} at ${new Date().toISOString()}`);
    console.log(`[AUDIT] Repayment schedule generated with ${scheduleData.insertedCount} payments`);

    const loan = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM loan_accounts WHERE id = ?', [loanId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    res.status(201).json({
      loan,
      schedule: scheduleData.schedule,
      message: 'Loan account created successfully with repayment schedule'
    });
  } catch (error) {
    console.error('Loan setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Escalate policy violation to Branch Manager
router.post('/escalate-policy/:loanId', authenticateToken, async (req, res) => {
  const { loanId } = req.params;
  const { reason, violation_type } = req.body;
  const userId = req.user.id;

  if (!reason || !violation_type) {
    return res.status(400).json({ error: 'Reason and violation type are required' });
  }

  try {
    // Create approval request for escalation
    const requestId = `ESC-${Date.now()}`;
    
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO approval_requests (id, type, entity_id, requested_by, status, justification) VALUES (?, ?, ?, ?, ?, ?)',
        [requestId, 'policy_violation', loanId, userId, 'Pending', reason],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log(`[AUDIT] Policy violation escalated for loan ${loanId} by user ${userId}: ${violation_type} - ${reason} at ${new Date().toISOString()}`);

    res.json({ 
      message: 'Policy violation escalated to Branch Manager',
      request_id: requestId 
    });
  } catch (error) {
    console.error('Escalation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Escalate loan to CEO approval for >100K (UC-M-003)
router.post('/:id/escalate-ceo', authenticateToken, authorizeRoles('branch_manager'), async (req, res) => {
  const { id } = req.params;
  const { recommendation } = req.body;
  const userId = req.user.id;

  try {
    // Get loan account details
    const loan = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM loan_accounts WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!loan) {
      return res.status(404).json({ error: 'Loan account not found' });
    }

    // Alternative Flow 1: Threshold Not Met
    if (loan.amount <= 100000) {
      return res.status(400).json({ 
        error: 'Loan amount is within branch limit. Use standard approval.',
        violation_type: 'threshold_not_met',
        loan_amount: loan.amount,
        threshold: 100000
      });
    }

    // Alternative Flow 2: Missing Recommendation
    if (!recommendation || recommendation.length < 10) {
      return res.status(400).json({ 
        error: 'Mandatory recommendation text is required for escalation (minimum 10 characters)',
        violation_type: 'missing_recommendation'
      });
    }

    // Package loan file, recommendation, and audit history
    const auditHistory = await new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM audit_trail WHERE details LIKE ? ORDER BY timestamp DESC',
        [`%${id}%`],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    const loanPackage = {
      loan,
      recommendation,
      audit_history: auditHistory,
      escalated_at: new Date().toISOString(),
      escalated_by: userId
    };

    // Create approval request for CEO
    const requestId = `CEO-ESC-${Date.now()}`;
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO approval_requests (id, type, entity_id, requested_by, status, justification) VALUES (?, ?, ?, ?, ?, ?)',
        [requestId, 'ceo_loan_approval', id, userId, 'Pending', recommendation],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Lock application status as "Pending CEO Review"
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE loan_accounts SET status = 'Pending CEO Review' WHERE id = ?",
        [id],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Send notification to CEO's approval queue (log to email_log)
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO email_log (recipient_email, subject, body, status) VALUES (?, ?, ?, ?)',
        ['ceo@edekise.com', `CEO Loan Approval Request: ${id}`, `Loan ${id} (${loan.amount} ETB) escalated for CEO approval. Recommendation: ${recommendation}`, 'Pending'],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log(`[AUDIT] Loan ${id} escalated to CEO approval by user ${userId} at ${new Date().toISOString()}`);
    console.log(`[AUDIT] Loan amount: ${loan.amount} ETB, Recommendation: ${recommendation}`);
    console.log(`[AUDIT] Status locked as Pending CEO Review`);

    res.json({
      message: 'Loan escalated to CEO for approval',
      request_id: requestId,
      status: 'Pending CEO Review',
      loan_package: loanPackage,
      ceo_notified: true,
      branch_manager_locked: true
    });
  } catch (error) {
    console.error('CEO escalation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
// Re-export loan type metadata for dev/test usage (attached after router export)
module.exports.LOAN_TYPE_RULES = LOAN_TYPE_RULES;
module.exports.LOAN_TYPE_META = LOAN_TYPE_META;
