const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { db } = require('../config/database');

const EDITABLE_SETTINGS_KEYS = {
  notifications: ['frontend_url', 'email_host', 'email_port', 'email_from'],
  security: ['session_timeout_staff', 'session_timeout_client', 'session_timeout_admin', 'password_policy', 'two_factor_auth'],
  system: ['system_name', 'timezone', 'currency', 'upload_dir', 'max_file_size'],
};

const buildDefaultSettings = () => ({
  database: {
    engine: 'PostgreSQL',
    host: process.env.DB_HOST || process.env.PGHOST || '127.0.0.1',
    port: process.env.DB_PORT || process.env.PGPORT || '5432',
    name: process.env.DB_NAME || process.env.PGDATABASE || 'edekise_microfinance',
    ssl_enabled: process.env.PG_SSL === 'true',
  },
    notifications: {
    frontend_url: process.env.FRONTEND_URL || 'http://192.168.137.1:3000',
    email_host: process.env.EMAIL_HOST || process.env.MAIL_HOST || 'Not configured',
    email_port: process.env.EMAIL_PORT || process.env.MAIL_PORT || 'Not configured',
    email_from: process.env.EMAIL_FROM || process.env.SMTP_FROM || 'Not configured',
  },
  security: {
    jwt_configured: Boolean(process.env.JWT_SECRET),
    encryption_key_configured: Boolean(process.env.ENCRYPTION_KEY),
    session_timeout_staff: '15 minutes',
    session_timeout_client: '30 minutes',
    session_timeout_admin: '1 hour',
    password_policy: 'Strong password policy enforced on secure registration flow',
    two_factor_auth: 'Available for future enablement',
  },
  system: {
    system_name: 'Edekise Microfinance System',
    environment: process.env.NODE_ENV || 'development',
    timezone: 'Africa/Addis_Ababa',
    currency: 'ETB',
    upload_dir: process.env.UPLOAD_DIR || './uploads',
    max_file_size: process.env.MAX_FILE_SIZE || '10485760',
  },
});

const loadStoredSettings = () => new Promise((resolve, reject) => {
  db.all('SELECT section, setting_key, setting_value FROM system_settings', [], (err, rows) => {
    if (err) {
      reject(err);
      return;
    }

    const storedSettings = rows.reduce((accumulator, row) => {
      if (!accumulator[row.section]) {
        accumulator[row.section] = {};
      }
      accumulator[row.section][row.setting_key] = row.setting_value;
      return accumulator;
    }, {});

    resolve(storedSettings);
  });
});

const mergeSettings = (defaults, storedSettings) => ({
  ...defaults,
  notifications: { ...defaults.notifications, ...(storedSettings.notifications || {}) },
  security: { ...defaults.security, ...(storedSettings.security || {}) },
  system: { ...defaults.system, ...(storedSettings.system || {}) },
});

const upsertSetting = (section, settingKey, settingValue) => new Promise((resolve, reject) => {
  db.run(
    `INSERT INTO system_settings (section, setting_key, setting_value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(section, setting_key) DO UPDATE SET
       setting_value = excluded.setting_value,
       updated_at = CURRENT_TIMESTAMP`,
    [section, settingKey, String(settingValue ?? '')],
    (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    }
  );
});

router.get('/summary', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const [
      users,
      branches,
      approvals,
      audits,
      recentActivities,
    ] = await Promise.all([
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      }),
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM branches', [], (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      }),
      new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) as count FROM approval_requests WHERE status = 'Pending'", [], (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      }),
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM audit_trail', [], (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      }),
      new Promise((resolve, reject) => {
        db.all(
          'SELECT id, action, user_role, details, timestamp FROM audit_trail ORDER BY timestamp DESC LIMIT 5',
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      }),
    ]);

    res.json({
      stats: {
        total_users: Number(users),
        total_branches: Number(branches),
        pending_approvals: Number(approvals),
        audit_events: Number(audits),
      },
      recent_activities: recentActivities,
    });
  } catch (error) {
    console.error('Admin summary error:', error);
    res.status(500).json({ error: 'Failed to load admin summary' });
  }
});

router.get('/settings', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const defaults = buildDefaultSettings();
    const storedSettings = await loadStoredSettings();
    res.json(mergeSettings(defaults, storedSettings));
  } catch (error) {
    console.error('Admin settings load error:', error);
    res.status(500).json({ error: 'Failed to load admin settings' });
  }
});

router.put('/settings', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const incomingSettings = req.body || {};

  try {
    for (const [section, keys] of Object.entries(EDITABLE_SETTINGS_KEYS)) {
      const sectionPayload = incomingSettings[section] || {};
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(sectionPayload, key)) {
          await upsertSetting(section, key, sectionPayload[key]);
        }
      }
    }

    console.log('[ADMIN SETTINGS] Updated by user:', req.user.id, incomingSettings);

    const defaults = buildDefaultSettings();
    const storedSettings = await loadStoredSettings();
    res.json(mergeSettings(defaults, storedSettings));
  } catch (error) {
    console.error('Admin settings update error:', error);
    res.status(500).json({ error: 'Failed to update admin settings' });
  }
});

module.exports = router;
