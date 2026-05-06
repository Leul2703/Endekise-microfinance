const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { auditLogger } = require('../middleware/auditLogger');
const { validatePasswordComplexity } = require('../utils/passwordValidator');
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

const normalizeText = (value) => String(value || '').trim();
const normalizeEmail = (value) => normalizeText(value).toLowerCase();
const normalizePhone = (value) => normalizeText(value);

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
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);
    const normalizedIdNumber = normalizeText(id_number);

    const duplicateName = normalizedFullName
      ? await new Promise((resolve, reject) => {
          db.get('SELECT id FROM clients WHERE lower(name) = lower(?)', [normalizedFullName], (err, row) => {
            if (err) reject(err);
            else resolve(Boolean(row));
          });
        })
      : false;

    const duplicateEmail = normalizedEmail
      ? await new Promise((resolve, reject) => {
          db.get('SELECT id FROM clients WHERE lower(email) = ?', [normalizedEmail], (err, row) => {
            if (err) reject(err);
            else resolve(Boolean(row));
          });
        })
      : false;

    const duplicateIdNumber = id_number
      ? await new Promise((resolve, reject) => {
          db.get('SELECT id FROM clients WHERE id_number = ?', [id_number], (err, row) => {
            if (err) reject(err);
            else resolve(Boolean(row));
          });
        })
      : false;

    const duplicatePhone = phone
      ? await new Promise((resolve, reject) => {
          db.get('SELECT id FROM clients WHERE phone = ?', [phone], (err, row) => {
            if (err) reject(err);
            else resolve(Boolean(row));
          });
        })
      : false;

    if (duplicateName || duplicateEmail || duplicatePhone || duplicateIdNumber) {
      return res.status(409).json({
        decision: 'REJECT',
        reason: 'Duplicate registration detected. Client name, email, phone, or ID already exists.',
        flags: [
          duplicateName ? 'RISK:DUPLICATE_NAME' : null,
          duplicateEmail ? 'RISK:DUPLICATE_EMAIL' : null,
          duplicatePhone ? 'RISK:DUPLICATE_PHONE' : null,
          duplicateIdNumber ? 'RISK:DUPLICATE_ID_NUMBER' : null
        ].filter(Boolean),
        recommended_action: 'Use existing client profile or correct duplicate identity fields.'
      });
    }

    const review = buildRegistrationDecision({
      payload: {
        ...payload,
        id_document: idDocumentText || idDocumentPath
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
          normalizedPhone || null,
          address || null,
          gender || null,
          normalizedIdNumber || null,
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
          phone || null,
          address || null,
          id_number || null,
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
router.post('/unlock/:username', async (req, res) => {
  const { username } = req.params;

  db.run(
    'UPDATE users SET login_attempts = 0, locked_until = NULL WHERE username = ?',
    [username],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      console.log(`[AUDIT] Account unlocked for ${username} at ${new Date().toISOString()}`);
      
      res.json({ message: 'Account unlocked successfully' });
    }
  );
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
