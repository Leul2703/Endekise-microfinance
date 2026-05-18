/**
 * Growth Term Saving: fixed monthly deposits, reminders, and interest pause on missed payments.
 */

const { db } = require('../config/database');
const { sendEmailReminder, sendSMSReminder } = require('./notificationService');
const { notifyAdministrators } = require('./adminNotifications');

const GROWTH_TERM_TYPE = 'Growth Term Saving';
const REMINDER_DAYS_BEFORE_DUE = [1];
const REMINDER_DAYS_AFTER_DUE = [1, 2, 3];

const runGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});

const runAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const runExec = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) reject(err);
    else resolve({ changes: this.changes || 0, lastID: this.lastID || null });
  });
});

const safeAlter = (sql) => new Promise((resolve) => {
  db.run(sql, () => resolve());
});

const ensureGrowthTermSchema = async () => {
  await safeAlter('ALTER TABLE savings_accounts ADD COLUMN monthly_deposit_amount REAL');
  await safeAlter('ALTER TABLE savings_accounts ADD COLUMN interest_accrual_paused INTEGER DEFAULT 0');
  await safeAlter('ALTER TABLE savings_accounts ADD COLUMN deposit_due_day INTEGER DEFAULT 1');

  await new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS growth_term_deposit_obligations (
        id TEXT PRIMARY KEY,
        savings_account_id TEXT NOT NULL,
        period_key TEXT NOT NULL,
        due_date TEXT NOT NULL,
        required_amount REAL NOT NULL,
        paid_amount REAL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        reminders_sent TEXT DEFAULT '[]',
        missed_alert_sent INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(savings_account_id, period_key)
      )`,
      (err) => (err ? reject(err) : resolve())
    );
  });

  await safeAlter('ALTER TABLE growth_term_deposit_obligations ADD COLUMN missed_alert_sent INTEGER DEFAULT 0');
};

const isGrowthTermAccount = (account) => String(account?.type || '') === GROWTH_TERM_TYPE;

const getPeriodKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const buildDueDate = (year, monthIndex, dueDay) => {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(Math.max(Number(dueDay) || 1, 1), lastDay);
  const d = new Date(year, monthIndex, day);
  return d.toISOString().split('T')[0];
};

const initializeGrowthTermAccount = async (account) => {
  if (!isGrowthTermAccount(account)) return;

  await ensureGrowthTermSchema();

  const monthlyAmount = Number(account.monthly_deposit_amount || account.amount || 0);
  const createdAt = account.created_at ? new Date(account.created_at) : new Date();
  const dueDay = createdAt.getDate();

  await runExec(
    `UPDATE savings_accounts
     SET monthly_deposit_amount = COALESCE(monthly_deposit_amount, ?),
         deposit_due_day = COALESCE(deposit_due_day, ?),
         interest_accrual_paused = COALESCE(interest_accrual_paused, 0)
     WHERE id = ?`,
    [monthlyAmount, dueDay, account.id]
  );

  await ensureObligationForAccount({
    ...account,
    monthly_deposit_amount: monthlyAmount,
    deposit_due_day: dueDay
  }, new Date());
};

const ensureObligationForAccount = async (account, referenceDate = new Date()) => {
  if (!isGrowthTermAccount(account)) return null;

  const periodKey = getPeriodKey(referenceDate);
  const existing = await runGet(
    'SELECT * FROM growth_term_deposit_obligations WHERE savings_account_id = ? AND period_key = ?',
    [account.id, periodKey]
  );
  if (existing) return existing;

  const dueDay = Number(account.deposit_due_day || 1);
  const dueDate = buildDueDate(referenceDate.getFullYear(), referenceDate.getMonth(), dueDay);
  const requiredAmount = Number(account.monthly_deposit_amount || account.amount || 0);
  const obligationId = `GTO-${account.id}-${periodKey}`;

  await runExec(
    `INSERT INTO growth_term_deposit_obligations
     (id, savings_account_id, period_key, due_date, required_amount, paid_amount, status, reminders_sent, missed_alert_sent)
     VALUES (?, ?, ?, ?, ?, 0, 'pending', '[]', 0)`,
    [obligationId, account.id, periodKey, dueDate, requiredAmount]
  );

  return runGet(
    'SELECT * FROM growth_term_deposit_obligations WHERE savings_account_id = ? AND period_key = ?',
    [account.id, periodKey]
  );
};

const recordGrowthTermDeposit = async (accountId, depositAmount) => {
  const account = await runGet('SELECT * FROM savings_accounts WHERE id = ?', [accountId]);
  if (!isGrowthTermAccount(account)) return;

  await ensureGrowthTermSchema();
  const obligation = await ensureObligationForAccount(account);
  if (!obligation) return;

  const required = Number(obligation.required_amount || 0);
  const paid = Number(obligation.paid_amount || 0) + Number(depositAmount || 0);
  const nextStatus = paid >= required - 0.005 ? 'paid' : 'partial';

  await runExec(
    `UPDATE growth_term_deposit_obligations
     SET paid_amount = ?, status = ?
     WHERE id = ?`,
    [paid, nextStatus, obligation.id]
  );

  if (nextStatus === 'paid') {
    await runExec(
      `UPDATE savings_accounts SET interest_accrual_paused = 0 WHERE id = ?`,
      [accountId]
    );
  }
};

const shouldAccrueInterest = async (account) => {
  if (!isGrowthTermAccount(account)) return true;
  if (Number(account.interest_accrual_paused || 0) === 1) return false;

  await ensureGrowthTermSchema();
  const obligation = await ensureObligationForAccount(account);
  if (!obligation) return true;

  const today = new Date().toISOString().split('T')[0];
  if (obligation.status === 'paid') return true;
  if (today <= obligation.due_date) return true;

  return false;
};

const daysBetween = (fromDate, toDate) => {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
};

const parseRemindersSent = (value) => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const reminderKey = (phase, day) => `${phase}:${day}`;

const sendClientDepositReminder = async ({ account, obligation, subject, text, smsMessage, phase, day }) => {
  if (account.client_email) {
    await sendEmailReminder({
      to: account.client_email,
      subject,
      text,
      category: 'deposit_reminder',
      clientId: account.client_id,
      metadata: {
        savings_account_id: account.id,
        period_key: obligation.period_key,
        phase,
        day,
        client_id: account.client_id
      }
    });
  }

  if (account.client_phone) {
    await sendSMSReminder({
      client_id: account.client_id,
      phone: account.client_phone,
      message: smsMessage,
      event_type: 'deposit_reminder',
      related_account_id: account.id
    });
  }
};

const processMissedDepositAlert = async ({ account, obligation, daysLate }) => {
  if (Number(obligation.missed_alert_sent || 0) === 1) return;

  const remaining = Math.max(0, Number(obligation.required_amount || 0) - Number(obligation.paid_amount || 0));
  const clientSubject = `Missed monthly deposit – account ${account.id}`;
  const clientText = `Dear ${account.client_name || 'Client'},

Our records show that your required monthly deposit of ${obligation.required_amount} ETB for Growth Term account ${account.id} was due on ${obligation.due_date} and has not been received (${daysLate} day(s) overdue).

Please deposit ${remaining > 0 ? remaining : obligation.required_amount} ETB as soon as possible. Interest accrual may be paused until the deposit is completed.

Edekise Microfinance`;

  if (account.client_email) {
    await sendEmailReminder({
      to: account.client_email,
      subject: clientSubject,
      text: clientText,
      category: 'missed_deposit',
      clientId: account.client_id,
      metadata: { savings_account_id: account.id, period_key: obligation.period_key, days_late: daysLate }
    });
  }

  if (account.client_phone) {
    await sendSMSReminder({
      client_id: account.client_id,
      phone: account.client_phone,
      message: `ALERT: Missed Growth Term deposit for ${account.id}. ${remaining > 0 ? remaining : obligation.required_amount} ETB overdue since ${obligation.due_date}.`,
      event_type: 'missed_deposit',
      related_account_id: account.id
    });
  }

  await notifyAdministrators({
    type: 'missed_deposit',
    title: 'Missed monthly deposit',
    message: `Client ${account.client_name || account.client_id} missed Growth Term deposit for ${account.id} (due ${obligation.due_date}, ${daysLate} days late).`,
    entityType: 'savings_account',
    entityId: account.id,
    emailSubject: `[Alert] Missed deposit – ${account.client_name || account.id}`,
    emailText: `A scheduled monthly deposit was missed.

Client: ${account.client_name || 'Unknown'}
Account: ${account.id}
Due date: ${obligation.due_date}
Required: ${obligation.required_amount} ETB
Paid: ${obligation.paid_amount || 0} ETB
Days overdue: ${daysLate}

Review the account in the admin portal.`
  });

  await runExec(
    `UPDATE growth_term_deposit_obligations SET status = 'missed', missed_alert_sent = 1 WHERE id = ?`,
    [obligation.id]
  );
  await runExec(
    `UPDATE savings_accounts SET interest_accrual_paused = 1 WHERE id = ?`,
    [account.id]
  );
};

const processGrowthTermReminders = async () => {
  await ensureGrowthTermSchema();

  const accounts = await runAll(
    `SELECT s.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone
     FROM savings_accounts s
     JOIN clients c ON c.id = s.client_id
     WHERE s.status = 'Active' AND s.type = ?`,
    [GROWTH_TERM_TYPE]
  );

  const today = new Date().toISOString().split('T')[0];

  for (const account of accounts) {
    const obligation = await ensureObligationForAccount(account);
    if (!obligation || obligation.status === 'paid') continue;

    const daysLate = daysBetween(obligation.due_date, today);
    const daysUntilDue = daysBetween(today, obligation.due_date);
    const sent = parseRemindersSent(obligation.reminders_sent);
    const amountLabel = Number(obligation.required_amount || 0).toLocaleString();

    // Pre-due reminder (1 day before)
    for (const day of REMINDER_DAYS_BEFORE_DUE) {
      if (daysUntilDue !== day) continue;
      const key = reminderKey('before', day);
      if (sent.includes(key)) continue;

      await sendClientDepositReminder({
        account,
        obligation,
        subject: `Monthly deposit due tomorrow – ${account.id}`,
        text: `Dear ${account.client_name || 'Client'},

Your fixed monthly deposit of ${amountLabel} ETB for Growth Term account ${account.id} is due tomorrow (${obligation.due_date}).

Please ensure funds are available so your account remains in good standing.

Edekise Microfinance`,
        smsMessage: `Reminder: Growth Term deposit ${amountLabel} ETB for ${account.id} is due tomorrow (${obligation.due_date}).`,
        phase: 'before',
        day
      });
      sent.push(key);
    }

    // Due today
    if (daysLate === 0) {
      const key = reminderKey('due', 0);
      if (!sent.includes(key)) {
        await sendClientDepositReminder({
          account,
          obligation,
          subject: `Monthly deposit due today – ${account.id}`,
          text: `Dear ${account.client_name || 'Client'},

Your fixed monthly deposit of ${amountLabel} ETB for Growth Term account ${account.id} is due today (${obligation.due_date}).

Please complete the deposit to keep earning interest on your account.

Edekise Microfinance`,
          smsMessage: `Today: Please deposit ${amountLabel} ETB for Growth Term account ${account.id}.`,
          phase: 'due',
          day: 0
        });
        sent.push(key);
      }
    }

    // Overdue reminders (days 1–3 after due date)
    if (daysLate > 0) {
      for (const day of REMINDER_DAYS_AFTER_DUE) {
        if (daysLate !== day || sent.includes(reminderKey('after', day))) continue;

        await sendClientDepositReminder({
          account,
          obligation,
          subject: `Deposit overdue (${day} day${day > 1 ? 's' : ''}) – ${account.id}`,
          text: `Dear ${account.client_name || 'Client'},

Your fixed monthly deposit of ${amountLabel} ETB for Growth Term account ${account.id} was due on ${obligation.due_date}.
This is reminder ${day} of 3 after the due date. Please deposit the required amount to keep earning interest.

Edekise Microfinance`,
          smsMessage: `Reminder: Growth Term deposit ${amountLabel} ETB for ${account.id} is ${day} day(s) overdue.`,
          phase: 'after',
          day
        });
        sent.push(reminderKey('after', day));
      }

      if (daysLate > Math.max(...REMINDER_DAYS_AFTER_DUE)) {
        await processMissedDepositAlert({ account, obligation, daysLate });
      }
    }

    await runExec(
      'UPDATE growth_term_deposit_obligations SET reminders_sent = ? WHERE id = ?',
      [JSON.stringify(sent), obligation.id]
    );
  }
};

const getClientDepositObligations = async (clientId) => {
  await ensureGrowthTermSchema();
  return runAll(
    `SELECT o.*, s.type AS account_type, s.monthly_deposit_amount, s.interest_accrual_paused
     FROM growth_term_deposit_obligations o
     JOIN savings_accounts s ON s.id = o.savings_account_id
     WHERE s.client_id = ?
     ORDER BY o.due_date DESC
     LIMIT 24`,
    [clientId]
  );
};

module.exports = {
  GROWTH_TERM_TYPE,
  ensureGrowthTermSchema,
  initializeGrowthTermAccount,
  recordGrowthTermDeposit,
  shouldAccrueInterest,
  processGrowthTermReminders,
  getClientDepositObligations,
  ensureObligationForAccount
};
