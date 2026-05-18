const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Created uploads directory');
}

// Create database connection
const dbPath = path.join(__dirname, '..', process.env.DB_PATH || 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      email TEXT,
      status TEXT DEFAULT 'Active',
      login_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      two_factor_secret TEXT,
      two_factor_enabled INTEGER DEFAULT 0,
      reset_token TEXT,
      reset_token_expiry TEXT,
      branch_id INTEGER,
      phone TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      id_number TEXT,
      income_source TEXT,
      kyc_status TEXT DEFAULT 'Pending',
      kyc_verified_at TEXT,
      branch_id INTEGER,
      gender TEXT,
      disability_status TEXT DEFAULT 'None',
      disability_type TEXT,
      marginalized_group TEXT DEFAULT 'None',
      special_program_eligible INTEGER DEFAULT 0,
      preferred_language TEXT DEFAULT 'Amharic',
      accessibility_needs TEXT,
      photo_path TEXT,
      group_id INTEGER,
      status TEXT DEFAULT 'Active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      client_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL,
      interest_rate REAL,
      status TEXT DEFAULT 'Active',
      product_type TEXT DEFAULT 'Standard',
      special_program INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS loan_accounts (
      id TEXT PRIMARY KEY,
      client_id INTEGER NOT NULL,
      savings_account_id TEXT NOT NULL,
      amount REAL NOT NULL,
      balance REAL NOT NULL,
      type TEXT NOT NULL,
      branch_id INTEGER,
      term TEXT NOT NULL,
      interest_rate REAL,
      payment_frequency TEXT DEFAULT 'Monthly',
      status TEXT DEFAULT 'Pending',
      disbursement_date TEXT,
      product_type TEXT DEFAULT 'Standard',
      special_program INTEGER DEFAULT 0,
      collateral_type TEXT,
      purpose TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS loan_payments (
      id TEXT PRIMARY KEY,
      loan_id TEXT NOT NULL,
      amount REAL NOT NULL,
      principal_amount REAL NOT NULL,
      interest_amount REAL NOT NULL,
      balance_before REAL NOT NULL,
      balance_after REAL NOT NULL,
      payment_date TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (loan_id) REFERENCES loan_accounts(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS savings_accounts (
      id TEXT PRIMARY KEY,
      client_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      branch_id INTEGER,
      interest_rate REAL,
      maturity_date TEXT,
      deposit_limit REAL DEFAULT 1000000,
      compliance_flag TEXT DEFAULT 'None',
      status TEXT DEFAULT 'Pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      client_id INTEGER NOT NULL,
      loan_id TEXT,
      approval_request_id TEXT,
      related_entity_type TEXT,
      related_entity_id TEXT,
      type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT DEFAULT 'Pending',
      version INTEGER DEFAULT 1,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS document_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_by INTEGER,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      change_reason TEXT,
      FOREIGN KEY (document_id) REFERENCES documents(id),
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      client TEXT NOT NULL,
      account TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      submitted_date TEXT NOT NULL,
      status TEXT DEFAULT 'Pending',
      kyc_complete INTEGER DEFAULT 1,
      rejection_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS system_settings (
      section TEXT NOT NULL,
      setting_key TEXT NOT NULL,
      setting_value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (section, setting_key)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS audit_trail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      user_id INTEGER,
      user_role TEXT NOT NULL,
      details TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      ip_address TEXT,
      user_agent TEXT,
      previous_hash TEXT,
      event_hash TEXT,
      status TEXT DEFAULT 'Success',
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      amount REAL,
      requested_by INTEGER NOT NULL,
      status TEXT DEFAULT 'Pending',
      approval_level TEXT DEFAULT 'branch_manager',
      justification TEXT,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      reviewed_by INTEGER,
      FOREIGN KEY (requested_by) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS account_unlock_requests (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      requested_user_id INTEGER NOT NULL,
      requested_user_email TEXT,
      requested_user_name TEXT,
      contact TEXT,
      status TEXT DEFAULT 'Pending',
      reason TEXT,
      lock_until TEXT,
      requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      reviewed_by INTEGER,
      rejection_reason TEXT,
      FOREIGN KEY (requested_user_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS payment_schedule (
      id TEXT PRIMARY KEY,
      loan_id TEXT NOT NULL,
      due_date TEXT NOT NULL,
      principal_amount REAL NOT NULL,
      interest_amount REAL NOT NULL,
      penalty_amount REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      balance_remaining REAL NOT NULL,
      principal_paid REAL DEFAULT 0,
      interest_paid REAL DEFAULT 0,
      penalty_paid REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'Pending',
      paid_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (loan_id) REFERENCES loan_accounts(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      account_type TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      amount REAL NOT NULL,
      balance_before REAL NOT NULL,
      balance_after REAL NOT NULL,
      description TEXT,
      transaction_reference TEXT,
      idempotency_key TEXT,
      approval_request_id TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS aml_alerts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      account_type TEXT NOT NULL,
      client_id INTEGER,
      transaction_id TEXT,
      alert_type TEXT NOT NULL,
      severity TEXT DEFAULT 'medium',
      amount REAL,
      details TEXT,
      status TEXT DEFAULT 'Open',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      manager_id INTEGER,
      phone TEXT,
      email TEXT,
      status TEXT DEFAULT 'Active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (manager_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'Sent',
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      error_message TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sync_status (
      user_id INTEGER PRIMARY KEY,
      last_sync TEXT,
      pending_operations INTEGER DEFAULT 0,
      sync_status TEXT DEFAULT 'Idle',
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      operation_type TEXT NOT NULL,
      operation_data TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      permission TEXT NOT NULL,
      granted_by INTEGER NOT NULL,
      granted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (granted_by) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS statements (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      client_id INTEGER NOT NULL,
      account_id TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      statement_data TEXT,
      status TEXT DEFAULT 'Pending',
      requested_by INTEGER,
      extended_range_flag TEXT DEFAULT 'Normal',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (requested_by) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS update_requests (
      id TEXT PRIMARY KEY,
      client_id INTEGER NOT NULL,
      request_type TEXT NOT NULL,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT NOT NULL,
      explanation TEXT,
      document_ids TEXT,
      status TEXT DEFAULT 'Pending Staff Review',
      tracking_id TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      leader_id INTEGER,
      branch_id INTEGER,
      status TEXT DEFAULT 'Active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (leader_id) REFERENCES clients(id),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS loan_guarantors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id TEXT NOT NULL,
      guarantor_id INTEGER NOT NULL,
      guarantee_amount REAL,
      status TEXT DEFAULT 'Active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (loan_id) REFERENCES loan_accounts(id),
      FOREIGN KEY (guarantor_id) REFERENCES clients(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS mobile_money_transactions (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      reference_number TEXT,
      amount REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      status TEXT DEFAULT 'Pending',
      processed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sms_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      phone_number TEXT NOT NULL,
      message_type TEXT NOT NULL,
      message TEXT NOT NULL,
      event_type TEXT NOT NULL,
      related_account_id TEXT,
      related_transaction_id TEXT,
      status TEXT DEFAULT 'Pending',
      sent_at TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      read_status INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS customer_messages (
      id TEXT PRIMARY KEY,
      submitted_by_user_id INTEGER,
      client_id INTEGER,
      name TEXT,
      email TEXT,
      phone TEXT,
      category TEXT DEFAULT 'complaint',
      subject TEXT,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'Pending',
      assigned_to INTEGER,
      resolved_at TEXT,
      resolution_notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submitted_by_user_id) REFERENCES users(id),
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    )`);

    console.log('Database tables initialized');

    db.run(`ALTER TABLE users ADD COLUMN email TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding email column:', err.message);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN reset_token TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding reset_token column:', err.message);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN reset_token_expiry TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding reset_token_expiry column:', err.message);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN two_factor_secret TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding two_factor_secret column:', err.message);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding two_factor_enabled column:', err.message);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN branch_id INTEGER`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding users.branch_id column:', err.message);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN phone TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding users.phone column:', err.message);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN session_id TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding users.session_id column:', err.message);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN last_login TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding users.last_login column:', err.message);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN last_seen TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding users.last_seen column:', err.message);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN company_id TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding users.company_id column:', err.message);
      }
    });

    db.run(`ALTER TABLE branches ADD COLUMN credit_limit REAL DEFAULT 0`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding credit_limit column:', err.message);
      }
    });

    db.run(`ALTER TABLE clients ADD COLUMN branch_id INTEGER`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding clients.branch_id column:', err.message);
      }
    });

    db.run(`ALTER TABLE clients ADD COLUMN id_number TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding clients.id_number column:', err.message);
      }
    });

    db.run(`ALTER TABLE clients ADD COLUMN income_source TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding clients.income_source column:', err.message);
      }
    });

    db.run(`ALTER TABLE clients ADD COLUMN kyc_status TEXT DEFAULT 'Pending'`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding clients.kyc_status column:', err.message);
      }
    });

    db.run(`ALTER TABLE clients ADD COLUMN kyc_verified_at TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding clients.kyc_verified_at column:', err.message);
      }
    });

    db.run(`ALTER TABLE loan_accounts ADD COLUMN branch_id INTEGER`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding loan_accounts.branch_id column:', err.message);
      }
    });

    db.run(`ALTER TABLE loan_accounts ADD COLUMN savings_account_id TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding loan_accounts.savings_account_id column:', err.message);
      }
    });

    db.run(`ALTER TABLE loan_accounts ADD COLUMN disbursement_date TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding loan_accounts.disbursement_date column:', err.message);
      }
    });

    db.run(`ALTER TABLE loan_accounts ADD COLUMN purpose TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding loan_accounts.purpose column:', err.message);
      }
    });

    db.run(`ALTER TABLE savings_accounts ADD COLUMN branch_id INTEGER`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding savings_accounts.branch_id column:', err.message);
      }
    });

    db.run(`ALTER TABLE audit_trail ADD COLUMN previous_hash TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding audit_trail.previous_hash column:', err.message);
      }
    });

    db.run(`ALTER TABLE audit_trail ADD COLUMN event_hash TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding audit_trail.event_hash column:', err.message);
      }
    });

    db.run(`ALTER TABLE transactions ADD COLUMN transaction_reference TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding transactions.transaction_reference column:', err.message);
      }
    });

    db.run(`ALTER TABLE transactions ADD COLUMN idempotency_key TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding transactions.idempotency_key column:', err.message);
      }
    });

    db.run(`ALTER TABLE transactions ADD COLUMN approval_request_id TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding transactions.approval_request_id column:', err.message);
      }
    });

    // Link documents to approval / domain entities (receipts, collateral, etc.)
    db.run(`ALTER TABLE documents ADD COLUMN approval_request_id TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding documents.approval_request_id column:', err.message);
      }
    });
    db.run(`ALTER TABLE documents ADD COLUMN related_entity_type TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding documents.related_entity_type column:', err.message);
      }
    });
    db.run(`ALTER TABLE documents ADD COLUMN related_entity_id TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding documents.related_entity_id column:', err.message);
      }
    });

    db.run(`ALTER TABLE payment_schedule ADD COLUMN principal_paid REAL DEFAULT 0`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding payment_schedule.principal_paid column:', err.message);
      }
    });

    db.run(`ALTER TABLE payment_schedule ADD COLUMN interest_paid REAL DEFAULT 0`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding payment_schedule.interest_paid column:', err.message);
      }
    });
    db.run(`ALTER TABLE payment_schedule ADD COLUMN penalty_amount REAL DEFAULT 0`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding payment_schedule.penalty_amount column:', err.message);
      }
    });
    db.run(`ALTER TABLE payment_schedule ADD COLUMN penalty_paid REAL DEFAULT 0`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding payment_schedule.penalty_paid column:', err.message);
      }
    });

    db.run(`ALTER TABLE payment_schedule ADD COLUMN paid_amount REAL DEFAULT 0`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding payment_schedule.paid_amount column:', err.message);
      }
    });

    db.run(`ALTER TABLE payment_schedule ADD COLUMN paid_date TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding payment_schedule.paid_date column:', err.message);
      }
    });

    db.run(`ALTER TABLE clients ADD COLUMN photo_path TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding clients.photo_path column:', err.message);
      }
    });

    db.run(`ALTER TABLE clients ADD COLUMN group_id INTEGER`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding clients.group_id column:', err.message);
      }
    });

    db.run(`ALTER TABLE clients ADD COLUMN notify_email INTEGER DEFAULT 1`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding clients.notify_email column:', err.message);
      }
    });
    db.run(`ALTER TABLE clients ADD COLUMN notify_sms INTEGER DEFAULT 1`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding clients.notify_sms column:', err.message);
      }
    });
    db.run(`ALTER TABLE clients ADD COLUMN notify_payment_reminders INTEGER DEFAULT 1`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding clients.notify_payment_reminders column:', err.message);
      }
    });

    db.run(
      `UPDATE loan_accounts
       SET savings_account_id = (
         SELECT s.id
         FROM savings_accounts s
         WHERE s.client_id = loan_accounts.client_id
         ORDER BY s.created_at ASC
         LIMIT 1
       )
       WHERE savings_account_id IS NULL`,
      (err) => {
        if (err) {
          console.error('Error backfilling loan_accounts.savings_account_id:', err.message);
        }
      }
    );

    db.run('CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone)');
    db.run('CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)');
    db.run('CREATE INDEX IF NOT EXISTS idx_loan_accounts_client ON loan_accounts(client_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_loan_accounts_savings ON loan_accounts(savings_account_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_loan_accounts_status ON loan_accounts(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_savings_accounts_client ON savings_accounts(client_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_savings_accounts_status ON savings_accounts(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type)');
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency_key ON transactions(idempotency_key)');
    db.run('CREATE INDEX IF NOT EXISTS idx_payment_schedule_loan ON payment_schedule(loan_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_payment_schedule_date ON payment_schedule(due_date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_payment_schedule_status ON payment_schedule(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_trail_user ON audit_trail(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_trail_timestamp ON audit_trail(timestamp)');
    db.run('CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_approval_requests_type ON approval_requests(type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_account_unlock_requests_status ON account_unlock_requests(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_account_unlock_requests_username ON account_unlock_requests(username)');
    db.run('CREATE INDEX IF NOT EXISTS idx_account_unlock_requests_requested_at ON account_unlock_requests(requested_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_documents_loan ON documents(loan_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_update_requests_client ON update_requests(client_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_update_requests_status ON update_requests(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_update_requests_tracking ON update_requests(tracking_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    db.run('CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)');
    db.run('CREATE INDEX IF NOT EXISTS idx_aml_alerts_account ON aml_alerts(account_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_aml_alerts_status ON aml_alerts(status)');
    console.log('Database indexes created for performance optimization');

    db.get('SELECT COUNT(*) as count FROM users', [], async (err, row) => {
      if (err) {
        console.error('Error checking users table:', err);
        return;
      }

      if (row.count === 0) {
        const shouldSeed = String(process.env.SEED_DEFAULT_USERS || 'false').toLowerCase() === 'true';
        if (!shouldSeed) {
          console.log('Users table empty. Skipping default user seed because SEED_DEFAULT_USERS is not enabled.');
          return;
        }
        console.log('Seeding initial users from environment...');
        const bcrypt = require('bcryptjs');

        const users = [
          { name: process.env.SEED_ADMIN_NAME || 'System Administrator', username: process.env.SEED_ADMIN_USERNAME || 'admin', password: process.env.SEED_ADMIN_PASSWORD, role: 'admin' },
          { name: process.env.SEED_MANAGER_NAME || 'Branch Manager', username: process.env.SEED_MANAGER_USERNAME || 'manager', password: process.env.SEED_MANAGER_PASSWORD, role: 'branch_manager' },
          { name: process.env.SEED_LOAN_STAFF_NAME || 'Loan Staff', username: process.env.SEED_LOAN_STAFF_USERNAME || 'loanstaff', password: process.env.SEED_LOAN_STAFF_PASSWORD, role: 'loan_staff' },
          { name: process.env.SEED_SAVING_STAFF_NAME || 'Saving Staff', username: process.env.SEED_SAVING_STAFF_USERNAME || 'savingstaff', password: process.env.SEED_SAVING_STAFF_PASSWORD, role: 'saving_staff' },
          { name: process.env.SEED_CEO_NAME || 'CEO', username: process.env.SEED_CEO_USERNAME || 'ceo', password: process.env.SEED_CEO_PASSWORD, role: 'ceo' },
          { name: process.env.SEED_CLIENT_NAME || 'Client', username: process.env.SEED_CLIENT_USERNAME || 'client', password: process.env.SEED_CLIENT_PASSWORD, role: 'client' },
        ];

        const usersWithPasswords = users.filter((user) => user.password);
        if (usersWithPasswords.length === 0) {
          console.warn('SEED_DEFAULT_USERS is enabled but no seed passwords were supplied in environment. Skipping seed.');
          return;
        }

        for (const user of usersWithPasswords) {
          const hashedPassword = await bcrypt.hash(user.password, 10);
          db.run(
            'INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)',
            [user.name, user.username, hashedPassword, user.role],
            (seedErr) => {
              if (seedErr) console.error('Error seeding user:', seedErr);
            }
          );
        }

        console.log('Initial users seeded successfully');
      }
    });

    db.get('SELECT COUNT(*) as count FROM branches', [], (err, row) => {
      if (err) {
        console.error('Error checking branches table:', err);
        return;
      }

      if (row.count === 0) {
        console.log('Seeding initial branches...');
        const branches = [
          { name: 'Addis Ababa (HQ)', location: 'Addis Ababa', phone: '+251-11-1234567', email: 'hq@edekise.com' },
          { name: 'Hawassa', location: 'Hawassa', phone: '+251-46-2345678', email: 'hawassa@edekise.com' },
          { name: 'Dire Dawa', location: 'Dire Dawa', phone: '+251-25-3456789', email: 'diredawa@edekise.com' },
          { name: 'Bahir Dar', location: 'Bahir Dar', phone: '+251-58-4567890', email: 'bahirdar@edekise.com' },
        ];

        branches.forEach((branch) => {
          db.run(
            'INSERT INTO branches (name, location, phone, email) VALUES (?, ?, ?, ?)',
            [branch.name, branch.location, branch.phone, branch.email],
            (seedErr) => {
              if (seedErr) console.error('Error seeding branch:', seedErr);
            }
          );
        });

        console.log('Initial branches seeded successfully');
      }
    });

    const retentionInterval = setInterval(enforceDataRetentionPolicy, 24 * 60 * 60 * 1000);
    console.log('Data retention policy scheduler initialized');

    process.on('SIGINT', () => {
      clearInterval(retentionInterval);
      console.log('Data retention scheduler stopped');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      clearInterval(retentionInterval);
      console.log('Data retention scheduler stopped');
      process.exit(0);
    });
  });
}

function enforceDataRetentionPolicy() {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const cutoffDate = oneYearAgo.toISOString();

  console.log(`[RETENTION] Enforcing data retention policy. Deleting records older than ${cutoffDate}`);

  db.run(
    'DELETE FROM audit_trail WHERE timestamp < ?',
    [cutoffDate],
    function(err) {
      if (err) {
        console.error('[RETENTION] Error deleting old audit logs:', err);
      } else {
        console.log(`[RETENTION] Deleted ${this.changes} old audit log entries`);
      }
    }
  );

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const emailCutoffDate = sixMonthsAgo.toISOString();

  db.run(
    'DELETE FROM email_log WHERE sent_at < ?',
    [emailCutoffDate],
    function(err) {
      if (err) {
        console.error('[RETENTION] Error deleting old email logs:', err);
      } else {
        console.log(`[RETENTION] Deleted ${this.changes} old email log entries`);
      }
    }
  );
}

const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const initializationPromise = Promise.resolve();

module.exports = { db, query, run, initializationPromise };
