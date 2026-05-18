const LATE_PENALTY_RATE = Number(process.env.LOAN_LATE_PENALTY_RATE || 1);

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const isInstallmentOverdue = (dueDate, status) => {
  if (!dueDate) return false;
  if (status === 'Overdue') return true;
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return due < startOfToday() && status !== 'Paid';
};

const computeExpectedPenalty = (payment) => {
  const total = Number(payment?.total_amount || 0);
  if (!isInstallmentOverdue(payment?.due_date, payment?.status)) {
    return 0;
  }
  return roundMoney(total * (LATE_PENALTY_RATE / 100));
};

const enrichPaymentScheduleRow = (payment) => {
  const total = Number(payment.total_amount || 0);
  const paid = Number(payment.paid_amount || 0);
  const storedPenalty = Number(payment.penalty_amount || 0);
  const penaltyPaid = Number(payment.penalty_paid || 0);
  const expectedPenalty = computeExpectedPenalty(payment);
  const penaltyAmount = Math.max(storedPenalty, expectedPenalty);
  const installmentOwed = total + penaltyAmount;
  const installmentRemaining = Math.max(0, roundMoney(installmentOwed - paid));
  const isPartial = payment.status === 'Partial' || (paid > 0.005 && paid + 0.005 < installmentOwed);
  const daysOverdue = payment.due_date && isInstallmentOverdue(payment.due_date, payment.status)
    ? Math.max(0, Math.floor((startOfToday() - new Date(payment.due_date)) / (24 * 60 * 60 * 1000)))
    : 0;

  return {
    ...payment,
    penalty_rate_percent: LATE_PENALTY_RATE,
    expected_penalty: expectedPenalty,
    penalty_amount: penaltyAmount,
    penalty_paid: penaltyPaid,
    penalty_remaining: Math.max(0, roundMoney(penaltyAmount - penaltyPaid)),
    installment_remaining: installmentRemaining,
    paid_amount: paid,
    is_partial: isPartial,
    is_overdue: isInstallmentOverdue(payment.due_date, payment.status),
    days_overdue: daysOverdue
  };
};

const buildPenaltySchedule = (scheduleRows = []) => {
  const enriched = scheduleRows.map(enrichPaymentScheduleRow);
  const overdueRows = enriched.filter((row) => row.is_overdue && row.installment_remaining > 0);

  return {
    penalty_rate_percent: LATE_PENALTY_RATE,
    description: `Late payment penalty: ${LATE_PENALTY_RATE}% of installment amount per overdue period`,
    total_penalty_outstanding: roundMoney(
      overdueRows.reduce((sum, row) => sum + row.penalty_remaining, 0)
    ),
    total_installments_overdue: overdueRows.length,
    schedule: enriched
  };
};

module.exports = {
  LATE_PENALTY_RATE,
  computeExpectedPenalty,
  enrichPaymentScheduleRow,
  buildPenaltySchedule,
  isInstallmentOverdue
};
