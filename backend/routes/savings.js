const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { db } = require('../config/database');
const { getUserRecord, resolveClientProfileByUser } = require('../utils/clientProfile');

const SAVINGS_OPTIONS = [
  {
    type: 'Regular Savings',
    interest_rate: 5,
    minimum_amount: 100,
    requires_duration: false,
    description: 'Flexible savings plan for routine deposits.'
  },
  {
    type: 'Fixed Deposit',
    interest_rate: 8,
    minimum_amount: 1000,
    requires_duration: true,
    description: 'Locked savings plan with higher returns for a fixed term.'
  },
  {
    type: 'Premium Savings',
    interest_rate: 7,
    minimum_amount: 5000,
    requires_duration: false,
    description: 'Higher-balance savings plan with improved interest.'
  }
];

const getSavingsOption = (type) => SAVINGS_OPTIONS.find((option) => option.type === type);

const runOne = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});

const runMany = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const runExec = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) {
      return reject(err);
    }

    resolve({
      lastID: this.lastID,
      changes: this.changes
    });
  });
});

const buildReceipt = ({ savingsId, transactionId, type, amount, interestRate, maturityDate }) => ({
  receipt_id: `RCT-${Date.now()}`,
  savings_account_id: savingsId,
  transaction_id: transactionId,
  saving_type: type,
  amount,
  interest_rate: interestRate,
  maturity_date: maturityDate || 'Ongoing',
  confirmed_at: new Date().toISOString()
});

router.get('/options', authenticateToken, authorizeRoles('client'), (req, res) => {
  res.json(SAVINGS_OPTIONS);
});

router.get('/mine', authenticateToken, authorizeRoles('client'), async (req, res) => {
  try {
    const client = await resolveClientProfileByUser(req.user);
    if (!client) {
      return res.json([]);
    }

    const savingsAccounts = await runMany(
      'SELECT * FROM savings_accounts WHERE client_id = ? ORDER BY created_at DESC',
      [client.id]
    );

    res.json(savingsAccounts);
  } catch (error) {
    console.error('Error fetching client savings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/apply', authenticateToken, authorizeRoles('client'), async (req, res) => {
  const { type, amount, duration_months, description } = req.body;

  try {
    const userRecord = await getUserRecord(req.user.id);
    if (!userRecord || userRecord.status !== 'Active') {
      return res.status(403).json({ error: 'Your account is inactive or invalid. The transaction has been halted.' });
    }

    const client = await resolveClientProfileByUser(req.user);
    if (!client) {
      return res.status(404).json({ error: 'Client profile not found. Please contact support.' });
    }

    const option = getSavingsOption(type);
    if (!option) {
      return res.status(400).json({ error: 'Invalid saving type selected.' });
    }

    const numericAmount = parseFloat(amount);
    if (Number.isNaN(numericAmount) || numericAmount < option.minimum_amount) {
      return res.status(400).json({
        error: `Minimum saving amount for ${option.type} is ${option.minimum_amount} ETB. Please enter a valid amount.`
      });
    }

    let maturityDate = null;
    if (option.requires_duration) {
      const months = parseInt(duration_months, 10);
      if (!months || months <= 0) {
        return res.status(400).json({ error: 'Duration is required for the selected saving type.' });
      }

      const startDate = new Date();
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + months);
      maturityDate = endDate.toISOString().split('T')[0];
    }

    const savingsId = `SV-${Date.now()}`;
    const transactionId = `TXN-${Date.now()}`;

    await runExec(
      `INSERT INTO savings_accounts (id, client_id, amount, type, interest_rate, maturity_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [savingsId, client.id, numericAmount, option.type, option.interest_rate, maturityDate, 'Pending']
    );

    const approvalRequestId = `APR-${Date.now()}`;
    await runExec(
      `INSERT INTO approval_requests (id, type, entity_id, amount, requested_by, status, approval_level, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        approvalRequestId,
        'account_creation',
        savingsId,
        numericAmount,
        req.user.id,
        'Pending',
        'branch_manager',
        JSON.stringify({
          client_id: client.id,
          client_name: client.name,
          account_type: 'savings',
          opening_balance: numericAmount,
          product_type: option.type,
          source_table: 'savings_accounts',
          kyc_status: client.kyc_status || 'Pending'
        })
      ]
    );

    console.log(`[AUDIT] Savings scheme created: ${savingsId} for client ${client.id} by user ${req.user.id} at ${new Date().toISOString()}`);

    const savings = await runOne('SELECT * FROM savings_accounts WHERE id = ?', [savingsId]);
    res.status(201).json({
      message: 'Saving account created and submitted for manager approval.',
      savings,
      approval_request_id: approvalRequestId,
      receipt: buildReceipt({
        savingsId,
        transactionId,
        type: option.type,
        amount: numericAmount,
        interestRate: option.interest_rate,
        maturityDate
      })
    });
  } catch (error) {
    console.error('Savings application error:', error);
    res.status(500).json({ error: 'A system processing error occurred. The transaction was not completed.' });
  }
});

// Get all savings accounts
router.get('/', authenticateToken, (req, res) => {
  const { client_id } = req.query;
  const params = [];
  const filters = [];

  if (req.user.role === 'client') {
    filters.push('c.name = ?');
    params.push(req.user.name);
  } else if (client_id) {
    filters.push('s.client_id = ?');
    params.push(client_id);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  db.all(
    `SELECT s.*, c.name AS client_name
     FROM savings_accounts s
     JOIN clients c ON c.id = s.client_id
     ${whereClause}
     ORDER BY s.created_at DESC`,
    params,
    (err, savings) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(savings);
    }
  );
});

// Get pending savings (simpler endpoint for branch manager)
router.get('/pending', authenticateToken, authorizeRoles('branch_manager', 'admin', 'ceo'), async (req, res) => {
  try {
    const savings = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM savings_accounts WHERE status = 'Pending' OR status = 'High Priority'", [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Transform to match frontend expected format
    const formattedSavings = savings.map(s => ({
      id: s.id,
      client: `Client-${s.client_id}`,
      type: s.type,
      amount: `${parseInt(s.amount).toLocaleString()} ETB`,
      interestRate: `${s.interest_rate}%`,
      term: s.maturity_date ? `Until ${new Date(s.maturity_date).toLocaleDateString()}` : 'Ongoing',
      status: s.status,
      submitted: new Date(s.created_at).toISOString().split('T')[0],
      complianceFlag: s.compliance_flag && s.compliance_flag !== 'None'
    }));

    res.json(formattedSavings);
  } catch (error) {
    console.error('Error fetching pending savings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get pending savings approvals
router.get('/approvals/pending', authenticateToken, authorizeRoles('branch_manager', 'admin', 'ceo'), async (req, res) => {
  try {
    const savings = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM savings_accounts WHERE status = 'Pending'", [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Enrich with client details and KYC status
    const enrichedSavings = await Promise.all(savings.map(async (savings) => {
      const client = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM clients WHERE id = ?', [savings.client_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      const documents = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM documents WHERE client_id = ?', [savings.client_id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      return {
        ...savings,
        client,
        kyc_verified: documents.length >= 2,
        document_count: documents.length,
        kyc_status: documents.length >= 2 ? 'Verified' : 'Pending'
      };
    }));

    res.json(enrichedSavings);
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve savings account
router.post('/:id/approve', authenticateToken, authorizeRoles('branch_manager', 'admin'), async (req, res) => {
  const { id } = req.params;
  const { justification, override_compliance } = req.body;
  const userId = req.user.id;

  if (!justification) {
    return res.status(400).json({ error: 'Justification is required' });
  }

  try {
    // Get savings account details
    const savings = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM savings_accounts WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!savings) {
      return res.status(404).json({ error: 'Savings account not found' });
    }

    // Check for compliance flag
    if (savings.compliance_flag && savings.compliance_flag !== 'None') {
      if (!override_compliance) {
        return res.status(400).json({ 
          error: 'Warning: Review Flag - Compliance issue detected',
          compliance_flag: savings.compliance_flag,
          requires_override: true,
          requires_expanded_justification: true
        });
      }
      
      if (!justification || justification.length < 50) {
        return res.status(400).json({ 
          error: 'Expanded justification required for compliance override (minimum 50 characters)' 
        });
      }
    }

    // Update status to Active
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE savings_accounts SET status = 'Active' WHERE id = ?",
        [id],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log(`[AUDIT] Savings account ${id} approved by user ${userId} at ${new Date().toISOString()}`);
    if (override_compliance) {
      console.log(`[AUDIT] Compliance override for ${id} with justification: ${justification}`);
    }

    res.json({ message: 'Savings account approved successfully' });
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject savings account
router.post('/:id/reject', authenticateToken, authorizeRoles('branch_manager', 'admin'), async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const userId = req.user.id;

  if (!reason) {
    return res.status(400).json({ error: 'Rejection reason is mandatory' });
  }

  try {
    // Get savings account details for notification
    const savings = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM savings_accounts WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!savings) {
      return res.status(404).json({ error: 'Savings account not found' });
    }

    // Update status to Rejected
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE savings_accounts SET status = 'Rejected' WHERE id = ?",
        [id],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log(`[AUDIT] Savings account ${id} rejected by user ${userId} with reason: ${reason} at ${new Date().toISOString()}`);

    // Log notification to email_log (saving stuff would be notified in production)
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO email_log (recipient_email, subject, body, status) VALUES (?, ?, ?, ?)',
        ['saving-staff@edekise.com', `Savings Account Rejected: ${id}`, `Savings account ${id} has been rejected. Reason: ${reason}`, 'Pending'],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ 
      message: 'Savings account rejected successfully',
      notification_sent: true
    });
  } catch (error) {
    console.error('Rejection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new savings account
router.post('/', authenticateToken, authorizeRoles('saving_staff', 'admin'), async (req, res) => {
  const { client_id, type, amount, interest_rate, maturity_date } = req.body;

  if (!client_id || !type || !amount) {
    return res.status(400).json({ error: 'Client, type, and amount are required' });
  }

  // Simple compliance flag detection (can be expanded)
  let complianceFlag = 'None';
  if (amount > 1000000) {
    complianceFlag = 'High Deposit - Manual Review Required';
  } else if (type === 'Fixed Deposit' && (!maturity_date || new Date(maturity_date) < new Date())) {
    complianceFlag = 'Invalid Maturity Date';
  }

  const savingsId = `SV-${Date.now()}`;
  
  try {
    const client = await runOne('SELECT * FROM clients WHERE id = ?', [client_id]);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const requiresApproval = req.user.role !== 'admin';
    const initialStatus = requiresApproval ? 'Pending' : 'Active';

    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO savings_accounts (id, client_id, amount, type, interest_rate, maturity_date, compliance_flag, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [savingsId, client_id, parseFloat(amount), type, parseFloat(interest_rate) || 5, maturity_date, complianceFlag, initialStatus],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    let approvalRequestId = null;
    if (requiresApproval) {
      approvalRequestId = `APR-${Date.now()}`;
      await runExec(
        `INSERT INTO approval_requests (id, type, entity_id, amount, requested_by, status, approval_level, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          approvalRequestId,
          'account_creation',
          savingsId,
          parseFloat(amount),
          req.user.id,
          'Pending',
          'branch_manager',
          JSON.stringify({
            client_id,
            client_name: client.name,
            account_type: 'savings',
            opening_balance: parseFloat(amount),
            product_type: type,
            source_table: 'savings_accounts',
            kyc_status: client.kyc_status || 'Pending'
          })
        ]
      );
    }

    console.log(`[AUDIT] New savings account created: ${savingsId} for client ${client_id} at ${new Date().toISOString()}`);
    if (complianceFlag !== 'None') {
      console.log(`[AUDIT] Compliance flag set for ${savingsId}: ${complianceFlag}`);
    }
    
    const savings = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM savings_accounts WHERE id = ?', [savingsId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    res.status(201).json({
      savings,
      approval_request_id: approvalRequestId,
      requires_approval: requiresApproval,
      message: requiresApproval ? 'Savings account created and submitted for approval' : 'Savings account created successfully'
    });
  } catch (error) {
    console.error('Savings creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Submit savings account for approval (UC-S-002)
router.post('/:id/submit-approval', authenticateToken, authorizeRoles('saving_staff', 'client', 'loan_staff', 'admin'), async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    // Get savings account details
    const savings = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM savings_accounts WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!savings) {
      return res.status(404).json({ error: 'Savings account not found' });
    }

    // Alternative Flow: Check KYC document completeness
    const documents = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM documents WHERE client_id = ?', [savings.client_id], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (documents.length < 2) {
      return res.status(400).json({ 
        error: 'Cannot submit: Mandatory fields/documents are missing',
        violation_type: 'missing_kyc_documents',
        required_documents: 2,
        current_documents: documents.length
      });
    }

    // Update status to Pending Manager Review
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE savings_accounts SET status = 'Pending Manager Review' WHERE id = ?",
        [id],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Create approval request
    const requestId = `APR-SV-${Date.now()}`;
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO approval_requests (id, type, entity_id, requested_by, status, justification) VALUES (?, ?, ?, ?, ?, ?)',
        [requestId, 'savings_account_approval', id, userId, 'Pending', 'Savings account awaiting manager approval'],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log(`[AUDIT] Savings account ${id} submitted for approval by user ${userId} at ${new Date().toISOString()}`);

    res.json({
      message: 'Savings account submitted for approval',
      request_id: requestId,
      status: 'Pending Manager Review',
      confirmation_receipt: `Receipt-${requestId}`
    });
  } catch (error) {
    console.error('Submit approval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
