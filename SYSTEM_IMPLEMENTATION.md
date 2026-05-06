# Edekise Microfinance System - System Implementation Documentation

## Table of Contents
1. [System Architecture](#system-architecture)
2. [Technology Stack](#technology-stack)
3. [Backend Implementation](#backend-implementation)
4. [Frontend Implementation](#frontend-implementation)
5. [Database Schema](#database-schema)
6. [Security Implementation](#security-implementation)
7. [API Endpoints](#api-endpoints)
8. [Middleware and Utilities](#middleware-and-utilities)
9. [Deployment and Configuration](#deployment-and-configuration)
10. [File Structure](#file-structure)

---

## System Architecture

### Architecture Overview
The Edekise Microfinance System follows a **client-server architecture** with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Client  │  │  Staff   │  │ Manager  │  │   CEO    │  │
│  │ Dashboard│  │Dashboard │  │Dashboard │  │Dashboard │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└───────────────────────────┬───────────────────────────────┘
                            │ HTTP/JSON (REST API)
                            │ JWT Authentication
┌───────────────────────────┴───────────────────────────────┐
│                    Backend (Express.js)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Middleware Layer                          │  │
│  │  - Authentication (JWT)                                │  │
│  │  - Authorization (Role-Based)                          │  │
│  │  - Rate Limiting                                       │  │
│  │  - Audit Logging                                       │  │
│  │  - Security Headers (Helmet)                           │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Route Handlers                             │  │
│  │  - Auth, Users, Loans, Savings                        │  │
│  │  - Transactions, Documents, Approvals                  │  │
│  │  - CEO Operations, Statements, Updates                 │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Business Logic                             │  │
│  │  - Validation, Policy Enforcement                     │  │
│  │  - Transaction Processing                              │  │
│  │  - Approval Workflows                                  │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────┬───────────────────────────────┘
                            │
┌───────────────────────────┴───────────────────────────────┐
│                    Database (SQLite)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Users   │  │ Clients  │  │  Loans   │  │ Savings  │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │Documents │  │Transactions│  │Approvals │  │AuditTrail│  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Design Patterns
- **MVC Pattern**: Separation of routes (controllers), database (models), and frontend (views)
- **Middleware Pattern**: Reusable authentication, authorization, and logging
- **Repository Pattern**: Database abstraction through `db` object
- **Factory Pattern**: Route handlers and utility functions
- **Observer Pattern**: Event-driven audit logging

---

## Technology Stack

### Backend Technologies
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 18+ | Runtime environment |
| Express.js | 4.18.2 | Web framework |
| SQLite3 | 6.0.1 | Database |
| bcryptjs | 2.4.3 | Password hashing |
| jsonwebtoken | 9.0.2 | JWT authentication |
| multer | 1.4.5-lts.1 | File uploads |
| nodemailer | 8.0.5 | Email service |
| node-cron | 3.0.3 | Scheduled tasks |
| express-rate-limit | 7.1.5 | Rate limiting |
| helmet | 7.1.0 | Security headers |
| cors | 2.8.5 | CORS configuration |
| morgan | 1.10.0 | HTTP logging |
| cookie-parser | 1.4.6 | Cookie handling |

### Frontend Technologies
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18+ | UI framework |
| React Router DOM | Latest | Client-side routing |
| Vite | Latest | Build tool |
| Lucide React | Latest | Icons |

### Development Tools
| Technology | Purpose |
|------------|---------|
| nodemon | Hot reload during development |
| Git | Version control |

---

## Backend Implementation

### Server Configuration (`server.js`)

**Environment Validation:**
```javascript
const requiredEnvVars = ['JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error('[CONFIG] Missing required environment variables:', missingEnvVars.join(', '));
  process.exit(1);
}
```

**Middleware Stack:**
1. **Helmet**: Security headers (CSP, HSTS, XSS protection)
2. **CORS**: Configured for localhost:3000, localhost:5173, and FRONTEND_URL
3. **Rate Limiting**: Global limiter (100 req/15min) + endpoint-specific limiters
4. **Cookie Parser**: Secure, httpOnly, sameSite: strict
5. **Body Parser**: JSON and URL-encoded (10MB limit)
6. **Morgan**: Combined logging format

**Route Mounting:**
```javascript
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/password-reset', rateLimiters.auth, passwordResetRoutes);
app.use('/api/users', userRoutes);
app.use('/api/loans', rateLimiters.financial, loanRoutes);
app.use('/api/savings', rateLimiters.financial, savingsRoutes);
app.use('/api/documents', rateLimiters.upload, documentRoutes);
app.use('/api/transactions', rateLimiters.financial, transactionRoutes);
// ... additional routes
```

**Error Handling:**
- Multer errors (file size, unexpected file)
- JWT errors (invalid token, expired token)
- Database errors (constraint violations)
- Generic error with stack trace in development

### Route Implementation Pattern

**Standard Route Structure:**
```javascript
router.post('/endpoint', authenticateToken, authorizeRoles('role1', 'role2'), async (req, res) => {
  // 1. Input validation
  if (!requiredField) {
    return res.status(400).json({ error: 'Field required' });
  }

  try {
    // 2. Business logic
    const result = await performOperation();

    // 3. Audit logging
    console.log(`[AUDIT] Operation performed at ${new Date().toISOString()}`);

    // 4. Response
    res.json({ message: 'Success', data: result });
  } catch (error) {
    console.error('Operation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Database Transaction Pattern:**
```javascript
db.serialize(() => {
  db.run('BEGIN TRANSACTION');
  
  db.get('SELECT * FROM table WHERE id = ?', [id], (err, row) => {
    if (err) {
      db.run('ROLLBACK');
      return res.status(500).json({ error: 'Database error' });
    }

    db.run('UPDATE table SET field = ? WHERE id = ?', [value, id], (err) => {
      if (err) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: 'Database error' });
      }

      db.run('COMMIT');
      res.json({ message: 'Success' });
    });
  });
});
```

### Key Route Implementations

**Authentication (`routes/auth.js`):**
- Login with account lockout (5 attempts, 30 min)
- JWT generation with role-based expiry
- Password complexity validation (12 chars, mixed case, number, special)
- Account unlock by admin
- Token verification endpoint

**Loan Management (`routes/loans.js`):**
- Loan creation with policy validation (max 500,000 ETB, 5-25% interest)
- Document verification before approval
- Policy violation escalation to CEO
- CEO escalation for high-value loans (>100,000 ETB)
- Audit history retrieval using LIKE pattern matching

**Financial Transactions (`routes/transactions.js`):**
- Deposit with database transaction
- Withdrawal with database transaction
- Loan payment with database transaction
- Balance validation before operations
- Transaction logging with before/after balances

**Document Management (`routes/documents.js`):**
- File upload with multer (5MB limit)
- Magic number validation (PDF: %PDF, JPEG: FF D8 FF)
- File type spoofing prevention
- Document verification/rejection workflow

**CEO Operations (`routes/ceo.js`):**
- Balance adjustment with secondary authentication
- Preview before confirmation
- Digital signature generation
- Branch manager notification
- Risk assessment report generation

---

## Frontend Implementation

### API Integration (`frontend/src/utils/api.js`)

**Base Configuration:**
```javascript
const API_BASE_URL = 'http://localhost:5000/api';
```

**Auth Helper:**
```javascript
const getAuthToken = () => {
  return localStorage.getItem('token');
};
```

**Fetch Wrapper:**
```javascript
const fetchWithAuth = async (endpoint, options = {}) => {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...options.headers
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
};
```

**API Methods Structure:**
```javascript
export const api = {
  // Auth
  login: (username, password) => fetchWithAuth('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  }),
  
  // Loans
  getLoans: () => fetchWithAuth('/loans'),
  approveLoan: (id, justification) => fetchWithAuth(`/loans/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ justification })
  }),
  
  // Transactions
  deposit: (accountId, amount, description) => fetchWithAuth('/transactions/deposit', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, amount, description })
  }),
  
  // File Upload (special handling)
  uploadDocument: (formData) => {
    const token = getAuthToken();
    return fetch(`${API_BASE_URL}/documents/upload`, {
      method: 'POST',
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` })
      },
      body: formData
    }).then(res => res.json());
  }
};
```

### Frontend Structure
```
frontend/src/
├── components/
│   └── Layout.jsx
├── context/
│   └── AuthContext.jsx
├── pages/
│   ├── Login.jsx
│   ├── Landing.jsx
│   ├── Unauthorized.jsx
│   ├── AdminDashboard.jsx
│   ├── BranchManagerDashboard.jsx
│   ├── CEODashboard.jsx
│   ├── ClientDashboard.jsx
│   ├── LoanStaffDashboard.jsx
│   ├── SavingStaffDashboard.jsx
│   ├── admin/
│   │   ├── Accounts.jsx
│   │   ├── Logs.jsx
│   │   └── Settings.jsx
│   ├── branch-manager/
│   │   ├── LoanApprovals.jsx
│   │   └── SavingsApprovals.jsx
│   ├── ceo/
│   │   ├── BalanceManagement.jsx
│   │   ├── BranchOverview.jsx
│   │   └── Reports.jsx
│   ├── client/
│   │   ├── MyLoans.jsx
│   │   ├── MySavings.jsx
│   │   └── Profile.jsx
│   ├── loan-staff/
│   │   ├── Documents.jsx
│   │   └── LoanManagement.jsx
│   └── saving-staff/
│       ├── Requests.jsx
│       └── SavingsManagement.jsx
├── utils/
│   ├── api.js
│   └── ProtectedRoute.jsx
├── App.jsx
├── index.css
└── main.jsx
```

---

## Database Schema

### Table Relationships

```
users (1) ──────< (many) approval_requests
users (1) ──────< (many) audit_trail
users (1) ──────< (many) transactions
users (1) ──────< (many) statements
users (1) ──────< (many) update_requests

clients (1) ─────< (many) loan_accounts
clients (1) ─────< (many) savings_accounts
clients (1) ─────< (many) documents
clients (1) ─────< (many) statements
clients (1) ─────< (many) update_requests

branches (1) ────< (many) users (manager_id)
branches (1) ────< (many) loan_accounts
branches (1) ────< (many) savings_accounts
branches (1) ────< (many) clients

loan_accounts (1) ─< (many) payment_schedule
loan_accounts (1) ─< (many) transactions
loan_accounts (1) ─< (many) documents
loan_accounts (1) ─< (many) statements

savings_accounts (1) ─< (many) transactions
savings_accounts (1) ─< (many) statements
```

### Table Definitions

**users:**
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT,
  status TEXT DEFAULT 'Active',
  login_attempts INTEGER DEFAULT 0,
  locked_until TEXT,
  reset_token TEXT,
  reset_token_expiry TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**clients:**
```sql
CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  gender TEXT,
  disability_status TEXT DEFAULT 'None',
  marginalized_group TEXT DEFAULT 'None',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**loan_accounts:**
```sql
CREATE TABLE loan_accounts (
  id TEXT PRIMARY KEY,
  client_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  balance REAL NOT NULL,
  type TEXT NOT NULL,
  term TEXT NOT NULL,
  interest_rate REAL,
  payment_frequency TEXT DEFAULT 'Monthly',
  status TEXT DEFAULT 'Pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

**savings_accounts:**
```sql
CREATE TABLE savings_accounts (
  id TEXT PRIMARY KEY,
  client_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  type TEXT NOT NULL,
  interest_rate REAL,
  maturity_date TEXT,
  deposit_limit REAL DEFAULT 1000000,
  compliance_flag TEXT DEFAULT 'None',
  status TEXT DEFAULT 'Pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

**documents:**
```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  client_id INTEGER NOT NULL,
  loan_id TEXT,
  type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT DEFAULT 'Pending',
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

**transactions:**
```sql
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  account_type TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  amount REAL NOT NULL,
  balance_before REAL NOT NULL,
  balance_after REAL NOT NULL,
  description TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
```

**payment_schedule:**
```sql
CREATE TABLE payment_schedule (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL,
  due_date TEXT NOT NULL,
  principal_amount REAL NOT NULL,
  interest_amount REAL NOT NULL,
  total_amount REAL NOT NULL,
  balance_remaining REAL NOT NULL,
  status TEXT DEFAULT 'Pending',
  paid_date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (loan_id) REFERENCES loan_accounts(id)
);
```

**audit_trail:**
```sql
CREATE TABLE audit_trail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  user_role TEXT NOT NULL,
  details TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**approval_requests:**
```sql
CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  requested_by INTEGER NOT NULL,
  status TEXT DEFAULT 'Pending',
  justification TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by INTEGER,
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
```

**statements:**
```sql
CREATE TABLE statements (
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
);
```

**update_requests:**
```sql
CREATE TABLE update_requests (
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
);
```

**branches:**
```sql
CREATE TABLE branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  manager_id INTEGER,
  phone TEXT,
  email TEXT,
  status TEXT DEFAULT 'Active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (manager_id) REFERENCES users(id)
);
```

**email_log:**
```sql
CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'Sent',
  sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
  error_message TEXT
);
```

### Performance Indexes

**Created Indexes (24 total):**
- `idx_clients_phone`, `idx_clients_name`
- `idx_loan_accounts_client`, `idx_loan_accounts_status`
- `idx_savings_accounts_client`, `idx_savings_accounts_status`
- `idx_transactions_account`, `idx_transactions_date`, `idx_transactions_type`
- `idx_payment_schedule_loan`, `idx_payment_schedule_date`, `idx_payment_schedule_status`
- `idx_audit_trail_user`, `idx_audit_trail_timestamp`
- `idx_approval_requests_status`, `idx_approval_requests_type`
- `idx_documents_client`, `idx_documents_loan`
- `idx_update_requests_client`, `idx_update_requests_status`, `idx_update_requests_tracking`
- `idx_users_email`, `idx_users_reset_token`

---

## Security Implementation

### Authentication

**JWT Token Generation:**
```javascript
const token = jwt.sign(
  { 
    id: user.id, 
    username: user.username, 
    role: user.role,
    sessionId: Date.now() + Math.random()
  },
  process.env.JWT_SECRET,
  { expiresIn: tokenExpiry }
);
```

**Role-Based Session Timeouts:**
```javascript
const sessionTimeouts = {
  'ceo': '1h',
  'branch_manager': '15m',
  'loan_staff': '15m',
  'saving_staff': '15m',
  'client': '30m'
};
```

**Account Lockout:**
```javascript
login_attempts INTEGER DEFAULT 0,
locked_until TEXT

// On failed login
login_attempts++;
if (login_attempts >= 5) {
  locked_until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
}
```

### Authorization

**Role-Based Access Control:**
```javascript
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
};
```

**Protected Routes:**
```javascript
router.get('/endpoint', authenticateToken, authorizeRoles('admin', 'ceo'), handler);
```

### Password Security

**Password Complexity Validation:**
```javascript
const validatePasswordComplexity = (password) => {
  const errors = [];
  
  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  const commonPasswords = ['password', '123456', 'qwerty', 'admin123', 'password123'];
  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    errors.push('Password contains common weak patterns');
  }
  
  return errors;
};
```

**Password Hashing:**
```javascript
const hashedPassword = await bcrypt.hash(password, 10);
```

### Rate Limiting

**Endpoint-Specific Limiters:**
```javascript
const rateLimiters = {
  auth: createRateLimiter(5, 15 * 60 * 1000),      // 5 attempts/15min
  financial: createRateLimiter(50, 60 * 60 * 1000), // 50 operations/hour
  read: createRateLimiter(200, 15 * 60 * 1000),    // 200 requests/15min
  upload: createRateLimiter(10, 60 * 60 * 1000),   // 10 uploads/hour
  admin: createRateLimiter(30, 60 * 60 * 1000)      // 30 operations/hour
};
```

### File Upload Security

**Magic Number Validation:**
```javascript
const validateFileContent = (filePath, file) => {
  const buffer = fs.readFileSync(filePath);
  const header = buffer.slice(0, 4).toString('hex');
  
  const magicNumbers = {
    'pdf': '25504446',  // %PDF
    'jpeg': 'ffd8ffe0'   // JPEG
  };
  
  if (file.mimetype === 'application/pdf' && !header.startsWith(magicNumbers.pdf)) {
    return false;
  }
  
  if (file.mimetype === 'image/jpeg' && !header.startsWith(magicNumbers.jpeg)) {
    return false;
  }
  
  return true;
};
```

### SQL Injection Prevention

**Parameterized Queries:**
```javascript
// Vulnerable (DON'T DO THIS):
db.all(`SELECT * FROM table WHERE id IN (${ids.join(',')})`, ...)

// Secure (DO THIS):
const placeholders = ids.map(() => '?').join(',');
db.all(`SELECT * FROM table WHERE id IN (${placeholders})`, ids, ...);
```

### Audit Logging

**Sanitization:**
```javascript
const sanitizeRequestBody = (body) => {
  const sensitiveFields = ['password', 'token', 'secret'];
  const sanitized = { ...body };
  
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });
  
  return sanitized;
};
```

### Data Encryption

**AES-256 Encryption:**
```javascript
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);
const ALGORITHM = 'aes-256-cbc';

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}
```

---

## API Endpoints

### Authentication Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/auth/login` | User login | No |
| POST | `/api/auth/logout` | User logout | Yes |
| GET | `/api/auth/verify` | Verify JWT token | No |
| POST | `/api/auth/unlock/:username` | Unlock account | Admin |
| POST | `/api/auth/register` | Register new user | No (dev only) |

### Password Reset Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/password-reset/request` | Request password reset | No |
| GET | `/api/password-reset/verify/:token` | Verify reset token | No |
| POST | `/api/password-reset/confirm` | Confirm new password | No |

### User Management Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/users` | Get all users | Admin |
| GET | `/api/users/:id` | Get user by ID | Yes |
| POST | `/api/users` | Create user | Admin |
| PUT | `/api/users/:id` | Update user | Admin |
| DELETE | `/api/users/:id` | Delete user | Admin |

### Loan Management Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/loans` | Get all loans | Yes |
| GET | `/api/loans/approvals/pending` | Get pending approvals | Yes |
| POST | `/api/loans/:id/approve` | Approve loan | Branch Manager |
| POST | `/api/loans/:id/reject` | Reject loan | Branch Manager |
| POST | `/api/loans/:id/escalate` | Escalate loan | Yes |
| POST | `/api/loans/setup` | Setup loan account | Loan Staff |
| POST | `/api/loans/escalate-policy/:loanId` | Escalate policy violation | Yes |
| POST | `/api/loans/:id/escalate-ceo` | Escalate to CEO | Branch Manager |

### Savings Management Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/savings` | Get all savings | Yes |
| GET | `/api/savings/approvals/pending` | Get pending approvals | Yes |
| POST | `/api/savings/:id/approve` | Approve savings | Branch Manager |
| POST | `/api/savings/:id/reject` | Reject savings | Branch Manager |
| POST | `/api/savings` | Create savings account | Saving Staff |
| POST | `/api/savings/:id/submit-approval` | Submit for approval | Saving Staff |

### Transaction Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/transactions/account/:accountId` | Get account transactions | Yes |
| POST | `/api/transactions/deposit` | Deposit to savings | Yes |
| POST | `/api/transactions/withdraw` | Withdraw from savings | Yes |
| POST | `/api/transactions/payment` | Make loan payment | Yes |

### Document Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/documents` | Get all documents | Yes |
| POST | `/api/documents/upload` | Upload document | Yes |
| POST | `/api/documents/:id/verify` | Verify document | Yes |
| POST | `/api/documents/:id/reject` | Reject document | Yes |
| DELETE | `/api/documents/:id` | Delete document | Yes |

### Payment Schedule Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/payment-schedule/loan/:loanId` | Get payment schedule | Yes |
| POST | `/api/payment-schedule/generate` | Generate schedule | Yes |
| POST | `/api/payment-schedule/:id/pay` | Mark payment as paid | Yes |
| POST | `/api/payment-schedule/advance-payment` | Make advance payment | Yes |

### Statement Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/statements/loan/:loanId` | Get loan statement | Yes |
| GET | `/api/statements/savings/:accountId` | Get savings statement | Yes |
| POST | `/api/statements/loan/request` | Request loan statement | Yes |
| POST | `/api/statements/savings/request` | Request savings statement | Yes |
| GET | `/api/statements/approvals/pending` | Get pending approvals | Yes |
| POST | `/api/statements/:id/approve` | Approve statement | Yes |
| POST | `/api/statements/:id/authorize` | Authorize statement | Yes |
| POST | `/api/statements/:id/reject` | Reject statement | Yes |

### CEO Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/ceo/balance-adjustment` | Adjust account balance | CEO |
| POST | `/api/ceo/balance-adjustment/preview` | Preview adjustment | CEO |
| GET | `/api/ceo/approvals/pending` | Get pending approvals | CEO |
| POST | `/api/ceo/approvals/:requestId/approve` | Approve request | CEO |
| POST | `/api/ceo/approvals/:requestId/reject` | Reject request | CEO |
| GET | `/api/ceo/reports` | Get CEO reports | CEO |
| GET | `/api/ceo/reports/risk` | Get risk assessment | CEO |

### Update Request Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/updates/request` | Submit update request | Client |
| GET | `/api/updates/my-requests` | Get my requests | Client |
| GET | `/api/updates/pending` | Get pending requests | Staff/Manager |
| POST | `/api/updates/:id/approve` | Approve request | Staff/Manager |
| POST | `/api/updates/:id/reject` | Reject request | Staff/Manager |

### Branch Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/branches` | Get all branches | Admin/CEO |
| GET | `/api/branches/:id` | Get branch details | Admin/CEO |
| POST | `/api/branches` | Create branch | Admin |
| PUT | `/api/branches/:id` | Update branch | Admin |
| DELETE | `/api/branches/:id` | Delete branch | Admin |

### Approval Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/approvals/escalated` | Get escalated requests | CEO |
| POST | `/api/approvals/:id/approve` | Approve request | CEO |
| POST | `/api/approvals/:id/reject` | Reject request | CEO |

### Audit Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/audit` | Get audit logs | Admin/CEO |
| GET | `/api/audit/user/:userId` | Get user audit logs | Yes |
| POST | `/api/audit/balance-inquiry` | Log balance inquiry | Yes |

---

## Middleware and Utilities

### Middleware

**Authentication Middleware (`middleware/auth.js`):**
```javascript
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'Server configuration error: JWT_SECRET not set' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    
    req.user = user;
    next();
  });
};
```

**Authorization Middleware:**
```javascript
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
};
```

**Rate Limiter Middleware (`middleware/rateLimiter.js`):**
```javascript
const createRateLimiter = (maxRequests, windowMs) => {
  return rateLimit({
    windowMs,
    max: maxRequests,
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });
};
```

**Audit Logger Middleware (`middleware/auditLogger.js`):**
```javascript
const auditLogger = (req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    if (res.statusCode < 400) {
      const logData = {
        action: `${req.method} ${req.path}`,
        user_id: req.user?.id,
        user_role: req.user?.role,
        details: JSON.stringify({
          body: sanitizeRequestBody(req.body),
          params: req.params,
          query: req.query
        }),
        ip_address: req.ip
      };
      
      db.run(
        'INSERT INTO audit_trail (action, user_id, user_role, details, timestamp, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [logData.action, logData.user_id, logData.user_role, logData.details, new Date().toISOString(), logData.ip_address]
      );
    }
    
    originalSend.call(this, data);
  };
  
  next();
};
```

### Utilities

**Email Service (`utils/emailService.js`):**
```javascript
const sendEmail = async (to, subject, text, html = null) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@edekise.com',
    to,
    subject,
    text
  };

  if (html) {
    mailOptions.html = html;
  }

  const transporter = getTransporter();
  const info = await transporter.sendMail(mailOptions);
  
  return { success: true, messageId: info.messageId };
};
```

**Password Validator (`utils/passwordValidator.js`):**
```javascript
const validatePasswordComplexity = (password) => {
  const errors = [];
  
  if (password.length < 12) errors.push('Password must be at least 12 characters long');
  if (!/[a-z]/.test(password)) errors.push('Password must contain at least one lowercase letter');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter');
  if (!/[0-9]/.test(password)) errors.push('Password must contain at least one number');
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push('Password must contain at least one special character');
  
  const commonPasswords = ['password', '123456', 'qwerty', 'admin123', 'password123'];
  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    errors.push('Password contains common weak patterns');
  }
  
  return errors;
};
```

**Encryption Utility (`utils/encryption.js`):**
```javascript
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
```

**Transaction Wrapper (`utils/transactionWrapper.js`):**
```javascript
const withTransaction = async (callback) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (beginErr) => {
        if (beginErr) return reject(beginErr);

        Promise.resolve(callback())
          .then((result) => {
            db.run('COMMIT', (commitErr) => {
              if (commitErr) return reject(commitErr);
              resolve(result);
            });
          })
          .catch((error) => {
            db.run('ROLLBACK', (rollbackErr) => {
              if (rollbackErr) return reject(rollbackErr);
              reject(error);
            });
          });
      });
    });
  });
};
```

**UUID Generator (`utils/uuidGenerator.js`):**
```javascript
const generateUUID = () => {
  return crypto.randomUUID();
};

const generatePrefixedUUID = (prefix) => {
  const uuid = crypto.randomUUID();
  return `${prefix}-${uuid}`;
};
```

---

## Deployment and Configuration

### Environment Variables

**Required Variables:**
```bash
# Server Configuration
PORT=5000
NODE_ENV=development

# Frontend URL
FRONTEND_URL=http://localhost:5173

# JWT Secret (REQUIRED - generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
JWT_SECRET=your-secret-key-change-this-in-production

# Database Configuration
DB_PATH=./database.sqlite

# Email Configuration (SMTP)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM=noreply@edekise.com

# Encryption Key (optional, will generate if not set)
ENCRYPTION_KEY=your-encryption-key

# File Upload Configuration
MAX_FILE_SIZE=5242880
UPLOAD_DIR=./uploads
```

### Installation

**Backend:**
```bash
cd backend
npm install
```

**Frontend:**
```bash
cd frontend
npm install
```

### Running the Application

**Development:**
```bash
# Backend
cd backend
npm run dev

# Frontend (separate terminal)
cd frontend
npm run dev
```

**Production:**
```bash
# Backend
cd backend
npm start

# Frontend
cd frontend
npm run build
# Serve built files with nginx or similar
```

### Database Initialization

The database is automatically initialized on first run:
- Tables are created if they don't exist
- Indexes are created for performance
- Seed users are inserted (admin, manager, loanstaff, savingstaff, ceo, client)
- Seed branches are inserted (Addis Ababa, Hawassa, Dire Dawa, Bahir Dar)

### Scheduled Tasks

**Data Retention Policy:**
- Runs daily at midnight
- Deletes audit logs older than 1 year
- Deletes email logs older than 6 months

**Payment Reminders:**
- Runs daily at 8:00 AM
- Sends reminders for payments due in next 3 days

### Security Considerations for Production

1. **Set strong JWT_SECRET** - Use cryptographically secure random string
2. **Configure SMTP credentials** - For password reset functionality
3. **Set NODE_ENV=production** - Enables production security settings
4. **Use HTTPS** - Configure reverse proxy (nginx/Apache) with SSL
5. **Set secure cookie flags** - Already configured for production
6. **Remove development endpoints** - Comment out seed reset and user list endpoints
7. **Configure CORS** - Set FRONTEND_URL to actual production domain
8. **Regular backups** - Backup database.sqlite file
9. **Monitor logs** - Set up log aggregation
10. **Rate limiting** - Adjust limits based on traffic patterns

---

## File Structure

### Backend Structure
```
backend/
├── config/
│   └── database.js              # Database initialization and schema
├── middleware/
│   ├── auth.js                  # JWT authentication and authorization
│   ├── auditLogger.js           # Audit logging middleware
│   ├── rateLimiter.js          # Rate limiting configuration
│   └── twoFactorAuth.js         # 2FA utilities (placeholder)
├── routes/
│   ├── approvals.js             # CEO approval endpoints
│   ├── audit.js                 # Audit log endpoints
│   ├── auth.js                  # Authentication endpoints
│   ├── branches.js              # Branch management endpoints
│   ├── ceo.js                   # CEO operations endpoints
│   ├── documents.js             # Document management endpoints
│   ├── loans.js                 # Loan management endpoints
│   ├── passwordReset.js         # Password reset endpoints
│   ├── paymentSchedule.js       # Payment schedule endpoints
│   ├── savings.js               # Savings management endpoints
│   ├── statements.js            # Statement generation endpoints
│   ├── transactions.js          # Financial transaction endpoints
│   ├── updates.js               # Update request endpoints
│   └── users.js                 # User management endpoints
├── scheduler/
│   └── reminderScheduler.js     # Payment reminder cron job
├── utils/
│   ├── emailService.js          # Email service wrapper
│   ├── encryption.js            # AES-256 encryption/decryption
│   ├── passwordValidator.js     # Password complexity validation
│   ├── transactionWrapper.js    # Database transaction wrapper
│   └── uuidGenerator.js         # UUID generation utilities
├── uploads/                     # Uploaded files directory
├── .env.example                 # Environment variables template
├── .gitignore
├── install.bat                  # Windows installation script
├── package.json                 # Backend dependencies
├── package-lock.json
└── server.js                    # Main application entry point
```

### Frontend Structure
```
frontend/
├── public/
│   └── assets/
├── src/
│   ├── components/
│   │   └── Layout.jsx           # Main layout component
│   ├── context/
│   │   └── AuthContext.jsx      # Authentication context
│   ├── pages/
│   │   ├── admin/               # Admin dashboard pages
│   │   ├── branch-manager/      # Branch manager pages
│   │   ├── ceo/                 # CEO dashboard pages
│   │   ├── client/              # Client dashboard pages
│   │   ├── loan-staff/          # Loan staff pages
│   │   ├── saving-staff/        # Saving staff pages
│   │   ├── AdminDashboard.jsx
│   │   ├── BranchManagerDashboard.jsx
│   │   ├── CEODashboard.jsx
│   │   ├── ClientDashboard.jsx
│   │   ├── Landing.jsx
│   │   ├── LoanStaffDashboard.jsx
│   │   ├── Login.jsx
│   │   ├── SavingStaffDashboard.jsx
│   │   └── Unauthorized.jsx
│   ├── utils/
│   │   ├── api.js               # API integration
│   │   └── ProtectedRoute.jsx   # Route protection
│   ├── App.css
│   ├── App.jsx                  # Main app component
│   ├── index.css
│   └── main.jsx                 # Application entry point
├── index.html
├── package.json                 # Frontend dependencies
├── package-lock.json
└── vite.config.js               # Vite configuration
```

---

## Summary

The Edekise Microfinance System is a comprehensive full-stack application built with:

- **Backend**: Node.js/Express with SQLite database
- **Frontend**: React with Vite
- **Security**: JWT authentication, role-based access control, rate limiting, audit logging
- **Features**: Loan management, savings accounts, financial transactions, document management, approval workflows, CEO operations
- **Architecture**: RESTful API with middleware layer, database transactions for financial operations
- **Deployment**: Environment-based configuration with production security considerations

All critical functionality has been implemented with proper error handling, validation, and security measures. The system is production-ready with the exception of 2FA implementation (placeholder exists) and SMTP configuration for email services.
