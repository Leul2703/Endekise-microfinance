const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { db } = require('../config/database');

// Get inclusive programs statistics
router.get('/statistics', authenticateToken, authorizeRoles('admin', 'branch_manager'), (req, res) => {
  db.all(`
    SELECT 
      COUNT(*) as total_clients,
      SUM(CASE WHEN gender = 'Female' THEN 1 ELSE 0 END) as female_clients,
      SUM(CASE WHEN disability_status != 'None' THEN 1 ELSE 0 END) as disabled_clients,
      SUM(CASE WHEN marginalized_group != 'None' THEN 1 ELSE 0 END) as marginalized_clients,
      SUM(CASE WHEN special_program_eligible = 1 THEN 1 ELSE 0 END) as special_program_eligible
    FROM clients
  `, [], (err, stats) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(stats[0]);
  });
});

// Get clients by marginalized group
router.get('/clients/:group', authenticateToken, authorizeRoles('admin', 'branch_manager'), (req, res) => {
  const { group } = req.params;
  
  db.all(
    'SELECT * FROM clients WHERE marginalized_group = ? AND status = ?',
    [group, 'Active'],
    (err, clients) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(clients);
    }
  );
});

// Get clients with disabilities
router.get('/disabilities', authenticateToken, authorizeRoles('admin', 'branch_manager'), (req, res) => {
  db.all(
    'SELECT * FROM clients WHERE disability_status != ? AND status = ?',
    ['None', 'Active'],
    (err, clients) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(clients);
    }
  );
});

// Update client accessibility needs
router.patch('/clients/:clientId/accessibility', authenticateToken, (req, res) => {
  const { clientId } = req.params;
  const { accessibility_needs, preferred_language } = req.body;

  db.run(
    'UPDATE clients SET accessibility_needs = ?, preferred_language = ? WHERE id = ?',
    [accessibility_needs, preferred_language, clientId],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ message: 'Accessibility needs updated successfully' });
    }
  );
});

// Mark client as special program eligible
router.patch('/clients/:clientId/special-program', authenticateToken, authorizeRoles('admin', 'branch_manager'), (req, res) => {
  const { clientId } = req.params;
  const { eligible } = req.body;

  db.run(
    'UPDATE clients SET special_program_eligible = ? WHERE id = ?',
    [eligible ? 1 : 0, clientId],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ message: 'Special program eligibility updated successfully' });
    }
  );
});

// Get special program loan products
router.get('/loan-products', authenticateToken, (req, res) => {
  const specialProducts = [
    {
      id: 'WOMEN_BUSINESS',
      name: 'Women Business Loan',
      description: 'Special loan product for women entrepreneurs',
      interest_rate: 12,
      max_amount: 200000,
      min_amount: 5000,
      term_options: [6, 12, 18, 24],
      target_group: 'Female',
      requirements: ['Business registration', '6 months operation', 'Women-owned business']
    },
    {
      id: 'DISABILITY_SUPPORT',
      name: 'Disability Support Loan',
      description: 'Low-interest loan for persons with disabilities',
      interest_rate: 8,
      max_amount: 100000,
      min_amount: 2000,
      term_options: [12, 24, 36],
      target_group: 'Disabled',
      requirements: ['Disability certificate', 'Income source', 'Guarantor']
    },
    {
      id: 'MARGINALIZED_GROUP',
      name: 'Marginalized Group Loan',
      description: 'Loan for marginalized community members',
      interest_rate: 10,
      max_amount: 150000,
      min_amount: 3000,
      term_options: [12, 18, 24],
      target_group: 'Marginalized',
      requirements: ['Community recommendation', 'Group formation', 'Training completion']
    }
  ];

  res.json(specialProducts);
});

// Get special program savings products
router.get('/savings-products', authenticateToken, (req, res) => {
  const specialProducts = [
    {
      id: 'WOMEN_SAVINGS',
      name: 'Women Savings Account',
      description: 'Higher interest rate for women savers',
      interest_rate: 10,
      min_balance: 500,
      target_group: 'Female',
      benefits: ['Free ATM card', 'Higher interest', 'Financial literacy training']
    },
    {
      id: 'DISABILITY_SAVINGS',
      name: 'Disability Savings Account',
      description: 'Special savings with no minimum balance',
      interest_rate: 9,
      min_balance: 0,
      target_group: 'Disabled',
      benefits: ['No minimum balance', 'Free transactions', 'Priority service']
    },
    {
      id: 'GROUP_SAVINGS',
      name: 'Group Savings Account',
      description: 'Savings account for marginalized groups',
      interest_rate: 9.5,
      min_balance: 1000,
      target_group: 'Marginalized',
      benefits: ['Group management', 'Joint withdrawals', 'Training programs']
    }
  ];

  res.json(specialProducts);
});

module.exports = router;
