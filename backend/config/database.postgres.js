const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Created uploads directory');
}

const txStorage = new AsyncLocalStorage();

const getPoolConfig = () => {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    host: process.env.PGHOST || process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
    database: process.env.PGDATABASE || process.env.DB_NAME || 'edekise_microfinance',
    user: process.env.PGUSER || process.env.DB_USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
};

const pool = new Pool(getPoolConfig());

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

const getStore = () => txStorage.getStore();

const normalizeSql = (sql) => {
  let index = 0;

  return sql
    .replace(/\?/g, () => `$${++index}`)
    .replace(/datetime\(["']now["']\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/date\(["']now["']\)/gi, 'CURRENT_DATE')
    .replace(/=\s*"([^"]+)"/g, "= '$1'")
    .replace(/\bIS NULL OR ([^)]+) > datetime\(["']now["']\)/gi, 'IS NULL OR $1 > CURRENT_TIMESTAMP');
};

const withCallback = (promise, callback, contextFactory = () => ({})) => {
  if (typeof callback !== 'function') {
    return promise;
  }

  promise
    .then((result) => callback.call(contextFactory(result), null, result))
    .catch((error) => callback.call(contextFactory(), error));

  return undefined;
};

const resolveExecutor = async (sql) => {
  const store = getStore();
  const trimmed = sql.trim().toUpperCase();

  if (trimmed === 'BEGIN TRANSACTION' || trimmed === 'BEGIN') {
    if (store?.client) {
      return { client: store.client, releaseAfterQuery: false, originalSql: 'BEGIN' };
    }

    const client = await pool.connect();
    if (store) {
      store.client = client;
    }
    return { client, releaseAfterQuery: false, originalSql: 'BEGIN' };
  }

  if (trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
    if (store?.client) {
      return { client: store.client, releaseAfterQuery: true, originalSql: trimmed };
    }
    return { client: null, releaseAfterQuery: false, originalSql: trimmed };
  }

  return { client: store?.client || pool, releaseAfterQuery: false, originalSql: sql };
};

const prepareRunStatement = (sql) => {
  const trimmed = sql.trim();
  if (/^INSERT\s+/i.test(trimmed) && !/\bRETURNING\b/i.test(trimmed)) {
    return `${trimmed} RETURNING id`;
  }
  return trimmed;
};

const extractLastId = (result) => {
  if (!result.rows || result.rows.length === 0) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(result.rows[0], 'id')) {
    return result.rows[0].id;
  }

  const firstValue = Object.values(result.rows[0])[0];
  return firstValue ?? null;
};

const internalQuery = async (sql, params = [], mode = 'all') => {
  const { client, releaseAfterQuery, originalSql } = await resolveExecutor(sql);
  const text = normalizeSql(
    mode === 'run' ? prepareRunStatement(originalSql) : originalSql
  );

  try {
    const result = client ? await client.query(text, params) : { rows: [], rowCount: 0 };

    if (releaseAfterQuery && getStore()?.client) {
      const txClient = getStore().client;
      getStore().client = null;
      txClient.release();
    }

    if (mode === 'get') {
      return result.rows[0] || undefined;
    }

    if (mode === 'run') {
      return {
        lastID: extractLastId(result),
        changes: result.rowCount || 0,
      };
    }

    return result.rows;
  } catch (error) {
    if (releaseAfterQuery && getStore()?.client) {
      const txClient = getStore().client;
      getStore().client = null;
      txClient.release();
    }
    throw error;
  }
};

const db = {
  serialize(fn) {
    return txStorage.run({ client: null }, fn);
  },

  all(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }

    return withCallback(
      internalQuery(sql, params, 'all'),
      callback
    );
  },

  get(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }

    return withCallback(
      internalQuery(sql, params, 'get'),
      callback
    );
  },

  run(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }

    return withCallback(
      internalQuery(sql, params, 'run'),
      callback,
      (result) => ({
        lastID: result?.lastID ?? null,
        changes: result?.changes ?? 0,
      })
    );
  },
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    email TEXT,
    status TEXT DEFAULT 'Active',
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    two_factor_secret TEXT,
    two_factor_enabled INTEGER DEFAULT 0,
    reset_token TEXT,
    reset_token_expiry TIMESTAMP,
    branch_id INTEGER,
    phone TEXT,
    session_id TEXT,
    last_login TIMESTAMP,
    last_seen TIMESTAMP,
    company_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    id_number TEXT,
    income_source TEXT,
    kyc_status TEXT DEFAULT 'Pending',
    kyc_verified_at TIMESTAMP,
    branch_id INTEGER,
    gender TEXT,
    disability_status TEXT DEFAULT 'None',
    disability_type TEXT,
    marginalized_group TEXT DEFAULT 'None',
    special_program_eligible INTEGER DEFAULT 0,
    preferred_language TEXT DEFAULT 'Amharic',
    accessibility_needs TEXT,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    type TEXT NOT NULL,
    balance NUMERIC(15, 2) NOT NULL,
    interest_rate NUMERIC(8, 2),
    status TEXT DEFAULT 'Active',
    product_type TEXT DEFAULT 'Standard',
    special_program INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS loan_accounts (
    id TEXT PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    savings_account_id TEXT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    balance NUMERIC(15, 2) NOT NULL,
    type TEXT NOT NULL,
    branch_id INTEGER,
    term TEXT NOT NULL,
    interest_rate NUMERIC(8, 2),
    payment_frequency TEXT DEFAULT 'Monthly',
    status TEXT DEFAULT 'Pending',
    disbursement_date TEXT,
    product_type TEXT DEFAULT 'Standard',
    special_program INTEGER DEFAULT 0,
    collateral_type TEXT,
    purpose TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS loan_payments (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL REFERENCES loan_accounts(id),
    amount NUMERIC(15, 2) NOT NULL,
    principal_amount NUMERIC(15, 2) NOT NULL,
    interest_amount NUMERIC(15, 2) NOT NULL,
    balance_before NUMERIC(15, 2) NOT NULL,
    balance_after NUMERIC(15, 2) NOT NULL,
    payment_date TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS savings_accounts (
    id TEXT PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    amount NUMERIC(15, 2) NOT NULL,
    type TEXT NOT NULL,
    branch_id INTEGER,
    interest_rate NUMERIC(8, 2),
    maturity_date TEXT,
    deposit_limit NUMERIC(15, 2) DEFAULT 1000000,
    compliance_flag TEXT DEFAULT 'None',
    status TEXT DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    loan_id TEXT,
    approval_request_id TEXT,
    related_entity_type TEXT,
    related_entity_id TEXT,
    type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    status TEXT DEFAULT 'Pending',
    version INTEGER DEFAULT 1,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS document_versions (
    id SERIAL PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    version INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    change_reason TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    client TEXT NOT NULL,
    account TEXT NOT NULL,
    type TEXT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    submitted_date TEXT NOT NULL,
    status TEXT DEFAULT 'Pending',
    kyc_complete INTEGER DEFAULT 1,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS system_settings (
    section TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    setting_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (section, setting_key)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_trail (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    user_id INTEGER,
    user_role TEXT DEFAULT 'anonymous',
    details TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT,
    previous_hash TEXT,
    event_hash TEXT,
    status TEXT DEFAULT 'Success'
  )`,
  `CREATE TABLE IF NOT EXISTS approval_requests (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    amount NUMERIC(15, 2),
    requested_by INTEGER NOT NULL REFERENCES users(id),
    status TEXT DEFAULT 'Pending',
    approval_level TEXT DEFAULT 'branch_manager',
    justification TEXT,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewed_by INTEGER REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS account_unlock_requests (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    requested_user_id INTEGER NOT NULL REFERENCES users(id),
    requested_user_email TEXT,
    requested_user_name TEXT,
    contact TEXT,
    status TEXT DEFAULT 'Pending',
    reason TEXT,
    lock_until TIMESTAMP,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewed_by INTEGER REFERENCES users(id),
    rejection_reason TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS payment_schedule (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL REFERENCES loan_accounts(id),
    due_date TEXT NOT NULL,
    principal_amount NUMERIC(15, 2) NOT NULL,
    interest_amount NUMERIC(15, 2) NOT NULL,
    total_amount NUMERIC(15, 2) NOT NULL,
    balance_remaining NUMERIC(15, 2) NOT NULL,
    principal_paid NUMERIC(15, 2) DEFAULT 0,
    interest_paid NUMERIC(15, 2) DEFAULT 0,
    paid_amount NUMERIC(15, 2) DEFAULT 0,
    status TEXT DEFAULT 'Pending',
    paid_date TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    account_type TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    balance_before NUMERIC(15, 2) NOT NULL,
    balance_after NUMERIC(15, 2) NOT NULL,
    description TEXT,
    transaction_reference TEXT,
    idempotency_key TEXT,
    approval_request_id TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS aml_alerts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    account_type TEXT NOT NULL,
    client_id INTEGER,
    transaction_id TEXT,
    alert_type TEXT NOT NULL,
    severity TEXT DEFAULT 'medium',
    amount NUMERIC(15, 2),
    details TEXT,
    status TEXT DEFAULT 'Open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    manager_id INTEGER REFERENCES users(id),
    phone TEXT,
    email TEXT,
    credit_limit NUMERIC(15, 2) DEFAULT 0,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS email_log (
    id SERIAL PRIMARY KEY,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT DEFAULT 'Sent',
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    error_message TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_status (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    last_sync TEXT,
    pending_operations INTEGER DEFAULT 0,
    sync_status TEXT DEFAULT 'Idle'
  )`,
  `CREATE TABLE IF NOT EXISTS sync_queue (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    operation_type TEXT NOT NULL,
    operation_data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS user_permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    permission TEXT NOT NULL,
    granted_by INTEGER NOT NULL REFERENCES users(id),
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS statements (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    account_id TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    statement_data TEXT,
    status TEXT DEFAULT 'Pending',
    requested_by INTEGER REFERENCES users(id),
    extended_range_flag TEXT DEFAULT 'Normal',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS update_requests (
    id TEXT PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    request_type TEXT NOT NULL,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT NOT NULL,
    explanation TEXT,
    document_ids TEXT,
    status TEXT DEFAULT 'Pending Staff Review',
    tracking_id TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    read_status INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS customer_messages (
    id TEXT PRIMARY KEY,
    submitted_by_user_id INTEGER REFERENCES users(id),
    client_id INTEGER REFERENCES clients(id),
    name TEXT,
    email TEXT,
    phone TEXT,
    category TEXT DEFAULT 'complaint',
    subject TEXT,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'Pending',
    assigned_to INTEGER REFERENCES users(id),
    resolved_at TIMESTAMP,
    resolution_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
];

const indexStatements = [
  'CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone)',
  'CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)',
  'CREATE INDEX IF NOT EXISTS idx_loan_accounts_client ON loan_accounts(client_id)',
  'CREATE INDEX IF NOT EXISTS idx_loan_accounts_savings ON loan_accounts(savings_account_id)',
  'CREATE INDEX IF NOT EXISTS idx_loan_accounts_status ON loan_accounts(status)',
  'CREATE INDEX IF NOT EXISTS idx_savings_accounts_client ON savings_accounts(client_id)',
  'CREATE INDEX IF NOT EXISTS idx_savings_accounts_status ON savings_accounts(status)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type)',
  'CREATE INDEX IF NOT EXISTS idx_payment_schedule_loan ON payment_schedule(loan_id)',
  'CREATE INDEX IF NOT EXISTS idx_payment_schedule_date ON payment_schedule(due_date)',
  'CREATE INDEX IF NOT EXISTS idx_payment_schedule_status ON payment_schedule(status)',
  'CREATE INDEX IF NOT EXISTS idx_audit_trail_user ON audit_trail(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_audit_trail_timestamp ON audit_trail(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status)',
  'CREATE INDEX IF NOT EXISTS idx_approval_requests_type ON approval_requests(type)',
  'CREATE INDEX IF NOT EXISTS idx_account_unlock_requests_status ON account_unlock_requests(status)',
  'CREATE INDEX IF NOT EXISTS idx_account_unlock_requests_username ON account_unlock_requests(username)',
  'CREATE INDEX IF NOT EXISTS idx_account_unlock_requests_requested_at ON account_unlock_requests(requested_at)',
  'CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client_id)',
  'CREATE INDEX IF NOT EXISTS idx_documents_loan ON documents(loan_id)',
  'CREATE INDEX IF NOT EXISTS idx_update_requests_client ON update_requests(client_id)',
  'CREATE INDEX IF NOT EXISTS idx_update_requests_status ON update_requests(status)',
  'CREATE INDEX IF NOT EXISTS idx_update_requests_tracking ON update_requests(tracking_id)',
  'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
  'CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)',
];

const ensureColumnExists = async (tableName, columnName, definition) => {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [tableName, columnName]
  );

  if (result.rowCount === 0) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
};

const seedInitialUsers = async () => {
  const userCount = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  if (userCount.rows[0].count > 0) {
    return;
  }

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
    await pool.query(
      'INSERT INTO users (name, username, password, role) VALUES ($1, $2, $3, $4)',
      [user.name, user.username, hashedPassword, user.role]
    );
  }

  console.log('Initial users seeded successfully');
};

const seedInitialBranches = async () => {
  const branchCount = await pool.query('SELECT COUNT(*)::int AS count FROM branches');
  if (branchCount.rows[0].count > 0) {
    return;
  }

  console.log('Seeding initial branches...');
  const branches = [
    { name: 'Addis Ababa (HQ)', location: 'Addis Ababa', phone: '+251-11-1234567', email: 'hq@edekise.com' },
    { name: 'Hawassa', location: 'Hawassa', phone: '+251-46-2345678', email: 'hawassa@edekise.com' },
    { name: 'Dire Dawa', location: 'Dire Dawa', phone: '+251-25-3456789', email: 'diredawa@edekise.com' },
    { name: 'Bahir Dar', location: 'Bahir Dar', phone: '+251-58-4567890', email: 'bahirdar@edekise.com' },
  ];

  for (const branch of branches) {
    await pool.query(
      'INSERT INTO branches (name, location, phone, email) VALUES ($1, $2, $3, $4)',
      [branch.name, branch.location, branch.phone, branch.email]
    );
  }

  console.log('Initial branches seeded successfully');
};

const enforceDataRetentionPolicy = async () => {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const cutoffDate = oneYearAgo.toISOString();

  console.log(`[RETENTION] Enforcing data retention policy. Deleting records older than ${cutoffDate}`);

  try {
    const auditResult = await pool.query(
      'DELETE FROM audit_trail WHERE timestamp < $1',
      [cutoffDate]
    );
    console.log(`[RETENTION] Deleted ${auditResult.rowCount} old audit log entries`);
  } catch (error) {
    console.error('[RETENTION] Error deleting old audit logs:', error);
  }

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const emailCutoffDate = sixMonthsAgo.toISOString();

  try {
    const emailResult = await pool.query(
      'DELETE FROM email_log WHERE sent_at < $1',
      [emailCutoffDate]
    );
    console.log(`[RETENTION] Deleted ${emailResult.rowCount} old email log entries`);
  } catch (error) {
    console.error('[RETENTION] Error deleting old email logs:', error);
  }
};

const initializeDatabase = async () => {
  for (const statement of schemaStatements) {
    await pool.query(statement);
  }

  await ensureColumnExists('users', 'email', 'TEXT');
  await ensureColumnExists('users', 'reset_token', 'TEXT');
  await ensureColumnExists('users', 'reset_token_expiry', 'TIMESTAMP');
  await ensureColumnExists('users', 'two_factor_secret', 'TEXT');
  await ensureColumnExists('users', 'two_factor_enabled', 'INTEGER DEFAULT 0');
  await ensureColumnExists('users', 'branch_id', 'INTEGER');
  await ensureColumnExists('users', 'phone', 'TEXT');
  await ensureColumnExists('users', 'session_id', 'TEXT');
  await ensureColumnExists('users', 'last_login', 'TIMESTAMP');
  await ensureColumnExists('users', 'last_seen', 'TIMESTAMP');
  await ensureColumnExists('users', 'company_id', 'TEXT');
  await ensureColumnExists('branches', 'credit_limit', 'NUMERIC(15, 2) DEFAULT 0');
  await ensureColumnExists('clients', 'branch_id', 'INTEGER REFERENCES branches(id)');
  await ensureColumnExists('loan_accounts', 'branch_id', 'INTEGER REFERENCES branches(id)');
  await ensureColumnExists('loan_accounts', 'savings_account_id', 'TEXT');
  await ensureColumnExists('loan_accounts', 'disbursement_date', 'TEXT');
  await ensureColumnExists('loan_accounts', 'purpose', 'TEXT');
  await ensureColumnExists('savings_accounts', 'branch_id', 'INTEGER REFERENCES branches(id)');
  await ensureColumnExists('payment_schedule', 'principal_paid', 'NUMERIC(15, 2) DEFAULT 0');
  await ensureColumnExists('payment_schedule', 'interest_paid', 'NUMERIC(15, 2) DEFAULT 0');
  await ensureColumnExists('clients', 'notify_email', 'INTEGER DEFAULT 1');
  await ensureColumnExists('clients', 'notify_sms', 'INTEGER DEFAULT 1');
  await ensureColumnExists('clients', 'notify_payment_reminders', 'INTEGER DEFAULT 1');
  await ensureColumnExists('payment_schedule', 'paid_amount', 'NUMERIC(15, 2) DEFAULT 0');
  await ensureColumnExists('payment_schedule', 'penalty_amount', 'NUMERIC(15, 2) DEFAULT 0');
  await ensureColumnExists('payment_schedule', 'penalty_paid', 'NUMERIC(15, 2) DEFAULT 0');
  await ensureColumnExists('payment_schedule', 'paid_date', 'TEXT');
  await ensureColumnExists('documents', 'approval_request_id', 'TEXT');
  await ensureColumnExists('documents', 'related_entity_type', 'TEXT');
  await ensureColumnExists('documents', 'related_entity_id', 'TEXT');

  await pool.query(`
    UPDATE loan_accounts la
    SET savings_account_id = sub.id
    FROM (
      SELECT DISTINCT ON (client_id) client_id, id
      FROM savings_accounts
      ORDER BY client_id, created_at ASC
    ) sub
    WHERE la.client_id = sub.client_id
      AND la.savings_account_id IS NULL
  `);

  for (const statement of indexStatements) {
    await pool.query(statement);
  }

  console.log('Database tables initialized');
  console.log('Database indexes created for performance optimization');

  await seedInitialUsers();
  await seedInitialBranches();

  const retentionInterval = setInterval(() => {
    enforceDataRetentionPolicy().catch((error) => {
      console.error('Retention policy error:', error);
    });
  }, 24 * 60 * 60 * 1000);

  console.log('Data retention policy scheduler initialized');

  const shutdown = async () => {
    clearInterval(retentionInterval);
    console.log('Data retention scheduler stopped');
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

const initializationPromise = pool
  .connect()
  .then((client) => {
    client.release();
    console.log('Connected to PostgreSQL database');
    return initializeDatabase();
  })
  .catch((error) => {
    console.error('Error connecting to PostgreSQL:', error.message);
    throw error;
  });

const query = async (sql, params = []) => {
  await initializationPromise;
  return internalQuery(sql, params, 'all');
};

const run = async (sql, params = []) => {
  await initializationPromise;
  return internalQuery(sql, params, 'run');
};

module.exports = { db, query, run, pool, initializationPromise };
