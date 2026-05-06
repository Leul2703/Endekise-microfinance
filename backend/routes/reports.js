const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { db } = require('../config/database');

// NBE Compliance Reports

// Loan Portfolio Quality Report
router.get('/nbe/loan-portfolio', authenticateToken, authorizeRoles('admin', 'ceo'), (req, res) => {
  const { start_date, end_date } = req.query;
  
  const dateFilter = start_date && end_date 
    ? 'AND la.created_at BETWEEN ? AND ?' 
    : '';
  const params = start_date && end_date ? [start_date, end_date] : [];

  db.all(`
    SELECT 
      COUNT(*) as total_loans,
      SUM(CASE WHEN la.status = 'Approved' THEN 1 ELSE 0 END) as active_loans,
      SUM(CASE WHEN la.status = 'Paid' THEN 1 ELSE 0 END) as paid_loans,
      SUM(CASE WHEN la.status = 'Pending' THEN 1 ELSE 0 END) as pending_loans,
      SUM(CASE WHEN la.status = 'Rejected' THEN 1 ELSE 0 END) as rejected_loans,
      SUM(la.amount) as total_loan_amount,
      SUM(la.balance) as total_outstanding_balance,
      AVG(la.interest_rate) as average_interest_rate
    FROM loan_accounts la
    WHERE 1=1 ${dateFilter}
  `, params, (err, portfolio) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Get non-performing loans (NPL) - loans overdue by 90+ days
    db.all(`
      SELECT 
        COUNT(*) as npl_count,
        SUM(la.balance) as npl_amount
      FROM loan_accounts la
      JOIN payment_schedule ps ON la.id = ps.loan_id
      WHERE ps.due_date < date('now', '-90 days') 
      AND ps.status = 'Pending'
      AND la.status = 'Approved'
    `, [], (err, npl) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      const totalOutstanding = portfolio[0].total_outstanding_balance || 0;
      const nplRatio = totalOutstanding > 0 ? (npl[0].npl_amount / totalOutstanding) * 100 : 0;
      
      res.json({
        report_type: 'NBE Loan Portfolio Quality',
        generated_at: new Date().toISOString(),
        period: { start_date, end_date },
        portfolio: portfolio[0],
        non_performing_loans: npl[0],
        npl_ratio: nplRatio.toFixed(2) + '%',
        nbe_compliance: nplRatio < 5 ? 'Compliant' : 'Non-Compliant (NPL ratio should be < 5%)'
      });
    });
  });
});

// Capital Adequacy Report
router.get('/nbe/capital-adequacy', authenticateToken, authorizeRoles('admin', 'ceo'), (req, res) => {
  db.all(`
    SELECT 
      SUM(s.amount) as total_savings,
      SUM(la.balance) as total_loans_outstanding
    FROM savings_accounts s
    LEFT JOIN loan_accounts la ON 1=1
    WHERE s.status = 'Active'
  `, [], (err, capital) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    const totalSavings = capital[0].total_savings || 0;
    const totalLoans = capital[0].total_loans_outstanding || 0;
    const capitalRatio = totalSavings > 0 ? (totalLoans / totalSavings) * 100 : 0;
    
    // NBE requires minimum 8% capital adequacy ratio
    const requiredCapital = totalLoans * 0.08;
    const availableCapital = totalSavings - totalLoans;
    const adequacyRatio = totalLoans > 0 ? (availableCapital / totalLoans) * 100 : 0;
    
    res.json({
      report_type: 'NBE Capital Adequacy',
      generated_at: new Date().toISOString(),
      total_savings: totalSavings,
      total_loans_outstanding: totalLoans,
      required_capital: requiredCapital,
      available_capital: availableCapital,
      capital_adequacy_ratio: adequacyRatio.toFixed(2) + '%',
      nbe_requirement: 'Minimum 8%',
      nbe_compliance: adequacyRatio >= 8 ? 'Compliant' : 'Non-Compliant'
    });
  });
});

// Liquidity Report
router.get('/nbe/liquidity', authenticateToken, authorizeRoles('admin', 'ceo'), (req, res) => {
  db.all(`
    SELECT 
      SUM(s.amount) as total_liquid_assets,
      SUM(la.balance) as total_short_term_liabilities
    FROM savings_accounts s
    LEFT JOIN loan_accounts la ON la.term = '12' AND la.status = 'Approved'
    WHERE s.status = 'Active'
  `, [], (err, liquidity) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    const liquidAssets = liquidity[0].total_liquid_assets || 0;
    const shortTermLiabilities = liquidity[0].total_short_term_liabilities || 0;
    const liquidityRatio = shortTermLiabilities > 0 ? (liquidAssets / shortTermLiabilities) * 100 : 100;
    
    res.json({
      report_type: 'NBE Liquidity',
      generated_at: new Date().toISOString(),
      liquid_assets: liquidAssets,
      short_term_liabilities: shortTermLiabilities,
      liquidity_ratio: liquidityRatio.toFixed(2) + '%',
      nbe_requirement: 'Minimum 20%',
      nbe_compliance: liquidityRatio >= 20 ? 'Compliant' : 'Non-Compliant'
    });
  });
});

// Monthly Regulatory Report
router.get('/nbe/monthly', authenticateToken, authorizeRoles('admin', 'ceo'), (req, res) => {
  const { year, month } = req.query;
  const startDate = `${year}-${month}-01`;
  const endDate = `${year}-${month}-31`;
  
  db.all(`
    SELECT 
      COUNT(DISTINCT c.id) as total_clients,
      COUNT(DISTINCT CASE WHEN c.gender = 'Female' THEN c.id END) as female_clients,
      COUNT(DISTINCT CASE WHEN c.disability_status != 'None' THEN c.id END) as disabled_clients,
      SUM(s.amount) as total_deposits,
      SUM(la.amount) as total_disbursed_loans,
      SUM(CASE WHEN la.status = 'Approved' THEN la.balance ELSE 0 END) as outstanding_loans,
      COUNT(CASE WHEN la.status = 'Approved' THEN 1 END) as active_loans
    FROM clients c
    LEFT JOIN savings_accounts s ON c.id = s.client_id AND s.status = 'Active'
    LEFT JOIN loan_accounts la ON c.id = la.client_id
    WHERE (s.created_at BETWEEN ? AND ? OR la.created_at BETWEEN ? AND ?)
  `, [startDate, endDate, startDate, endDate], (err, monthly) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json({
      report_type: 'NBE Monthly Regulatory Report',
      generated_at: new Date().toISOString(),
      reporting_period: { year, month },
      data: monthly[0]
    });
  });
});

// Non-Performing Loans Detailed Report
router.get('/nbe/npl-detailed', authenticateToken, authorizeRoles('admin', 'ceo'), (req, res) => {
  db.all(`
    SELECT 
      la.id,
      la.client_id,
      c.name as client_name,
      la.amount,
      la.balance,
      la.interest_rate,
      la.disbursement_date,
      la.status,
      MIN(ps.due_date) as first_payment_due,
      MAX(ps.due_date) as last_payment_due,
      COUNT(CASE WHEN ps.status = 'Pending' AND ps.due_date < date('now') THEN 1 END) as overdue_payments,
      SUM(CASE WHEN ps.status = 'Pending' AND ps.due_date < date('now') THEN ps.total_amount ELSE 0 END) as overdue_amount
    FROM loan_accounts la
    JOIN clients c ON la.client_id = c.id
    JOIN payment_schedule ps ON la.id = ps.loan_id
    WHERE la.status = 'Approved'
    GROUP BY la.id
    HAVING overdue_payments > 0
  `, [], (err, nplDetails) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json({
      report_type: 'NBE Non-Performing Loans Detailed',
      generated_at: new Date().toISOString(),
      total_npl_accounts: nplDetails.length,
      npl_accounts: nplDetails
    });
  });
});

// Sector-wise Loan Distribution
router.get('/nbe/sector-distribution', authenticateToken, authorizeRoles('admin', 'ceo'), (req, res) => {
  db.all(`
    SELECT 
      la.product_type,
      COUNT(*) as loan_count,
      SUM(la.amount) as total_amount,
      SUM(la.balance) as outstanding_balance,
      AVG(la.interest_rate) as average_interest_rate
    FROM loan_accounts la
    WHERE la.status = 'Approved'
    GROUP BY la.product_type
  `, [], (err, sectors) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    const totalAmount = sectors.reduce((sum, s) => sum + s.total_amount, 0);
    
    sectors.forEach(sector => {
      sector.percentage = totalAmount > 0 ? ((sector.total_amount / totalAmount) * 100).toFixed(2) + '%' : '0%';
    });
    
    res.json({
      report_type: 'NBE Sector-wise Loan Distribution',
      generated_at: new Date().toISOString(),
      total_loan_portfolio: totalAmount,
      sector_distribution: sectors
    });
  });
});

// Gender Disparity Report
router.get('/nbe/gender-disparity', authenticateToken, authorizeRoles('admin', 'ceo'), (req, res) => {
  db.all(`
    SELECT 
      c.gender,
      COUNT(DISTINCT c.id) as client_count,
      SUM(s.amount) as total_savings,
      SUM(la.amount) as total_loans_received,
      AVG(la.interest_rate) as average_loan_rate
    FROM clients c
    LEFT JOIN savings_accounts s ON c.id = s.client_id AND s.status = 'Active'
    LEFT JOIN loan_accounts la ON c.id = la.client_id AND la.status = 'Approved'
    GROUP BY c.gender
  `, [], (err, genderData) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json({
      report_type: 'NBE Gender Disparity Report',
      generated_at: new Date().toISOString(),
      gender_analysis: genderData
    });
  });
});

// Export all NBE reports
router.get('/nbe/export-all', authenticateToken, authorizeRoles('admin', 'ceo'), async (req, res) => {
  try {
    const reports = {};
    
    // Fetch all reports
    const reportsToFetch = [
      { name: 'loan_portfolio', path: '/nbe/loan-portfolio' },
      { name: 'capital_adequacy', path: '/nbe/capital-adequacy' },
      { name: 'liquidity', path: '/nbe/liquidity' },
      { name: 'npl_detailed', path: '/nbe/npl-detailed' },
      { name: 'sector_distribution', path: '/nbe/sector-distribution' },
      { name: 'gender_disparity', path: '/nbe/gender-disparity' }
    ];
    
    for (const report of reportsToFetch) {
      const reportData = await new Promise((resolve, reject) => {
        db.all(report.query, [], (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
      reports[report.name] = reportData;
    }
    
    res.json({
      report_type: 'NBE Complete Compliance Package',
      generated_at: new Date().toISOString(),
      reports
    });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;
