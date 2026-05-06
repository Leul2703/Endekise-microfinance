const { db } = require('../config/database');
const { sendLoanApprovalEmail, sendLoanRejectionEmail } = require('./emailService');

const HIGH_VALUE_THRESHOLD = 100000;

const formatAmount = (value) => Number(value || 0);

const generateLoanAccountNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `LN-${timestamp}-${random}`;
};

const generateTransactionId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `TXN-${timestamp}-${random}`;
};

const generateScheduleId = (loanId, sequence) => `${loanId}-PMT-${String(sequence).padStart(3, '0')}`;

const parseTermMonths = (term) => {
  if (typeof term === 'number') {
    return term;
  }

  const numeric = String(term || '').match(/\d+/);
  return numeric ? parseInt(numeric[0], 10) : 12;
};

const addMonthsKeepingDay = (dateInput, monthsToAdd) => {
  const source = new Date(dateInput);
  const originalDay = source.getDate();
  const result = new Date(source);
  result.setMonth(result.getMonth() + monthsToAdd, 1);

  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));

  return result;
};

const buildRepaymentSchedule = ({ loanId, principal, interestRate, termMonths, paymentFrequency = 'Monthly', originationDate }) => {
  const normalizedPrincipal = formatAmount(principal);
  const normalizedInterestRate = formatAmount(interestRate);
  const normalizedTerm = parseTermMonths(termMonths);
  const effectiveDate = originationDate ? new Date(originationDate) : new Date();
  const monthlyRate = normalizedInterestRate / 100 / 12;

  let periodicPayment = 0;
  if (monthlyRate === 0) {
    periodicPayment = normalizedPrincipal / normalizedTerm;
  } else {
    periodicPayment = normalizedPrincipal *
      (monthlyRate * Math.pow(1 + monthlyRate, normalizedTerm)) /
      (Math.pow(1 + monthlyRate, normalizedTerm) - 1);
  }

  let balanceRemaining = normalizedPrincipal;
  const schedule = [];

  for (let installment = 1; installment <= normalizedTerm; installment += 1) {
    const dueDate = addMonthsKeepingDay(effectiveDate, installment);
    const interestAmount = monthlyRate === 0 ? 0 : balanceRemaining * monthlyRate;
    let principalAmount = periodicPayment - interestAmount;

    if (installment === normalizedTerm) {
      principalAmount = balanceRemaining;
    }

    balanceRemaining = Math.max(0, balanceRemaining - principalAmount);

    schedule.push({
      id: generateScheduleId(loanId, installment),
      loan_id: loanId,
      due_date: dueDate.toISOString().split('T')[0],
      principal_amount: Math.round(principalAmount * 100) / 100,
      interest_amount: Math.round(interestAmount * 100) / 100,
      total_amount: Math.round((principalAmount + interestAmount) * 100) / 100,
      balance_remaining: Math.round(balanceRemaining * 100) / 100,
      status: 'Pending'
    });
  }

  return {
    schedule,
    monthlyPayment: Math.round(periodicPayment * 100) / 100
  };
};

const runQuery = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});

const runMany = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const runExec = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) {
      return reject(err);
    }

    resolve({
      lastID: this.lastID,
      changes: this.changes
    });
  });
});

const fetchLoanWithClient = async (loanId) => runQuery(`
  SELECT la.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone
  FROM loan_accounts la
  JOIN clients c ON c.id = la.client_id
  WHERE la.id = ?
`, [loanId]);

const logAudit = async ({ action, entityId, user, details }) => {
  await runExec(
    `INSERT INTO audit_trail (action, entity_type, entity_id, user_id, user_role, details, timestamp, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      action,
      'loan_account',
      entityId,
      user?.id || null,
      user?.role || 'system',
      JSON.stringify(details || {}),
      new Date().toISOString(),
      'Success'
    ]
  );
};

const logEmailStatus = async ({ recipientEmail, subject, body, status, errorMessage = null }) => {
  await runExec(
    `INSERT INTO email_log (recipient_email, subject, body, status, error_message, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [recipientEmail, subject, body, status, errorMessage, new Date().toISOString()]
  );
};

const sendLoanStatusEmail = async (loan, status, reason = null) => {
  if (!loan?.client_email) {
    return { success: false, skipped: true, error: 'Client email not available' };
  }

  const result = status === 'approved'
    ? await sendLoanApprovalEmail(loan)
    : await sendLoanRejectionEmail(loan, reason);

  const subject = status === 'approved'
    ? `Loan Application Approved - ${loan.id}`
    : `Loan Application Update - ${loan.id}`;
  const body = status === 'approved'
    ? `Loan ${loan.id} was approved and activated for ${loan.client_name}.`
    : `Loan ${loan.id} was rejected for ${loan.client_name}. Reason: ${reason || 'Not specified'}`;

  await logEmailStatus({
    recipientEmail: loan.client_email,
    subject,
    body,
    status: result.success ? 'Sent' : 'Failed',
    errorMessage: result.success ? null : result.error
  });

  return result;
};

const activateLoanAccount = async ({ loanId, activatedBy, activationReason, originationDate }) => {
  const loan = await fetchLoanWithClient(loanId);
  if (!loan) {
    throw new Error('Loan account not found');
  }

  const effectiveOriginationDate = originationDate || loan.disbursement_date || new Date().toISOString().split('T')[0];
  const termMonths = parseTermMonths(loan.term);
  const { schedule, monthlyPayment } = buildRepaymentSchedule({
    loanId,
    principal: loan.amount,
    interestRate: loan.interest_rate,
    termMonths,
    paymentFrequency: loan.payment_frequency,
    originationDate: effectiveOriginationDate
  });

  await runExec(
    `UPDATE loan_accounts
     SET status = 'Active', disbursement_date = ?, payment_frequency = ?, term = ?, balance = ?
     WHERE id = ?`,
    [effectiveOriginationDate, loan.payment_frequency || 'Monthly', String(termMonths), loan.amount, loanId]
  );

  await runExec('DELETE FROM payment_schedule WHERE loan_id = ?', [loanId]);
  for (const payment of schedule) {
    await runExec(
      `INSERT INTO payment_schedule (id, loan_id, due_date, principal_amount, interest_amount, total_amount, balance_remaining, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payment.id,
        payment.loan_id,
        payment.due_date,
        payment.principal_amount,
        payment.interest_amount,
        payment.total_amount,
        payment.balance_remaining,
        payment.status
      ]
    );
  }

  await runExec(
    `INSERT INTO transactions (id, account_id, account_type, transaction_type, amount, balance_before, balance_after, description, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateTransactionId(),
      loanId,
      'loan',
      'loan_origination',
      formatAmount(loan.amount),
      0,
      formatAmount(loan.amount),
      activationReason || 'Initial loan disbursement',
      activatedBy?.id || null,
      new Date().toISOString()
    ]
  );

  const refreshedLoan = await fetchLoanWithClient(loanId);
  await sendLoanStatusEmail(refreshedLoan, 'approved');
  await logAudit({
    action: 'LOAN_ACTIVATED',
    entityId: loanId,
    user: activatedBy,
    details: {
      activation_reason: activationReason,
      monthly_payment: monthlyPayment,
      origination_date: effectiveOriginationDate,
      total_schedule_entries: schedule.length
    }
  });

  return {
    loan: refreshedLoan,
    schedule,
    monthlyPayment
  };
};

const rejectLoanAccount = async ({ loanId, rejectedBy, reason }) => {
  await runExec(
    `UPDATE loan_accounts SET status = 'Rejected' WHERE id = ?`,
    [loanId]
  );

  const loan = await fetchLoanWithClient(loanId);
  if (loan) {
    await sendLoanStatusEmail(loan, 'rejected', reason);
  }

  await logAudit({
    action: 'LOAN_REJECTED',
    entityId: loanId,
    user: rejectedBy,
    details: { reason }
  });

  return loan;
};

module.exports = {
  HIGH_VALUE_THRESHOLD,
  activateLoanAccount,
  buildRepaymentSchedule,
  fetchLoanWithClient,
  generateLoanAccountNumber,
  logAudit,
  parseTermMonths,
  rejectLoanAccount,
  runExec,
  runMany,
  runQuery
};
