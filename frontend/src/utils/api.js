const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

// Helper function to get auth token
const getAuthToken = () => {
  return localStorage.getItem('token');
};

// Generic fetch wrapper with auth headers
const fetchWithAuth = async (endpoint, options = {}) => {
  const token = getAuthToken();
  const controller = new AbortController();
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 20000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...options.headers
  };

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
      cache: 'no-store',
      signal: options.signal || controller.signal
    });
  } catch (networkError) {
    if (networkError?.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw new Error(networkError?.message || 'Network error. Please check your connection and try again.');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    if (errorJson?.error || errorJson?.reason || errorJson?.message) {
      const err = new Error(errorJson.error || errorJson.reason || errorJson.message);
      if (Array.isArray(errorJson?.details)) {
        err.details = errorJson.details;
      } else if (typeof errorJson?.details === 'string') {
        err.details = [errorJson.details];
      }
      throw err;
    }

    const errorText = await response.text().catch(() => '');
    if (response.status === 400) {
      throw new Error(errorText || 'Invalid request. Please check input fields and try again.');
    }
    if (response.status === 429) {
      throw new Error('Too many requests. Please wait a moment and try again.');
    }

    throw new Error(errorText || `HTTP error! status: ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json().catch(() => null);
};

const fetchBlobWithAuth = async (endpoint, options = {}) => {
  const token = getAuthToken();
  const headers = {
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...options.headers
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
    cache: 'no-store'
  });

  if (!response.ok) {
    // try json first, then fall back to text
    const asJson = await response.json().catch(() => null);
    if (asJson?.error) {
      throw new Error(asJson.error);
    }
    const text = await response.text().catch(() => '');
    throw new Error(text || `HTTP error! status: ${response.status}`);
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get('content-disposition') || '';
  return { blob, contentDisposition };
};

// API functions
export const api = {
  // Auth
  login: (username, password) => fetchWithAuth('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  }),
  registerUser: (userData) => fetchWithAuth('/auth/register', {
    method: 'POST',
    body: JSON.stringify(userData)
  }),
  publicClientRegistration: async (registrationData) => {
    const formData = new FormData();
    Object.entries(registrationData || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, value);
      }
    });

    const response = await fetch(`${API_BASE_URL}/auth/client-register`, {
      method: 'POST',
      body: formData,
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => null);
      throw new Error(errorJson?.error || errorJson?.reason || 'Failed to submit registration');
    }
    return response.json().catch(() => null);
  },
  logout: () => fetchWithAuth('/auth/logout', {
    method: 'POST'
  }),
  requestAccountUnlock: (payload) => fetchWithAuth('/auth/unlock-request', {
    method: 'POST',
    body: JSON.stringify(payload || {})
  }),

  // Admin unlock requests
  getPendingUnlockRequests: () => fetchWithAuth('/auth/unlock-requests/pending'),
  approveUnlockRequest: (requestId) => fetchWithAuth(`/auth/unlock-requests/${requestId}/approve`, {
    method: 'POST'
  }),
  rejectUnlockRequest: (requestId, reason) => fetchWithAuth(`/auth/unlock-requests/${requestId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? null })
  }),
  changeClientPassword: (currentPassword, newPassword, confirmPassword) => fetchWithAuth('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: confirmPassword
    })
  }),

  // Admin
  getAdminSummary: () => fetchWithAuth('/admin/summary'),
  getAdminSettings: () => fetchWithAuth('/admin/settings'),
  updateAdminSettings: (settingsData) => fetchWithAuth('/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(settingsData)
  }),

  // Users
  getUsers: () => fetchWithAuth('/users'),
  getUser: (id) => fetchWithAuth(`/users/${id}`),
  createUser: (userData) => fetchWithAuth('/users', {
    method: 'POST',
    body: JSON.stringify(userData)
  }),
  updateUser: (id, userData) => fetchWithAuth(`/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(userData)
  }),
  archiveUser: (id) => fetchWithAuth(`/users/${id}/archive`, {
    method: 'PATCH'
  }),
  deleteUser: (id, secondaryPassword) => fetchWithAuth(`/users/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ secondary_auth_password: secondaryPassword, confirm_delete: true })
  }),
  getAvailablePermissions: () => fetchWithAuth('/users/permissions/available'),
  getUserPermissions: (userId) => fetchWithAuth(`/users/${userId}/permissions`),
  assignUserPermission: (userId, permissionId) => fetchWithAuth(`/users/${userId}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permission: permissionId })
  }),
  revokeUserPermission: (id, permissionId) => fetchWithAuth(`/users/${id}/permissions/${permissionId}`, {
    method: 'DELETE'
  }),
  verifySecondaryAuth: (password) => fetchWithAuth('/auth/verify-secondary', {
    method: 'POST',
    body: JSON.stringify({ password })
  }),

  // Loans
  // NOTE: backend exposes loan listing at `/loans`; previous value referenced a non-existent `/clients/loans-list`.
  getLoans: () => fetchWithAuth('/loans'),
  getPendingLoans: () => fetchWithAuth('/loans/approvals/pending'),
  approveLoan: (id, justification) => fetchWithAuth(`/loans/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ justification })
  }),
  rejectLoan: (id, reason) => fetchWithAuth(`/loans/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  }),
  escalateLoan: (id, reason) => fetchWithAuth(`/loans/${id}/escalate`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  }),
  createLoan: (loanData) => fetchWithAuth('/loans', {
    method: 'POST',
    body: JSON.stringify(loanData)
  }),
  updateLoan: (id, loanData) => fetchWithAuth(`/loans/${id}`, {
    method: 'PUT',
    body: JSON.stringify(loanData)
  }),
  recordPayment: (loanId, amount) => fetchWithAuth('/transactions/payment', {
    method: 'POST',
    body: JSON.stringify({ account_id: loanId, amount, description: 'Loan payment' })
  }),
  setupLoanAccount: (loanData) => fetchWithAuth('/loans/setup', {
    method: 'POST',
    body: JSON.stringify(loanData)
  }),
  escalatePolicyViolation: (loanId, reason, violationType) => fetchWithAuth(`/loans/escalate-policy/${loanId}`, {
    method: 'POST',
    body: JSON.stringify({ reason, violation_type: violationType })
  }),
  escalateToCEO: (id, recommendation) => fetchWithAuth(`/loans/${id}/escalate-ceo`, {
    method: 'POST',
    body: JSON.stringify({ recommendation })
  }),

  // Savings
  getSavings: (clientId) => fetchWithAuth(`/savings${clientId ? `?client_id=${clientId}` : ''}`),
  getMySavings: () => fetchWithAuth('/savings/mine'),
  getSavingsOptions: () => fetchWithAuth('/savings/options'),
  applySavings: (savingData) => fetchWithAuth('/savings/apply', {
    method: 'POST',
    body: JSON.stringify(savingData)
  }),
  getPendingSavings: () => fetchWithAuth('/savings/approvals/pending'),
  approveSavings: (id, justification, overrideCompliance = false) => fetchWithAuth(`/savings/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ justification, override_compliance: overrideCompliance })
  }),
  rejectSavings: (id, reason) => fetchWithAuth(`/savings/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  }),
  createSavings: (savingsData) => fetchWithAuth('/savings', {
    method: 'POST',
    body: JSON.stringify(savingsData)
  }),
  recordDeposit: (accountId, amount) => fetchWithAuth('/transactions/deposit', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, amount, description: 'Savings deposit' })
  }),
  recordWithdrawal: (accountId, amount) => fetchWithAuth('/transactions/withdraw', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, amount, description: 'Savings withdrawal' })
  }),
  submitSavingsForApproval: (id) => fetchWithAuth(`/savings/${id}/submit-approval`, {
    method: 'POST'
  }),

  // Requests
  getRequests: () => fetchWithAuth('/requests'),
  approveRequest: (id, justification) => fetchWithAuth(`/approvals/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ justification })
  }),
  rejectRequest: (id, reason) => fetchWithAuth(`/approvals/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  }),
  createRequest: (requestData) => fetchWithAuth('/requests', {
    method: 'POST',
    body: JSON.stringify(requestData)
  }),

  // Client
  getMyBalanceSummary: () => fetchWithAuth('/clients/me/balance-summary'),
  getMyLoans: () => fetchWithAuth('/clients/me/loans'),
  registerClient: (clientData) => fetchWithAuth('/clients/register', {
    method: 'POST',
    body: JSON.stringify(clientData)
  }),
  reviewClientRegistration: (registrationData) => fetchWithAuth('/clients/registrations/review', {
    method: 'POST',
    body: JSON.stringify(registrationData)
  }),
  getClientRegistrationRequests: () => fetchWithAuth('/clients/registration-requests'),
  approveClientRegistrationRequest: (requestId, payload) => fetchWithAuth(`/clients/registration-requests/${requestId}/approve`, {
    method: 'POST',
    body: JSON.stringify(payload || {})
  }),
  rejectClientRegistrationRequest: (requestId, payload) => fetchWithAuth(`/clients/registration-requests/${requestId}/reject`, {
    method: 'POST',
    body: JSON.stringify(payload || {})
  }),
  reopenClientRegistrationRequest: (requestId) => fetchWithAuth(`/clients/registration-requests/${requestId}/reopen`, {
    method: 'POST'
  }),
  getClients: () => fetchWithAuth('/clients'),
  updateClient: (clientId, clientData) => fetchWithAuth(`/clients/${clientId}`, {
    method: 'PUT',
    body: JSON.stringify(clientData)
  }),
  deleteClient: (clientId, payload) => fetchWithAuth(`/clients/${clientId}`, {
    method: 'DELETE',
    body: JSON.stringify(payload || {})
  }),
  getMyClientProfile: () => fetchWithAuth('/clients/me/profile'),
  updateMyClientProfile: (profileData) => fetchWithAuth('/clients/me/profile', {
    method: 'PUT',
    body: JSON.stringify(profileData)
  }),
  getAllClientAccounts: () => fetchWithAuth('/clients/accounts/all'),
  getAllAccounts: () => fetchWithAuth('/clients/accounts/all'),
  createClientSavingsAccount: (clientId, accountData) => fetchWithAuth(`/clients/${clientId}/accounts/savings`, {
    method: 'POST',
    body: JSON.stringify(accountData)
  }),
  createClientLoanAccount: (clientId, accountData) => fetchWithAuth(`/clients/${clientId}/accounts/loan`, {
    method: 'POST',
    body: JSON.stringify(accountData)
  }),
  getClientAccounts: (clientId) => fetchWithAuth(`/clients/${clientId}/accounts`),
  updateClientAccountStatus: (accountId, status) => fetchWithAuth(`/clients/accounts/${accountId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  }),
  updateClientAccountInterestRate: (accountId, interest_rate) => fetchWithAuth(`/clients/accounts/${accountId}/interest-rate`, {
    method: 'PATCH',
    body: JSON.stringify({ interest_rate })
  }),

  // Statements
  requestLoanStatement: (statementData) => fetchWithAuth('/statements/loan/request', {
    method: 'POST',
    body: JSON.stringify(statementData)
  }),
  requestSavingsStatement: (statementData) => fetchWithAuth('/statements/savings/request', {
    method: 'POST',
    body: JSON.stringify(statementData)
  }),
  getPendingStatementApprovals: () => fetchWithAuth('/statements/approvals/pending'),
  approveStatement: (id, justification) => fetchWithAuth(`/statements/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ justification })
  }),
  authorizeStatement: (id) => fetchWithAuth(`/statements/${id}/authorize`, {
    method: 'POST'
  }),
  rejectStatement: (id, reason) => fetchWithAuth(`/statements/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  }),

  // CEO
  previewBalanceAdjustment: (adjustmentData) => fetchWithAuth('/ceo/balance-adjustment/preview', {
    method: 'POST',
    body: JSON.stringify(adjustmentData)
  }),
  adjustBalance: (adjustmentData) => fetchWithAuth('/ceo/balance-adjustment', {
    method: 'POST',
    body: JSON.stringify(adjustmentData)
  }),

  // Users (legacy explicit signature retained for backward compatibility)
  deleteUserWithConfirmation: (id, secondaryAuthPassword, confirmDelete) => fetchWithAuth(`/users/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ secondary_auth_password: secondaryAuthPassword, confirm_delete: confirmDelete })
  }),
  archiveUserLegacy: (id) => fetchWithAuth(`/users/${id}/archive`, {
    method: 'PATCH'
  }),

  // CEO Approvals
  getCEOPendingApprovals: () => fetchWithAuth('/ceo/approvals/pending'),
  getPendingApprovals: () => fetchWithAuth('/approvals/pending'),
  getApprovalThresholds: () => fetchWithAuth('/approvals/thresholds'),
  getApprovalHistory: (types) => fetchWithAuth(`/approvals/history${types ? `?type=${encodeURIComponent(types)}` : ''}`),
  approveApprovalRequest: (id, justification) => fetchWithAuth(`/approvals/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ justification })
  }),
  rejectApprovalRequest: (id, reason) => fetchWithAuth(`/approvals/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  }),

  // Clients with savings accounts
  getSavingsAccounts: (search) => fetchWithAuth(`/clients/savings-accounts${search ? `?search=${search}` : ''}`),
  approveBranchRequest: (requestId) => fetchWithAuth(`/ceo/approvals/${requestId}/approve`, {
    method: 'POST'
  }),
  rejectBranchRequest: (requestId, justification) => fetchWithAuth(`/ceo/approvals/${requestId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ justification })
  }),
  getCEOReports: () => fetchWithAuth('/ceo/reports'),
  getRiskReport: () => fetchWithAuth('/ceo/reports/risk'),
  getComplianceOverview: () => fetchWithAuth('/ceo/reports/compliance'),
  approveEscalatedRequest: (requestId, justification) => fetchWithAuth(`/ceo/approvals/${requestId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ justification })
  }),
  rejectEscalatedRequest: (requestId, justification) => fetchWithAuth(`/ceo/approvals/${requestId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ justification })
  }),

  // Update Requests
  submitUpdateRequest: (requestData) => fetchWithAuth('/updates/request', {
    method: 'POST',
    body: JSON.stringify(requestData)
  }),
  getMyUpdateRequests: () => fetchWithAuth('/updates/my-requests'),
  getPendingUpdateRequests: () => fetchWithAuth('/updates/pending'),
  approveUpdateRequest: (id, justification) => fetchWithAuth(`/updates/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ justification })
  }),
  rejectUpdateRequest: (id, reason) => fetchWithAuth(`/updates/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  }),

  // Branches
  getBranchDetails: (id) => fetchWithAuth(`/branches/${id}`),
  setBranchCreditLimit: (id, creditLimit) => fetchWithAuth(`/branches/${id}/credit-limit`, {
    method: 'PATCH',
    body: JSON.stringify({ credit_limit: creditLimit })
  }),
  createBranch: (branchData) => fetchWithAuth('/branches', {
    method: 'POST',
    body: JSON.stringify(branchData)
  }),

  // Documents
  getDocuments: () => fetchWithAuth('/documents'),
  getDocumentsByApprovalRequest: (approvalRequestId) => fetchWithAuth(`/documents/approval/${approvalRequestId}`),
  getDocumentsByLoan: (loanId) => fetchWithAuth(`/documents/loan/${loanId}`),
  downloadDocument: (documentId) => fetchBlobWithAuth(`/documents/${documentId}/download`),
  uploadDocument: (formData) => {
    const token = getAuthToken();
    return fetch(`${API_BASE_URL}/documents/upload`, {
      method: 'POST',
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` })
        // Note: Don't set Content-Type when sending FormData - browser sets it automatically
      },
      body: formData
    }).then(async (res) => {
      if (!res.ok) {
        const asJson = await res.json().catch(() => null);
        if (asJson?.error) {
          throw new Error(asJson.error);
        }
        const text = await res.text().catch(() => '');
        throw new Error(text || 'Upload failed');
      }

      return res.json().catch(async () => {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'Upload response was not valid JSON');
      });
    });
  },
  uploadLoanDocument: (formData) => {
    const token = getAuthToken();
    return fetch(`${API_BASE_URL}/documents/upload`, {
      method: 'POST',
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` })
      },
      body: formData
    }).then(async (res) => {
      if (!res.ok) {
        const asJson = await res.json().catch(() => null);
        if (asJson?.error) {
          throw new Error(asJson.error);
        }
        const text = await res.text().catch(() => '');
        throw new Error(text || 'Upload failed');
      }
      return res.json().catch(async () => {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'Upload response was not valid JSON');
      });
    });
  },
  verifyDocument: (id) => fetchWithAuth(`/documents/${id}/verify`, {
    method: 'POST'
  }),
  rejectDocument: (id, reason) => fetchWithAuth(`/documents/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  }),
  deleteDocument: (id) => fetchWithAuth(`/documents/${id}`, {
    method: 'DELETE'
  }),

  // Approvals (CEO escalated requests)
  getEscalatedRequests: () => fetchWithAuth('/approvals/escalated'),
  approveEscalatedRequest: (id, justification) => fetchWithAuth(`/approvals/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ justification })
  }),
  rejectEscalatedRequest: (id, reason) => fetchWithAuth(`/approvals/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  }),

  // Audit
  getAuditLogs: () => fetchWithAuth('/audit'),
  getUserAuditLogs: (userId) => fetchWithAuth(`/audit/user/${userId}`),
  logBalanceInquiry: () => fetchWithAuth('/audit/balance-inquiry', {
    method: 'POST'
  }),

  // Transactions
  deposit: (accountId, amount, description) => fetchWithAuth('/transactions/deposit', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, amount, description })
  }),
  submitClientDepositRequest: (payload) => fetchWithAuth('/transactions/deposit-request', {
    method: 'POST',
    body: JSON.stringify(payload || {})
  }),
  withdraw: (accountId, amount, description) => fetchWithAuth('/transactions/withdraw', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, amount, description })
  }),
  payment: (data) => fetchWithAuth('/transactions/payment', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  advancePayment: (data) => fetchWithAuth('/payment-schedule/advance-payment', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  makePayment: (accountId, amount, description) => fetchWithAuth('/transactions/payment', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, amount, description })
  }),
  getAccountTransactions: (accountId) => fetchWithAuth(`/transactions/account/${accountId}`),
  getMySavingsTransactions: () => fetchWithAuth('/transactions/my-savings'),

  // Branches
  getBranches: () => fetchWithAuth('/branches'),
  getBranch: (id) => fetchWithAuth(`/branches/${id}`),
  createBranch: (branchData) => fetchWithAuth('/branches', {
    method: 'POST',
    body: JSON.stringify(branchData)
  }),
  updateBranch: (id, branchData) => fetchWithAuth(`/branches/${id}`, {
    method: 'PUT',
    body: JSON.stringify(branchData)
  }),
  deleteBranch: (id) => fetchWithAuth(`/branches/${id}`, {
    method: 'DELETE'
  }),

  // Payment Schedule
  getPaymentSchedule: (loanId) => fetchWithAuth(`/payment-schedule/loan/${loanId}`),
  generatePaymentSchedule: (scheduleData) => fetchWithAuth('/payment-schedule/generate', {
    method: 'POST',
    body: JSON.stringify(scheduleData)
  }),
  markPaymentPaid: (paymentId) => fetchWithAuth(`/payment-schedule/${paymentId}/pay`, {
    method: 'POST'
  }),

  // Statements
  getLoanStatement: (loanId) => fetchWithAuth(`/statements/loan/${loanId}`),
  getSavingsStatement: (accountId) => fetchWithAuth(`/statements/savings/${accountId}`),
  downloadLoanStatementCsv: (loanId) => fetchBlobWithAuth(`/statements/loan/${loanId}/download?format=csv`),
  downloadSavingsStatementCsv: (accountId) => fetchBlobWithAuth(`/statements/savings/${accountId}/download?format=csv`),
  downloadLoanStatementPdf: (loanId) => fetchBlobWithAuth(`/statements/loan/${loanId}/download?format=pdf`),
  downloadSavingsStatementPdf: (accountId) => fetchBlobWithAuth(`/statements/savings/${accountId}/download?format=pdf`)
};

export default api;
