const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { db } = require('../config/database');
const { recordAuditEvent } = require('../utils/auditTrail');
const { emitLoanUpdated, emitBalanceUpdated } = require('../utils/realtime');
const { ensureClientUserCredentials, ensureRegistrationRequestCredentialColumns } = require('./clients');
const { sendEmail, sendLoanApprovalEmail, sendLoanRejectionEmail } = require('../utils/emailService');

// Approval thresholds (ETB)
const APPROVAL_THRESHOLDS = {
  branch_manager: 100000,      // Branch Manager can approve up to 100,000 ETB
  ceo: Infinity                // CEO can approve any amount
};

// Generate approval request ID
const generateApprovalId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `APR-${timestamp}-${random}`;
};

// Determine approval level based on amount
const getApprovalLevel = (amount) => {
  if (amount <= APPROVAL_THRESHOLDS.branch_manager) {
    return 'branch_manager';
  }
  return 'ceo';
};

// Create approval request
const createApprovalRequest = async (type, entityId, amount, requestedBy, details) => {
  const approvalLevel = getApprovalLevel(amount);
  const approvalId = generateApprovalId();
  
  await new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO approval_requests (id, type, entity_id, amount, requested_by, status, approval_level, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [approvalId, type, entityId, amount, requestedBy, 'Pending', approvalLevel, JSON.stringify(details)],
      function(err) {
        if (err) reject(err);
        else resolve(approvalId);
      }
    );
  });

  // Notify approvers by email (best-effort)
  try {
    const rolesToNotify = approvalLevel === 'branch_manager' ? ['branch_manager', 'admin'] : ['ceo', 'admin'];
    db.all(
      `SELECT email, username, role FROM users WHERE role IN (${rolesToNotify.map(() => '?').join(',')}) AND email IS NOT NULL`,
      rolesToNotify,
      async (err, rows) => {
        if (err || !rows || rows.length === 0) return;
        const subject = `Approval Required: ${type}`;
        const text = `An approval request (${approvalId}) of type ${type} requires your review.\n\nRequested by user ID: ${requestedBy}\nAmount: ${amount || 0}\n\nPlease review the request in the admin portal.`;
        for (const r of rows) {
          try {
            await sendEmail(r.email, subject, text);
          } catch (e) {
            console.warn('Failed to send approval notification to', r.email, e && e.message);
          }
        }
      }
    );
  } catch (e) {
    // ignore notification errors
  }

  return approvalId;
};

const parseRequestDetails = (request) => {
  if (!request?.details) {
    return {};
  }

  try {
    return typeof request.details === 'string' ? JSON.parse(request.details) : request.details;
  } catch (parseError) {
    console.warn('Failed to parse approval request details:', parseError.message);
    return {};
  }
};

const runGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});

const runAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const safeRecordAudit = async (payload, contextLabel) => {
  try {
    await recordAuditEvent(payload);
  } catch (error) {
    console.warn(`Audit logging failed (${contextLabel}):`, error?.message || error);
  }
};

const findLinkedDocuments = async (request) => {
  if (!request?.id) return [];
  const details = parseRequestDetails(request);
  const receiptDocId = details.receipt_document_id || details.receiptDocId || null;
  const relatedEntityType = details.related_entity_type || details.relatedEntityType || null;
  const relatedEntityId = details.related_entity_id || details.relatedEntityId || request.entity_id || null;

  if (receiptDocId) {
    const doc = await runGet('SELECT * FROM documents WHERE id = ?', [receiptDocId]);
    return doc ? [doc] : [];
  }

  // Prefer approval_request linkage if available; fall back to related entity linkage.
  const docs = await runAll(
    `SELECT *
     FROM documents
     WHERE approval_request_id = ?
        OR (related_entity_id = ? AND (? IS NULL OR related_entity_type = ?))
     ORDER BY uploaded_at DESC`,
    [request.id, relatedEntityId, relatedEntityType, relatedEntityType]
  );
  return docs || [];
};

const preflightApprovalRequirements = async (request) => {
  const details = parseRequestDetails(request);
  const requiresReceiptProof = Boolean(details.requires_receipt_proof || details.requiresReceiptProof);
  if (!requiresReceiptProof) {
    return;
  }

  // Enforce receipt proof for workflows that depend on external evidence.
  const typesRequiringProof = new Set(['transaction_deposit']);
  if (!typesRequiringProof.has(request.type)) {
    return;
  }

  const linked = await findLinkedDocuments(request);
  if (!linked || linked.length === 0) {
    const err = new Error('Receipt/proof is required before approval. Please attach the receipt document first.');
    err.statusCode = 400;
    err.code = 'MISSING_RECEIPT_PROOF';
    throw err;
  }
};

// Get pending approvals for current user based on role
router.get('/pending', authenticateToken, authorizeRoles('branch_manager', 'ceo', 'admin'), (req, res) => {
  const userRole = req.user.role;
  
  let whereClause = "ar.status = 'Pending'";
  const params = [];
  
  // Filter by approval level based on role
  if (userRole === 'branch_manager') {
    whereClause += " AND ar.approval_level = 'branch_manager'";
  }
  // CEO can see all pending approvals
  
  db.all(`
    SELECT ar.*, u.username as requested_by_name 
    FROM approval_requests ar 
    LEFT JOIN users u ON ar.requested_by = u.id 
    WHERE ${whereClause}
    ORDER BY ar.created_at DESC
  `, params, async (err, requests) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    try {
      const enriched = await Promise.all((requests || []).map(async (request) => {
        if (!['transaction_deposit', 'transaction_withdraw'].includes(request.type)) {
          return request;
        }
        const details = parseRequestDetails(request);
        if (details.client_name && details.savings_type) {
          return request;
        }
        const account = await runGet('SELECT id, client_id, type FROM savings_accounts WHERE id = ?', [request.entity_id]);
        if (!account) {
          return request;
        }
        const client = await runGet('SELECT id, name FROM clients WHERE id = ?', [account.client_id]);
        const mergedDetails = {
          ...details,
          client_id: details.client_id || account.client_id,
          client_name: details.client_name || client?.name || `Client-${account.client_id}`,
          account_type: details.account_type || 'savings',
          savings_type: details.savings_type || account.type,
          transaction_type: details.transaction_type || (request.type === 'transaction_withdraw' ? 'withdrawal' : 'deposit')
        };
        return {
          ...request,
          details: JSON.stringify(mergedDetails)
        };
      }));
      res.json(enriched);
    } catch (enrichError) {
      console.error('Pending approval enrichment error:', enrichError);
      res.json(requests);
    }
  });
});

// Get all approvals (admin view)
router.get('/all', authenticateToken, authorizeRoles('admin'), (req, res) => {
  db.all(`
    SELECT ar.*, u.username as requested_by_name, r.username as reviewed_by_name 
    FROM approval_requests ar 
    LEFT JOIN users u ON ar.requested_by = u.id 
    LEFT JOIN users r ON ar.reviewed_by = r.id 
    ORDER BY ar.created_at DESC
  `, [], (err, requests) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(requests);
  });
});

// Get approval history summary (branch manager/admin/ceo)
router.get('/history', authenticateToken, authorizeRoles('branch_manager', 'admin', 'ceo'), (req, res) => {
  const { type } = req.query;
  const allowedTypes = ['loan_origination', 'account_creation', 'savings_account_approval'];
  const requestedTypes = type
    ? String(type).split(',').map((item) => item.trim()).filter(Boolean)
    : allowedTypes;
  const filteredTypes = requestedTypes.filter((item) => allowedTypes.includes(item));
  if (filteredTypes.length === 0) {
    return res.status(400).json({ error: 'Unsupported approval history type filter.' });
  }

  const placeholders = filteredTypes.map(() => '?').join(',');
  db.all(
    `SELECT id, type, entity_id, amount, status, approval_level, created_at, reviewed_at, reviewed_by
     FROM approval_requests
     WHERE type IN (${placeholders})
       AND status IN ('Approved', 'Rejected')
     ORDER BY COALESCE(reviewed_at, created_at) DESC
     LIMIT 200`,
    filteredTypes,
    (err, rows) => {
      if (err) {
        console.error('Approval history query error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      const normalized = Array.isArray(rows) ? rows : [];
      const summary = normalized.reduce((acc, item) => {
        const key = item.type;
        if (!acc[key]) {
          acc[key] = { approved: 0, rejected: 0, total: 0 };
        }
        if (item.status === 'Approved') acc[key].approved += 1;
        if (item.status === 'Rejected') acc[key].rejected += 1;
        acc[key].total += 1;
        return acc;
      }, {});

      return res.json({
        summary,
        history: normalized
      });
    }
  );
});

// Approve request
router.post('/:id/approve', authenticateToken, authorizeRoles('branch_manager', 'ceo', 'admin'), (req, res) => {
  const { id } = req.params;
  const { justification } = req.body;
  const userId = req.user.id;
  const userRole = req.user.role;

  // Get approval request details
  db.get('SELECT * FROM approval_requests WHERE id = ?', [id], async (err, request) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!request) {
      return res.status(404).json({ error: 'Approval request not found' });
    }
    
    if (request.status !== 'Pending') {
      return res.status(400).json({ error: 'Request has already been processed' });
    }
    
    // Check if user has authority to approve at this level
    if (request.approval_level === 'ceo' && userRole !== 'ceo' && userRole !== 'admin') {
      return res.status(403).json({ error: 'Insufficient privileges to approve this request' });
    }

    try {
      await preflightApprovalRequirements(request);
    } catch (preflightError) {
      return res.status(preflightError.statusCode || 400).json({
        error: preflightError.message || 'Approval preflight failed',
        code: preflightError.code || 'PREFLIGHT_FAILED'
      });
    }
    
    // Update approval request
    db.run(
      "UPDATE approval_requests SET status = 'Approved', justification = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?",
      [justification || 'Approved', userId, id],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        console.log(`[AUDIT] Approval request ${id} approved by ${userRole} (ID: ${userId}) at ${new Date().toISOString()}`);
        
        executeApprovedAction(request)
          .then((result) => {
            recordAuditEvent({
              action: 'APPROVAL_APPROVED',
              entityType: 'approval_request',
              entityId: id,
              user: req.user,
              details: { amount: request.amount, type: request.type, justification: justification || 'Approved' }
            }).catch(() => {});
            // Notify requester about approval (best-effort)
            try {
              db.get('SELECT email, username FROM users WHERE id = ?', [request.requested_by], async (err, userRow) => {
                if (!err && userRow && userRow.email) {
                  const subject = `Your request ${id} has been approved`;
                  const text = `Hello ${userRow.username || ''},\n\nYour approval request (${id}) for ${request.type} has been approved by ${req.user.role}.\n\nRegards,\nEdekise Microfinance`;
                  try { await sendEmail(userRow.email, subject, text); } catch (e) { console.warn('Failed to send approval notification to requester', e && e.message); }
                }
              });
            } catch (e) {
              // ignore
            }

            res.json({
              message: 'Request approved successfully',
              execution: result || null
            });
          })
          .catch((executionError) => {
            console.error('Approval execution error:', executionError);
            // Approval has already been recorded; return 200 with a warning so the UI
            // doesn't show a hard failure for an already-approved request.
            res.json({
              message: 'Request approved successfully',
              execution: null,
              warning: 'Approval recorded but the requested action could not be completed',
              details: executionError.message
            });
          });
      }
    );
  });
});

// Reject request
router.post('/:id/reject', authenticateToken, authorizeRoles('branch_manager', 'ceo', 'admin'), (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const userId = req.user.id;
  const userRole = req.user.role;

  // Get approval request details
  db.get('SELECT * FROM approval_requests WHERE id = ?', [id], (err, request) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!request) {
      return res.status(404).json({ error: 'Approval request not found' });
    }
    
    if (request.status !== 'Pending') {
      return res.status(400).json({ error: 'Request has already been processed' });
    }
    
    // Check if user has authority to reject at this level
    if (request.approval_level === 'ceo' && userRole !== 'ceo' && userRole !== 'admin') {
      return res.status(403).json({ error: 'Insufficient privileges to reject this request' });
    }
    
    db.run(
      "UPDATE approval_requests SET status = 'Rejected', justification = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?",
      [reason || 'Rejected', userId, id],
      async function onReject(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        try {
          const result = await executeRejectedAction({
            ...request,
            reviewed_by: userId
          }, reason);
          recordAuditEvent({
            action: 'APPROVAL_REJECTED',
            entityType: 'approval_request',
            entityId: id,
            user: req.user,
            details: { amount: request.amount, type: request.type, reason: reason || 'Rejected' }
          }).catch(() => {});
          console.log(`[AUDIT] Approval request ${id} rejected by ${userRole} (ID: ${userId}) at ${new Date().toISOString()}`);

          // Notify requester about rejection (best-effort)
          try {
            db.get('SELECT email, username FROM users WHERE id = ?', [request.requested_by], async (err, userRow) => {
              if (!err && userRow && userRow.email) {
                const subject = `Your request ${id} has been rejected`;
                const text = `Hello ${userRow.username || ''},\n\nYour approval request (${id}) for ${request.type} has been rejected by ${req.user.role}.\nReason: ${reason || 'Not specified'}\n\nRegards,\nEdekise Microfinance`;
                try { await sendEmail(userRow.email, subject, text); } catch (e) { console.warn('Failed to send rejection notification to requester', e && e.message); }
              }
            });
          } catch (e) {
            // ignore
          }

          res.json({
            message: 'Request rejected successfully',
            execution: result || null
          });
        } catch (executionError) {
          console.error('Approval rejection execution error:', executionError);
          // Rejection has already been recorded; return 200 with a warning so the UI
          // doesn't show a hard failure for an already-rejected request.
          res.json({
            message: 'Request rejected successfully',
            execution: null,
            warning: 'Rejection recorded but follow-up cleanup failed',
            details: executionError.message
          });
        }
      }
    );
  });
});

async function executeApprovedAction(request) {
  if (request.type === 'transaction_deposit' || request.type === 'transaction_withdraw') {
    return executeApprovedTransaction(request);
  }

  if (request.type === 'account_creation') {
    return executeApprovedAccountCreation(request);
  }

  if (request.type === 'savings_account_approval') {
    return executeApprovedSavingsAccount(request);
  }

  if (request.type === 'loan_origination') {
    return executeApprovedLoan(request);
  }

  if (request.type === 'statement_approval') {
    return executeApprovedStatementRequest(request);
  }

  return null;
}

async function executeRejectedAction(request, reason) {
  if (request.type === 'account_creation') {
    return executeRejectedAccountCreation(request, reason);
  }

  if (request.type === 'savings_account_approval') {
    return executeRejectedSavingsAccount(request, reason);
  }

  if (request.type === 'loan_origination') {
    return executeRejectedLoan(request, reason);
  }

  if (request.type === 'statement_approval') {
    return executeRejectedStatementRequest(request, reason);
  }

  return null;
}

async function executeApprovedStatementRequest(request) {
  const statementId = request.entity_id;
  const statement = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM statements WHERE id = ?', [statementId], (err, row) => (err ? reject(err) : resolve(row || null)));
  });

  if (!statement) {
    throw new Error(`Statement ${statementId} not found for approval execution`);
  }

  if (statement.status === 'Finalized') {
    return { statement_id: statementId, status: 'Finalized' };
  }

  await new Promise((resolve, reject) => {
    db.run("UPDATE statements SET status = 'Approved' WHERE id = ?", [statementId], (err) => (err ? reject(err) : resolve()));
  });

  return { statement_id: statementId, status: 'Approved' };
}

async function executeRejectedStatementRequest(request, reason) {
  const statementId = request.entity_id;
  const statement = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM statements WHERE id = ?', [statementId], (err, row) => (err ? reject(err) : resolve(row || null)));
  });

  if (!statement) {
    throw new Error(`Statement ${statementId} not found for rejection execution`);
  }

  await new Promise((resolve, reject) => {
    db.run("UPDATE statements SET status = 'Rejected' WHERE id = ?", [statementId], (err) => (err ? reject(err) : resolve()));
  });

  return { statement_id: statementId, status: 'Rejected', reason: reason || 'Rejected' };
}

// Execute approved transaction
async function executeApprovedTransaction(request) {
  const details = parseRequestDetails(request);

  if (request.type === 'transaction_deposit') {
    const accountId = details.accountId || details.account_id || details.savings_account_id;
    const amount = details.amount;
    const description = details.description;
    
    const account = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, amount AS balance, status, client_id, 'savings_accounts' AS source_table
         FROM savings_accounts
         WHERE id = ?`,
        [accountId],
        (err, row) => {
        if (err) reject(err);
        else resolve(row);
        }
      );
    });
    
    if (account) {
      const balanceBefore = Number(account.balance || 0);
      const balanceAfter = balanceBefore + Number(amount);
      const updateSql = 'UPDATE savings_accounts SET amount = ? WHERE id = ?';
      
      await new Promise((resolve, reject) => {
        db.run(updateSql, [balanceAfter, accountId], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
      
      const transactionId = generateApprovalId();
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, approval_request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [transactionId, accountId, 'savings', 'deposit', amount, balanceBefore, balanceAfter, description || 'Deposit (Approved)', request.id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      await safeRecordAudit({
        action: 'APPROVED_DEPOSIT_EXECUTED',
        entityType: 'transaction',
        entityId: transactionId,
        user: { id: request.reviewed_by, role: 'checker' },
        beforeState: { accountId, balance: balanceBefore },
        afterState: { accountId, balance: balanceAfter },
        details: { approval_request_id: request.id }
      }, 'approved_deposit_executed');
      emitBalanceUpdated({ savingsAccountId: accountId, balance: balanceAfter });
      return {
        transaction_id: transactionId,
        account_id: accountId,
        transaction_type: 'deposit'
      };
    }
  } else if (request.type === 'transaction_withdraw') {
    const accountId = details.accountId || details.account_id || details.savings_account_id;
    const amount = details.amount;
    const description = details.description;
    
    const account = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, amount AS balance, status, client_id, 'savings_accounts' AS source_table
         FROM savings_accounts
         WHERE id = ?`,
        [accountId],
        (err, row) => {
        if (err) reject(err);
        else resolve(row);
        }
      );
    });
    
    if (account) {
      const balanceBefore = Number(account.balance || 0);
      const balanceAfter = balanceBefore - Number(amount);
      const updateSql = 'UPDATE savings_accounts SET amount = ? WHERE id = ?';
      
      await new Promise((resolve, reject) => {
        db.run(updateSql, [balanceAfter, accountId], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
      
      const transactionId = generateApprovalId();
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, approval_request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [transactionId, accountId, 'savings', 'withdraw', amount, balanceBefore, balanceAfter, description || 'Withdrawal (Approved)', request.id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      await safeRecordAudit({
        action: 'APPROVED_WITHDRAWAL_EXECUTED',
        entityType: 'transaction',
        entityId: transactionId,
        user: { id: request.reviewed_by, role: 'checker' },
        beforeState: { accountId, balance: balanceBefore },
        afterState: { accountId, balance: balanceAfter },
        details: { approval_request_id: request.id }
      }, 'approved_withdrawal_executed');
      emitBalanceUpdated({ savingsAccountId: accountId, balance: balanceAfter });
      return {
        transaction_id: transactionId,
        account_id: accountId,
        transaction_type: 'withdraw'
      };
    }
  }

  return null;
}

async function executeApprovedAccountCreation(request) {
  const details = parseRequestDetails(request);
  const accountId = request.entity_id;
  const sourceTable = 'savings_accounts';
  const balanceColumn = 'amount';

  const account = await new Promise((resolve, reject) => {
    db.get(
      `SELECT a.*, c.name AS client_name, c.kyc_status, c.id_number, c.income_source
       FROM ${sourceTable} a
       JOIN clients c ON c.id = a.client_id
       WHERE a.id = ?`,
      [accountId],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });

  if (!account) {
    throw new Error(`Account ${accountId} could not be found for approval execution`);
  }

  await new Promise((resolve, reject) => {
    db.run(
      `UPDATE ${sourceTable}
       SET status = 'Active'
       WHERE id = ?`,
      [accountId],
      (err) => (err ? reject(err) : resolve())
    );
  });

  const openingBalance = Number(details.opening_balance || details.initial_balance || account[balanceColumn] || 0);
  if (openingBalance > 0) {
    const existingTransaction = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id
         FROM transactions
         WHERE account_id = ? AND account_type = 'savings' AND transaction_type = 'deposit'
         ORDER BY created_at ASC
         LIMIT 1`,
        [accountId],
        (err, row) => (err ? reject(err) : resolve(row || null))
      );
    });

    if (!existingTransaction) {
      const transactionId = generateApprovalId();
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO transactions
           (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, approval_request_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            transactionId,
            accountId,
            'savings',
            'deposit',
            openingBalance,
            0,
            openingBalance,
            'Opening balance approved',
            request.id,
            request.reviewed_by || null
          ],
          (err) => (err ? reject(err) : resolve())
        );
      });
    }
  }

  await safeRecordAudit({
    action: 'ACCOUNT_CREATION_APPROVED',
    entityType: 'account',
    entityId: accountId,
    user: { id: request.reviewed_by, role: 'checker' },
    beforeState: { status: account.status },
    afterState: { status: 'Active' },
    details: {
      approval_request_id: request.id,
      client_id: account.client_id,
      client_name: account.client_name,
      requested_type: details.account_type || account.type
    }
  }, 'account_creation_approved');

  // Ensure client user credentials exist and persist/send generated credentials if created
  try {
    await ensureRegistrationRequestCredentialColumns();
  } catch (e) {
    // best-effort, ignore schema alteration failures
  }

  try {
    const clientRow = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM clients WHERE id = ?', [account.client_id], (err, row) => (err ? reject(err) : resolve(row)));
    });

    if (clientRow) {
      const { username, temporaryPassword, created } = await ensureClientUserCredentials(clientRow);
      if (created && username && temporaryPassword) {
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE client_registration_requests SET generated_username = ?, generated_temporary_password = ?, credentials_sent_at = ? WHERE client_id = ?',
            [username, temporaryPassword, new Date().toISOString(), clientRow.id],
            (err) => (err ? reject(err) : resolve())
          );
        });

        if (clientRow.email) {
          const subject = 'Your Edekise Microfinance Account Credentials';
          const text = `Dear ${clientRow.name},\n\nYour account has been approved and your client portal account is ready.\n\nUsername: ${username}\nTemporary password: ${temporaryPassword}\n\nPlease change your password after first login.\n\nRegards,\nEdekise Microfinance Team`;
          try {
            await sendEmail(clientRow.email, subject, text);
          } catch (e) {
            console.warn('Failed to send credentials email:', e && e.message);
          }
        }
      }
    }
  } catch (e) {
    console.warn('Credential creation on approval failed:', e && e.message);
  }
  return {
    account_id: accountId,
    client_id: account.client_id,
    status: 'Active'
  };
}

async function executeRejectedAccountCreation(request, reason) {
  const accountId = request.entity_id;
  const sourceTable = 'savings_accounts';

  await new Promise((resolve, reject) => {
    const updateSql = "UPDATE savings_accounts SET status = 'Rejected' WHERE id = ?";
    db.run(updateSql, [accountId], function(err) {
      if (err) reject(err);
      else resolve();
    });
  });

  await safeRecordAudit({
    action: 'ACCOUNT_CREATION_REJECTED',
    entityType: 'account',
    entityId: accountId,
    user: { id: request.reviewed_by, role: 'checker' },
    beforeState: { status: 'Pending' },
    afterState: { status: 'Rejected' },
    details: { reason, approval_request_id: request.id }
  }, 'account_creation_rejected');

  return { account_id: accountId, status: 'Rejected', reason };
}

// Execute approved savings account
async function executeApprovedSavingsAccount(request) {
  const { entity_id: savingsId } = request;

  await new Promise((resolve, reject) => {
    db.run(
      "UPDATE savings_accounts SET status = 'Active', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?",
      [request.reviewed_by, savingsId],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  const savings = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM savings_accounts WHERE id = ?', [savingsId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  await safeRecordAudit({
    action: 'SAVINGS_ACCOUNT_APPROVED',
    entityType: 'savings_account',
    entityId: savingsId,
    user: { id: request.reviewed_by, role: 'branch_manager' },
    beforeState: { status: 'Pending Manager Review' },
    afterState: { status: 'Active' },
    details: { approval_request_id: request.id, client_id: savings.client_id }
  }, 'savings_account_approved');

  // Create notification for client
  const client = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM clients WHERE id = ?', [savings.client_id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  if (client) {
    try {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [client.user_id, 'approval', 'Savings Account Approved', `Your savings account ${savingsId} has been approved and is now active.`, 'savings_account', savingsId, new Date().toISOString()],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } catch (notificationError) {
      console.warn('Savings approval notification write failed:', notificationError?.message || notificationError);
    }
  }

  // Ensure client has user credentials and send them when created
  try {
    await ensureRegistrationRequestCredentialColumns();
  } catch (e) {
    // ignore
  }

  try {
    if (client) {
      const { username, temporaryPassword, created } = await ensureClientUserCredentials(client);
      if (created && username && temporaryPassword) {
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE client_registration_requests SET generated_username = ?, generated_temporary_password = ?, credentials_sent_at = ? WHERE client_id = ?',
            [username, temporaryPassword, new Date().toISOString(), client.id],
            (err) => (err ? reject(err) : resolve())
          );
        });

        if (client.email) {
          const subject = 'Your Edekise Microfinance Account Credentials';
          const text = `Dear ${client.name},\n\nYour savings account has been approved and your client portal account is ready.\n\nUsername: ${username}\nTemporary password: ${temporaryPassword}\n\nPlease change your password after first login.\n\nRegards,\nEdekise Microfinance Team`;
          try {
            await sendEmail(client.email, subject, text);
          } catch (e) {
            console.warn('Failed to send credentials email:', e && e.message);
          }
        }
      }
    }
  } catch (e) {
    console.warn('Credential creation on savings approval failed:', e && e.message);
  }

  return { savings_id: savingsId, status: 'Active', client_id: savings.client_id };
}

// Execute rejected savings account
async function executeRejectedSavingsAccount(request, reason) {
  const { entity_id: savingsId } = request;

  await new Promise((resolve, reject) => {
    db.run(
      "UPDATE savings_accounts SET status = 'Rejected', rejection_reason = ? WHERE id = ?",
      [reason, savingsId],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  await safeRecordAudit({
    action: 'SAVINGS_ACCOUNT_REJECTED',
    entityType: 'savings_account',
    entityId: savingsId,
    user: { id: request.reviewed_by, role: 'branch_manager' },
    beforeState: { status: 'Pending Manager Review' },
    afterState: { status: 'Rejected' },
    details: { reason, approval_request_id: request.id }
  }, 'savings_account_rejected');

  return { savings_id: savingsId, status: 'Rejected', reason };
}

// Execute approved loan
async function executeApprovedLoan(request) {
  const { entity_id: loanId } = request;
  const details = parseRequestDetails(request);

  // Get loan details
  const loan = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM loan_accounts WHERE id = ?', [loanId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  if (!loan) {
    throw new Error('Loan not found');
  }

  // Check savings account status and balance
  const savingsAccount = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM savings_accounts WHERE id = ?', [loan.savings_account_id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  if (!savingsAccount) {
    throw new Error('Linked savings account not found');
  }

  if (savingsAccount.status !== 'Active') {
    throw new Error('Linked savings account is not active');
  }

  // Verify group guarantee if client belongs to a group
  if (savingsAccount.group_id) {
    const group = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM groups WHERE id = ?', [savingsAccount.group_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!group || group.status !== 'Active') {
      throw new Error('Client group is not active');
    }

    // Verify guarantors
    const guarantors = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM loan_guarantors WHERE loan_id = ?', [loanId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (guarantors.length === 0) {
      throw new Error('Group loan requires at least one guarantor');
    }

    // Verify each guarantor is active and in the same group
    for (const guarantor of guarantors) {
      const guarantorClient = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM clients WHERE id = ?', [guarantor.guarantor_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!guarantorClient || guarantorClient.status !== 'Active') {
        throw new Error(`Guarantor ${guarantor.guarantor_id} is not active`);
      }

      if (guarantorClient.group_id !== savingsAccount.group_id) {
        throw new Error(`Guarantor ${guarantor.guarantor_id} is not in the same group`);
      }
    }
  }

  await new Promise((resolve, reject) => {
    db.run(
      "UPDATE loan_accounts SET status = 'Active', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?",
      [request.reviewed_by, loanId],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  // Disburse loan amount to savings account
  const transactionId = `TXN-${Date.now()}-DISB`;
  const savingsBalanceBefore = savingsAccount.amount;
  const savingsBalanceAfter = savingsBalanceBefore + loan.amount;

  await new Promise((resolve, reject) => {
    db.run(
      'UPDATE savings_accounts SET amount = ? WHERE id = ?',
      [savingsBalanceAfter, loan.savings_account_id],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  // Create transaction record for disbursement
  await new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [transactionId, loan.savings_account_id, 'savings', 'disbursement', loan.amount, savingsBalanceBefore, savingsBalanceAfter, `Loan disbursement for ${loanId}`, request.reviewed_by, new Date().toISOString()],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  // Update loan disbursement date
  await new Promise((resolve, reject) => {
    db.run(
      'UPDATE loan_accounts SET disbursement_date = ? WHERE id = ?',
      [new Date().toISOString().split('T')[0], loanId],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  await safeRecordAudit({
    action: 'LOAN_APPROVED',
    entityType: 'loan_account',
    entityId: loanId,
    user: { id: request.reviewed_by, role: 'branch_manager' },
    beforeState: { status: 'Pending Branch Manager Review' },
    afterState: { status: 'Active' },
    details: { approval_request_id: request.id, client_id: loan.client_id, amount: loan.amount }
  }, 'loan_approved');
  emitLoanUpdated({ loanId, status: 'Active', balance: Number(loan.amount || 0) });
  emitBalanceUpdated({ savingsAccountId: loan.savings_account_id, balance: savingsBalanceAfter });

  // Create notification for client
  const client = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM clients WHERE id = ?', [loan.client_id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  if (client) {
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [client.user_id, 'approval', 'Loan Application Approved', `Your loan application ${loanId} for ${loan.amount} ETB has been approved and is now active.`, 'loan_account', loanId, new Date().toISOString()],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    if (client.email) {
      try {
        await sendLoanApprovalEmail({
          ...loan,
          client_name: client.name || loan.client_name,
          client_email: client.email
        });
      } catch (emailError) {
        console.warn('Loan approval email failed:', emailError?.message || emailError);
      }
    }
  }

  return { loan_id: loanId, status: 'Active', client_id: loan.client_id, amount: loan.amount };
}

// Execute rejected loan
async function executeRejectedLoan(request, reason) {
  const { entity_id: loanId } = request;

  await new Promise((resolve, reject) => {
    db.run(
      "UPDATE loan_accounts SET status = 'Rejected', rejection_reason = ? WHERE id = ?",
      [reason, loanId],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  await safeRecordAudit({
    action: 'LOAN_REJECTED',
    entityType: 'loan_account',
    entityId: loanId,
    user: { id: request.reviewed_by, role: 'branch_manager' },
    beforeState: { status: 'Pending Branch Manager Review' },
    afterState: { status: 'Rejected' },
    details: { reason, approval_request_id: request.id }
  }, 'loan_rejected');
  emitLoanUpdated({ loanId, status: 'Rejected' });

  const loan = await new Promise((resolve, reject) => {
    db.get(
      `SELECT la.*, c.name AS client_name, c.email AS client_email
       FROM loan_accounts la
       LEFT JOIN clients c ON c.id = la.client_id
       WHERE la.id = ?`,
      [loanId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      }
    );
  });

  if (loan?.client_email) {
    try {
      await sendLoanRejectionEmail(loan, reason);
    } catch (emailError) {
      console.warn('Loan rejection email failed:', emailError?.message || emailError);
    }
  }

  return { loan_id: loanId, status: 'Rejected', reason };
}

// Get approval thresholds (for UI)
router.get('/thresholds', authenticateToken, (req, res) => {
  res.json(APPROVAL_THRESHOLDS);
});

module.exports = router;
module.exports.createApprovalRequest = createApprovalRequest;
module.exports.getApprovalLevel = getApprovalLevel;
