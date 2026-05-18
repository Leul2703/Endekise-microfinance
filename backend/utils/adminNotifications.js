const { db } = require('../config/database');
const { sendEmailReminder } = require('./notificationService');

const runAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const runExec = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) reject(err);
    else resolve({ changes: this.changes || 0 });
  });
});

const getStaffUsers = async (roles = ['admin', 'branch_manager']) => {
  const placeholders = roles.map(() => '?').join(', ');
  return runAll(
    `SELECT id, name, email, role FROM users
     WHERE role IN (${placeholders}) AND status = 'Active' AND email IS NOT NULL`,
    roles
  );
};

const insertNotification = async ({ userId, type, title, message, entityType, entityId }) => {
  await runExec(
    `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id, read_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [userId, type, title, message, entityType || null, entityId || null, new Date().toISOString()]
  );
};

/**
 * Notify administrators and branch managers (in-app + email).
 */
async function notifyAdministrators({ type, title, message, entityType, entityId, emailSubject, emailText }) {
  const staff = await getStaffUsers(['admin', 'branch_manager']);
  const results = [];

  for (const user of staff) {
    try {
      await insertNotification({
        userId: user.id,
        type,
        title,
        message,
        entityType,
        entityId
      });
    } catch (err) {
      console.warn('[NOTIFY] Failed to insert notification for user', user.id, err?.message);
    }

    if (user.email && emailSubject && emailText) {
      try {
        const emailResult = await sendEmailReminder({
          to: user.email,
          subject: emailSubject,
          text: emailText,
          category: type,
          metadata: { entity_type: entityType, entity_id: entityId }
        });
        results.push({ user_id: user.id, email: emailResult.success });
      } catch (err) {
        console.warn('[NOTIFY] Email to staff failed', user.email, err?.message);
      }
    }
  }

  return { notified: staff.length, results };
}

module.exports = {
  notifyAdministrators,
  insertNotification,
  getStaffUsers
};
