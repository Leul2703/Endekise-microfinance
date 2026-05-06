#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Locate database file (same location logic as app)
const dbPath = path.join(__dirname, '..', 'backend', process.env.DB_PATH || 'database.sqlite');

if (!fs.existsSync(dbPath)) {
  console.error('Database file not found at', dbPath);
  process.exit(1);
}

const backupPath = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g,'-')}`;
fs.copyFileSync(dbPath, backupPath);
console.log('Backup created at', backupPath);

const tables = [
  'clients',
  'client_registration_requests',
  'savings_accounts',
  'loan_accounts',
  'transactions',
  'payment_schedule',
  'notifications',
  'sms_notifications',
  'email_log',
  'audit_trail',
  'approval_requests'
];

const db = new sqlite3.Database(dbPath);

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function(err) {
    if (err) reject(err); else resolve({ changes: this.changes, lastID: this.lastID });
  }));
}

function getCount(table) {
  return new Promise((resolve) => {
    db.get(`SELECT COUNT(*) as c FROM ${table}`, [], (err, row) => {
      if (err) return resolve(null);
      return resolve(row && row.c ? row.c : 0);
    });
  });
}

(async () => {
  try {
    console.log('Starting clear operation at', new Date().toISOString());
    const summary = [];

    await runSql('BEGIN TRANSACTION');

    for (const table of tables) {
      const before = await getCount(table);
      if (before === null) {
        console.log(`Table ${table} does not exist or cannot be queried, skipping.`);
        summary.push({ table, before: null, after: null, skipped: true });
        continue;
      }
      const res = await runSql(`DELETE FROM ${table}`);
      const after = await getCount(table);
      console.log(`Cleared ${table}: ${before} -> ${after} (deleted ${res.changes || 0})`);
      summary.push({ table, before, after, deleted: res.changes || 0 });
    }

    await runSql('COMMIT');
    console.log('Clear operation completed successfully. Summary:');
    console.table(summary.map(s => ({ table: s.table, before: s.before, after: s.after, deleted: s.deleted })));
  } catch (err) {
    console.error('Error during clear operation:', err);
    try { await runSql('ROLLBACK'); } catch (e) {}
    console.error('Rolled back changes. Database backup preserved at', backupPath);
  } finally {
    db.close();
  }
})();
