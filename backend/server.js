require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { initializationPromise } = require('./config/database');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/users');
const clientRoutes = require('./routes/clients');
const loanRoutes = require('./routes/loans');
const savingsRoutes = require('./routes/savings');
const documentRoutes = require('./routes/documents');
const approvalRoutes = require('./routes/approvals');
const auditRoutes = require('./routes/audit');
const transactionRoutes = require('./routes/transactions');
const branchRoutes = require('./routes/branches');
const paymentScheduleRoutes = require('./routes/paymentSchedule');
const statementRoutes = require('./routes/statements');
const ceoRoutes = require('./routes/ceo');
const updateRoutes = require('./routes/updates');
const passwordResetRoutes = require('./routes/passwordReset');
const requestRoutes = require('./routes/requests');
const inclusiveRoutes = require('./routes/inclusive');
const syncRoutes = require('./routes/sync');
const reportsRoutes = require('./routes/reports');
const mobileMoneyRoutes = require('./routes/mobile-money');
const { rateLimiters } = require('./middleware/rateLimiter');
const { Server } = require('socket.io');
const { setSocketServer } = require('./utils/realtime');

// Initialize reminder scheduler
require('./scheduler/reminderScheduler');

// Initialize interest calculation scheduler
require('./scheduler/interestScheduler');

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('[CONFIG] Missing required environment variables:', missingEnvVars.join(', '));
  console.error('[CONFIG] Please set these variables in your .env file and restart the server.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173', process.env.FRONTEND_URL].filter(Boolean),
    credentials: true
  }
});

setSocketServer(io);
io.on('connection', (socket) => {
  console.log(`[SOCKET] Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[SOCKET] Client disconnected: ${socket.id}`);
  });
});

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // allow normal in-app navigation without accidental throttling
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 login attempts per windowMs (increased for testing)
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
  frameguard: { action: 'deny' }
}));
// CORS configuration - allow both localhost:3000 and localhost:5173 for development
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', process.env.FRONTEND_URL].filter(Boolean),
  credentials: true
}));
app.use(limiter);
app.use(cookieParser({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict'
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined'));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Routes with endpoint-specific rate limiting
// Temporarily disabled strict rate limiting on login for development
// app.use('/api/auth/login', rateLimiters.auth);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/admin', rateLimiters.admin, adminRoutes);
app.use('/api/password-reset', rateLimiters.auth, passwordResetRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/loans', rateLimiters.financial, loanRoutes);
app.use('/api/savings', rateLimiters.financial, savingsRoutes);
// Expose lightweight dev endpoints when running in development mode
if (process.env.NODE_ENV !== 'production') {
  try {
    const devRoutes = require('./routes/dev');
    app.use('/api/dev', devRoutes);
    console.log('[DEV] Dev routes mounted at /api/dev');
  } catch (e) {
    console.warn('[DEV] Failed to mount dev routes:', e.message || e);
  }
}
app.use('/api/documents', rateLimiters.upload, documentRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/transactions', rateLimiters.financial, transactionRoutes);
app.use('/api/branches', rateLimiters.read, branchRoutes);
app.use('/api/payment-schedule', rateLimiters.financial, paymentScheduleRoutes);
app.use('/api/statements', rateLimiters.read, statementRoutes);
app.use('/api/ceo', rateLimiters.admin, ceoRoutes);
app.use('/api/updates', updateRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/inclusive', inclusiveRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/mobile-money', rateLimiters.financial, mobileMoneyRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Edekise Microfinance API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth/*',
      users: '/api/users/*',
      loans: '/api/loans/*',
      savings: '/api/savings/*',
      documents: '/api/documents/*',
      approvals: '/api/approvals/*',
      audit: '/api/audit/*',
      transactions: '/api/transactions/*',
      branches: '/api/branches/*',
      paymentSchedule: '/api/payment-schedule/*',
      statements: '/api/statements/*',
      advancePayment: '/api/payment-schedule/advance-payment',
      csrfToken: '/api/csrf-token',
      loanSetup: '/api/loans/setup',
      escalatePolicy: '/api/loans/escalate-policy/:loanId',
      escalateToCEO: '/api/loans/:id/escalate-ceo',
      statements: '/api/statements/*',
      loanStatementRequest: '/api/statements/loan/request',
      savingsStatementRequest: '/api/statements/savings/request',
      statementApprovals: '/api/statements/approvals/pending',
      authorizeStatement: '/api/statements/:id/authorize',
      rejectStatement: '/api/statements/:id/reject',
      submitSavingsApproval: '/api/savings/:id/submit-approval',
      ceoBalanceAdjustment: '/api/ceo/balance-adjustment',
      ceoPreviewAdjustment: '/api/ceo/balance-adjustment/preview',
      ceoPendingApprovals: '/api/ceo/approvals/pending',
      approveBranchRequest: '/api/ceo/approvals/:requestId/approve',
      rejectBranchRequest: '/api/ceo/approvals/:requestId/reject',
      ceoReports: '/api/ceo/reports',
      deleteUser: '/api/users/:id',
      updateRequest: '/api/updates/request',
      myUpdateRequests: '/api/updates/my-requests',
      pendingUpdateRequests: '/api/updates/pending',
      approveUpdateRequest: '/api/updates/:id/approve',
      rejectUpdateRequest: '/api/updates/:id/reject',
      uploadLoanDocument: '/api/documents/upload',
      logout: '/api/auth/logout',
      branchDetails: '/api/branches/:id'
    },
    security: {
      rateLimit: '100 requests per 15 minutes',
      authRateLimit: '5 login attempts per 15 minutes',
      csrfProtection: 'Available via /api/csrf-token'
    },
    policyLimits: {
      maxPrincipal: 500000,
      maxInterestRate: 25,
      minInterestRate: 5
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  
  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File size exceeds limit' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field' });
  }
  
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }
  
  // Database errors
  if (err.code === 'SQLITE_CONSTRAINT') {
    return res.status(409).json({ error: 'Resource already exists' });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Resource already exists' });
  }
  
  // Generic error
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server only after the database connection is ready
initializationPromise
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  })
  .catch((error) => {
    console.error('[STARTUP] Database initialization failed. Server not started.');
    console.error(error);
    process.exit(1);
  });
