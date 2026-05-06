const { db } = require('../config/database');

const LARGE_TRANSACTION_THRESHOLD = 100000;
const AML_LARGE_TRANSACTION_THRESHOLD = 500000;
const AML_STRUCTURING_WINDOW_HOURS = 24;
const AML_RAPID_WINDOW_MINUTES = 10;

const queryOne = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});

const queryMany = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const getClientKycStatus = async (clientId) => {
  const client = await queryOne('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (!client) {
    return { complete: false, status: 'Missing', missing: ['client_record'] };
  }

  const documents = await queryMany('SELECT type FROM documents WHERE client_id = ?', [clientId]);
  const documentTypes = new Set(documents.map((document) => String(document.type || '').toLowerCase()));
  const missing = [];

  if (!client.phone) missing.push('phone');
  if (!client.address) missing.push('address');
  if (!client.id_number && !documentTypes.has('id') && !documentTypes.has('kyc')) missing.push('identity_document');
  if (!client.income_source && !documentTypes.has('income') && !documentTypes.has('proof_of_income')) missing.push('income_source');

  const complete = missing.length === 0;
  return {
    complete,
    status: complete ? 'Verified' : (client.kyc_status || 'Pending'),
    missing,
    client
  };
};

const assertClientKycEligible = async (clientId) => {
  const kyc = await getClientKycStatus(clientId);
  if (!kyc.complete) {
    const error = new Error(`KYC incomplete: missing ${kyc.missing.join(', ')}`);
    error.statusCode = 403;
    error.code = 'KYC_INCOMPLETE';
    error.details = kyc;
    throw error;
  }
  return kyc;
};

const createAmlAlert = async ({ accountId, accountType, clientId, transactionId, alertType, severity = 'medium', amount, details }) => {
  const alertId = `AML-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO aml_alerts (id, account_id, account_type, client_id, transaction_id, alert_type, severity, amount, details, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open')`,
      [alertId, accountId, accountType, clientId || null, transactionId || null, alertType, severity, amount || null, JSON.stringify(details || {})],
      (err) => {
        if (err) reject(err);
        else resolve(alertId);
      }
    );
  });
};

const evaluateAmlAlerts = async ({ accountId, accountType, clientId, amount, transactionType, transactionId }) => {
  const alerts = [];
  if (amount >= AML_LARGE_TRANSACTION_THRESHOLD) {
    alerts.push(createAmlAlert({
      accountId,
      accountType,
      clientId,
      transactionId,
      alertType: 'large_sudden_transfer',
      severity: 'high',
      amount,
      details: { transactionType, threshold: AML_LARGE_TRANSACTION_THRESHOLD }
    }));
  }

  const rapidTransactions = await queryMany(
    `SELECT id, amount, created_at
     FROM transactions
     WHERE account_id = ?
       AND created_at >= datetime('now', ?)
     ORDER BY created_at DESC`,
    [accountId, `-${AML_RAPID_WINDOW_MINUTES} minutes`]
  );
  if (rapidTransactions.length >= 3) {
    alerts.push(createAmlAlert({
      accountId,
      accountType,
      clientId,
      transactionId,
      alertType: 'rapid_repeated_transactions',
      severity: 'medium',
      amount,
      details: { transactionType, count: rapidTransactions.length, window_minutes: AML_RAPID_WINDOW_MINUTES }
    }));
  }

  const structuredTransactions = await queryMany(
    `SELECT id, amount
     FROM transactions
     WHERE account_id = ?
       AND amount < ?
       AND created_at >= datetime('now', ?)
     ORDER BY created_at DESC`,
    [accountId, AML_LARGE_TRANSACTION_THRESHOLD, `-${AML_STRUCTURING_WINDOW_HOURS} hours`]
  );
  const structuredTotal = structuredTransactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  if (structuredTransactions.length >= 3 && structuredTotal >= AML_LARGE_TRANSACTION_THRESHOLD) {
    alerts.push(createAmlAlert({
      accountId,
      accountType,
      clientId,
      transactionId,
      alertType: 'structured_splitting_behavior',
      severity: 'high',
      amount: structuredTotal,
      details: { transactionType, count: structuredTransactions.length, total: structuredTotal, window_hours: AML_STRUCTURING_WINDOW_HOURS }
    }));
  }

  return Promise.all(alerts);
};

module.exports = {
  LARGE_TRANSACTION_THRESHOLD,
  getClientKycStatus,
  assertClientKycEligible,
  evaluateAmlAlerts
};
