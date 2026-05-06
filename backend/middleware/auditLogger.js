const { db } = require('../config/database');

/**
 * Comprehensive audit logging middleware
 * Logs all sensitive actions to the audit_trail table
 */
const auditLogger = (action) => {
  return (req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Only log on successful responses (2xx, 3xx)
      if (res.statusCode < 400) {
        const userId = req.user?.id || null;
        const userRole = req.user?.role || 'anonymous';
        const ipAddress = req.ip || req.connection.remoteAddress;
        
        const details = {
          action: action,
          method: req.method,
          path: req.path,
          body: sanitizeRequestBody(req.body),
          params: req.params,
          query: req.query,
          statusCode: res.statusCode
        };
        
        db.run(
          'INSERT INTO audit_trail (action, user_id, user_role, details, ip_address, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [action, userId, userRole, JSON.stringify(details), ipAddress, new Date().toISOString()],
          (err) => {
            if (err) {
              console.error('[AUDIT] Failed to log audit entry:', err);
            }
          }
        );
      }
      
      originalSend.call(this, data);
    };
    
    next();
  };
};

/**
 * Sanitize request body to remove sensitive data before logging
 */
const sanitizeRequestBody = (body) => {
  if (!body) return null;
  
  const sensitiveFields = ['password', 'currentPassword', 'newPassword', 'token', 'secret'];
  const sanitized = { ...body };
  
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });
  
  return sanitized;
};

/**
 * Format audit log details into human-readable description
 */
const formatAuditLogDetails = (details) => {
  try {
    const parsed = typeof details === 'string' ? JSON.parse(details) : details;
    
    // Create human-readable description
    let description = '';
    
    switch (parsed.action) {
      case 'LOGIN':
        description = `User logged in successfully`;
        break;
      case 'LOGOUT':
        description = `User logged out`;
        break;
      case 'CREATE_USER':
        description = `New user account created`;
        break;
      case 'UPDATE_USER':
        description = `User account information updated`;
        break;
      case 'DELETE_USER':
        description = `User account deleted`;
        break;
      case 'CREATE_LOAN':
        description = `New loan application submitted`;
        break;
      case 'APPROVE_LOAN':
        description = `Loan application approved`;
        break;
      case 'REJECT_LOAN':
        description = `Loan application rejected`;
        break;
      case 'CREATE_SAVINGS':
        description = `New savings account created`;
        break;
      case 'APPROVE_SAVINGS':
        description = `Savings account approved`;
        break;
      case 'REJECT_SAVINGS':
        description = `Savings account rejected`;
        break;
      case 'DEPOSIT':
        description = `Deposit transaction processed`;
        break;
      case 'WITHDRAWAL':
        description = `Withdrawal transaction processed`;
        break;
      case 'PAYMENT':
        description = `Loan payment processed`;
        break;
      case 'BALANCE_INQUIRY':
        description = `Account balance inquiry performed`;
        break;
      case 'DATA_ACCESS':
        description = `Sensitive data accessed`;
        break;
      default:
        // Generic format for unknown actions
        const actionWords = parsed.action ? parsed.action.split('_').join(' ').toLowerCase() : 'action';
        description = `User performed ${actionWords}`;
    }
    
    // Add additional context if available
    if (parsed.path && parsed.action !== 'LOGIN' && parsed.action !== 'LOGOUT') {
      description += ` on ${parsed.path}`;
    }
    
    if (parsed.statusCode) {
      const status = parsed.statusCode >= 200 && parsed.statusCode < 300 ? 'successfully' : 'with error';
      description += ` ${status}`;
    }
    
    return description;
  } catch (error) {
    // If parsing fails, return a simple description
    return 'Audit log entry';
  }
};

/**
 * Log data access (read operations on sensitive data)
 */
const logDataAccess = (userId, userRole, entityType, entityId, ipAddress) => {
  const details = {
    action: 'DATA_ACCESS',
    entityType,
    entityId,
    timestamp: new Date().toISOString()
  };
  
  db.run(
    'INSERT INTO audit_trail (action, user_id, user_role, details, ip_address, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
    ['DATA_ACCESS', userId, userRole, JSON.stringify(details), ipAddress, new Date().toISOString()],
    (err) => {
      if (err) {
        console.error('[AUDIT] Failed to log data access:', err);
      }
    }
  );
};

module.exports = { auditLogger, logDataAccess, formatAuditLogDetails };
