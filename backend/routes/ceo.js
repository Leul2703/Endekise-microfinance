const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { db } = require('../config/database');
const { activateLoanAccount, rejectLoanAccount } = require('../utils/loanWorkflow');

// Manage Account Balance (UC-M-005)
router.post('/balance-adjustment', authenticateToken, authorizeRoles('ceo', 'admin'), async (req, res) => {
  const { account_id, account_type, adjustment_type, amount, justification, secondary_auth } = req.body;
  const userId = req.user.id;
  const numericAmount = Number(amount);

  // Step 2: System requires secondary authentication
  if (!secondary_auth) {
    return res.status(400).json({ 
      error: 'Secondary authentication is required for balance adjustments',
      requires_secondary_auth: true
    });
  }

  // Validate required fields
  if (!account_id || !account_type || !adjustment_type || !numericAmount) {
    return res.status(400).json({ error: 'Account ID, Account Type, Adjustment Type, and Amount are required' });
  }

  if (numericAmount <= 0) {
    return res.status(400).json({ error: 'Adjustment amount must be greater than zero' });
  }

  // Alternative Flow: Missing Justification
  if (!justification || justification.length < 20) {
    return res.status(400).json({ 
      error: 'Justification is mandatory for audit compliance (minimum 20 characters)',
      violation_type: 'missing_justification'
    });
  }

  try {
    // Get current balance based on account type
    let currentBalance = 0;
    let account = null;

    if (account_type === 'loan') {
      account = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM loan_accounts WHERE id = ?', [account_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      if (account) currentBalance = account.balance;
    } else if (account_type === 'savings') {
      account = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM savings_accounts WHERE id = ?', [account_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      if (account) currentBalance = account.amount;
    }

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Calculate proposed final balance
    let proposedBalance = currentBalance;
    if (adjustment_type === 'credit') {
      proposedBalance = Number(currentBalance) + numericAmount;
    } else if (adjustment_type === 'debit') {
      proposedBalance = Number(currentBalance) - numericAmount;
    }

    if (proposedBalance < 0) {
      return res.status(400).json({ error: 'Adjustment would result in a negative balance' });
    }

    // Step 5: Display current balance, adjustment amount, and proposed final balance
    const preview = {
      current_balance: currentBalance,
      adjustment_type: adjustment_type,
      adjustment_amount: numericAmount,
      proposed_final_balance: proposedBalance
    };

    // Step 6: CEO confirms the transaction (we'll proceed directly for API)
    // Step 7: Process the adjustment
    const transactionId = `TXN-CEO-${Date.now()}`;
    const digitalSignature = `SIG-CEO-${userId}-${Date.now()}`;

    if (account_type === 'loan') {
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE loan_accounts SET balance = ? WHERE id = ?',
          [proposedBalance, account_id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } else if (account_type === 'savings') {
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE savings_accounts SET amount = ? WHERE id = ?',
          [proposedBalance, account_id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    // Log transaction
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [transactionId, account_id, account_type, adjustment_type, numericAmount, currentBalance, proposedBalance, `CEO Balance Adjustment: ${justification}`, userId, new Date().toISOString()],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Create high-security audit log entry
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO audit_trail
         (action, entity_type, entity_id, user_id, user_role, details, timestamp, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'CEO_BALANCE_ADJUSTMENT',
          account_type,
          account_id,
          userId,
          req.user.role,
          JSON.stringify({ preview, justification, digital_signature: digitalSignature }),
          new Date().toISOString(),
          'Success'
        ],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Notify Branch Manager (log to email_log for now)
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO email_log (recipient_email, subject, body, status) VALUES (?, ?, ?, ?)',
        ['branch-manager@edekise.com', `CEO Balance Adjustment Alert: ${account_id}`, `CEO has adjusted balance for ${account_type} account ${account_id}. Justification: ${justification}`, 'Pending'],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log(`[AUDIT] CEO balance adjustment: ${transactionId} for ${account_type} ${account_id} by user ${userId} at ${new Date().toISOString()}`);
    console.log(`[AUDIT] Digital signature: ${digitalSignature}`);
    console.log(`[AUDIT] Branch Manager notified`);

    res.json({
      message: 'Balance adjustment completed successfully',
      transaction_id: transactionId,
      digital_signature: digitalSignature,
      preview,
      status: 'Completed',
      audit_log_created: true,
      branch_manager_notified: true
    });
  } catch (error) {
    console.error('Balance adjustment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Preview balance adjustment (before confirmation)
router.post('/balance-adjustment/preview', authenticateToken, authorizeRoles('ceo', 'admin'), async (req, res) => {
  const { account_id, account_type, adjustment_type, amount } = req.body;
  const numericAmount = Number(amount);

  if (!account_id || !account_type || !adjustment_type || !numericAmount) {
    return res.status(400).json({ error: 'Account ID, Account Type, Adjustment Type, and Amount are required' });
  }

  if (numericAmount <= 0) {
    return res.status(400).json({ error: 'Adjustment amount must be greater than zero' });
  }

  try {
    let currentBalance = 0;
    let account = null;

    if (account_type === 'loan') {
      account = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM loan_accounts WHERE id = ?', [account_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      if (account) currentBalance = account.balance;
    } else if (account_type === 'savings') {
      account = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM savings_accounts WHERE id = ?', [account_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      if (account) currentBalance = account.amount;
    }

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    let proposedBalance = currentBalance;
    if (adjustment_type === 'credit') {
      proposedBalance = Number(currentBalance) + numericAmount;
    } else if (adjustment_type === 'debit') {
      proposedBalance = Number(currentBalance) - numericAmount;
    }

    if (proposedBalance < 0) {
      return res.status(400).json({ error: 'Adjustment would result in a negative balance' });
    }

    res.json({
      current_balance: currentBalance,
      adjustment_type: adjustment_type,
      adjustment_amount: numericAmount,
      proposed_final_balance: proposedBalance
    });
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get CEO pending approvals (UC-M-007)
router.get('/approvals/pending', authenticateToken, authorizeRoles('ceo'), async (req, res) => {
  try {
    const approvals = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM approval_requests WHERE type = 'ceo_loan_approval' AND status = 'Pending'", [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Enrich with loan details and branch manager info
    const enrichedApprovals = await Promise.all(approvals.map(async (approval) => {
      const loan = await new Promise((resolve, reject) => {
        db.get(`
          SELECT la.*, c.name AS client_name, c.email AS client_email
          FROM loan_accounts la
          JOIN clients c ON c.id = la.client_id
          WHERE la.id = ?
        `, [approval.entity_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      const requester = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE id = ?', [approval.requested_by], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      return {
        ...approval,
        loan,
        requester
      };
    }));

    res.json(enrichedApprovals);
  } catch (error) {
    console.error('Error fetching CEO pending approvals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve branch request (UC-M-007)
router.post('/approvals/:requestId/approve', authenticateToken, authorizeRoles('ceo'), async (req, res) => {
  const { requestId } = req.params;
  const userId = req.user.id;

  try {
    // Get approval request details
    const approval = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM approval_requests WHERE id = ?', [requestId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!approval) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    if (approval.status !== 'Pending') {
      return res.status(400).json({ error: 'Request has already been processed' });
    }

    // Update approval request status
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE approval_requests SET status = 'Approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?",
        [userId, requestId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    let activationResult = null;
    if (approval.type === 'ceo_loan_approval') {
      activationResult = await activateLoanAccount({
        loanId: approval.entity_id,
        activatedBy: req.user,
        activationReason: 'CEO final approval'
      });
    }

    // Notify Branch Manager and originating staff
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO email_log (recipient_email, subject, body, status) VALUES (?, ?, ?, ?)',
        ['branch-manager@edekise.com', `CEO Approval: ${requestId}`, `CEO has approved request ${requestId}. The originating record has been updated.`, 'Pending'],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log(`[AUDIT] CEO approved request ${requestId} by user ${userId} at ${new Date().toISOString()}`);
    console.log(`[AUDIT] Branch Manager notified of approval`);

    res.json({
      message: 'Branch request approved successfully',
      request_id: requestId,
      status: 'Approved',
      originating_record_updated: true,
      branch_manager_notified: true,
      loan_status: activationResult?.loan?.status || null,
      total_payments: activationResult?.schedule?.length || 0
    });
  } catch (error) {
    console.error('CEO approval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject branch request (UC-M-007)
router.post('/approvals/:requestId/reject', authenticateToken, authorizeRoles('ceo'), async (req, res) => {
  const { requestId } = req.params;
  const { justification } = req.body;
  const userId = req.user.id;

  console.log('[CEO REJECT] Request ID:', requestId);
  console.log('[CEO REJECT] Justification:', justification);

  // Alternative Flow: Reject Mandate - requires mandatory rejection justification
  if (!justification || justification.length < 10) {
    return res.status(400).json({ 
      error: 'Mandatory rejection justification is required (minimum 10 characters)',
      violation_type: 'missing_justification'
    });
  }

  try {
    // Get approval request details
    const approval = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM approval_requests WHERE id = ?', [requestId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    console.log('[CEO REJECT] Found approval:', approval);

    if (!approval) {
      console.log('[CEO REJECT] Approval not found for ID:', requestId);
      return res.status(404).json({ error: 'Approval request not found' });
    }

    if (approval.status !== 'Pending') {
      return res.status(400).json({ error: 'Request has already been processed' });
    }

    // Update approval request status with justification
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE approval_requests SET status = 'Rejected', justification = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?",
        [justification, userId, requestId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    if (approval.type === 'ceo_loan_approval') {
      await rejectLoanAccount({
        loanId: approval.entity_id,
        rejectedBy: req.user,
        reason: justification
      });
    }

    // Notify Branch Manager and originating staff
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO email_log (recipient_email, subject, body, status) VALUES (?, ?, ?, ?)',
        ['branch-manager@edekise.com', `CEO Rejection: ${requestId}`, `CEO has rejected request ${requestId}. Justification: ${justification}`, 'Pending'],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log(`[AUDIT] CEO rejected request ${requestId} by user ${userId} with justification: ${justification} at ${new Date().toISOString()}`);
    console.log(`[AUDIT] Branch Manager notified of rejection`);

    res.json({
      message: 'Branch request rejected',
      request_id: requestId,
      status: 'Rejected',
      rejection_justification: justification,
      originating_record_updated: true,
      branch_manager_notified: true
    });
  } catch (error) {
    console.error('CEO rejection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate CEO reports
router.get('/reports', authenticateToken, authorizeRoles('ceo'), async (req, res) => {
  try {
    // Get system-wide statistics
    const totalPortfolio = await new Promise((resolve, reject) => {
      db.get('SELECT SUM(balance) as total FROM loan_accounts WHERE status = "Active"', [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const totalClients = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM clients', [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const activeLoans = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM loan_accounts WHERE status = "Active"', [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const totalSavings = await new Promise((resolve, reject) => {
      db.get('SELECT SUM(amount) as total FROM savings_accounts WHERE status = "Active"', [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Get branch performance data
    const branches = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM branches', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Generate report data
    const reportData = {
      summary: {
        total_portfolio: totalPortfolio?.total || 0,
        total_clients: totalClients?.count || 0,
        active_loans: activeLoans?.count || 0,
        total_savings: totalSavings?.total || 0
      },
      branches: branches,
      generated_at: new Date().toISOString()
    };

    res.json(reportData);
  } catch (error) {
    console.error('Reports generation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate Risk Assessment Report
router.get('/reports/risk', authenticateToken, authorizeRoles('ceo'), async (req, res) => {
  try {
    // Get overdue loans
    const overdueLoans = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM loan_accounts WHERE status = "Active" AND due_date < date("now")', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Get loans with high interest rates
    const highInterestLoans = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM loan_accounts WHERE interest_rate > 20 AND status = "Active"', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Calculate risk metrics
    const totalLoans = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM loan_accounts WHERE status = "Active"', [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const overduePercentage = totalLoans.count > 0 ? (overdueLoans.length / totalLoans.count * 100).toFixed(2) : 0;

    const riskData = {
      risk_metrics: {
        overdue_loans_count: overdueLoans.length,
        overdue_percentage: parseFloat(overduePercentage),
        high_interest_loans_count: highInterestLoans.length,
        total_active_loans: totalLoans.count,
        risk_level: overduePercentage > 10 ? 'High' : overduePercentage > 5 ? 'Medium' : 'Low'
      },
      overdue_loans: overdueLoans,
      high_interest_loans: highInterestLoans,
      recommendations: overduePercentage > 10 
        ? ['Increase collection efforts', 'Review loan approval criteria', 'Implement early warning system']
        : overduePercentage > 5
        ? ['Monitor overdue accounts', 'Contact clients proactively']
        : ['Continue current practices'],
      generated_at: new Date().toISOString()
    };

    res.json(riskData);
  } catch (error) {
    console.error('Risk assessment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports/compliance', authenticateToken, authorizeRoles('admin', 'branch_manager', 'ceo'), async (req, res) => {
  try {
    const [
      pendingKyc,
      verifiedKyc,
      openAmlAlerts,
      recentAmlAlerts,
      pendingApprovals,
      overdueLoans,
      defaultedLoans,
      recentAuditEvents
    ] = await Promise.all([
      new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) AS count FROM clients WHERE COALESCE(kyc_status, 'Pending') != 'Verified'", [], (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      }),
      new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) AS count FROM clients WHERE kyc_status = 'Verified'", [], (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      }),
      new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) AS count FROM aml_alerts WHERE status IN ('Open', 'Under Review')", [], (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      }),
      new Promise((resolve, reject) => {
        db.all(
          `SELECT id, alert_type, severity, status, account_id, transaction_id, description, created_at
           FROM aml_alerts
           ORDER BY created_at DESC
           LIMIT 5`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      }),
      new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) AS count FROM approval_requests WHERE status = 'Pending'", [], (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      }),
      new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) AS count FROM loan_accounts WHERE status = 'Overdue'", [], (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      }),
      new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) AS count FROM loan_accounts WHERE status = 'Defaulted'", [], (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      }),
      new Promise((resolve, reject) => {
        db.all(
          `SELECT id, action, user_role, details, timestamp
           FROM audit_trail
           ORDER BY timestamp DESC
           LIMIT 8`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      })
    ]);

    res.json({
      generated_at: new Date().toISOString(),
      summary: {
        pending_kyc: pendingKyc,
        verified_kyc: verifiedKyc,
        open_aml_alerts: openAmlAlerts,
        pending_approvals: pendingApprovals,
        overdue_loans: overdueLoans,
        defaulted_loans: defaultedLoans
      },
      recent_aml_alerts: recentAmlAlerts,
      recent_audit_events: recentAuditEvents
    });
  } catch (error) {
    console.error('Compliance overview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
