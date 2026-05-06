const crypto = require('crypto');
const { db } = require('../config/database');

const getPreviousHash = () => new Promise((resolve, reject) => {
  db.get('SELECT event_hash FROM audit_trail ORDER BY id DESC LIMIT 1', [], (err, row) => {
    if (err) reject(err);
    else resolve(row?.event_hash || null);
  });
});

const createHash = (payload) => crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const recordAuditEvent = async ({
  action,
  entityType = null,
  entityId = null,
  user = null,
  beforeState = null,
  afterState = null,
  details = {},
  status = 'Success',
  ipAddress = null,
  userAgent = null
}) => {
  const previousHash = await getPreviousHash();
  const timestamp = new Date().toISOString();
  const payload = {
    action,
    entityType,
    entityId,
    userId: user?.id || null,
    userRole: user?.role || 'anonymous',
    beforeState,
    afterState,
    details,
    status,
    timestamp,
    previousHash
  };
  const eventHash = createHash(payload);

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO audit_trail
       (action, entity_type, entity_id, user_id, user_role, details, timestamp, ip_address, user_agent, previous_hash, event_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        action,
        entityType,
        entityId,
        user?.id || null,
        user?.role || 'anonymous',
        JSON.stringify({ ...details, beforeState, afterState }),
        timestamp,
        ipAddress,
        userAgent,
        previousHash,
        eventHash,
        status
      ],
      (err) => {
        if (err) reject(err);
        else resolve({ eventHash, previousHash, timestamp });
      }
    );
  });
};

module.exports = { recordAuditEvent };
