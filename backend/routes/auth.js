const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { sendEmail } = require('../utils/emailService');
const { auditLogger } = require('../middleware/auditLogger');
const { validatePasswordComplexity } = require('../utils/passwordValidator');
const {
  validateClientRegistrationFields,
  normalizeEthiopianPhone,
  normalizeNationalId,
  hasEmoji,
  stripEmojis,
  normalizeText,
  normalizeEmail
} = require('../utils/inputValidators');
const { findDuplicateRegistration, duplicateRegistrationMessage } = require('../utils/duplicateRegistration');
const { buildCompanyId } = require('../utils/companyId');
const {
  buildTwoFactorResponse,
  enableUserTwoFactor,
  generate2FASecret,
  getUserTwoFactorState,
  requiresTwoFactor,
  verify2FAToken
} = require('../middleware/twoFactorAuth');

const kycUploadDir = path.join(__dirname, '..', 'uploads', 'kyc');
if (!fs.existsSync(kycUploadDir)) {
  fs.mkdirSync(kycUploadDir, { recursive: true });
}

const publicKycUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, kycUploadDir),
    filename: (req, file, cb) => {
      const safeExt = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `kyc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if ((file.mimetype || '').startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only image files are allowed for KYC uploads'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

const ensureRegistrationRequestSchema = async () => {
  await new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS client_registration_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER,
        full_name TEXT NOT NULL,
        gender TEXT,
        date_of_birth TEXT,
        phone TEXT,
        address TEXT,
        id_number TEXT,
        id_type TEXT,
        id_document TEXT,
        id_document_path TEXT,
        photo_path TEXT,
        monthly_income REAL,
        requested_loan_amount REAL,
        income_source TEXT,
        email TEXT,
        decision TEXT,
        reason TEXT,
        flags TEXT,
        recommended_action TEXT,
        status TEXT DEFAULT 'Pending Admin Review',
        kyc_match_status TEXT DEFAULT 'Pending',
        admin_review_notes TEXT,
        reviewed_at TEXT,
        reviewed_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      (tableErr) => (tableErr ? reject(tableErr) : resolve())
    );
  });

  const safeAlter = async (sql) => new Promise((resolve) => {
    db.run(sql, () => resolve());
  });
  await safeAlter('ALTER TABLE client_registration_requests ADD COLUMN id_document_path TEXT');
  await safeAlter('ALTER TABLE client_registration_requests ADD COLUMN photo_path TEXT');
  await safeAlter("ALTER TABLE client_registration_requests ADD COLUMN kyc_match_status TEXT DEFAULT 'Pending'");
  await safeAlter('ALTER TABLE client_registration_requests ADD COLUMN admin_review_notes TEXT');
  await safeAlter('ALTER TABLE client_registration_requests ADD COLUMN reviewed_at TEXT');
  await safeAlter('ALTER TABLE client_registration_requests ADD COLUMN reviewed_by INTEGER');
};

const createAuthToken = (user, options = {}) => {
  const sessionTimeouts = {
    admin: '1h',
    ceo: '1h',
    branch_manager: '15m',
    loan_staff: '15m',
    saving_staff: '15m',
    client: '30m'
  };

  if (!process.env.JWT_SECRET) {
    throw new Error('Server configuration error: JWT_SECRET not set');
  }

  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      sessionId: options.sessionId || (Date.now() + Math.random()),
      twoFactorVerified: Boolean(options.twoFactorVerified)
    },
    process.env.JWT_SECRET,
    { expiresIn: options.expiresIn || sessionTimeouts[user.role] || '15m' }
  );
};

const createTwoFactorSetupToken = (user, secret) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('Server configuration error: JWT_SECRET not set');
  }

  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      type: 'two_factor_setup',
      secret
    },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
};

const createTwoFactorChallengeToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('Server configuration error: JWT_SECRET not set');
  }

  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      type: 'two_factor_challenge'
    },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
};

const buildRegistrationDecision = ({ payload, duplicateIdNumber = false, duplicatePhone = false }) => {
  const requiredFields = ['full_name', 'gender', 'date_of_birth', 'phone', 'address', 'id_number', 'id_type', 'id_document'];
  const missingFields = requiredFields.filter((field) => {
    const value = payload?.[field];
    return value === undefined || value === null || String(value).trim() === '';
  });

  if (missingFields.length > 0) {
    return {
      decision: 'NEED_MORE_INFO',
      reason: `Missing required fields: ${missingFields.join(', ')}`,
      flags: [`RISK:MISSING_DOCUMENTS:${missingFields.join('|')}`],
      recommended_action: 'Collect all mandatory KYC fields and resubmit.'
    };
  }

  if (!payload.id_number || !payload.id_document) {
    return {
      decision: 'REJECT',
      reason: 'Identity verification failed. ID number and ID document are required.',
      flags: ['RISK:IDENTITY_INCOMPLETE'],
      recommended_action: 'Reject and request valid identity evidence.'
    };
  }

  if (duplicateIdNumber) {
    return {
      decision: 'REJECT',
      reason: 'Duplicate identity detected. ID number already exists.',
      flags: ['RISK:DUPLICATE_ID_NUMBER'],
      recommended_action: 'Reject and escalate to compliance review.'
    };
  }

  const flags = [];
  if (duplicatePhone) {
    flags.push('RISK:DUPLICATE_PHONE');
  }

  const hasIncome = payload.monthly_income !== undefined && payload.monthly_income !== null && String(payload.monthly_income).trim() !== '';
  if (!hasIncome) {
    return {
      decision: 'NEED_MORE_INFO',
      reason: 'Monthly income is required for financial credibility assessment.',
      flags,
      recommended_action: 'Request monthly income details and proof before approval.'
    };
  }

  const monthlyIncome = Number(payload.monthly_income);
  if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) {
    flags.push('RISK:UNREALISTIC_INCOME');
  }

  const requestedLoanAmount = Number(payload.requested_loan_amount || 0);
  if (requestedLoanAmount > 0 && monthlyIncome > 0 && requestedLoanAmount > monthlyIncome * 24) {
    flags.push('RISK:LOW_INCOME_FOR_REQUESTED_LOAN');
  }

  if (flags.length > 0) {
    return {
      decision: 'NEED_MORE_INFO',
      reason: 'Registration has risk indicators and requires enhanced due diligence.',
      flags,
      recommended_action: 'Hold and perform manual compliance verification.'
    };
  }

  return {
    decision: 'APPROVE',
    reason: 'Registration passed baseline KYC, uniqueness, and financial checks.',
    flags: [],
    recommended_action: 'Proceed with admin review and account creation workflow.'
  };
};

// Secondary authentication endpoint for sensitive operations
router.post('/verify-secondary', authenticateToken, async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], async (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid password' });
      }

      res.json({ success: true, message: 'Secondary authentication successful' });
    });
  } catch (error) {
    console.error('Secondary authentication error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Client password change endpoint
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body || {};

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({ error: 'Current password, new password, and confirmation are required' });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'New password and confirmation do not match' });
    }

    const passwordErrors = validatePasswordComplexity(new_password);
    if (passwordErrors.length > 0) {
      return res.status(400).json({
        error: 'Password does not meet complexity requirements',
        details: passwordErrors
      });
    }

    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], async (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (req.user.role !== 'client') {
        return res.status(403).json({ error: 'Only client users can change password here' });
      }

      const isCurrentPasswordValid = await bcrypt.compare(current_password, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      const hashedPassword = await bcrypt.hash(new_password, 12);
      db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id], function(updateErr) {
        if (updateErr) {
          console.error('Password change update error:', updateErr);
          return res.status(500).json({ error: 'Failed to update password' });
        }

        console.log(`[AUDIT] Client ${user.username} changed password at ${new Date().toISOString()}`);
        return res.json({ message: 'Password changed successfully' });
      });
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!user) {
        return res.status(401).json({ error: 'Invalid Username or Password. Please try again.' });
      }

      // Check if account is locked
      if (user.locked_until) {
        const lockedUntil = new Date(user.locked_until);
        if (lockedUntil > new Date()) {
          const minutesLeft = Math.ceil((lockedUntil - new Date()) / 60000);
          return res.status(403).json({ 
            error: 'Account locked due to excessive failed attempts. Contact support.',
            locked: true,
            minutesRemaining: minutesLeft
          });
        } else {
          // Lock expired, reset attempts
          db.run('UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
        }
      }

      // Check password using bcrypt
      const isMatch = await bcrypt.compare(password, user.password);
      
      if (!isMatch) {
        // Increment failed attempts
        const newAttempts = (user.login_attempts || 0) + 1;
        
        if (newAttempts >= 5) {
          // Lock account for 30 minutes
          const lockedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          db.run(
            'UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?',
            [newAttempts, lockedUntil, user.id]
          );
          
          console.log(`[AUDIT] Account locked for ${username} after ${newAttempts} failed attempts at ${new Date().toISOString()}`);
          
          return res.status(403).json({ 
            error: 'Account locked due to excessive failed attempts. Contact support.',
            locked: true
          });
        } else {
          db.run('UPDATE users SET login_attempts = ? WHERE id = ?', [newAttempts, user.id]);
          console.log(`[AUDIT] Failed login attempt ${newAttempts} for ${username} at ${new Date().toISOString()}`);
        }
        
        return res.status(401).json({ error: 'Invalid Username or Password. Please try again.' });
      }

      // Successful login - reset attempts
      db.run('UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);

      if (requiresTwoFactor(user.role)) {
        const twoFactorState = await getUserTwoFactorState(user.id);

        if (!twoFactorState.enabled || !twoFactorState.secret) {
          const setup = generate2FASecret(user.username);
          const setupToken = createTwoFactorSetupToken(user, setup.secret);

          return res.status(200).json(
            buildTwoFactorResponse(
              'setup',
              {
                secret: setup.secret,
                otpauthUrl: setup.otpauthUrl,
                message: 'Set up an authenticator app and enter the 6-digit code to finish sign-in.'
              },
              setupToken
            )
          );
        }

        const challengeToken = createTwoFactorChallengeToken(user);
        return res.status(200).json({
          requiresTwoFactor: true,
          twoFactorMode: 'verify',
          challengeToken
        });
      }

      const sessionId = String(Date.now() + Math.random());
      const token = createAuthToken(user, { sessionId });

      // server-side session binding (single-session invalidation)
      db.run(
        'UPDATE users SET session_id = ?, last_login = CURRENT_TIMESTAMP, last_seen = CURRENT_TIMESTAMP, login_attempts = 0, locked_until = NULL WHERE id = ?',
        [sessionId, user.id],
        (updateErr) => {
          if (updateErr) {
            console.error('Failed to update user session metadata:', updateErr);
          }
        }
      );

      if (!user.company_id) {
        const companyId = buildCompanyId(user.role, user.id);
        db.run('UPDATE users SET company_id = ? WHERE id = ?', [companyId, user.id], (companyErr) => {
          if (companyErr) {
            console.error('Failed to backfill company_id:', companyErr);
          }
        });
        user.company_id = companyId;
      }

      // Log audit trail
      console.log(`[AUDIT] User ${username} logged in at ${new Date().toISOString()}`);

      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          name: user.name,
          company_id: user.company_id || null
        }
      });
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/2fa/setup/verify', async (req, res) => {
  try {
    const { setupToken, token } = req.body;

    if (!setupToken || !token) {
      return res.status(400).json({ error: 'Setup token and authentication code are required' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'Server configuration error: JWT_SECRET not set' });
    }

    const payload = jwt.verify(setupToken, process.env.JWT_SECRET);
    if (payload.type !== 'two_factor_setup' || !requiresTwoFactor(payload.role)) {
      return res.status(400).json({ error: 'Invalid two-factor setup token' });
    }

    if (!verify2FAToken(payload.secret, token)) {
      return res.status(400).json({ error: 'Invalid two-factor authentication code' });
    }

    const enabled = await enableUserTwoFactor(payload.id, payload.secret);
    if (!enabled) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, username, role, name FROM users WHERE id = ?',
        [payload.id],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    const authToken = createAuthToken(user, { twoFactorVerified: true });
    console.log(`[AUDIT] User ${user.username} completed 2FA setup at ${new Date().toISOString()}`);

    return res.json({
      message: 'Two-factor authentication enabled successfully',
      token: authToken,
      user
    });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired setup token' });
    }

    console.error('2FA setup verification error:', error);
    return res.status(500).json({ error: 'Failed to verify two-factor setup' });
  }
});

router.post('/2fa/verify', async (req, res) => {
  try {
    const { challengeToken, token } = req.body;

    if (!challengeToken || !token) {
      return res.status(400).json({ error: 'Challenge token and authentication code are required' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'Server configuration error: JWT_SECRET not set' });
    }

    const payload = jwt.verify(challengeToken, process.env.JWT_SECRET);
    if (payload.type !== 'two_factor_challenge' || !requiresTwoFactor(payload.role)) {
      return res.status(400).json({ error: 'Invalid two-factor challenge token' });
    }

    const twoFactorState = await getUserTwoFactorState(payload.id);
    if (!twoFactorState.enabled || !twoFactorState.secret) {
      return res.status(403).json({ error: 'Two-factor authentication setup required' });
    }

    if (!verify2FAToken(twoFactorState.secret, token)) {
      return res.status(400).json({ error: 'Invalid two-factor authentication code' });
    }

    const user = {
      id: payload.id,
      username: payload.username,
      role: payload.role,
      name: payload.name
    };

    const authToken = createAuthToken(user, { twoFactorVerified: true });
    console.log(`[AUDIT] User ${user.username} completed 2FA verification at ${new Date().toISOString()}`);

    return res.json({
      message: 'Two-factor authentication verified successfully',
      token: authToken,
      user
    });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired challenge token' });
    }

    console.error('2FA verification error:', error);
    return res.status(500).json({ error: 'Failed to verify two-factor authentication' });
  }
});

// Register endpoint (for admin to create users with hashed passwords)
router.post('/register', auditLogger('USER_REGISTRATION'), async (req, res) => {
  try {
    const { name, username, password, role } = req.body;

    if (!name || !username || !password || !role) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate password complexity
    const passwordErrors = validatePasswordComplexity(password);
    if (passwordErrors.length > 0) {
      return res.status(400).json({ 
        error: 'Password does not meet complexity requirements',
        details: passwordErrors
      });
    }

    // Hash the password with increased work factor for security
    const hashedPassword = await bcrypt.hash(password, 12);

    const normalizedUsername = String(username).trim();
    const normalizedName = String(name).trim();
    const normalizedRole = String(role).trim();

    const duplicate = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM users WHERE username = ? OR (lower(name) = lower(?) AND role = ?)`,
        [normalizedUsername, normalizedName, normalizedRole],
        (err, row) => (err ? reject(err) : resolve(Boolean(row)))
      );
    });

    if (duplicate) {
      return res.status(409).json({ error: 'Duplicate user detected. Username or name already exists for this role.' });
    }

    db.run(
      'INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)',
      [normalizedName, normalizedUsername, hashedPassword, normalizedRole],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: 'Database error' });
        }
        
        console.log(`[AUDIT] User registered: ${username} by admin at ${new Date().toISOString()}`);

        const companyId = buildCompanyId(normalizedRole, this.lastID);
        db.run('UPDATE users SET company_id = ? WHERE id = ?', [companyId, this.lastID], (companyErr) => {
          if (companyErr) {
            console.error('Failed to set company_id:', companyErr);
          }
        });
        
        res.status(201).json({
          message: 'User registered successfully',
          user: {
            id: this.lastID,
            name,
            username,
            role,
            company_id: companyId
          }
        });
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public client registration from landing page (home onboarding)
router.post('/client-register', publicKycUpload.fields([
  { name: 'id_document_file', maxCount: 1 },
  { name: 'profile_photo_file', maxCount: 1 }
]), async (req, res) => {
  try {
    await ensureRegistrationRequestSchema();

    const payload = req.body || {};
    const idDocumentFile = req.files?.id_document_file?.[0] || null;
    const profilePhotoFile = req.files?.profile_photo_file?.[0] || null;
    const idDocumentPath = idDocumentFile ? `/uploads/kyc/${idDocumentFile.filename}` : '';
    const profilePhotoPath = profilePhotoFile ? `/uploads/kyc/${profilePhotoFile.filename}` : '';
    const {
      full_name,
      gender,
      date_of_birth,
      phone,
      address,
      id_number,
      id_type,
      id_document: idDocumentText,
      monthly_income,
      requested_loan_amount,
      email,
      income_source
    } = payload;
    const normalizedFullName = normalizeText(full_name);
    const validation = validateClientRegistrationFields({
      ...payload,
      full_name,
      id_number,
      id_type
    });
    if (validation.errors.length > 0) {
      return res.status(400).json({ error: validation.errors[0], details: validation.errors });
    }

    const normalizedEmail = validation.normalized.email;
    const normalizedPhone = validation.normalized.phone;
    const normalizedIdNumber = validation.normalized.id_number;

    const duplicateFlags = await findDuplicateRegistration({
      name: normalizedFullName,
      email: normalizedEmail,
      phone: normalizedPhone,
      id_number: normalizedIdNumber,
      id_type
    });

    if (duplicateFlags.length > 0) {
      return res.status(409).json({
        decision: 'REJECT',
        reason: duplicateRegistrationMessage(duplicateFlags),
        flags: duplicateFlags.map((f) => `RISK:${f}`),
        recommended_action: 'Use existing client profile or correct duplicate identity fields.'
      });
    }

    const duplicateIdNumber = duplicateFlags.some((f) => f.includes('ID'));
    const duplicatePhone = duplicateFlags.some((f) => f.includes('PHONE'));

    const review = buildRegistrationDecision({
      payload: {
        ...payload,
        id_document: idDocumentText || idDocumentPath,
        phone: normalizedPhone,
        email: normalizedEmail,
        id_number: normalizedIdNumber
      },
      duplicateIdNumber,
      duplicatePhone
    });

    if (review.decision === 'REJECT') {
      return res.status(422).json(review);
    }

    const initialKycStatus = review.decision === 'APPROVE' ? 'Verified' : 'Pending';
    const createdClientId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO clients
         (name, email, phone, address, gender, id_number, income_source, kyc_status, kyc_verified_at, status, photo_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          full_name,
          normalizedEmail || null,
          normalizedPhone,
          address || null,
          gender || null,
          normalizedIdNumber,
          income_source || null,
          initialKycStatus,
          initialKycStatus === 'Verified' ? new Date().toISOString() : null,
          'Pending Admin Approval',
          profilePhotoPath || null
        ],
        function onInsert(err) {
          if (err) {
            if (err.message.includes('UNIQUE')) {
              return reject(new Error('A similar registration already exists.'));
            }
            return reject(err);
          }
          resolve(this.lastID);
        }
      );
    });

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO client_registration_requests
         (client_id, full_name, gender, date_of_birth, phone, address, id_number, id_type, id_document, id_document_path, photo_path, monthly_income, requested_loan_amount, income_source, email, decision, reason, flags, recommended_action)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createdClientId,
          full_name,
          gender || null,
          date_of_birth || null,
          normalizedPhone,
          address || null,
          normalizedIdNumber,
          id_type || null,
          idDocumentText || idDocumentPath || null,
          idDocumentPath || null,
          profilePhotoPath || null,
          Number(monthly_income || 0),
          Number(requested_loan_amount || 0),
          income_source || null,
          email || null,
          review.decision,
          review.reason,
          JSON.stringify(review.flags || []),
          review.recommended_action
        ],
        (insertErr) => (insertErr ? reject(insertErr) : resolve())
      );
    });

    if (normalizedEmail) {
      const applicantSubject = 'Registration Submitted - Edekise Microfinance';
      const applicantText = [
        `Dear ${full_name},`,
        '',
        'Your registration was submitted successfully and is now waiting for admin review.',
        `Current status: Pending Admin Approval.`,
        '',
        'We will contact you once your application has been reviewed.',
        '',
        'Edekise Microfinance'
      ].join('\n');
      await sendEmail(normalizedEmail, applicantSubject, applicantText);
    }

    db.all(
      "SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL AND trim(email) <> ''",
      [],
      async (emailErr, admins) => {
        if (emailErr || !Array.isArray(admins) || admins.length === 0) return;
        const adminSubject = `New Client Registration - ${full_name}`;
        const adminText = [
          `A new public client registration was submitted.`,
          `Name: ${full_name}`,
          `Phone: ${normalizedPhone}`,
          `Email: ${normalizedEmail || 'Not provided'}`,
          `Requested loan amount: ${Number(requested_loan_amount || 0).toLocaleString()} ETB`,
          `Decision hint: ${review.decision}`,
          `Review reason: ${review.reason}`
        ].join('\n');

        for (const admin of admins) {
          try {
            await sendEmail(admin.email, adminSubject, adminText);
          } catch (sendErr) {
            console.warn('Failed to notify admin about registration submission:', sendErr?.message || sendErr);
          }
        }
      }
    );

      // Note: registration review is driven by `client_registration_requests` queue (admin page).
      // We intentionally do not create a separate approval_request here to avoid schema coupling.

      return res.status(201).json({
        message: 'Registration submitted successfully. An admin will review your application.',
        tracking_status: 'Pending Admin Approval',
        review
      });
  } catch (error) {
    console.error('Public client registration error:', error);
    return res.status(500).json({
      decision: 'NEED_MORE_INFO',
      reason: 'Internal system error while submitting registration.',
      flags: ['RISK:SUBMISSION_INTERNAL_ERROR'],
      recommended_action: 'Try again later or contact support.'
    });
  }
});

// Logout endpoint (UC-A-002)
router.post('/logout', authenticateToken, auditLogger('LOGOUT'), (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;

  // Log audit trail
  console.log(`[AUDIT] User ${username} (ID: ${userId}) logged out at ${new Date().toISOString()}`);

  // Invalidate current session so the token cannot be reused.
  db.run('UPDATE users SET session_id = NULL WHERE id = ?', [userId], (err) => {
    if (err) {
      console.error('Logout session invalidation error:', err);
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ message: 'Logout successful' });
  });
});

// Verify token endpoint
router.get('/verify', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'Server configuration error: JWT_SECRET not set' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Unlock account endpoint (admin only)
router.post('/unlock/:username', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { username } = req.params;
  const adminId = req.user.id;
  const adminUsername = req.user.username;

  const requestedUsername = String(username || '').trim();
  if (!requestedUsername) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    const unlockedResult = await new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET login_attempts = 0, locked_until = NULL WHERE username = ?',
        [requestedUsername],
        function unlockCb(err) {
          if (err) return reject(err);
          resolve({ changes: this.changes || 0 });
        }
      );
    });

    if (unlockedResult.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Mark the latest pending unlock request (if any) as approved.
    const pendingRequest = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, requested_user_email FROM account_unlock_requests WHERE username = ? AND status = ? ORDER BY requested_at DESC LIMIT 1',
        [requestedUsername, 'Pending'],
        (err, row) => (err ? reject(err) : resolve(row || null))
      );
    });

    const nowIso = new Date().toISOString();
    if (pendingRequest?.id) {
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE account_unlock_requests SET status = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = NULL WHERE id = ?',
          ['Approved', nowIso, adminId, pendingRequest.id],
          (err) => (err ? reject(err) : resolve())
        );
      });

      // Best-effort completion email to the requester.
      if (pendingRequest.requested_user_email) {
        const subject = `Account Unlocked - ${requestedUsername}`;
        const text = `Hello,\n\nYour account (${requestedUsername}) has been unlocked by an administrator at ${nowIso}.\n\nIf this was not intended, please contact support.\n`;
        await sendEmail(pendingRequest.requested_user_email, subject, text);
      }
    }

    // Audit event
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO audit_trail (action, entity_type, entity_id, user_id, user_role, details, timestamp, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'ACCOUNT_UNLOCKED',
          'user',
          requestedUsername,
          adminId,
          'admin',
          JSON.stringify({ username: requestedUsername }),
          nowIso,
          'Success'
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    console.log(`[AUDIT] Account unlocked for ${requestedUsername} by ${adminUsername} at ${nowIso}`);
    res.json({ message: 'Account unlocked successfully' });
  } catch (error) {
    console.error('Account unlock error:', error);
    res.status(500).json({ error: 'Failed to unlock account' });
  }
});

// Account unlock request endpoint (for locked users)
router.post('/unlock-request', async (req, res) => {
  const { username, contact, reason } = req.body || {};
  const normalizedUsername = String(username || '').trim();
  const normalizedContact = contact ? String(contact).trim() : null;
  const normalizedReason = reason ? String(reason).trim() : null;

  if (!normalizedUsername) {
    return res.status(400).json({ error: 'Username is required to request account unlock.' });
  }

  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id, username, name, email, locked_until FROM users WHERE username = ?', [normalizedUsername], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (!user.locked_until) {
      return res.status(400).json({ error: 'Account is not locked. Unlock request is not required.' });
    }

    // Idempotency: prevent spamming multiple pending requests for the same username.
    const existingPending = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id FROM account_unlock_requests WHERE username = ? AND status = ? ORDER BY requested_at DESC LIMIT 1',
        [normalizedUsername, 'Pending'],
        (err, row) => (err ? reject(err) : resolve(row || null))
      );
    });

    if (existingPending?.id) {
      return res.json({
        message: 'Unlock request already submitted. Admin will review it shortly.',
        request_id: existingPending.id
      });
    }

    const unlockRequestId = `UR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nowIso = new Date().toISOString();

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO account_unlock_requests
          (id, username, requested_user_id, requested_user_email, requested_user_name, contact, status, reason, lock_until, requested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          unlockRequestId,
          user.username,
          user.id,
          user.email || null,
          user.name || null,
          normalizedContact,
          'Pending',
          normalizedReason,
          user.locked_until,
          nowIso
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    db.all(
      "SELECT email, username FROM users WHERE role = 'admin' AND email IS NOT NULL",
      [],
      async (emailErr, admins) => {
        if (emailErr || !Array.isArray(admins)) return;
        const subject = `Account Unlock Request: ${user.username}`;
        const body = `User ${user.username} (${user.name || 'N/A'}) requested account unlock.\nLocked until: ${user.locked_until || 'N/A'}\nContact: ${normalizedContact || user.email || 'N/A'}\nRequest ID: ${unlockRequestId}`;
        for (const admin of admins) {
          try {
            await sendEmail(admin.email, subject, body);
          } catch (sendErr) {
            console.warn('Failed to notify admin for unlock request:', sendErr?.message || sendErr);
          }
        }
      }
    );

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO audit_trail (action, entity_type, entity_id, user_id, user_role, details, timestamp, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'ACCOUNT_UNLOCK_REQUESTED',
          'user',
          unlockRequestId,
          user.id,
          'user',
          JSON.stringify({
            username: user.username,
            contact: normalizedContact,
            request_id: unlockRequestId
          }),
          nowIso,
          'Success'
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    return res.json({
      message: 'Unlock request submitted successfully. Admin will review and unlock your account.',
      request_id: unlockRequestId
    });
  } catch (error) {
    console.error('Unlock request error:', error);
    return res.status(500).json({ error: 'Failed to submit unlock request.' });
  }
});

// Admin: list pending unlock requests
router.get('/unlock-requests/pending', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const pending = await new Promise((resolve, reject) => {
      db.all(
        `SELECT
          id,
          username,
          requested_user_email,
          requested_user_name,
          contact,
          reason,
          lock_until,
          status,
          requested_at,
          reviewed_at,
          reviewed_by,
          rejection_reason
        FROM account_unlock_requests
        WHERE status = 'Pending'
        ORDER BY requested_at DESC`,
        [],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });

    res.json({ count: pending.length, requests: pending });
  } catch (error) {
    console.error('Pending unlock request fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch pending unlock requests' });
  }
});

// Admin: approve unlock request
router.post('/unlock-requests/:id/approve', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  const adminId = req.user.id;
  const adminUsername = req.user.username;

  const requestId = String(id || '').trim();
  if (!requestId) {
    return res.status(400).json({ error: 'Request id is required' });
  }

  try {
    const request = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM account_unlock_requests WHERE id = ?`,
        [requestId],
        (err, row) => (err ? reject(err) : resolve(row || null))
      );
    });

    if (!request) {
      return res.status(404).json({ error: 'Unlock request not found' });
    }

    if (request.status !== 'Pending') {
      return res.status(409).json({ error: `Unlock request is not pending (status: ${request.status})` });
    }

    const nowIso = new Date().toISOString();

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE account_unlock_requests
         SET status = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = NULL
         WHERE id = ?`,
        ['Approved', nowIso, adminId, requestId],
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Unlock account
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET login_attempts = 0, locked_until = NULL WHERE username = ?',
        [request.username],
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Completion email (best-effort)
    if (request.requested_user_email) {
      const subject = `Account Unlocked - ${request.username}`;
      const text = `Hello,\n\nYour account (${request.username}) has been unlocked by an administrator at ${nowIso}.\n\nIf this was not intended, please contact support.\n`;
      await sendEmail(request.requested_user_email, subject, text);
    }

    // Audit event
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO audit_trail (action, entity_type, entity_id, user_id, user_role, details, timestamp, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'ACCOUNT_UNLOCK_APPROVED',
          'account_unlock_request',
          requestId,
          adminId,
          'admin',
          JSON.stringify({ request_id: requestId, username: request.username, approved_by: adminUsername }),
          nowIso,
          'Success'
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    res.json({ message: 'Unlock request approved and account unlocked' });
  } catch (error) {
    console.error('Unlock approval error:', error);
    res.status(500).json({ error: 'Failed to approve unlock request' });
  }
});

// Admin: reject unlock request
router.post('/unlock-requests/:id/reject', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  const adminId = req.user.id;
  const adminUsername = req.user.username;
  const { reason } = req.body || {};

  const requestId = String(id || '').trim();
  const normalizedReason = reason ? String(reason).trim() : null;

  if (!requestId) {
    return res.status(400).json({ error: 'Request id is required' });
  }

  try {
    const request = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM account_unlock_requests WHERE id = ?`,
        [requestId],
        (err, row) => (err ? reject(err) : resolve(row || null))
      );
    });

    if (!request) {
      return res.status(404).json({ error: 'Unlock request not found' });
    }

    if (request.status !== 'Pending') {
      return res.status(409).json({ error: `Unlock request is not pending (status: ${request.status})` });
    }

    const nowIso = new Date().toISOString();

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE account_unlock_requests
         SET status = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = ?
         WHERE id = ?`,
        ['Rejected', nowIso, adminId, normalizedReason, requestId],
        (err) => (err ? reject(err) : resolve())
      );
    });

    if (request.requested_user_email) {
      const subject = `Account Unlock Request Rejected - ${request.username}`;
      const text = `Hello,\n\nWe reviewed your account unlock request (${request.username}). Unfortunately, it was rejected.\n\nReason: ${normalizedReason || 'Not provided'}\n\nYou may contact support if you have questions.\n`;
      await sendEmail(request.requested_user_email, subject, text);
    }

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO audit_trail (action, entity_type, entity_id, user_id, user_role, details, timestamp, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'ACCOUNT_UNLOCK_REJECTED',
          'account_unlock_request',
          requestId,
          adminId,
          'admin',
          JSON.stringify({ request_id: requestId, username: request.username, rejected_by: adminUsername, rejection_reason: normalizedReason }),
          nowIso,
          'Success'
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    res.json({ message: 'Unlock request rejected' });
  } catch (error) {
    console.error('Unlock rejection error:', error);
    res.status(500).json({ error: 'Failed to reject unlock request' });
  }
});

// Reset seed users endpoint (development only - removes all users and re-seeds)
// No authentication required for development convenience
router.post('/reset-seed-users', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'This endpoint is not available in production' });
  }

  try {
    // Delete all existing users
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM users', (deleteErr) => {
        if (deleteErr) {
          console.error('Error deleting users:', deleteErr);
          return reject(deleteErr);
        }
        resolve();
      });
    });

    // Re-seed from environment-provided credentials only
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
      return res.status(400).json({ error: 'No seed users were configured in environment variables' });
    }

    const bcrypt = require('bcryptjs');

    for (const user of usersWithPasswords) {
      const hashedPassword = await bcrypt.hash(user.password, 12);
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)',
          [user.name, user.username, hashedPassword, user.role],
          (err) => {
            if (err) {
              console.error('Error seeding user:', err);
              return reject(err);
            }
            resolve();
          }
        );
      });
    }

    console.log(`[AUDIT] Seed users reset successfully at ${new Date().toISOString()}`);
    res.json({ 
      message: 'Seed users reset successfully',
      users: usersWithPasswords.map(u => ({ username: u.username, role: u.role }))
    });
  } catch (error) {
    console.error('Reset seed users error:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Diagnostic endpoint to list users (development only)
router.get('/list-users', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'This endpoint is not available in production' });
  }

  db.all('SELECT id, name, username, role, status FROM users', [], (err, users) => {
    if (err) {
      console.error('Error listing users:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ count: users.length, users });
  });
});

module.exports = router;
