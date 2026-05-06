const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { assertClientKycEligible } = require('../utils/compliance');
const { recordAuditEvent } = require('../utils/auditTrail');
const { withTransaction } = require('../utils/transactionWrapper');
const { sendEmail } = require('../utils/emailService');

// Generate account ID
const generateAccountId = (type) => {
  const prefix = type === 'savings' ? 'SA' : 'LA';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

const buildClientUsername = (fullName, clientId) => {
  const base = String(fullName || 'client')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 18) || 'client';
  return `${base}.${clientId}`;
};

const generateTemporaryPassword = () => `Cli-${crypto.randomBytes(6).toString('base64url')}`;

const normalizeText = (value) => String(value || '').trim();
const normalizeEmail = (value) => normalizeText(value).toLowerCase();
const normalizePhone = (value) => normalizeText(value);

const isPasswordUsed = async (plainPassword) => {
  if (!plainPassword) return false;
  const userRows = await new Promise((resolve, reject) => {
    db.all('SELECT password FROM users', [], (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
  for (const row of userRows) {
    if (!row?.password) continue;
    // Enforce unique temporary passwords across users.
    const matched = await bcrypt.compare(plainPassword, row.password);
    if (matched) return true;
  }
  return false;
};

const ensureClientUserCredentials = async (client) => {
  if (!client) {
    return { username: null, temporaryPassword: null, created: false };
  }

  const normalizedClientName = normalizeText(client.name);
  const normalizedClientEmail = normalizeEmail(client.email);
  const normalizedClientPhone = normalizePhone(client.phone);

  const existingClientUser = await new Promise((resolve, reject) => {
    db.get(
      "SELECT * FROM users WHERE role = 'client' AND (email = ? OR phone = ? OR name = ?)",
      [normalizedClientEmail || null, normalizedClientPhone || null, normalizedClientName || null],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });

  if (existingClientUser) {
    return { username: existingClientUser.username, temporaryPassword: null, created: false };
  }

  const baseUsername = buildClientUsername(client.name, client.id);
  let candidateUsername = baseUsername;
  let suffix = 1;
  while (true) {
    const usernameExists = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM users WHERE username = ?', [candidateUsername], (err, row) => {
        if (err) reject(err);
        else resolve(Boolean(row));
      });
    });
    if (!usernameExists) break;
    candidateUsername = `${baseUsername}${suffix}`;
    suffix += 1;
  }

  let temporaryPassword = generateTemporaryPassword();
  while (await isPasswordUsed(temporaryPassword)) {
    temporaryPassword = generateTemporaryPassword();
  }
  const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
  await new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO users (name, username, email, password, role, phone, status)
       VALUES (?, ?, ?, ?, 'client', ?, 'Active')`,
      [normalizedClientName || client.name, candidateUsername, normalizedClientEmail || null, hashedPassword, normalizedClientPhone || null],
      (err) => (err ? reject(err) : resolve())
    );
  });
  // Persist generated username back to clients table when possible (best-effort)
  try {
    db.run('ALTER TABLE clients ADD COLUMN username TEXT', () => {
      // ignore errors (column may already exist)
      db.run('UPDATE clients SET username = ? WHERE id = ?', [candidateUsername, client.id], () => {});
    });
  } catch (e) {
    // non-fatal
  }

  return { username: candidateUsername, temporaryPassword, created: true };
};

const ensureRegistrationRequestCredentialColumns = async () => {
  const safeAlter = async (sql) => new Promise((resolve) => {
    db.run(sql, () => resolve());
  });
  await safeAlter('ALTER TABLE client_registration_requests ADD COLUMN generated_username TEXT');
  await safeAlter('ALTER TABLE client_registration_requests ADD COLUMN generated_temporary_password TEXT');
  await safeAlter('ALTER TABLE client_registration_requests ADD COLUMN credentials_sent_at TEXT');
};

module.exports = module.exports || {};
module.exports.ensureClientUserCredentials = ensureClientUserCredentials;
module.exports.ensureRegistrationRequestCredentialColumns = ensureRegistrationRequestCredentialColumns;

const buildRegistrationDecision = ({ payload, duplicateIdNumber = false, duplicatePhone = false }) => {
  const flags = [];
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
      recommended_action: 'Collect all mandatory KYC fields and resubmit the registration.'
    };
  }

  if (!payload.id_number || !payload.id_document) {
    return {
      decision: 'REJECT',
      reason: 'Identity verification failed. ID number and ID document are required.',
      flags: ['RISK:IDENTITY_INCOMPLETE'],
      recommended_action: 'Reject registration and request valid identity evidence.'
    };
  }

  if (duplicateIdNumber) {
    return {
      decision: 'REJECT',
      reason: 'ID number already exists. Duplicate identity is not allowed.',
      flags: ['RISK:DUPLICATE_ID_NUMBER'],
      recommended_action: 'Reject and escalate for compliance/fraud review.'
    };
  }

  if (duplicatePhone) {
    flags.push('RISK:DUPLICATE_PHONE');
  }

  const hasIncome = payload.monthly_income !== undefined && payload.monthly_income !== null && String(payload.monthly_income).trim() !== '';
  if (!hasIncome) {
    return {
      decision: 'NEED_MORE_INFO',
      reason: 'Monthly income is required for financial credibility checks.',
      flags,
      recommended_action: 'Request monthly income proof before admin approval.'
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
      reason: 'Registration contains risk indicators that require additional verification.',
      flags,
      recommended_action: 'Collect supporting documents and perform manual compliance review before approval.'
    };
  }

  return {
    decision: 'APPROVE',
    reason: 'Registration passed required KYC, identity uniqueness, and baseline financial checks.',
    flags: [],
    recommended_action: 'Forward to admin for final approval.'
  };
};

const detectDuplicateClientIdentity = async ({ name, email, phone, id_number, excludeClientId = null }) => {
  const normalizedName = normalizeText(name);
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const normalizedIdNumber = normalizeText(id_number);
  const exclusionClause = excludeClientId ? 'AND id != ?' : '';
  const withExclusion = (params) => (excludeClientId ? [...params, excludeClientId] : params);

  const [nameDuplicate, emailDuplicate, phoneDuplicate, idDuplicate] = await Promise.all([
    normalizedName
      ? new Promise((resolve, reject) => {
          db.get(`SELECT id FROM clients WHERE lower(name) = lower(?) ${exclusionClause}`, withExclusion([normalizedName]), (err, row) => {
            if (err) reject(err);
            else resolve(Boolean(row));
          });
        })
      : Promise.resolve(false),
    normalizedEmail
      ? new Promise((resolve, reject) => {
          db.get(`SELECT id FROM clients WHERE lower(email) = ? ${exclusionClause}`, withExclusion([normalizedEmail]), (err, row) => {
            if (err) reject(err);
            else resolve(Boolean(row));
          });
        })
      : Promise.resolve(false),
    normalizedPhone
      ? new Promise((resolve, reject) => {
          db.get(`SELECT id FROM clients WHERE phone = ? ${exclusionClause}`, withExclusion([normalizedPhone]), (err, row) => {
            if (err) reject(err);
            else resolve(Boolean(row));
          });
        })
      : Promise.resolve(false),
    normalizedIdNumber
      ? new Promise((resolve, reject) => {
          db.get(`SELECT id FROM clients WHERE id_number = ? ${exclusionClause}`, withExclusion([normalizedIdNumber]), (err, row) => {
            if (err) reject(err);
            else resolve(Boolean(row));
          });
        })
      : Promise.resolve(false)
  ]);

  const duplicates = [];
  if (nameDuplicate) duplicates.push('Name already exists');
  if (emailDuplicate) duplicates.push('Email already exists');
  if (phoneDuplicate) duplicates.push('Phone already exists');
  if (idDuplicate) duplicates.push('ID number already exists');
  return duplicates;
};

const getOrCreateClientProfile = async (user) => {
  const existingClient = await new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM clients WHERE name = ? ORDER BY id ASC LIMIT 1',
      [user.name],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });

  if (existingClient) {
    return existingClient;
  }

  const clientId = await new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO clients (name, status, kyc_status) VALUES (?, ?, ?)',
      [user.name, 'Active', 'Pending'],
      function onInsert(err) {
        if (err) {
          return reject(err);
        }
        resolve(this.lastID);
      }
    );
  });

  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM clients WHERE id = ?', [clientId], (err, row) => (
      err ? reject(err) : resolve(row)
    ));
  });
};

router.get('/me/balance-summary', authenticateToken, authorizeRoles('client'), async (req, res) => {
  try {
    const client = await getOrCreateClientProfile(req.user);

    const savingsAccounts = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, type, amount AS balance, status
         FROM savings_accounts
         WHERE client_id = ? AND status = 'Active'
         ORDER BY created_at DESC`,
        [client.id],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });

    const loanAccounts = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, type, amount, balance, status
         FROM loan_accounts
         WHERE client_id = ? AND status IN ('Approved', 'Active')
         ORDER BY created_at DESC`,
        [client.id],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });

    const accounts = [
      ...savingsAccounts.map((account) => ({
        account_type: 'Savings',
        account_number: account.id,
        current_deposit_balance: Number(account.balance || 0),
        available_credit_or_outstanding_loan_balance: 0
      })),
      ...loanAccounts.map((loan) => ({
        account_type: 'Loan',
        account_number: loan.id,
        current_deposit_balance: 0,
        available_credit_or_outstanding_loan_balance: Number(loan.balance || 0)
      }))
    ];

    res.json({
      client: {
        id: client.id,
        name: client.name
      },
      accounts,
      hasActiveAccounts: accounts.length > 0,
      message: accounts.length === 0
        ? 'No active accounts found. Please contact your branch.'
        : 'Balance summary retrieved successfully.'
    });
  } catch (error) {
    console.error('Balance summary error:', error);
    res.status(500).json({ error: 'Failed to retrieve balance summary' });
  }
});

router.get('/me/profile', authenticateToken, authorizeRoles('client'), async (req, res) => {
  try {
    const client = await getOrCreateClientProfile(req.user);
    res.json(client);
  } catch (error) {
    console.error('Client profile load error:', error);
    res.status(500).json({ error: 'Failed to load client profile' });
  }
});

router.get('/me/loans', authenticateToken, authorizeRoles('client'), async (req, res) => {
  try {
    const client = await getOrCreateClientProfile(req.user);

    const loans = await new Promise((resolve, reject) => {
      db.all(
        `SELECT la.*, c.name as client_name
         FROM loan_accounts la
         JOIN clients c ON la.client_id = c.id
         WHERE la.client_id = ?
         ORDER BY la.created_at DESC`,
        [client.id],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });

    res.json(loans);
  } catch (error) {
    console.error('Client loans error:', error);
    res.status(500).json({ error: 'Failed to retrieve client loans' });
  }
});

router.put('/me/profile', authenticateToken, authorizeRoles('client'), async (req, res) => {
  const clientId = req.body?.id;
  const {
    firstName,
    lastName,
    email,
    phone,
    address,
    idNumber,
    gender,
    disabilityStatus,
    marginalizedGroup,
    incomeSource,
    photoPath,
    groupId
  } = req.body || {};

  try {
    const client = await getOrCreateClientProfile(req.user);
    if (!client) {
      return res.status(404).json({ error: 'Client profile not found' });
    }

    if (clientId && Number(clientId) !== Number(client.id)) {
      return res.status(403).json({ error: 'You can only update your own profile' });
    }

    const normalizedName = [firstName, lastName].filter(Boolean).join(' ').trim() || client.name;
    const beforeState = {
      name: client.name,
      email: client.email,
      phone: client.phone,
      address: client.address,
      id_number: client.id_number,
      gender: client.gender,
      disability_status: client.disability_status,
      marginalized_group: client.marginalized_group,
      income_source: client.income_source,
      photo_path: client.photo_path,
      group_id: client.group_id
    };

    // Determine KYC status based on required fields
    const hasRequiredKycFields = phone && address && idNumber && incomeSource;
    const newKycStatus = hasRequiredKycFields ? 'Verified' : 'Pending';
    const kycVerifiedAt = hasRequiredKycFields && client.kyc_status !== 'Verified' ? new Date().toISOString() : client.kyc_verified_at;

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE clients
         SET name = ?, email = ?, phone = ?, address = ?, id_number = ?, gender = ?, disability_status = ?, marginalized_group = ?, income_source = ?, photo_path = ?, group_id = ?, kyc_status = ?, kyc_verified_at = ?
         WHERE id = ?`,
        [
          normalizedName,
          email || null,
          phone || null,
          address || null,
          idNumber || null,
          gender || null,
          disabilityStatus || null,
          marginalizedGroup || null,
          incomeSource || null,
          photoPath || null,
          groupId || null,
          newKycStatus,
          kycVerifiedAt,
          client.id
        ],
        function onUpdate(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    const updatedClient = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM clients WHERE id = ?', [client.id], (err, row) => (err ? reject(err) : resolve(row)));
    });

    await recordAuditEvent({
      action: 'CLIENT_PROFILE_UPDATED',
      entityType: 'client',
      entityId: String(client.id),
      user: req.user,
      beforeState,
      afterState: {
        name: updatedClient.name,
        email: updatedClient.email,
        phone: updatedClient.phone,
        address: updatedClient.address,
        id_number: updatedClient.id_number,
        gender: updatedClient.gender,
        disability_status: updatedClient.disability_status,
        marginalized_group: updatedClient.marginalized_group,
        income_source: updatedClient.income_source,
        photo_path: updatedClient.photo_path,
        group_id: updatedClient.group_id
      },
      details: {
        kyc_status: updatedClient.kyc_status,
        kyc_verified_at: updatedClient.kyc_verified_at
      }
    });

    res.json({
      message: 'Client profile updated successfully',
      client: updatedClient
    });
  } catch (error) {
    console.error('Client profile update error:', error);
    res.status(500).json({ error: 'Failed to update client profile' });
  }
});

// Get all loans (for review) - Must be before parameterized routes
router.get('/loans-list', authenticateToken, authorizeRoles('admin', 'branch_manager', 'loan_staff'), (req, res) => {
  db.all(`
    SELECT la.*, c.name as client_name
    FROM loan_accounts la
    JOIN clients c ON la.client_id = c.id
    ORDER BY la.created_at DESC
  `, [], (err, loans) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(loans);
  });
});

// Get clients with active savings accounts for loan application
router.get('/savings-accounts', authenticateToken, authorizeRoles('admin', 'branch_manager', 'loan_staff', 'saving_staff'), (req, res) => {
  const { search } = req.query;
  const searchPattern = search ? `%${search}%` : null;
  const params = search ? [searchPattern, searchPattern, searchPattern] : [];

  const query = `
    SELECT
      c.id AS client_id,
      c.name AS client_name,
      c.phone AS phone,
      s.id AS account_id,
      s.id AS savings_account_id,
      s.amount AS balance,
      s.status AS status,
      'savings_accounts' AS account_source
    FROM clients c
    JOIN savings_accounts s ON c.id = s.client_id
    WHERE s.status IN ('Active', 'Pending Manager Review', 'Pending')
    ${search ? 'AND (s.id LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)' : ''}
    ORDER BY client_name ASC, account_id ASC
  `;

  db.all(query, params, (err, accounts) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    console.log('[SAVINGS ACCOUNTS] Returning accounts for selector:', accounts);
    res.json(accounts);
  });
});

router.get('/registration-requests', authenticateToken, authorizeRoles('admin', 'branch_manager'), (req, res) => {
  db.all(
    `SELECT *
     FROM client_registration_requests
     ORDER BY created_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        if (err.message && err.message.includes('no such table')) {
          return res.json([]);
        }
        console.error('Registration requests query error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      const requests = (rows || []).map((row) => ({
        ...row,
        flags: (() => {
          try {
            return row.flags ? JSON.parse(row.flags) : [];
          } catch {
            return [];
          }
        })()
      }));
      return res.json(requests);
    }
  );
});

router.post('/registration-requests/:id/approve', authenticateToken, authorizeRoles('admin', 'branch_manager'), async (req, res) => {
  const { id } = req.params;
  const { is_match, notes } = req.body || {};

  if (!is_match) {
    return res.status(400).json({ error: 'KYC match confirmation is required before approval.' });
  }

  try {
    await ensureRegistrationRequestCredentialColumns();
    const request = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM client_registration_requests WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!request) {
      return res.status(404).json({ error: 'Registration request not found' });
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE client_registration_requests
         SET status = 'Approved',
             kyc_match_status = 'Matched',
             admin_review_notes = ?,
             reviewed_at = ?,
             reviewed_by = ?
         WHERE id = ?`,
        [notes || null, new Date().toISOString(), req.user.id, id],
        (err) => (err ? reject(err) : resolve())
      );
    });

    const client = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM clients WHERE id = ?', [request.client_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    let createdUsername = null;
    let temporaryPassword = null;
    let existingUsername = null;
    if (client) {
      const credentials = await ensureClientUserCredentials(client);
      createdUsername = credentials.created ? credentials.username : null;
      temporaryPassword = credentials.temporaryPassword;
      existingUsername = !credentials.created ? credentials.username : null;
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE clients
         SET status = 'Active',
             kyc_status = 'Verified',
             kyc_verified_at = ?,
             photo_path = COALESCE(photo_path, ?)
         WHERE id = ?`,
        [new Date().toISOString(), request.photo_path || null, request.client_id],
        (err) => (err ? reject(err) : resolve())
      );
    });

    if (request.id_document_path) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO documents (id, client_id, type, file_name, file_path, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            `DOC-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
            request.client_id,
            'kyc',
            'submitted_kyc_id',
            request.id_document_path,
            'Approved'
          ],
          (err) => {
            if (err && !String(err.message || '').includes('UNIQUE')) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    }

    const targetEmail = request.email || client?.email || null;
    if (createdUsername && targetEmail) {
      await sendEmail(
        targetEmail,
        'Client Account Approved - Login Credentials',
        `Dear ${request.full_name || 'Client'}, your account has been approved.\nUsername: ${createdUsername}\nTemporary Password: ${temporaryPassword}\nPlease log in and change your password from profile settings immediately.`,
        `<p>Dear ${request.full_name || 'Client'},</p>
         <p>Your client account has been approved and activated.</p>
         <p><strong>Username:</strong> ${createdUsername}<br/>
         <strong>Temporary Password:</strong> ${temporaryPassword}</p>
         <p>Please log in and change your password immediately from profile settings.</p>`
      );
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE client_registration_requests
         SET generated_username = COALESCE(?, generated_username),
             generated_temporary_password = COALESCE(?, generated_temporary_password),
             credentials_sent_at = ?
         WHERE id = ?`,
        [
          createdUsername || existingUsername || null,
          temporaryPassword || null,
          targetEmail ? new Date().toISOString() : null,
          id
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    return res.json({
      message: 'KYC registration approved and client activated.',
      credentials_sent: Boolean((createdUsername || existingUsername) && targetEmail),
      username: createdUsername || existingUsername || null,
      temporary_password: temporaryPassword || null
    });
  } catch (error) {
    console.error('Approve registration request error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/registration-requests/:id/reject', authenticateToken, authorizeRoles('admin', 'branch_manager'), async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body || {};
  try {
    const request = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM client_registration_requests WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!request) {
      return res.status(404).json({ error: 'Registration request not found' });
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE client_registration_requests
         SET status = 'Rejected',
             kyc_match_status = 'Not Matched',
             admin_review_notes = ?,
             reviewed_at = ?,
             reviewed_by = ?
         WHERE id = ?`,
        [notes || null, new Date().toISOString(), req.user.id, id],
        (err) => (err ? reject(err) : resolve())
      );
    });

    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE clients SET status = 'Inactive', kyc_status = 'Rejected' WHERE id = ?",
        [request.client_id],
        (err) => (err ? reject(err) : resolve())
      );
    });

    const targetEmail = request.email || null;
    if (targetEmail) {
      await sendEmail(
        targetEmail,
        'Client Registration Update',
        `Dear ${request.full_name || 'Client'}, your registration was rejected.${notes ? ` Reason: ${notes}` : ''}`,
        `<p>Dear ${request.full_name || 'Client'},</p><p>Your registration was rejected.</p>${notes ? `<p><strong>Reason:</strong> ${notes}</p>` : ''}`
      );
    }

    return res.json({ message: 'KYC registration rejected.' });
  } catch (error) {
    console.error('Reject registration request error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/registration-requests/:id/reopen', authenticateToken, authorizeRoles('admin', 'branch_manager'), async (req, res) => {
  const { id } = req.params;
  try {
    await ensureRegistrationRequestCredentialColumns();
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE client_registration_requests
         SET status = 'Pending Admin Review',
             kyc_match_status = 'Pending',
             reviewed_at = NULL,
             reviewed_by = NULL
         WHERE id = ?`,
        [id],
        (err) => (err ? reject(err) : resolve())
      );
    });
    return res.json({ message: 'Registration request moved back to pending review.' });
  } catch (error) {
    console.error('Reopen registration request error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Register new client
router.post('/register', authenticateToken, authorizeRoles('admin', 'branch_manager', 'loan_staff', 'saving_staff'), async (req, res) => {
  const {
    name,
    email,
    phone,
    address,
    gender,
    disability_status,
    marginalized_group,
    id_number,
    income_source,
    photo_path,
    group_id,
    date_of_birth,
    id_type,
    id_document,
    monthly_income,
    requested_loan_amount
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!phone || !address || !id_number || !income_source) {
    return res.status(400).json({
      error: 'Phone, address, ID number, and income source are required to complete client registration.'
    });
  }

  try {
    const duplicateFields = await detectDuplicateClientIdentity({ name, email, phone, id_number });
    if (duplicateFields.length > 0) {
      return res.status(409).json({
        error: 'Duplicate client information detected.',
        details: duplicateFields
      });
    }

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

    const reviewResult = buildRegistrationDecision({
      payload: {
        full_name: name,
        gender,
        date_of_birth,
        phone,
        address,
        id_number,
        id_type,
        id_document,
        monthly_income,
        requested_loan_amount
      },
      duplicateIdNumber,
      duplicatePhone
    });

    if (reviewResult.decision === 'REJECT') {
      return res.status(422).json(reviewResult);
    }

    const kycStatus = reviewResult.decision === 'APPROVE' ? 'Verified' : 'Pending';
    db.run(
      `INSERT INTO clients
       (name, email, phone, address, gender, disability_status, marginalized_group, id_number, income_source, kyc_status, kyc_verified_at, photo_path, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        email || null,
        phone || null,
        address || null,
        gender || null,
        disability_status || 'None',
        marginalized_group || 'None',
        id_number || null,
        income_source || null,
        kycStatus,
        kycStatus === 'Verified' ? new Date().toISOString() : null,
        photo_path || null,
        group_id || null
      ],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        db.get('SELECT * FROM clients WHERE id = ?', [this.lastID], async (err, client) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          let credentials = { username: null, temporaryPassword: null, created: false };
          if (client?.kyc_status === 'Verified') {
            credentials = await ensureClientUserCredentials(client);
            if (credentials.created && client.email) {
              await sendEmail(
                client.email,
                'Client Account Created - Login Credentials',
                `Dear ${client.name}, your account is active.\nUsername: ${credentials.username}\nTemporary Password: ${credentials.temporaryPassword}\nPlease change the password after first login.`,
                `<p>Dear ${client.name},</p><p>Your account is active.</p><p><strong>Username:</strong> ${credentials.username}<br/><strong>Temporary Password:</strong> ${credentials.temporaryPassword}</p><p>Please change the password after first login.</p>`
              );
            }
          }
          recordAuditEvent({
            action: 'CLIENT_REGISTERED',
            entityType: 'client',
            entityId: String(client.id),
            user: req.user,
            afterState: client,
            details: { kyc_status: client.kyc_status, review: reviewResult }
          }).catch((auditError) => console.error('Client registration audit error:', auditError));
          res.status(201).json({
            message: 'Client registered successfully',
            client,
            review: reviewResult,
            username: credentials.username,
            temporary_password: credentials.temporaryPassword
          });
        });
      }
    );
  } catch (error) {
    console.error('Client registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/registrations/review', authenticateToken, authorizeRoles('admin', 'branch_manager', 'loan_staff', 'saving_staff'), async (req, res) => {
  try {
    const payload = req.body || {};
    const duplicateIdNumber = payload.id_number
      ? await new Promise((resolve, reject) => {
          db.get('SELECT id FROM clients WHERE id_number = ?', [payload.id_number], (err, row) => {
            if (err) reject(err);
            else resolve(Boolean(row));
          });
        })
      : false;
    const duplicatePhone = payload.phone
      ? await new Promise((resolve, reject) => {
          db.get('SELECT id FROM clients WHERE phone = ?', [payload.phone], (err, row) => {
            if (err) reject(err);
            else resolve(Boolean(row));
          });
        })
      : false;

    const reviewResult = buildRegistrationDecision({
      payload,
      duplicateIdNumber,
      duplicatePhone
    });

    return res.status(200).json(reviewResult);
  } catch (error) {
    console.error('Registration review error:', error);
    return res.status(500).json({
      decision: 'NEED_MORE_INFO',
      reason: 'Could not complete registration review due to internal system error.',
      flags: ['RISK:REVIEW_INTERNAL_ERROR'],
      recommended_action: 'Retry review and escalate to technical support if it persists.'
    });
  }
});

// Get all clients
router.get('/', authenticateToken, (req, res) => {
  db.all('SELECT * FROM clients ORDER BY created_at DESC', [], (err, clients) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(clients);
  });
});

// Get client by ID
router.get('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM clients WHERE id = ?', [id], (err, client) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(client);
  });
});

// Update client
router.put('/:id', authenticateToken, authorizeRoles('admin', 'branch_manager'), (req, res) => {
  const { id } = req.params;
  const { name, email, phone, address, gender, disability_status, marginalized_group, status } = req.body;

  (async () => {
    const duplicateFields = await detectDuplicateClientIdentity({ name, email, phone, id_number: null, excludeClientId: Number(id) });
    if (duplicateFields.length > 0) {
      return res.status(409).json({
        error: 'Duplicate client information detected.',
        details: duplicateFields
      });
    }

    db.run(
      'UPDATE clients SET name = ?, email = ?, phone = ?, address = ?, gender = ?, disability_status = ?, marginalized_group = ?, status = ? WHERE id = ?',
      [name, normalizeEmail(email) || null, normalizePhone(phone) || null, address, gender, disability_status, marginalized_group, status, id],
      function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      db.get('SELECT * FROM clients WHERE id = ?', [id], (err, client) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({
          message: 'Client updated successfully',
          client
        });
      });
      }
    );
  })().catch((error) => {
    console.error('Client update validation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  });
});

router.delete('/:id', authenticateToken, authorizeRoles('admin', 'branch_manager'), (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM clients WHERE id = ?', [id], function onDelete(err) {
    if (err) {
      console.error('Delete client error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    return res.json({ message: 'Client deleted successfully' });
  });
});

// Create savings account for client
router.post('/:clientId/accounts/savings', authenticateToken, authorizeRoles('admin', 'branch_manager', 'saving_staff', 'loan_staff'), async (req, res) => {
  const { clientId } = req.params;
  const { initial_balance, type } = req.body;

  if (!initial_balance || initial_balance <= 0) {
    return res.status(400).json({ error: 'Initial balance must be greater than 0' });
  }

  try {
    // Check if client exists
    const client = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM clients WHERE id = ?', [clientId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const credentials = await ensureClientUserCredentials(client);
    if (credentials.created && client.email) {
      await sendEmail(
        client.email,
        'Client Account Credentials',
        `Dear ${client.name}, your client login has been created.\nUsername: ${credentials.username}\nTemporary Password: ${credentials.temporaryPassword}\nPlease change your password after first login.`,
        `<p>Dear ${client.name},</p><p>Your client login has been created.</p><p><strong>Username:</strong> ${credentials.username}<br/><strong>Temporary Password:</strong> ${credentials.temporaryPassword}</p><p>Please change your password after first login.</p>`
      );
    }

    await assertClientKycEligible(clientId);

    const accountId = generateAccountId('savings');
    const requiresApproval = req.user.role !== 'admin';
    const initialStatus = requiresApproval ? 'Pending' : 'Active';

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO savings_accounts
         (id, client_id, amount, type, interest_rate, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [accountId, clientId, Number(initial_balance), type || 'Regular Savings', 5, initialStatus],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    let approvalRequestId = null;
    if (requiresApproval) {
      const { createApprovalRequest } = require('./approvals');
      approvalRequestId = await createApprovalRequest(
        'account_creation',
        accountId,
        Number(initial_balance),
        req.user.id,
        {
          client_id: clientId,
          account_type: 'savings',
          opening_balance: Number(initial_balance),
          product_type: type || 'Regular Savings',
          source_table: 'savings_accounts',
          client_name: client.name,
          kyc_status: client.kyc_status || 'Pending'
        }
      );
    }

    db.get('SELECT * FROM savings_accounts WHERE id = ?', [accountId], async (err, account) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      await recordAuditEvent({
        action: 'SAVINGS_ACCOUNT_CREATED',
        entityType: 'savings_account',
        entityId: accountId,
        user: req.user,
        afterState: account,
        details: {
          approval_request_id: approvalRequestId,
          maker_checker_required: requiresApproval
        }
      }).catch((auditError) => console.error('Savings account audit error:', auditError));
      res.status(201).json({
        message: requiresApproval
          ? 'Savings account created and submitted for approval'
          : 'Savings account created successfully',
        account,
        approval_request_id: approvalRequestId,
        requires_approval: requiresApproval,
        username: credentials.username,
        temporary_password: credentials.temporaryPassword
      });
    });
  } catch (error) {
    console.error('Savings account creation error:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Internal server error',
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || null
    });
  }
});

// Create loan account for client (client must have existing savings account)
router.post('/:clientId/accounts/loan', authenticateToken, authorizeRoles('admin', 'branch_manager', 'loan_staff'), async (req, res) => {
  const { clientId } = req.params;
  const { amount, type, term, interest_rate } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Loan amount must be greater than 0' });
  }

  try {
    // Check if client exists
    const client = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM clients WHERE id = ?', [clientId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    await assertClientKycEligible(clientId);

    // Check if client has existing savings account
    const savingsAccount = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM savings_accounts WHERE client_id = ? AND status = ?',
        [clientId, 'Active'],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!savingsAccount) {
      return res.status(400).json({ 
        error: 'Client must have an active savings account to apply for a loan' 
      });
    }

    const accountId = generateAccountId('loan');
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO loan_accounts
         (id, client_id, savings_account_id, amount, balance, type, term, interest_rate, payment_frequency, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [accountId, clientId, savingsAccount.id, amount, amount, type || 'Personal Loan', term || '12', interest_rate || 12, 'Monthly', 'Pending'],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Ensure client has user credentials and include them in response if newly created
    try {
      const credentials = await ensureClientUserCredentials(client);
      if (credentials.created && client.email) {
        await sendEmail(
          client.email,
          'Client Account Credentials',
          `Dear ${client.name}, your client login has been created.\nUsername: ${credentials.username}\nTemporary Password: ${credentials.temporaryPassword}\nPlease change your password after first login.`,
          `<p>Dear ${client.name},</p><p>Your client login has been created.</p><p><strong>Username:</strong> ${credentials.username}<br/><strong>Temporary Password:</strong> ${credentials.temporaryPassword}</p><p>Please change the password after first login.</p>`
        );
      }
    } catch (credErr) {
      console.error('Error ensuring client credentials during loan creation:', credErr);
    }

    db.get('SELECT * FROM loan_accounts WHERE id = ?', [accountId], (err, account) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.status(201).json({ message: 'Loan account created successfully', account });
    });
  } catch (error) {
    console.error('Loan account creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all accounts for a client
router.get('/:clientId/accounts', authenticateToken, (req, res) => {
  const { clientId } = req.params;
  db.all(
    `SELECT id, client_id, type, amount AS balance, interest_rate, status, created_at, 'savings' AS account_kind
     FROM savings_accounts
     WHERE client_id = ?
     UNION ALL
     SELECT id, client_id, type, balance, interest_rate, status, created_at, 'loan' AS account_kind
     FROM loan_accounts
     WHERE client_id = ?
     ORDER BY created_at DESC`,
    [clientId, clientId],
    (err, accounts) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(accounts);
  });
});

// Get all accounts (admin view)
router.get('/accounts/all', authenticateToken, authorizeRoles('admin', 'branch_manager', 'ceo'), (req, res) => {
  db.all(`
    SELECT
      s.id,
      s.client_id,
      s.type,
      s.amount AS balance,
      s.interest_rate,
      s.status,
      s.created_at,
      c.name as client_name
    FROM savings_accounts s
    JOIN clients c ON s.client_id = c.id
    ORDER BY s.created_at DESC
  `, [], (err, accounts) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(accounts);
  });
});

// Activate/deactivate account
router.patch('/accounts/:accountId/status', authenticateToken, authorizeRoles('admin', 'branch_manager'), (req, res) => {
  const { accountId } = req.params;
  const { status } = req.body;

  if (!status || !['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ error: 'Status must be Active or Inactive' });
  }

  db.run(
    'UPDATE savings_accounts SET status = ? WHERE id = ?',
    [status, accountId],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Account not found' });
      }

      db.get('SELECT * FROM savings_accounts WHERE id = ?', [accountId], (err, account) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({
          message: `Account ${status.toLowerCase()} successfully`,
          account
        });
      });
    }
  );
});

// Generate transaction ID
const generateTransactionId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `TXN-${timestamp}-${random}`;
};

// Deposit money into savings account
router.post('/accounts/:accountId/deposit', authenticateToken, authorizeRoles('admin', 'branch_manager', 'saving_staff'), async (req, res) => {
  const { accountId } = req.params;
  const { amount, description } = req.body;
  const userId = req.user.id;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0' });
  }

  try {
    // Get account details
    const account = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM savings_accounts WHERE id = ?', [accountId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (account.status !== 'Active') {
      return res.status(400).json({ error: 'Account is not active' });
    }

    // Check if amount requires approval (large transactions)
    const { createApprovalRequest, getApprovalLevel } = require('./approvals');
    const approvalLevel = getApprovalLevel(amount);
    if (approvalLevel === 'ceo') {
      // Create approval request instead of executing immediately
      const approvalId = await createApprovalRequest(
        'transaction_deposit',
        accountId,
        amount,
        userId,
        { accountId, amount, description }
      );
      
      return res.json({
        message: 'Deposit requires approval',
        requires_approval: true,
        approval_id: approvalId,
        approval_level: approvalLevel,
        amount
      });
    }

    const balanceBefore = Number(account.amount || 0);
    const balanceAfter = balanceBefore + amount;

    // Update account balance
    await new Promise((resolve, reject) => {
      db.run('UPDATE savings_accounts SET amount = ? WHERE id = ?', [balanceAfter, accountId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    // Create transaction record
    const transactionId = generateTransactionId();
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [transactionId, accountId, 'savings', 'deposit', amount, balanceBefore, balanceAfter, description || 'Deposit', userId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({
      message: 'Deposit successful',
      transaction: {
        id: transactionId,
        amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter
      },
      account: {
        id: account.id,
        balance: balanceAfter
      }
    });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Withdraw money from savings account
router.post('/accounts/:accountId/withdraw', authenticateToken, authorizeRoles('admin', 'branch_manager', 'saving_staff'), async (req, res) => {
  const { accountId } = req.params;
  const { amount, description } = req.body;
  const userId = req.user.id;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0' });
  }

  try {
    // Get account details
    const account = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM savings_accounts WHERE id = ?', [accountId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (account.status !== 'Active') {
      return res.status(400).json({ error: 'Account is not active' });
    }

    if (Number(account.amount || 0) < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Check if amount requires approval (large transactions)
    const { createApprovalRequest, getApprovalLevel } = require('./approvals');
    const approvalLevel = getApprovalLevel(amount);
    if (approvalLevel === 'ceo') {
      // Create approval request instead of executing immediately
      const approvalId = await createApprovalRequest(
        'transaction_withdraw',
        accountId,
        amount,
        userId,
        { accountId, amount, description }
      );
      
      return res.json({
        message: 'Withdrawal requires approval',
        requires_approval: true,
        approval_id: approvalId,
        approval_level: approvalLevel,
        amount
      });
    }

    const balanceBefore = Number(account.amount || 0);
    const balanceAfter = balanceBefore - amount;

    // Update account balance
    await new Promise((resolve, reject) => {
      db.run('UPDATE savings_accounts SET amount = ? WHERE id = ?', [balanceAfter, accountId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    // Create transaction record
    const transactionId = generateTransactionId();
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [transactionId, accountId, 'savings', 'withdraw', amount, balanceBefore, balanceAfter, description || 'Withdrawal', userId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({
      message: 'Withdrawal successful',
      transaction: {
        id: transactionId,
        amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter
      },
      account: {
        id: account.id,
        balance: balanceAfter
      }
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Calculate and apply interest to savings account
router.post('/accounts/:accountId/interest', authenticateToken, authorizeRoles('admin', 'branch_manager', 'saving_staff'), async (req, res) => {
  const { accountId } = req.params;
  const { months } = req.body;
  const userId = req.user.id;

  const monthsToCalculate = months || 1;

  if (monthsToCalculate <= 0) {
    return res.status(400).json({ error: 'Months must be greater than 0' });
  }

  try {
    // Get account details
    const account = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM savings_accounts WHERE id = ?', [accountId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (account.status !== 'Active') {
      return res.status(400).json({ error: 'Account is not active' });
    }

    const interestRate = account.interest_rate || 5; // Default 5% if not set
    const principal = Number(account.amount || 0);
    const interest = (principal * (interestRate / 100) * monthsToCalculate) / 12;
    const balanceBefore = Number(account.amount || 0);
    const balanceAfter = balanceBefore + interest;

    // Update account balance
    await new Promise((resolve, reject) => {
      db.run('UPDATE savings_accounts SET amount = ? WHERE id = ?', [balanceAfter, accountId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    // Create transaction record
    const transactionId = generateTransactionId();
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [transactionId, accountId, 'savings', 'interest', interest, balanceBefore, balanceAfter, `Interest for ${monthsToCalculate} month(s) at ${interestRate}%`, userId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({
      message: 'Interest calculated and applied successfully',
      transaction: {
        id: transactionId,
        interest_rate: interestRate,
        months: monthsToCalculate,
        interest_amount: interest,
        balance_before: balanceBefore,
        balance_after: balanceAfter
      },
      account: {
        id: account.id,
        balance: balanceAfter
      }
    });
  } catch (error) {
    console.error('Interest calculation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get transaction history for an account
router.get('/accounts/:accountId/transactions', authenticateToken, (req, res) => {
  const { accountId } = req.params;

  db.all(
    'SELECT t.*, u.username as created_by_name FROM transactions t LEFT JOIN users u ON t.created_by = u.id WHERE t.account_id = ? ORDER BY t.created_at DESC',
    [accountId],
    (err, transactions) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(transactions);
    }
  );
});

// Update account interest rate
router.patch('/accounts/:accountId/interest-rate', authenticateToken, authorizeRoles('admin', 'branch_manager', 'saving_staff'), (req, res) => {
  const { accountId } = req.params;
  const { interest_rate } = req.body;

  if (interest_rate === undefined || interest_rate < 0) {
    return res.status(400).json({ error: 'Interest rate must be a non-negative number' });
  }

  db.run(
    'UPDATE savings_accounts SET interest_rate = ? WHERE id = ?',
    [interest_rate, accountId],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Account not found' });
      }

      db.get('SELECT * FROM savings_accounts WHERE id = ?', [accountId], (err, account) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({
          message: 'Interest rate updated successfully',
          account
        });
      });
    }
  );
});

// Loan workflow endpoints

// Apply for loan (client or staff on behalf of client)
router.post('/:clientId/loans/apply', authenticateToken, authorizeRoles('admin', 'branch_manager', 'loan_staff'), async (req, res) => {
  const { clientId } = req.params;
  const { amount, type, term, interest_rate, payment_frequency } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Loan amount must be greater than 0' });
  }

  try {
    // Check if client exists
    const client = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM clients WHERE id = ?', [clientId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Check if client has active savings account
    const savingsAccount = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM savings_accounts WHERE client_id = ? AND status = ?',
        [clientId, 'Active'],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!savingsAccount) {
      return res.status(400).json({ error: 'Client must have an active savings account to apply for a loan' });
    }

    // Generate loan ID
    const loanId = generateAccountId('loan');

    // Create loan application
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO loan_accounts (id, client_id, savings_account_id, amount, balance, type, term, interest_rate, payment_frequency, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [loanId, clientId, savingsAccount.id, amount, amount, type || 'Personal Loan', term || '12 months', interest_rate || 12, payment_frequency || 'Monthly', 'Pending'],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.status(201).json({
      message: 'Loan application submitted successfully',
      loan: {
        id: loanId,
        client_id: clientId,
        amount,
        status: 'Pending'
      }
    });
  } catch (error) {
    console.error('Loan application error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Approve loan (Branch Manager)
router.patch('/loans/:loanId/approve', authenticateToken, authorizeRoles('admin', 'branch_manager'), async (req, res) => {
  const { loanId } = req.params;
  const userId = req.user.id;

  try {
    // Get loan details
    const loan = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM loan_accounts WHERE id = ?', [loanId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'Pending') {
      return res.status(400).json({ error: 'Loan can only be approved when in Pending status' });
    }

    // Set disbursement date to current date
    const disbursementDate = new Date().toISOString().split('T')[0];

    // Update loan status to Approved and set disbursement date
    await new Promise((resolve, reject) => {
      db.run('UPDATE loan_accounts SET status = ?, disbursement_date = ? WHERE id = ?', ['Approved', disbursementDate, loanId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    // Auto-generate payment schedule using disbursement date
    const termMonths = parseInt(loan.term) || 12; // Default to 12 months if not specified
    const monthlyInterestRate = (loan.interest_rate || 15) / 100 / 12;
    const monthlyPayment = loan.amount * 
      (monthlyInterestRate * Math.pow(1 + monthlyInterestRate, termMonths)) / 
      (Math.pow(1 + monthlyInterestRate, termMonths) - 1);

    let balanceRemaining = loan.amount;
    const schedule = [];
    const startDate = new Date(disbursementDate);

    for (let i = 1; i <= termMonths; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      
      const interestAmount = balanceRemaining * monthlyInterestRate;
      const principalAmount = monthlyPayment - interestAmount;
      balanceRemaining = balanceRemaining - principalAmount;
      
      // Round to 2 decimal places
      const roundedInterest = Math.round(interestAmount * 100) / 100;
      const roundedPrincipal = Math.round(principalAmount * 100) / 100;
      const roundedTotal = Math.round(monthlyPayment * 100) / 100;
      const roundedBalance = Math.round(Math.max(0, balanceRemaining) * 100) / 100;

      const scheduleId = `PS-${loanId}-${i}`;
      
      schedule.push({
        id: scheduleId,
        loan_id: loanId,
        due_date: dueDate.toISOString().split('T')[0],
        principal_amount: roundedPrincipal,
        interest_amount: roundedInterest,
        total_amount: roundedTotal,
        balance_remaining: roundedBalance,
        status: 'Pending'
      });
    }

    // Insert payment schedules into database
    let insertedCount = 0;
    for (const payment of schedule) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO payment_schedule (id, loan_id, due_date, principal_amount, interest_amount, total_amount, balance_remaining, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [payment.id, payment.loan_id, payment.due_date, payment.principal_amount, 
           payment.interest_amount, payment.total_amount, payment.balance_remaining, payment.status],
          (err) => {
            if (err) reject(err);
            else {
              insertedCount++;
              resolve();
            }
          }
        );
      });
    }

    console.log(`[AUDIT] Loan ${loanId} approved by user ${userId} at ${new Date().toISOString()}`);
    console.log(`[AUDIT] Disbursement date set to ${disbursementDate}`);
    console.log(`[AUDIT] Payment schedule auto-generated with ${insertedCount} payments`);

    res.json({
      message: 'Loan approved successfully',
      loan: {
        id: loanId,
        status: 'Approved',
        disbursement_date: disbursementDate
      },
      payment_schedule: {
        total_payments: schedule.length,
        monthly_payment: Math.round(monthlyPayment * 100) / 100,
        first_payment_date: schedule[0].due_date,
        last_payment_date: schedule[schedule.length - 1].due_date
      }
    });
  } catch (error) {
    console.error('Loan approval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject loan (Branch Manager)
router.patch('/loans/:loanId/reject', authenticateToken, authorizeRoles('admin', 'branch_manager'), async (req, res) => {
  const { loanId } = req.params;
  const { reason } = req.body;

  try {
    // Get loan details
    const loan = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM loan_accounts WHERE id = ?', [loanId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'Pending') {
      return res.status(400).json({ error: 'Loan can only be rejected when in Pending status' });
    }

    // Update loan status to Rejected
    await new Promise((resolve, reject) => {
      db.run('UPDATE loan_accounts SET status = ? WHERE id = ?', ['Rejected', loanId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({
      message: 'Loan rejected successfully',
      loan: {
        id: loanId,
        status: 'Rejected',
        reason: reason || 'Not specified'
      }
    });
  } catch (error) {
    console.error('Loan rejection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Make loan repayment
router.post('/loans/:loanId/repay', authenticateToken, authorizeRoles('admin', 'branch_manager', 'loan_staff'), async (req, res) => {
  const { loanId } = req.params;
  const { amount } = req.body;
  const userId = req.user.id;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Repayment amount must be greater than 0' });
  }

  try {
    // Get loan details
    const loan = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM loan_accounts WHERE id = ?', [loanId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (!['Approved', 'Active', 'Overdue', 'Defaulted', 'Completed', 'Paid'].includes(loan.status)) {
      return res.status(400).json({ error: 'Loan must be approved/active before making repayments' });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'Repayment amount must be a valid positive number' });
    }

    if (Number(loan.balance || 0) < numericAmount) {
      return res.status(400).json({ error: 'Repayment amount exceeds outstanding balance' });
    }

    // Repayment must be paid from the linked savings account (per spec).
    if (!loan.savings_account_id) {
      return res.status(400).json({ error: 'Loan is missing a linked savings account. Cannot process repayment.' });
    }

    await assertClientKycEligible(loan.client_id);

    const savings = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM savings_accounts WHERE id = ? AND client_id = ?',
        [loan.savings_account_id, loan.client_id],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    if (!savings) {
      return res.status(400).json({ error: 'Linked savings account not found for this loan' });
    }
    if (savings.status !== 'Active') {
      return res.status(400).json({ error: 'Linked savings account must be Active to repay a loan' });
    }

    const loanBalanceBefore = Number(loan.balance || 0);
    const loanBalanceAfter = loanBalanceBefore - numericAmount;

    const savingsBalanceBefore = Number(savings.amount || 0);
    if (numericAmount > savingsBalanceBefore) {
      return res.status(400).json({ error: 'Insufficient savings balance for loan repayment' });
    }
    const savingsBalanceAfter = savingsBalanceBefore - numericAmount;

    const nowIso = new Date().toISOString();
    const transferReference = `LOAN_REPAY-${Date.now()}`;
    const loanTxnId = `TXN-${Date.now()}-LN`;
    const savingsTxnId = `TXN-${Date.now()}-SV`;

    // Apply repayment to payment_schedule (interest first, then principal) in due-date order.
    const scheduledPayments = await new Promise((resolve, reject) => {
      db.all(
        `SELECT *
         FROM payment_schedule
         WHERE loan_id = ?
           AND status IN ('Pending', 'Partial', 'Overdue')
         ORDER BY due_date ASC, created_at ASC`,
        [loanId],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });

    let remaining = numericAmount;
    let totalPrincipalApplied = 0;
    let totalInterestApplied = 0;

    const runExec = (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });

    await withTransaction(async () => {
      await runExec('UPDATE savings_accounts SET amount = ? WHERE id = ?', [savingsBalanceAfter, loan.savings_account_id]);
      await runExec(
        'UPDATE loan_accounts SET balance = ?, status = ? WHERE id = ?',
        [loanBalanceAfter, loanBalanceAfter <= 0 ? 'Completed' : loan.status, loanId]
      );

      await runExec(
        `INSERT INTO transactions
         (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, transaction_reference, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          savingsTxnId,
          loan.savings_account_id,
          'savings',
          'withdrawal',
          numericAmount,
          savingsBalanceBefore,
          savingsBalanceAfter,
          `Loan repayment transfer to ${loanId}`,
          transferReference,
          userId,
          nowIso
        ]
      );

      await runExec(
        `INSERT INTO transactions
         (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, transaction_reference, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          loanTxnId,
          loanId,
          'loan',
          'repayment',
          numericAmount,
          loanBalanceBefore,
          loanBalanceAfter,
          'Loan repayment (paid from savings)',
          transferReference,
          userId,
          nowIso
        ]
      );

      for (const payment of scheduledPayments) {
        if (remaining <= 0) break;

        const principalPaid = Number(payment.principal_paid || 0);
        const interestPaid = Number(payment.interest_paid || 0);
        const paidAmount = Number(payment.paid_amount || 0);
        const outstandingInterest = Math.max(0, Number(payment.interest_amount || 0) - interestPaid);
        const outstandingPrincipal = Math.max(0, Number(payment.principal_amount || 0) - principalPaid);
        const outstandingTotal = Math.max(0, Number(payment.total_amount || 0) - paidAmount);

        if (outstandingTotal <= 0) continue;

        const applied = Math.min(remaining, outstandingTotal);
        const interestApplied = Math.min(applied, outstandingInterest);
        const principalApplied = Math.min(applied - interestApplied, outstandingPrincipal);

        const nextPaidAmount = paidAmount + applied;
        const nextPrincipalPaid = principalPaid + principalApplied;
        const nextInterestPaid = interestPaid + interestApplied;
        const nextStatus = nextPaidAmount + 0.005 >= Number(payment.total_amount || 0) ? 'Paid' : 'Partial';

        await runExec(
          `UPDATE payment_schedule
           SET principal_paid = ?, interest_paid = ?, paid_amount = ?, status = ?, paid_date = ?
           WHERE id = ?`,
          [
            nextPrincipalPaid,
            nextInterestPaid,
            nextPaidAmount,
            nextStatus,
            nextStatus === 'Paid' ? nowIso : payment.paid_date || null,
            payment.id
          ]
        );

        totalPrincipalApplied += principalApplied;
        totalInterestApplied += interestApplied;
        remaining -= applied;
      }

      await runExec(
        `INSERT INTO loan_payments
         (id, loan_id, amount, principal_amount, interest_amount, balance_before, balance_after, payment_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `LPM-${Date.now()}`,
          loanId,
          numericAmount,
          Math.round(totalPrincipalApplied * 100) / 100,
          Math.round(totalInterestApplied * 100) / 100,
          loanBalanceBefore,
          loanBalanceAfter,
          nowIso,
          nowIso
        ]
      );
    });

    await recordAuditEvent({
      action: 'LOAN_REPAYMENT_POSTED',
      entityType: 'loan_account',
      entityId: loanId,
      user: req.user,
      beforeState: {
        loan_balance: loanBalanceBefore,
        savings_balance: savingsBalanceBefore,
        savings_account_id: loan.savings_account_id
      },
      afterState: {
        loan_balance: loanBalanceAfter,
        savings_balance: savingsBalanceAfter,
        savings_account_id: loan.savings_account_id
      },
      details: {
        amount: numericAmount,
        transfer_reference: transferReference,
        principal_applied: Math.round(totalPrincipalApplied * 100) / 100,
        interest_applied: Math.round(totalInterestApplied * 100) / 100
      }
    });

    res.json({
      message: 'Repayment successful',
      payment: {
        id: loanTxnId,
        amount: numericAmount,
        principal_amount: Math.round(totalPrincipalApplied * 100) / 100,
        interest_amount: Math.round(totalInterestApplied * 100) / 100,
        balance_before: loanBalanceBefore,
        balance_after: loanBalanceAfter,
        transfer_reference: transferReference
      },
      loan: {
        id: loanId,
        balance: loanBalanceAfter,
        status: loanBalanceAfter <= 0 ? 'Completed' : loan.status
      },
      savings_impact: {
        id: loan.savings_account_id,
        balance_before: savingsBalanceBefore,
        balance_after: savingsBalanceAfter
      }
    });
  } catch (error) {
    console.error('Repayment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get loan payment history
router.get('/loans/:loanId/payments', authenticateToken, (req, res) => {
  const { loanId } = req.params;

  db.all(
    'SELECT * FROM loan_payments WHERE loan_id = ? ORDER BY payment_date DESC',
    [loanId],
    (err, payments) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(payments);
    }
  );
});

// Calculate loan interest
router.get('/loans/:loanId/calculate-interest', authenticateToken, (req, res) => {
  const { loanId } = req.params;
  const { months } = req.query;

  const monthsToCalculate = parseInt(months) || 1;

  db.get('SELECT * FROM loan_accounts WHERE id = ?', [loanId], (err, loan) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    const interestRate = loan.interest_rate || 12;
    const principal = loan.balance;
    const interest = (principal * (interestRate / 100) * monthsToCalculate) / 12;

    res.json({
      loan_id: loanId,
      principal,
      interest_rate: interestRate,
      months: monthsToCalculate,
      interest_amount: interest,
      total_amount: principal + interest
    });
  });
});

module.exports = router;
module.exports.ensureClientUserCredentials = ensureClientUserCredentials;
module.exports.ensureRegistrationRequestCredentialColumns = ensureRegistrationRequestCredentialColumns;
