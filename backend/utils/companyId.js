const ROLE_PREFIX = {
  admin: 'ADM',
  ceo: 'CEO',
  branch_manager: 'BRM',
  loan_staff: 'LNS',
  saving_staff: 'SVS',
  client: 'CLI'
};

const normalizeRole = (role) => String(role || '').trim().toLowerCase();

const buildCompanyId = (role, numericId) => {
  const prefix = ROLE_PREFIX[normalizeRole(role)] || 'USR';
  const padded = String(Number(numericId || 0)).padStart(6, '0');
  return `${prefix}-${padded}`;
};

module.exports = { buildCompanyId };

