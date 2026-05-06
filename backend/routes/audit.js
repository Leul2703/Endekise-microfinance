const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { db } = require('../config/database');
const { formatAuditLogDetails } = require('../middleware/auditLogger');

// Get audit trail logs (admin/CEO only)
router.get('/', authenticateToken, authorizeRoles('admin', 'ceo'), (req, res) => {
  db.all('SELECT * FROM audit_trail ORDER BY timestamp DESC', [], (err, logs) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Format logs with human-readable descriptions
    const formattedLogs = logs.map(log => ({
      ...log,
      human_readable_description: formatAuditLogDetails(log.details)
    }));
    
    res.json(formattedLogs);
  });
});

// Get audit logs by user
router.get('/user/:userId', authenticateToken, (req, res) => {
  const { userId } = req.params;
  db.all('SELECT * FROM audit_trail WHERE user_id = ? ORDER BY timestamp DESC LIMIT 100', [userId], (err, logs) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Format logs with human-readable descriptions
    const formattedLogs = logs.map(log => ({
      ...log,
      human_readable_description: formatAuditLogDetails(log.details)
    }));
    
    res.json(formattedLogs);
  });
});

// Log balance inquiry
router.post('/balance-inquiry', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;

  db.run(
    `INSERT INTO audit_trail (action, user_id, user_role, details, timestamp) 
     VALUES (?, ?, ?, ?, ?)`,
    ['BALANCE_INQUIRY', userId, userRole, 'Client viewed account balances', new Date().toISOString()],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      console.log(`[AUDIT] Balance inquiry logged for user ${userId} at ${new Date().toISOString()}`);
      
      res.json({ message: 'Balance inquiry logged successfully' });
    }
  );
});

// Get email log entries
router.get('/email-log', authenticateToken, (req, res) => {
  db.all('SELECT * FROM email_log ORDER BY sent_at DESC LIMIT 50', [], (err, logs) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(logs);
  });
});

module.exports = router;
