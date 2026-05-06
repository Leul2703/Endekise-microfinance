const jwt = require('jsonwebtoken');
const { requiresTwoFactor } = require('./twoFactorAuth');
const { db } = require('../config/database');

const ROLE_ALIASES = {
  head_ceo: 'ceo',
  chief_executive_officer: 'ceo',
  chiefexecutiveofficer: 'ceo',
  saver_staff: 'saving_staff',
  savings_staff: 'saving_staff'
};

const normalizeRole = (role) => {
  const normalized = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  return ROLE_ALIASES[normalized] || normalized;
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

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

    const normalizedRole = normalizeRole(user.role);

    if (requiresTwoFactor(normalizedRole) && !user.twoFactorVerified) {
      return res.status(403).json({
        error: 'Two-factor authentication verification required',
        requiresTwoFactor: true
      });
    }

    // Bind JWT to the latest server-side session_id (invalidates older tokens on re-login/logout)
    db.get('SELECT session_id FROM users WHERE id = ?', [user.id], (dbErr, row) => {
      if (dbErr) {
        console.error('Session lookup error:', dbErr);
        return res.status(500).json({ error: 'Database error' });
      }

      const currentSessionId = row?.session_id || null;
      if (!currentSessionId || String(currentSessionId) !== String(user.sessionId)) {
        return res.status(403).json({ error: 'Session expired. Please login again.' });
      }

      db.run('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [user.id], (touchErr) => {
        if (touchErr) {
          console.warn('Failed to update last_seen:', touchErr?.message || touchErr);
        }
        req.user = {
          ...user,
          role: normalizedRole,
          originalRole: user.role
        };
        next();
      });
    });
  });
};

const authorizeRoles = (...allowedRoles) => {
  const normalizedAllowedRoles = allowedRoles.map(normalizeRole);

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const normalizedUserRole = normalizeRole(req.user.role);

    if (!normalizedAllowedRoles.includes(normalizedUserRole)) {
      return res.status(403).json({
        error: `Insufficient permissions for role '${normalizedUserRole || 'unknown'}'`,
        required_roles: normalizedAllowedRoles
      });
    }

    next();
  };
};

module.exports = { authenticateToken, authorizeRoles, normalizeRole };
