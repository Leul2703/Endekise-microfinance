const { db } = require('../config/database');

/**
 * Database transaction wrapper with automatic rollback on failure
 * Ensures atomic operations for financial transactions
 * @param {Function} callback - Function to execute within transaction
 * @returns {Promise} Result of the callback or error
 */
const withTransaction = async (callback) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Begin transaction
      db.run('BEGIN TRANSACTION', (beginErr) => {
        if (beginErr) {
          console.error('[TRANSACTION] Failed to begin transaction:', beginErr);
          return reject(beginErr);
        }

        // Execute callback
        Promise.resolve(callback())
          .then((result) => {
            // Commit on success
            db.run('COMMIT', (commitErr) => {
              if (commitErr) {
                console.error('[TRANSACTION] Failed to commit:', commitErr);
                return reject(commitErr);
              }
              console.log('[TRANSACTION] Transaction committed successfully');
              resolve(result);
            });
          })
          .catch((error) => {
            // Rollback on error
            db.run('ROLLBACK', (rollbackErr) => {
              if (rollbackErr) {
                console.error('[TRANSACTION] Failed to rollback:', rollbackErr);
                return reject(rollbackErr);
              }
              console.log('[TRANSACTION] Transaction rolled back due to error:', error.message);
              reject(error);
            });
          });
      });
    });
  });
};

/**
 * Execute multiple SQL statements in a single transaction
 * @param {Array} statements - Array of SQL statements with parameters
 * @returns {Promise} Array of results
 */
const executeTransaction = async (statements) => {
  return withTransaction(async () => {
    const results = [];
    
    for (const stmt of statements) {
      const result = await new Promise((resolve, reject) => {
        db.run(stmt.sql, stmt.params, function(err) {
          if (err) {
            return reject(err);
          }
          resolve({ id: this.lastID, changes: this.changes });
        });
      });
      results.push(result);
    }
    
    return results;
  });
};

module.exports = { withTransaction, executeTransaction };
