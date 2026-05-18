const { db } = require('../config/database');
const { normalizeEmail, normalizeEthiopianPhone, normalizeNationalId, normalizeText } = require('./inputValidators');

const runGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});

const phonesMatch = (stored, incoming) => {
  const a = normalizeEthiopianPhone(stored);
  const b = normalizeEthiopianPhone(incoming);
  if (a && b) return a === b;
  return normalizeText(stored) === normalizeText(incoming);
};

/**
 * Prevent duplicate account registration across clients, users, and pending requests.
 */
const findDuplicateRegistration = async ({
  name,
  email,
  phone,
  id_number,
  id_type,
  excludeClientId = null
}) => {
  const flags = [];
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizeEthiopianPhone(phone);
  const normalizedName = normalizeText(name);
  const normalizedId = (id_type === 'National ID' || id_type === 'Fayda ID')
    ? normalizeNationalId(id_number)
    : normalizeText(id_number);

  if (normalizedName) {
    const row = await runGet(
      `SELECT id FROM clients WHERE lower(name) = lower(?)${excludeClientId ? ' AND id != ?' : ''}`,
      excludeClientId ? [normalizedName, excludeClientId] : [normalizedName]
    );
    if (row) flags.push('DUPLICATE_NAME');
  }

  if (normalizedEmail) {
    const clientEmail = await runGet(
      `SELECT id FROM clients WHERE lower(email) = ?${excludeClientId ? ' AND id != ?' : ''}`,
      excludeClientId ? [normalizedEmail, excludeClientId] : [normalizedEmail]
    );
    if (clientEmail) flags.push('DUPLICATE_EMAIL');

    const userEmail = await runGet('SELECT id FROM users WHERE lower(email) = ?', [normalizedEmail]);
    if (userEmail) flags.push('DUPLICATE_USER_EMAIL');
  }

  if (normalizedPhone) {
    const clientRows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, phone FROM clients${excludeClientId ? ' WHERE id != ?' : ''}`,
        excludeClientId ? [excludeClientId] : [],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });
    if (clientRows.some((row) => phonesMatch(row.phone, normalizedPhone))) {
      flags.push('DUPLICATE_PHONE');
    }

    const userRows = await new Promise((resolve, reject) => {
      db.all('SELECT id, phone FROM users WHERE phone IS NOT NULL', [], (err, rows) => (
        err ? reject(err) : resolve(rows || [])
      ));
    });
    if (userRows.some((row) => phonesMatch(row.phone, normalizedPhone))) {
      flags.push('DUPLICATE_USER_PHONE');
    }
  }

  if (normalizedId) {
    const idRow = await runGet(
      `SELECT id FROM clients WHERE id_number = ?${excludeClientId ? ' AND id != ?' : ''}`,
      excludeClientId ? [normalizedId, excludeClientId] : [normalizedId]
    );
    if (idRow) flags.push('DUPLICATE_ID_NUMBER');
  }

  if (normalizedEmail || normalizedPhone || normalizedId) {
    const pending = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, email, phone, id_number, status
         FROM client_registration_requests
         WHERE status IS NULL OR status IN ('Pending Admin Review', 'Pending')`,
        [],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });

    for (const request of pending) {
      if (excludeClientId && Number(request.client_id) === Number(excludeClientId)) continue;
      if (normalizedEmail && normalizeEmail(request.email) === normalizedEmail) {
        flags.push('DUPLICATE_PENDING_EMAIL');
        break;
      }
      if (normalizedPhone && phonesMatch(request.phone, normalizedPhone)) {
        flags.push('DUPLICATE_PENDING_PHONE');
        break;
      }
      if (normalizedId && normalizeText(request.id_number) === normalizedId) {
        flags.push('DUPLICATE_PENDING_ID');
        break;
      }
    }
  }

  return [...new Set(flags)];
};

const duplicateRegistrationMessage = (flags = []) => {
  if (flags.some((f) => f.includes('EMAIL'))) return 'An account with this email already exists or is pending review.';
  if (flags.some((f) => f.includes('PHONE'))) return 'An account with this phone number already exists or is pending review.';
  if (flags.some((f) => f.includes('ID'))) return 'This ID number is already registered or pending review.';
  if (flags.includes('DUPLICATE_NAME')) return 'A client with this name already exists.';
  return 'Duplicate registration detected.';
};

module.exports = {
  findDuplicateRegistration,
  duplicateRegistrationMessage
};
