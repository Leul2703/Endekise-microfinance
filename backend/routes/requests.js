const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const getSavingsAccountContext = (accountId) => new Promise((resolve, reject) => {
  db.get(
    `SELECT c.id AS client_id, c.name AS client_name, c.phone, s.id AS account_id, s.amount AS balance, s.status, 'savings_accounts' AS account_source
     FROM savings_accounts s
     JOIN clients c ON c.id = s.client_id
     WHERE s.id = ?`,
    [accountId],
    (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    }
  );
});

// Get all requests
router.get('/', authenticateToken, authorizeRoles('admin', 'branch_manager', 'saving_staff'), (req, res) => {
  db.all('SELECT * FROM requests ORDER BY submitted_date DESC', [], (err, rows) => {
    if (err) {
      console.error('Error fetching requests:', err);
      return res.status(500).json({ error: 'Failed to fetch requests' });
    }
    res.json(rows);
  });
});

// Create new request
router.post('/', authenticateToken, authorizeRoles('admin', 'branch_manager', 'saving_staff'), async (req, res) => {
  const accountId = req.body.accountId || req.body.account_id || req.body.account;
  const clientName = req.body.client || req.body.clientName;
  const requestType = req.body.requestType || req.body.type;
  const amount = req.body.amount;

  console.log('[REQUESTS] Incoming create request payload:', req.body);

  if (!accountId || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  try {
    const accountContext = await getSavingsAccountContext(accountId);
    console.log('[REQUESTS] Resolved account context:', accountContext);

    if (!accountContext) {
      return res.status(404).json({ error: 'Selected savings account could not be found' });
    }

    if (!['Active', 'Pending Manager Review', 'Pending'].includes(accountContext.status)) {
      return res.status(400).json({ error: 'Selected savings account is not available for new requests' });
    }

    const requestId = 'REQ-' + Date.now().toString().slice(-6);
    const submittedDate = new Date().toISOString().split('T')[0];
    const resolvedClientName = clientName || accountContext.client_name;
    const resolvedRequestType = requestType || 'Withdrawal Request';

    db.run(
      `INSERT INTO requests (id, client, account, type, amount, submitted_date, status, kyc_complete)
       VALUES (?, ?, ?, ?, ?, ?, 'Pending', 1)`,
      [requestId, resolvedClientName, accountContext.account_id, resolvedRequestType, parsedAmount, submittedDate],
      function(err) {
        if (err) {
          console.error('Error creating request:', err);
          return res.status(500).json({ error: 'Failed to create request' });
        }

        db.get('SELECT * FROM requests WHERE id = ?', [requestId], (lookupError, row) => {
          if (lookupError) {
            return res.status(500).json({ error: 'Failed to retrieve created request' });
          }
          res.status(201).json({ message: 'Request created successfully', request: row });
        });
      }
    );
  } catch (error) {
    console.error('Error validating request account:', error);
    res.status(500).json({ error: 'Failed to validate selected savings account' });
  }
});

// Approve request
router.post('/:id/approve', authenticateToken, authorizeRoles('admin', 'branch_manager'), (req, res) => {
  const { id } = req.params;

  db.run(
    'UPDATE requests SET status = ? WHERE id = ?',
    ['Approved', id],
    function(err) {
      if (err) {
        console.error('Error approving request:', err);
        return res.status(500).json({ error: 'Failed to approve request' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Request not found' });
      }
      res.json({ message: 'Request approved successfully' });
    }
  );
});

// Reject request
router.post('/:id/reject', authenticateToken, authorizeRoles('admin', 'branch_manager'), (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'Rejection reason is required' });
  }

  db.run(
    'UPDATE requests SET status = ?, rejection_reason = ? WHERE id = ?',
    ['Rejected', reason, id],
    function(err) {
      if (err) {
        console.error('Error rejecting request:', err);
        return res.status(500).json({ error: 'Failed to reject request' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Request not found' });
      }
      res.json({ message: 'Request rejected successfully' });
    }
  );
});

module.exports = router;
