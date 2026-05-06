const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { buildCompanyId } = require('../utils/companyId');
const { validatePasswordComplexity } = require('../utils/passwordValidator');

const logUserAdminAudit = (action, entityId, adminUser, details) => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO audit_trail (action, entity_type, entity_id, user_id, user_role, details, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        action,
        'user',
        String(entityId),
        adminUser.id,
        adminUser.role,
        JSON.stringify(details),
        new Date().toISOString()
      ],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

// Get all users (admin/CEO)
router.get('/', authenticateToken, authorizeRoles('admin', 'ceo'), (req, res) => {
  db.all('SELECT id, name, username, email, role, branch_id, phone, status, created_at as created FROM users ORDER BY created_at DESC', [], (err, users) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(users);
  });
});

// Get available special permissions
router.get('/permissions/available', authenticateToken, authorizeRoles('admin'), (req, res) => {
  const availablePermissions = [
    {
      id: 'approve_large_loans',
      name: 'Approve Large Loans',
      description: 'Can approve loans above 100,000 ETB without CEO approval',
      category: 'loans'
    },
    {
      id: 'delete_accounts',
      name: 'Delete Accounts',
      description: 'Can delete user accounts (requires secondary auth)',
      category: 'users'
    },
    {
      id: 'view_all_audit_logs',
      name: 'View All Audit Logs',
      description: 'Can view audit logs for all users',
      category: 'audit'
    },
    {
      id: 'manage_branches',
      name: 'Manage Branches',
      description: 'Can create, update, and delete branches',
      category: 'branches'
    },
    {
      id: 'override_approvals',
      name: 'Override Approvals',
      description: 'Can override approval decisions',
      category: 'approvals'
    },
    {
      id: 'export_reports',
      name: 'Export Reports',
      description: 'Can export NBE compliance reports',
      category: 'reports'
    },
    {
      id: 'manage_permissions',
      name: 'Manage Permissions',
      description: 'Can assign special permissions to other users',
      category: 'admin'
    }
  ];

  res.json(availablePermissions);
});

// Get user by ID
router.get('/:id', authenticateToken, authorizeRoles('admin', 'ceo'), (req, res) => {
  const { id } = req.params;
  db.get('SELECT id, name, username, email, role, status, created_at as created FROM users WHERE id = ?', [id], (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  });
});

// Create new user (admin only)
router.post('/', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { name, username, email, password, role, branch_id, phone, full_name } = req.body;
  
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, and role are required' });
  }
  if (String(username).trim().length < 3 || /\s/.test(String(username))) {
    return res.status(400).json({ error: 'Username must be at least 3 characters and must not include spaces' });
  }
  const passwordErrors = validatePasswordComplexity(password);
  if (passwordErrors.length > 0) {
    return res.status(400).json({ error: 'Password does not meet complexity requirements', details: passwordErrors });
  }

  try {
    const normalizedPhone = phone ? String(phone).trim() : '';
    const normalizedEmail = email ? String(email).trim().toLowerCase() : '';
    const normalizedName = String(full_name || name || username).trim();

    const duplicate = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, username, email, phone, name, role FROM users
         WHERE username = ?
            OR (? != '' AND lower(email) = ?)
            OR (? != '' AND phone = ?)
            OR (? != '' AND lower(name) = lower(?) AND role = ?)`,
        [
          String(username).trim(),
          normalizedEmail,
          normalizedEmail,
          normalizedPhone,
          normalizedPhone,
          normalizedName,
          normalizedName,
          role
        ],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    if (duplicate) {
      return res.status(409).json({
        error: 'Duplicate user detected. Username, email, phone, or name already exists.',
        details: [
          duplicate.username === String(username).trim() ? 'Username already exists' : null,
          normalizedEmail && duplicate.email && String(duplicate.email).trim().toLowerCase() === normalizedEmail ? 'Email already exists' : null,
          normalizedPhone && duplicate.phone && String(duplicate.phone).trim() === normalizedPhone ? 'Phone already exists' : null,
          duplicate.name && String(duplicate.name).trim().toLowerCase() === normalizedName.toLowerCase() && duplicate.role === role ? 'Name already exists for this role' : null
        ].filter(Boolean)
      });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (name, username, email, password, role, branch_id, phone) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [normalizedName, String(username).trim(), normalizedEmail || null, hashedPassword, role, branch_id || null, normalizedPhone || null],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: 'Database error' });
        }
        
        console.log(`[AUDIT] User created: ${username} by admin at ${new Date().toISOString()}`);

        const newUserId = this.lastID;
        const companyId = buildCompanyId(role, newUserId);
        db.run('UPDATE users SET company_id = ? WHERE id = ?', [companyId, newUserId], (companyErr) => {
          if (companyErr) {
            console.error('Failed to set company_id:', companyErr);
          }
        });
        
        db.get('SELECT id, name, username, email, role, branch_id, phone, status, created_at as created FROM users WHERE id = ?', [this.lastID], (err, newUser) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          newUser.company_id = companyId;
          logUserAdminAudit('USER_CREATED', this.lastID, req.user, {
            created_user: username,
            created_role: role,
            created_name: full_name || name
          })
            .catch((auditError) => {
              console.error('User creation audit log error:', auditError);
            })
            .finally(() => {
              res.status(201).json(newUser);
            });
        });
      }
    );
  } catch (error) {
    console.error('User creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user
router.put('/:id', authenticateToken, authorizeRoles('admin'), (req, res) => {
  const { id } = req.params;
  const { name, username, email, role, status, branch_id, phone, full_name } = req.body;

  console.log('[UPDATE USER] ID:', id, 'Body:', req.body);

  db.run(
    'UPDATE users SET name = ?, username = ?, email = ?, role = ?, status = ?, branch_id = ?, phone = ? WHERE id = ?',
    [full_name || name || username, username, email || null, role, status, branch_id || null, phone || null, id],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      console.log(`[UPDATE USER] Updated ${this.changes} row(s)`);

      db.get('SELECT id, name, username, email, role, branch_id, phone, status, created_at as created FROM users WHERE id = ?', [id], (err, user) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        console.log('[UPDATE USER] Result:', user);
        logUserAdminAudit('USER_UPDATED', id, req.user, {
          updated_user: user?.username,
          name: full_name || name,
          email,
          role,
          status,
          branch_id,
          phone
        })
          .catch((auditError) => {
            console.error('User update audit log error:', auditError);
          })
          .finally(() => {
            res.json(user);
          });
      });
    }
  );
});

// Archive user (admin only) - Sets status to 'Archived'
router.patch('/:id/archive', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  console.log(`[ARCHIVE] Starting archive for user ID: ${id} by admin: ${userId}`);

  try {
    // Get target user details
    const targetUser = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!targetUser) {
      console.log(`[ARCHIVE] User not found: ${id}`);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`[ARCHIVE] Found user: ${targetUser.username}`);

    // Prevent archiving own account
    if (parseInt(id) === userId) {
      console.log(`[ARCHIVE] Attempt to archive own account`);
      return res.status(400).json({ error: 'Cannot archive your own account' });
    }

    // Update status to Archived
    console.log(`[ARCHIVE] Updating status to Archived`);
    await new Promise((resolve, reject) => {
      db.run('UPDATE users SET status = ? WHERE id = ?', ['Archived', id], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log(`[ARCHIVE] Status updated successfully`);

    console.log(`[ARCHIVE] Sending response`);
    await logUserAdminAudit('USER_ARCHIVED', id, req.user, {
      archived_user: targetUser.username,
      previous_status: targetUser.status,
      new_status: 'Archived'
    });

    res.json({
      message: 'User archived successfully',
      archived_user: targetUser.username,
      new_status: 'Archived'
    });
    console.log(`[ARCHIVE] Response sent`);
  } catch (error) {
    console.error('User archive error:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Delete user (admin only) - UC-ADM-004
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  const { secondary_auth_password, confirm_delete } = req.body;
  const userId = req.user.id;

  // Validate ID is a number
  const targetId = parseInt(id);
  if (isNaN(targetId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  // Step 3: Secondary authentication verification - verify admin password
  if (!secondary_auth_password) {
    return res.status(400).json({ 
      error: 'Secondary authentication is required to delete user accounts',
      requires_secondary_auth: true
    });
  }

  try {
    // Verify admin's password for secondary authentication
    const adminUser = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!adminUser) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    const passwordMatch = await bcrypt.compare(secondary_auth_password, adminUser.password);
    if (!passwordMatch) {
      return res.status(401).json({ 
        error: 'Secondary authentication failed. Invalid password.',
        secondary_auth_failed: true
      });
    }

    // Step 4: Confirm deletion request
    if (!confirm_delete) {
      return res.status(400).json({ 
        error: 'You must confirm the deletion request',
        requires_confirmation: true
      });
    }

    // Get target user details
    const targetUser = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE id = ?', [targetId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deletion of own account
    if (targetId === userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Archived users are eligible for final deletion after their data is preserved.
    const deletableStatuses = ['Inactive', 'Suspended', 'Archived'];
    if (!deletableStatuses.includes(targetUser.status)) {
      return res.status(400).json({ 
        error: 'Cannot delete active accounts. Account must be Inactive, Suspended, or Archived.',
        current_status: targetUser.status,
        required_status: deletableStatuses
      });
    }

    // Step 5: Remove user and revoke permissions
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM users WHERE id = ?', [targetId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    // Remove any special permissions for this user
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM user_permissions WHERE user_id = ?', [targetId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    await logUserAdminAudit('USER_DELETED', targetId, req.user, {
      deleted_user: targetUser.username,
      deleted_role: targetUser.role,
      deleted_status: targetUser.status,
      verified_by: adminUser.username
    });

    res.json({
      message: 'User account deleted successfully',
      deleted_user: targetUser.username,
      access_tokens_invalidated: true,
      audit_log_created: true,
      secondary_auth_verified: true
    });
  } catch (error) {
    console.error('User deletion error:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Get user's special permissions
router.get('/:id/permissions', authenticateToken, authorizeRoles('admin'), (req, res) => {
  const { id } = req.params;

  db.all(
    'SELECT up.*, u.username as granted_by_username FROM user_permissions up JOIN users u ON up.granted_by = u.id WHERE up.user_id = ? AND (up.expires_at IS NULL OR up.expires_at > datetime("now"))',
    [id],
    (err, permissions) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(permissions);
    }
  );
});

// Assign special permission to user
router.post('/:id/permissions', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  const { permission, expires_at } = req.body;
  const adminId = req.user.id;

  if (!permission) {
    return res.status(400).json({ error: 'Permission is required' });
  }

  try {
    // Check if user exists
    const targetUser = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if permission already exists
    const existingPermission = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM user_permissions WHERE user_id = ? AND permission = ? AND (expires_at IS NULL OR expires_at > datetime("now"))',
        [id, permission],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (existingPermission) {
      return res.status(400).json({ error: 'User already has this permission' });
    }

    // Assign permission
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO user_permissions (user_id, permission, granted_by, expires_at) VALUES (?, ?, ?, ?)',
        [id, permission, adminId, expires_at || null],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    await logUserAdminAudit('PERMISSION_GRANTED', id, req.user, {
      permission,
      granted_to: targetUser.username,
      expires_at
    });

    console.log(`[AUDIT] Permission '${permission}' granted to user ${targetUser.username} by admin ${adminId} at ${new Date().toISOString()}`);

    res.json({
      message: 'Permission assigned successfully',
      permission,
      user: targetUser.username,
      expires_at
    });
  } catch (error) {
    console.error('Permission assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Revoke special permission from user
router.delete('/:id/permissions/:permissionId', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { id, permissionId } = req.params;
  const adminId = req.user.id;

  try {
    // Get permission details before deletion
    const permission = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM user_permissions WHERE id = ?', [permissionId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!permission) {
      return res.status(404).json({ error: 'Permission not found' });
    }

    if (permission.user_id !== parseInt(id)) {
      return res.status(400).json({ error: 'Permission does not belong to this user' });
    }

    // Revoke permission
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM user_permissions WHERE id = ?', [permissionId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    // Get user details for audit log
    const targetUser = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    await logUserAdminAudit('PERMISSION_REVOKED', id, req.user, {
      permission: permission.permission,
      revoked_from: targetUser.username
    });

    console.log(`[AUDIT] Permission '${permission.permission}' revoked from user ${targetUser.username} by admin ${adminId} at ${new Date().toISOString()}`);

    res.json({
      message: 'Permission revoked successfully',
      permission: permission.permission,
      user: targetUser.username
    });
  } catch (error) {
    console.error('Permission revocation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
