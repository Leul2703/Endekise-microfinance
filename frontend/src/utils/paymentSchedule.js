/**
 * Payment schedule helpers for installment-level remaining balances.
 */

export function getInstallmentRemaining(payment) {
  if (!payment) return null;

  const total = Number(payment.total_amount || 0);
  const paid = Number(payment.paid_amount || 0);
  const penalty = Number(payment.penalty_amount || 0);
  const owed = total + penalty;

  if (payment.status === 'Partial' || (paid > 0.005 && paid + 0.005 < owed)) {
    return Math.max(0, Math.round((owed - paid) * 100) / 100);
  }

  return null;
}

export function formatScheduleAmount(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
}

export function getInstallmentRemainingFromRow(payment) {
  if (payment?.installment_remaining != null) {
    return Number(payment.installment_remaining);
  }
  return getInstallmentRemaining(payment);
}
