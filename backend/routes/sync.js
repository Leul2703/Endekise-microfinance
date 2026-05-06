const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { db } = require('../config/database');

// Get sync status
router.get('/status', authenticateToken, (req, res) => {
  const userId = req.user.id;
  
  db.get(
    'SELECT * FROM sync_status WHERE user_id = ?',
    [userId],
    (err, status) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!status) {
        return res.json({
          user_id: userId,
          last_sync: null,
          pending_operations: 0,
          sync_status: 'Idle'
        });
      }
      
      res.json(status);
    }
  );
});

// Sync pending operations from client
router.post('/push', authenticateToken, async (req, res) => {
  const { operations } = req.body;
  const userId = req.user.id;
  
  if (!operations || !Array.isArray(operations)) {
    return res.status(400).json({ error: 'Operations array required' });
  }

  try {
    const results = [];
    
    for (const op of operations) {
      const result = await processOperation(op, userId);
      results.push({
        id: op.id,
        success: result.success,
        error: result.error
      });
    }
    
    // Update sync status
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO sync_status (user_id, last_sync, pending_operations, sync_status)
         VALUES (?, ?, ?, ?)`,
        [userId, new Date().toISOString(), 0, 'Synced'],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    res.json({
      message: 'Sync completed',
      results,
      synced_count: results.filter(r => r.success).length,
      failed_count: results.filter(r => !r.success).length
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Pull data for offline use
router.get('/pull', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const { last_sync } = req.query;
  
  // Get data modified since last sync
  const query = last_sync 
    ? 'SELECT * FROM clients WHERE updated_at > ? OR created_at > ?'
    : 'SELECT * FROM clients';
  
  const params = last_sync ? [last_sync, last_sync] : [];
  
  db.all(query, params, (err, clients) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Get active savings accounts
    db.all('SELECT * FROM savings_accounts', [], (err, accounts) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Get loans
      db.all('SELECT * FROM loan_accounts', [], (err, loans) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        
        // Update sync status
        db.run(
          `INSERT OR REPLACE INTO sync_status (user_id, last_sync, pending_operations, sync_status)
           VALUES (?, ?, ?, ?)`,
          [userId, new Date().toISOString(), 0, 'Synced'],
          (err) => {
            if (err) console.error('Sync status update error:', err);
          }
        );
        
        res.json({
          timestamp: new Date().toISOString(),
          data: {
            clients,
            accounts,
            loans
          }
        });
      });
    });
  });
});

// Process a single operation
async function processOperation(op, userId) {
  try {
    switch (op.type) {
      case 'client_create':
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO clients (name, email, phone, address, gender, disability_status, marginalized_group) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [op.data.name, op.data.email, op.data.phone, op.data.address, op.data.gender, op.data.disability_status, op.data.marginalized_group],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        return { success: true };
        
      case 'account_create':
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO savings_accounts (id, client_id, type, amount, interest_rate, status)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              op.data.id,
              op.data.client_id,
              op.data.type || 'Regular Savings',
              op.data.balance ?? op.data.amount ?? 0,
              op.data.interest_rate ?? 5,
              op.data.status || 'Pending'
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        return { success: true };
        
      case 'transaction_create':
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [op.data.id, op.data.account_id, op.data.account_type, op.data.transaction_type, op.data.amount, op.data.balance_before, op.data.balance_after, op.data.description],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        return { success: true };
        
      default:
        return { success: false, error: 'Unknown operation type' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Queue operation for later sync
router.post('/queue', authenticateToken, (req, res) => {
  const { operation } = req.body;
  const userId = req.user.id;
  
  db.run(
    'INSERT INTO sync_queue (user_id, operation_type, operation_data, created_at) VALUES (?, ?, ?, ?)',
    [userId, operation.type, JSON.stringify(operation.data), new Date().toISOString()],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Update pending count
      db.run(
        'UPDATE sync_status SET pending_operations = pending_operations + 1 WHERE user_id = ?',
        [userId],
        (err) => {
          if (err) console.error('Sync status update error:', err);
        }
      );
      
      res.json({ message: 'Operation queued', queue_id: this.lastID });
    }
  );
});

// Get queued operations
router.get('/queue', authenticateToken, (req, res) => {
  const userId = req.user.id;
  
  db.all(
    'SELECT * FROM sync_queue WHERE user_id = ? ORDER BY created_at ASC',
    [userId],
    (err, operations) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json(operations);
    }
  );
});

module.exports = router;
