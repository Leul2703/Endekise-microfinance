const { db } = require('../config/database');

/** Required savings balance as % of requested loan (default 30%). */
const COLLATERAL_PERCENT = Number(process.env.LOAN_SAVINGS_COLLATERAL_PERCENT || 30);
/** Minimum informational threshold (default 20%). */
const MIN_PERCENT = Number(process.env.LOAN_SAVINGS_MIN_PERCENT || 20);

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const runQuery = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});

const countLoanDocuments = async (clientId, loanId = null) => {
  if (loanId) {
    const row = await runQuery(
      `SELECT COUNT(*) AS count
       FROM documents
       WHERE client_id = ?
         AND (loan_id = ? OR related_entity_type = 'loan_account' AND related_entity_id = ?)`,
      [clientId, loanId, loanId]
    );
    return Number(row?.count || 0);
  }

  const row = await runQuery(
    `SELECT COUNT(*) AS count FROM documents WHERE client_id = ?`,
    [clientId]
  );
  return Number(row?.count || 0);
};

/**
 * Evaluate savings collateral + supporting documents for loan approval.
 */
async function evaluateLoanSavingsRequirement({ savingsAccount, loanAmount, clientId, loanId = null }) {
  const principal = Number(loanAmount || 0);
  const savingsBalance = Number(savingsAccount?.amount || 0);
  const requiredAmount = roundMoney(principal * (COLLATERAL_PERCENT / 100));
  const minimumAmount = roundMoney(principal * (MIN_PERCENT / 100));
  const documentCount = await countLoanDocuments(clientId, loanId);
  const hasDocuments = documentCount > 0;
  const meetsSavings = savingsBalance + 0.005 >= requiredAmount;
  const meetsMinimum = savingsBalance + 0.005 >= minimumAmount;

  return {
    collateral_percent: COLLATERAL_PERCENT,
    minimum_percent: MIN_PERCENT,
    loan_amount: principal,
    savings_balance: savingsBalance,
    savings_account_id: savingsAccount?.id || null,
    required_savings_amount: requiredAmount,
    minimum_savings_amount: minimumAmount,
    savings_shortfall: meetsSavings ? 0 : roundMoney(requiredAmount - savingsBalance),
    savings_ratio_percent: principal > 0 ? roundMoney((savingsBalance / principal) * 100) : 0,
    document_count: documentCount,
    has_documents: hasDocuments,
    meets_savings: meetsSavings,
    meets_minimum: meetsMinimum,
    meets_documents: hasDocuments,
    eligible: meetsSavings && hasDocuments,
    message: !meetsSavings && !hasDocuments
      ? `Loan requires ${COLLATERAL_PERCENT}% (${requiredAmount.toLocaleString()} ETB) in savings and at least one supporting document.`
      : !meetsSavings
        ? `Savings balance must be at least ${COLLATERAL_PERCENT}% of the loan (${requiredAmount.toLocaleString()} ETB). Current: ${savingsBalance.toLocaleString()} ETB.`
        : !hasDocuments
          ? 'At least one supporting document must be uploaded before loan approval.'
          : 'Savings collateral and documents meet loan approval requirements.'
  };
}

async function assertLoanSavingsRequirement({ savingsAccount, loanAmount, clientId, loanId = null }) {
  const evaluation = await evaluateLoanSavingsRequirement({ savingsAccount, loanAmount, clientId, loanId });
  if (!evaluation.eligible) {
    const error = new Error(evaluation.message);
    error.statusCode = 400;
    error.details = evaluation;
    throw error;
  }
  return evaluation;
}

module.exports = {
  COLLATERAL_PERCENT,
  MIN_PERCENT,
  evaluateLoanSavingsRequirement,
  assertLoanSavingsRequirement,
  countLoanDocuments
};
