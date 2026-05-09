const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { db } = require('../config/database');
const PDFDocument = require('pdfkit');
const { withTransaction } = require('../utils/transactionWrapper');
const { resolveClientProfileByUser } = require('../utils/clientProfile');

const COMPANY_NAME = process.env.STATEMENT_COMPANY_NAME || 'Edekise Microfinance';
const COMPANY_TAGLINE = process.env.STATEMENT_COMPANY_TAGLINE || 'Official Account Statement';
const BRAND_COLOR = '#0f766e';

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  return d.toLocaleString('en-GB', { hour12: false });
};

const formatDateOnly = (value) => {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB');
};

const formatMoney = (value) => `${Number(value || 0).toLocaleString()} ETB`;

const drawStatementBrandHeader = (doc) => {
  const top = doc.y;
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  doc.save();
  doc.fillColor(BRAND_COLOR).circle(left + 12, top + 12, 11).fill();
  doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold').text('EM', left + 6.5, top + 8);
  doc.restore();

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827').text(COMPANY_NAME, left + 30, top + 1, { width: right - left - 140 });
  doc.font('Helvetica').fontSize(9).fillColor('#4b5563').text(COMPANY_TAGLINE, left + 30, top + 20, { width: right - left - 140 });
  doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(`Generated: ${formatDateTime(new Date().toISOString())}`, right - 135, top + 4, { width: 135, align: 'right' });

  doc.moveDown(1.4);
  doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
  doc.moveDown(0.6);
};

const buildStatementPdf = ({ title, subtitleLines = [], summaryLines = [], transactions = [] }) => {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });

  drawStatementBrandHeader(doc);
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#111827').text(title, { align: 'left' });
  doc.moveDown(0.25);
  doc.fontSize(10).fillColor('#444');
  for (const line of subtitleLines) {
    doc.text(line);
  }
  doc.fillColor('#000');
  doc.moveDown(0.75);

  if (summaryLines.length) {
    doc.fontSize(12).text('Summary', { underline: true });
    doc.moveDown(0.25);
    doc.fontSize(10);
    for (const line of summaryLines) {
      doc.text(line);
    }
    doc.moveDown(0.75);
  }

  doc.fontSize(12).text('Transactions', { underline: true });
  doc.moveDown(0.25);
  doc.fontSize(9);

  const header = ['Date', 'Type', 'Amount', 'Balance After', 'Description'];
  doc.font('Helvetica-Bold').text(header.join(' | '));
  doc.font('Helvetica');
  doc.moveDown(0.15);
  doc.text('-'.repeat(110));
  doc.moveDown(0.25);

  const rows = (transactions || []).slice(0, 200);
  for (const t of rows) {
    const date = formatDateTime(t.created_at);
    const type = String(t.transaction_type || '');
    const amount = Number(t.amount || 0).toFixed(2);
    const balAfter = t.balance_after === null || t.balance_after === undefined ? '' : Number(t.balance_after).toFixed(2);
    const desc = String(t.description || '').replace(/\s+/g, ' ').trim();
    doc.text([date, type, amount, balAfter, desc].join(' | '));
  }

  if ((transactions || []).length > rows.length) {
    doc.moveDown(0.25);
    doc.fillColor('#444').text(`Showing first ${rows.length} transactions.`).fillColor('#000');
  }

  doc.moveDown(1);
  doc.fontSize(8).fillColor('#666').text(`Generated at ${formatDateTime(new Date().toISOString())}`);
  doc.fillColor('#000');

  return doc;
};

const toCsvValue = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const transactionsToCsv = (transactions = []) => {
  const header = [
    'id',
    'account_id',
    'account_type',
    'transaction_type',
    'amount',
    'balance_before',
    'balance_after',
    'description',
    'created_at'
  ];

  const lines = [header.join(',')];
  for (const txn of transactions) {
    const row = header.map((key) => toCsvValue(txn?.[key]));
    lines.push(row.join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
};

const safeParseJson = (value, fallback = null) => {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

const getById = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row || null);
  });
});

// Generate loan statement
router.get('/loan/:loanId', authenticateToken, (req, res) => {
  const { loanId } = req.params;

  db.get('SELECT * FROM loan_accounts WHERE id = ?', [loanId], (err, loan) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // Get payment schedule
    db.all(
      'SELECT * FROM payment_schedule WHERE loan_id = ? ORDER BY due_date ASC',
      [loanId],
      (err, schedule) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        // Get transactions
        db.all(
          'SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at DESC',
          [loanId],
          (err, transactions) => {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Database error' });
            }

            const statement = {
              loan,
              payment_schedule: schedule,
              transactions,
              generated_at: new Date().toISOString(),
              summary: {
                total_amount: loan.amount,
                balance_remaining: loan.balance,
                payments_made: schedule.filter(p => p.status === 'Paid').length,
                payments_remaining: schedule.filter(p => p.status === 'Pending').length
              }
            };

            res.json(statement);
          }
        );
      }
    );
  });
});

// Download loan statement as CSV
router.get('/loan/:loanId/download', authenticateToken, (req, res) => {
  const { loanId } = req.params;
  const format = String(req.query.format || 'csv').toLowerCase();

  db.get('SELECT * FROM loan_accounts WHERE id = ?', [loanId], (err, loan) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    db.all(
      'SELECT * FROM transactions WHERE account_id = ? AND account_type = ? ORDER BY created_at ASC, id ASC',
      [loanId, 'loan'],
      (txErr, transactions) => {
        if (txErr) {
          console.error('Database error:', txErr);
          return res.status(500).json({ error: 'Database error' });
        }

        if (format === 'pdf') {
          const filename = `loan_statement_${loanId}_${new Date().toISOString().slice(0, 10)}.pdf`;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Cache-Control', 'no-store');

          const doc = buildStatementPdf({
            title: 'Loan Statement',
            subtitleLines: [
              `Loan ID: ${loanId}`,
              `Principal: ${Number(loan.amount || 0).toLocaleString()} ETB`,
              `Outstanding balance: ${Number(loan.balance || 0).toLocaleString()} ETB`,
              `Interest rate: ${Number(loan.interest_rate || 0)}%`,
              `Disbursement date: ${loan.disbursement_date || 'N/A'}`
            ],
            summaryLines: [
              `Total transactions: ${(transactions || []).length}`,
              `Period: All time`
            ],
            transactions
          });

          doc.pipe(res);
          doc.end();
          return;
        }

        if (format !== 'csv') {
          return res.status(415).json({ error: 'Unsupported format. Use ?format=csv or ?format=pdf' });
        }

        const csv = transactionsToCsv(transactions || []);
        const filename = `loan_statement_${loanId}_${new Date().toISOString().slice(0, 10)}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(csv);
      }
    );
  });
});

// Generate savings statement
router.get('/savings/:accountId', authenticateToken, (req, res) => {
  const { accountId } = req.params;

  db.get('SELECT * FROM savings_accounts WHERE id = ?', [accountId], (err, account) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!account) {
      return res.status(404).json({ error: 'Savings account not found' });
    }

    // Get transactions
    db.all(
      'SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at DESC',
      [accountId],
      (err, transactions) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        // Calculate totals
        const deposits = transactions.filter(t => t.transaction_type === 'deposit');
        const withdrawals = transactions.filter(t => t.transaction_type === 'withdrawal');
        
        const totalDeposits = deposits.reduce((sum, t) => sum + t.amount, 0);
        const totalWithdrawals = withdrawals.reduce((sum, t) => sum + t.amount, 0);

        const statement = {
          account,
          transactions,
          generated_at: new Date().toISOString(),
          summary: {
            current_balance: account.amount,
            total_deposits: totalDeposits,
            total_withdrawals: totalWithdrawals,
            total_transactions: transactions.length
          }
        };

        res.json(statement);
      }
    );
  });
});

// Download savings statement as CSV
router.get('/savings/:accountId/download', authenticateToken, (req, res) => {
  const { accountId } = req.params;
  const format = String(req.query.format || 'csv').toLowerCase();

  db.get('SELECT * FROM savings_accounts WHERE id = ?', [accountId], (err, account) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!account) {
      return res.status(404).json({ error: 'Savings account not found' });
    }

    db.all(
      'SELECT * FROM transactions WHERE account_id = ? AND account_type = ? ORDER BY created_at ASC, id ASC',
      [accountId, 'savings'],
      (txErr, transactions) => {
        if (txErr) {
          console.error('Database error:', txErr);
          return res.status(500).json({ error: 'Database error' });
        }

        if (format === 'pdf') {
          const filename = `savings_statement_${accountId}_${new Date().toISOString().slice(0, 10)}.pdf`;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Cache-Control', 'no-store');

          const doc = buildStatementPdf({
            title: 'Savings Statement',
            subtitleLines: [
              `Savings Account ID: ${accountId}`,
              `Product: ${account.type || 'Savings'}`,
              `Current balance: ${Number(account.amount || 0).toLocaleString()} ETB`,
              `Interest rate: ${Number(account.interest_rate || 0)}%`,
              `Status: ${account.status || 'N/A'}`
            ],
            summaryLines: [
              `Total transactions: ${(transactions || []).length}`,
              `Period: All time`
            ],
            transactions
          });

          doc.pipe(res);
          doc.end();
          return;
        }

        if (format !== 'csv') {
          return res.status(415).json({ error: 'Unsupported format. Use ?format=csv or ?format=pdf' });
        }

        const csv = transactionsToCsv(transactions || []);
        const filename = `savings_statement_${accountId}_${new Date().toISOString().slice(0, 10)}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(csv);
      }
    );
  });
});

router.get('/transaction/:transactionId/download', authenticateToken, async (req, res) => {
  const { transactionId } = req.params;
  const format = String(req.query.format || 'pdf').toLowerCase();

  try {
    const transaction = await getById(
      `SELECT
        t.*,
        s.client_id AS savings_client_id,
        l.client_id AS loan_client_id,
        s.type AS savings_type,
        l.type AS loan_type,
        c.id AS client_id,
        c.name AS client_name
      FROM transactions t
      LEFT JOIN savings_accounts s ON t.account_type = 'savings' AND t.account_id = s.id
      LEFT JOIN loan_accounts l ON t.account_type = 'loan' AND t.account_id = l.id
      LEFT JOIN clients c ON c.id = COALESCE(s.client_id, l.client_id)
      WHERE t.id = ?`,
      [transactionId]
    );

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (req.user.role === 'client') {
      const client = await resolveClientProfileByUser(req.user);
      const txnClientId = transaction.client_id || transaction.savings_client_id || transaction.loan_client_id;
      if (!client || String(client.id) !== String(txnClientId)) {
        return res.status(403).json({ error: 'You can only download statements for your own transactions.' });
      }
    }

    if (format === 'csv') {
      const csv = transactionsToCsv([transaction]);
      const filename = `transaction_statement_${transactionId}_${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(csv);
    }

    if (format !== 'pdf') {
      return res.status(415).json({ error: 'Unsupported format. Use ?format=pdf or ?format=csv' });
    }

    const filename = `transaction_statement_${transactionId}_${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    const productLabel = transaction.account_type === 'loan'
      ? (transaction.loan_type || 'Loan')
      : (transaction.savings_type || 'Savings');

    const doc = buildStatementPdf({
      title: 'Transaction Statement',
      subtitleLines: [
        `Transaction ID: ${transaction.id}`,
        `Client: ${transaction.client_name || 'N/A'}`,
        `Account: ${transaction.account_id || 'N/A'} (${transaction.account_type || 'N/A'})`,
        `Product: ${productLabel}`,
        `Recorded at: ${formatDateTime(transaction.created_at)}`
      ],
      summaryLines: [
        `Type: ${transaction.transaction_type || 'N/A'}`,
        `Amount: ${formatMoney(transaction.amount)}`,
        `Balance before: ${formatMoney(transaction.balance_before)}`,
        `Balance after: ${formatMoney(transaction.balance_after)}`,
        `Description: ${transaction.description || 'N/A'}`,
        `Reference: ${transaction.transaction_reference || 'N/A'}`,
        `Statement date: ${formatDateOnly(new Date().toISOString())}`
      ],
      transactions: [transaction]
    });

    doc.pipe(res);
    doc.end();
    return null;
  } catch (error) {
    console.error('Error generating transaction statement:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Request loan statement (UC-L-004)
router.post('/loan/request', authenticateToken, async (req, res) => {
  const {
    client_id,
    loan_id,
    account_id,
    start_date,
    end_date,
    date_from,
    date_to
  } = req.body;
  const userId = req.user.id;
  const resolvedLoanId = loan_id || account_id;
  const resolvedStartDate = start_date || date_from || '1970-01-01';
  const resolvedEndDate = end_date || date_to || new Date().toISOString().split('T')[0];

  if (!resolvedLoanId) {
    return res.status(400).json({ error: 'Loan ID is required' });
  }

  const startDate = new Date(resolvedStartDate);
  const endDate = new Date(resolvedEndDate);
  const today = new Date();

  // Alternative Flow 1: Future Date Range
  if (endDate > today) {
    return res.status(400).json({ 
      error: 'Statement date range cannot extend beyond today',
      violation_type: 'future_date_range'
    });
  }

  if (startDate > endDate) {
    return res.status(400).json({ error: 'Start date must be before end date' });
  }

  // Alternative Flow 2: Large Range Flag (24+ months)
  const monthDiff = (endDate.getFullYear() - startDate.getFullYear()) * 12 + 
                     (endDate.getMonth() - startDate.getMonth());
  let extendedRangeFlag = 'Normal';
  let largeRangeWarning = null;

  if (monthDiff >= 24) {
    extendedRangeFlag = 'Extended';
    largeRangeWarning = 'Statement is for an extended period. Manager must review extra carefully.';
  }

  try {
    // Verify loan exists and is active
    const loan = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM loan_accounts WHERE id = ?', [resolvedLoanId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!loan) {
      return res.status(404).json({ error: 'Loan account not found' });
    }

    const resolvedClientId = client_id || loan.client_id;

    // Retrieve transactions for the period
    const transactions = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM transactions 
         WHERE account_id = ? AND account_type = 'loan' 
         AND created_at >= ? AND created_at <= ?
         ORDER BY created_at ASC`,
        [resolvedLoanId, resolvedStartDate, resolvedEndDate],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Get payment schedule for the period
    const paymentSchedule = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM payment_schedule 
         WHERE loan_id = ? AND due_date >= ? AND due_date <= ?
         ORDER BY due_date ASC`,
        [resolvedLoanId, resolvedStartDate, resolvedEndDate],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Format statement data
    const statementData = {
      loan,
      period: { start_date: resolvedStartDate, end_date: resolvedEndDate },
      transactions,
      payment_schedule: paymentSchedule,
      summary: {
        total_transactions: transactions.length,
        total_payments: transactions
          .filter(t => ['payment', 'repayment'].includes(String(t.transaction_type || '').toLowerCase()))
          .reduce((sum, t) => sum + Number(t.amount || 0), 0),
        payments_made: paymentSchedule.filter(p => p.status === 'Paid').length,
        payments_pending: paymentSchedule.filter(p => p.status === 'Pending').length
      },
      generated_at: new Date().toISOString()
    };

    const statementId = `STMT-${Date.now()}`;
    const requestId = `APR-STMT-${Date.now()}`;
    await withTransaction(async () => {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO statements (id, type, client_id, account_id, start_date, end_date, statement_data, status, requested_by, extended_range_flag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [statementId, 'loan', resolvedClientId, resolvedLoanId, resolvedStartDate, resolvedEndDate, JSON.stringify(statementData), 'Pending', userId, extendedRangeFlag],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO approval_requests (id, type, entity_id, requested_by, status, justification) VALUES (?, ?, ?, ?, ?, ?)',
          [requestId, 'statement_approval', statementId, userId, 'Pending', largeRangeWarning || 'Statement awaiting manager approval'],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });

    console.log(`[AUDIT] Loan statement requested: ${statementId} for loan ${resolvedLoanId} by user ${userId} at ${new Date().toISOString()}`);
    if (largeRangeWarning) {
      console.log(`[AUDIT] Extended range flag set for ${statementId}: ${largeRangeWarning}`);
    }

    res.status(201).json({
      statement_id: statementId,
      request_id: requestId,
      status: 'Pending',
      message: 'Statement submitted to Branch Manager for approval',
      warning: largeRangeWarning,
      extended_range_flag: extendedRangeFlag
    });
  } catch (error) {
    console.error('Statement request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Request savings statement
router.post('/savings/request', authenticateToken, async (req, res) => {
  const { client_id, savings_id, start_date, end_date } = req.body;
  const userId = req.user.id;

  if (!client_id || !savings_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'Client ID, Savings ID, Start Date, and End Date are required' });
  }

  const startDate = new Date(start_date);
  const endDate = new Date(end_date);
  const today = new Date();

  // Future Date Range validation
  if (endDate > today) {
    return res.status(400).json({ 
      error: 'Statement date range cannot extend beyond today',
      violation_type: 'future_date_range'
    });
  }

  if (startDate > endDate) {
    return res.status(400).json({ error: 'Start date must be before end date' });
  }

  // Large Range Flag (24+ months)
  const monthDiff = (endDate.getFullYear() - startDate.getFullYear()) * 12 + 
                     (endDate.getMonth() - startDate.getMonth());
  let extendedRangeFlag = 'Normal';
  let largeRangeWarning = null;

  if (monthDiff >= 24) {
    extendedRangeFlag = 'Extended';
    largeRangeWarning = 'Statement is for an extended period. Manager must review extra carefully.';
  }

  try {
    // Verify savings account exists
    const savings = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM savings_accounts WHERE id = ? AND client_id = ?', [savings_id, client_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!savings) {
      return res.status(404).json({ error: 'Savings account not found for this client' });
    }

    // Retrieve transactions for the period
    const transactions = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM transactions 
         WHERE account_id = ? AND account_type = 'savings' 
         AND created_at >= ? AND created_at <= ?
         ORDER BY created_at ASC`,
        [savings_id, start_date, end_date],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Format statement data
    const statementData = {
      savings,
      period: { start_date, end_date },
      transactions,
      summary: {
        total_transactions: transactions.length,
        total_deposits: transactions.filter(t => t.transaction_type === 'deposit').reduce((sum, t) => sum + t.amount, 0),
        total_withdrawals: transactions.filter(t => t.transaction_type === 'withdrawal').reduce((sum, t) => sum + t.amount, 0)
      },
      generated_at: new Date().toISOString()
    };

    const statementId = `STMT-${Date.now()}`;
    const requestId = `APR-STMT-${Date.now()}`;
    await withTransaction(async () => {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO statements (id, type, client_id, account_id, start_date, end_date, statement_data, status, requested_by, extended_range_flag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [statementId, 'savings', client_id, savings_id, start_date, end_date, JSON.stringify(statementData), 'Pending', userId, extendedRangeFlag],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO approval_requests (id, type, entity_id, requested_by, status, justification) VALUES (?, ?, ?, ?, ?, ?)',
          [requestId, 'statement_approval', statementId, userId, 'Pending', largeRangeWarning || 'Statement awaiting manager approval'],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });

    console.log(`[AUDIT] Savings statement requested: ${statementId} for savings ${savings_id} by user ${userId} at ${new Date().toISOString()}`);

    res.status(201).json({
      statement_id: statementId,
      request_id: requestId,
      status: 'Pending',
      message: 'Statement submitted to Branch Manager for approval',
      warning: largeRangeWarning,
      extended_range_flag: extendedRangeFlag
    });
  } catch (error) {
    console.error('Statement request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get pending statement approvals
router.get('/approvals/pending', authenticateToken, authorizeRoles('branch_manager', 'admin', 'ceo'), async (req, res) => {
  try {
    const statements = await new Promise((resolve, reject) => {
      db.all(
        `SELECT s.*, ar.id AS approval_request_id, ar.created_at AS approval_created_at, ar.requested_by AS approval_requested_by
         FROM statements s
         JOIN approval_requests ar ON ar.entity_id = s.id
         WHERE s.status = 'Pending'
           AND ar.type = 'statement_approval'
           AND ar.status = 'Pending'
         ORDER BY ar.created_at DESC`,
        [],
        (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Enrich with client details
    const enrichedStatements = await Promise.all(statements.map(async (stmt) => {
      const client = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM clients WHERE id = ?', [stmt.client_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      const requester = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE id = ?', [stmt.requested_by], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      return {
        ...stmt,
        statement_data: safeParseJson(stmt.statement_data, null),
        client,
        requester
      };
    }));

    res.json(enrichedStatements);
  } catch (error) {
    console.error('Error fetching pending statement approvals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve statement
router.post('/:id/approve', authenticateToken, authorizeRoles('branch_manager', 'admin', 'ceo'), async (req, res) => {
  const { id } = req.params;
  const { justification } = req.body;
  const userId = req.user.id;

  if (!justification) {
    return res.status(400).json({ error: 'Justification is required' });
  }

  try {
    const statement = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM statements WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    if (!statement) {
      return res.status(404).json({ error: 'Statement not found' });
    }
    if (statement.status !== 'Pending') {
      return res.status(400).json({ error: 'Statement can only be approved when Pending' });
    }

    await withTransaction(async () => {
      await new Promise((resolve, reject) => {
        db.run("UPDATE statements SET status = 'Approved' WHERE id = ?", [id], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE approval_requests
           SET status = 'Approved',
               justification = ?,
               reviewed_at = CURRENT_TIMESTAMP,
               reviewed_by = ?
           WHERE entity_id = ? AND type = 'statement_approval' AND status = 'Pending'`,
          [justification, userId, id],
          function onUpdate(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });

    console.log(`[AUDIT] Statement ${id} approved by user ${userId} at ${new Date().toISOString()}`);
    res.json({ message: 'Statement approved successfully' });
  } catch (error) {
    console.error('Statement approval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Authorize loan statement (UC-M-001)
router.post('/:id/authorize', authenticateToken, authorizeRoles('branch_manager', 'admin', 'ceo'), async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    // Get statement details
    const statement = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM statements WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!statement) {
      return res.status(404).json({ error: 'Statement not found' });
    }

    if (!['Approved', 'Pending'].includes(statement.status)) {
      return res.status(400).json({ error: 'Statement can only be authorized when in Approved or Pending status' });
    }

    await withTransaction(async () => {
      await new Promise((resolve, reject) => {
        db.run(
          "UPDATE statements SET status = 'Finalized' WHERE id = ?",
          [id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      await new Promise((resolve, reject) => {
        db.run(
          "UPDATE approval_requests SET status = 'Approved' WHERE entity_id = ? AND type = 'statement_approval'",
          [id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });

    console.log(`[AUDIT] Statement ${id} authorized by user ${userId} at ${new Date().toISOString()}`);
    console.log(`[AUDIT] Statement digitally signed and finalized`);

    res.json({
      message: 'Statement authorized and finalized',
      status: 'Finalized',
      digital_signature: `SIG-${id}-${Date.now()}`
    });
  } catch (error) {
    console.error('Statement authorization error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject and reroute statement (UC-M-001)
router.post('/:id/reject', authenticateToken, authorizeRoles('branch_manager', 'admin', 'ceo'), async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const userId = req.user.id;

  // Alternative Flow: Manager Rejects - requires detailed rejection reason
  if (!reason || reason.length < 10) {
    return res.status(400).json({ 
      error: 'Detailed rejection reason is required (minimum 10 characters)',
      violation_type: 'missing_rejection_reason'
    });
  }

  try {
    // Get statement details
    const statement = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM statements WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!statement) {
      return res.status(404).json({ error: 'Statement not found' });
    }

    await withTransaction(async () => {
      await new Promise((resolve, reject) => {
        db.run(
          "UPDATE statements SET status = 'Rejected' WHERE id = ?",
          [id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      await new Promise((resolve, reject) => {
        db.run(
          "UPDATE approval_requests SET status = 'Rejected', justification = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE entity_id = ? AND type = 'statement_approval'",
          [reason, userId, id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });

    console.log(`[AUDIT] Statement ${id} rejected by user ${userId} with reason: ${reason} at ${new Date().toISOString()}`);

    res.json({
      message: 'Statement rejected and routed back to Loan Stuff',
      status: 'Rejected',
      rejection_note: reason,
      routed_to: 'Loan Stuff'
    });
  } catch (error) {
    console.error('Statement rejection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
