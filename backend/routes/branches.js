const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { db } = require('../config/database');

const getBranchById = (id) => new Promise((resolve, reject) => {
  db.get(
    `SELECT b.*, u.name AS manager_name
     FROM branches b
     LEFT JOIN users u ON u.id = b.manager_id
     WHERE b.id = ?`,
    [id],
    (err, row) => {
      if (err) reject(err);
      else resolve(row);
    }
  );
});

// Get all branches (admin/CEO only)
router.get('/', authenticateToken, authorizeRoles('admin', 'ceo'), (req, res) => {
  db.all(`
    SELECT
      b.*,
      u.name AS manager_name,
      COALESCE(loan_summary.total_credit, 0) AS total_credit,
      COALESCE(loan_summary.active_loans, 0) AS active_loans,
      COALESCE(savings_summary.total_deposits, 0) AS total_deposits,
      COALESCE(savings_summary.active_savings_accounts, 0) AS active_savings_accounts,
      COALESCE(client_summary.client_count, 0) AS client_count
    FROM branches b
    LEFT JOIN users u ON u.id = b.manager_id
    LEFT JOIN (
      SELECT branch_id, SUM(balance) AS total_credit, COUNT(*) AS active_loans
      FROM loan_accounts
      WHERE status = 'Active'
      GROUP BY branch_id
    ) AS loan_summary ON loan_summary.branch_id = b.id
    LEFT JOIN (
      SELECT branch_id, SUM(amount) AS total_deposits, COUNT(*) AS active_savings_accounts
      FROM savings_accounts
      WHERE status = 'Active'
      GROUP BY branch_id
    ) AS savings_summary ON savings_summary.branch_id = b.id
    LEFT JOIN (
      SELECT branch_id, COUNT(*) AS client_count
      FROM clients
      GROUP BY branch_id
    ) AS client_summary ON client_summary.branch_id = b.id
    ORDER BY b.created_at DESC
  `, [], (err, branches) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(branches);
  });
});

// Get branch details by ID
router.get('/:id', authenticateToken, authorizeRoles('admin', 'ceo'), async (req, res) => {
  const { id } = req.params;

  try {
    // Get branch details
    const branch = await getBranchById(id);

    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    // Get branch loan accounts
    const loans = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM loan_accounts WHERE branch_id = ?', [id], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Get branch savings accounts
    const savings = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM savings_accounts WHERE branch_id = ?', [id], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Get branch clients
    const clients = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM clients WHERE branch_id = ?', [id], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Calculate statistics
    const totalLoanPortfolio = loans.reduce((sum, loan) => sum + (loan.balance || 0), 0);
    const totalSavings = savings.reduce((sum, saving) => sum + (saving.amount || 0), 0);
    const activeLoans = loans.filter((loan) => loan.status === 'Active');
    const outstandingCredit = activeLoans.reduce((sum, loan) => sum + (loan.balance || 0), 0);
    const branchCreditLimit = Number(branch.credit_limit || 0);

    const branchDetails = {
      ...branch,
      statistics: {
        total_loans: loans.length,
        total_savings: savings.length,
        total_clients: clients.length,
        total_loan_portfolio: totalLoanPortfolio,
        total_savings_amount: totalSavings,
        branch_total_deposits: totalSavings,
        branch_total_credit: outstandingCredit,
        available_credit_capacity: Math.max(branchCreditLimit - outstandingCredit, 0)
      },
      loans,
      savings,
      clients
    };

    res.json(branchDetails);
  } catch (error) {
    console.error('Branch details error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new branch (admin only)
router.post('/', authenticateToken, authorizeRoles('admin'), (req, res) => {
  const { name, location, phone, email, manager_id } = req.body;

  if (!name || !location) {
    return res.status(400).json({ error: 'Name and location are required' });
  }

  db.run(
    'INSERT INTO branches (name, location, phone, email, manager_id) VALUES (?, ?, ?, ?, ?)',
    [name, location, phone, email, manager_id],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      console.log(`[AUDIT] Branch created: ${name} by admin at ${new Date().toISOString()}`);
      
      db.get('SELECT * FROM branches WHERE id = ?', [this.lastID], (err, newBranch) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.status(201).json(newBranch);
      });
    }
  );
});

// Update branch (admin only)
router.put('/:id', authenticateToken, authorizeRoles('admin'), (req, res) => {
  const { id } = req.params;
  const { name, location, phone, email, manager_id, status } = req.body;

  db.run(
    'UPDATE branches SET name = ?, location = ?, phone = ?, email = ?, manager_id = ?, status = ? WHERE id = ?',
    [name, location, phone, email, manager_id, status, id],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      console.log(`[AUDIT] Branch ${id} updated by admin at ${new Date().toISOString()}`);
      
      db.get('SELECT * FROM branches WHERE id = ?', [id], (err, branch) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json(branch);
      });
    }
  );
});

// Set branch credit limit (CEO/Admin)
router.patch('/:id/credit-limit', authenticateToken, authorizeRoles('admin', 'ceo'), async (req, res) => {
  const { id } = req.params;
  const { credit_limit } = req.body;

  const normalizedLimit = Number(credit_limit);
  if (!Number.isFinite(normalizedLimit) || normalizedLimit < 0) {
    return res.status(400).json({ error: 'A valid non-negative credit limit is required' });
  }

  try {
    const branch = await getBranchById(id);
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE branches SET credit_limit = ? WHERE id = ?',
        [normalizedLimit, id],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO audit_trail (action, entity_type, entity_id, user_id, user_role, details, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          'BRANCH_CREDIT_LIMIT_UPDATED',
          'branch',
          String(id),
          req.user.id,
          req.user.role,
          JSON.stringify({
            branch_name: branch.name,
            previous_credit_limit: Number(branch.credit_limit || 0),
            new_credit_limit: normalizedLimit
          }),
          new Date().toISOString()
        ],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    const updatedBranch = await getBranchById(id);
    res.json({
      message: 'Branch credit limit updated successfully',
      branch: updatedBranch
    });
  } catch (error) {
    console.error('Branch credit limit update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete branch (admin only)
router.delete('/:id', authenticateToken, authorizeRoles('admin'), (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM branches WHERE id = ?', [id], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    console.log(`[AUDIT] Branch ${id} deleted by admin at ${new Date().toISOString()}`);
    res.json({ message: 'Branch deleted successfully' });
  });
});

module.exports = router;
