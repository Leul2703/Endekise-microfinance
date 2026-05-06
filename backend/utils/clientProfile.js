const { db } = require('../config/database');

const queryOne = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});

const getUserRecord = async (userId) => queryOne(
  'SELECT id, username, role, name, status FROM users WHERE id = ?',
  [userId]
);

const resolveClientProfileByUser = async (user) => {
  if (!user?.name) {
    return null;
  }

  const existingClient = await queryOne(
    'SELECT * FROM clients WHERE name = ? ORDER BY id ASC LIMIT 1',
    [user.name]
  );

  return existingClient || null;
};

module.exports = {
  getUserRecord,
  resolveClientProfileByUser
};
