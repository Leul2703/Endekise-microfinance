import { useState, useEffect, useCallback } from 'react';
import { CreditCard, CheckCircle, XCircle, DollarSign, Calculator, History, Plus, Search, RefreshCw, AlertTriangle } from 'lucide-react';
import './AdminPages.css';
import { useToast } from '../../context/ToastContext';
import api from '../../utils/api';

const BACKEND_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://192.168.137.1:5000/api').replace(/\/api\/?$/, '');

const LOAN_TYPE_CONFIG = {
  'Micro Enterprise Loan': { interestRate: 8, minAmount: 50000, maxAmount: 90000, minTermMonths: 12, maxTermMonths: 24 },
  'Individual Business Loan': { interestRate: 7.5, minAmount: 10000, maxAmount: 50000, minTermMonths: 1, maxTermMonths: 1 },
  'Consumption Loan': { interestRate: 9, minAmount: 10000, maxAmount: 100000, organizationLetterRequired: true },
  'Construction Loan': { interestRate: 12, minAmount: 100000, maxAmount: 500000 },
  'Agricultural Business Loan': { interestRate: 10, minAmount: 100000, maxAmount: 300000, requiredIncomeSources: ['Agriculture'] }
};

const Loans = () => {
  const { success, error, warning } = useToast();
  const [loans, setLoans] = useState([]);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showRepayModal, setShowRepayModal] = useState(false);
  const [showInterestModal, setShowInterestModal] = useState(false);
  const [showPaymentHistoryModal, setShowPaymentHistoryModal] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectLoanId, setRejectLoanId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  
  const [newLoan, setNewLoan] = useState({
    clientId: '',
    savingsAccountId: '',
    clientName: '',
    amount: '',
    type: 'Micro Enterprise Loan',
    term: '12',
    interestRate: 8,
    paymentFrequency: 'Monthly',
    purpose: '',
    organizationLetterProvided: false
  });
  const [accountSearch, setAccountSearch] = useState('');
  const [savingsAccounts, setSavingsAccounts] = useState([]);
  const [organizationLetterFile, setOrganizationLetterFile] = useState(null);
  const [organizationLetterDocumentId, setOrganizationLetterDocumentId] = useState('');
  const [organizationLetterUploading, setOrganizationLetterUploading] = useState(false);
  
  const [repayAmount, setRepayAmount] = useState('');
  const [interestMonths, setInterestMonths] = useState('1');
  const [interestResult, setInterestResult] = useState(null);

  const fetchLoans = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    try {
      const data = await api.getLoans();
      setLoans(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching loans:', err);
      setFetchError(err.message || 'Failed to load loans');
      setLoans([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleRefresh = () => {
    fetchLoans(true);
  };

  useEffect(() => {
    fetchLoans();
  }, [fetchLoans]);

  useEffect(() => {
    if (!showApplyModal) return;
    const loadAccounts = async () => {
      try {
        const data = await api.getSavingsAccounts(accountSearch);
        setSavingsAccounts(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error loading savings accounts:', err);
        setSavingsAccounts([]);
      }
    };
    const timer = setTimeout(loadAccounts, 250);
    return () => clearTimeout(timer);
  }, [showApplyModal, accountSearch]);

  const handleApplyLoan = async () => {
    if (!newLoan.clientId || !newLoan.savingsAccountId || !newLoan.amount || !newLoan.term) {
      warning('Client, savings account, amount and term are required');
      return;
    }
    const configured = LOAN_TYPE_CONFIG[newLoan.type];
    const amount = Number(newLoan.amount);
    const term = Number(newLoan.term);
    const selectedAccount = savingsAccounts.find((acc) => (acc.savings_account_id || acc.account_id) === newLoan.savingsAccountId);
    const selectedIncomeSource = String(selectedAccount?.client_income_source || '').trim();
    if (!selectedAccount || String(selectedAccount.status || '').toLowerCase() !== 'active') {
      warning('Loan application requires an active savings account.');
      return;
    }
    if (configured?.minAmount && amount < configured.minAmount) {
      warning(`Minimum amount for ${newLoan.type} is ${configured.minAmount.toLocaleString()} ETB.`);
      return;
    }
    if (configured?.maxAmount && amount > configured.maxAmount) {
      warning(`Maximum amount for ${newLoan.type} is ${configured.maxAmount.toLocaleString()} ETB.`);
      return;
    }
    if (configured?.minTermMonths && term < configured.minTermMonths) {
      warning(`Minimum term for ${newLoan.type} is ${configured.minTermMonths} month(s).`);
      return;
    }
    if (configured?.maxTermMonths && term > configured.maxTermMonths) {
      warning(`Maximum term for ${newLoan.type} is ${configured.maxTermMonths} month(s).`);
      return;
    }
    if (Number(newLoan.interestRate) !== configured.interestRate) {
      warning(`Interest rate for ${newLoan.type} must be ${configured.interestRate}%.`);
      return;
    }
    if (Array.isArray(configured?.requiredIncomeSources) && configured.requiredIncomeSources.length > 0 && !configured.requiredIncomeSources.includes(selectedIncomeSource)) {
      warning(`Selected client is not eligible for ${newLoan.type}. Required income source: ${configured.requiredIncomeSources.join(', ')}.`);
      return;
    }
    let uploadedOrganizationDocId = organizationLetterDocumentId || '';
    if (configured?.organizationLetterRequired) {
      if (!newLoan.organizationLetterProvided) {
        warning('Consumption loan requires organization letter confirmation.');
        return;
      }
      if (!uploadedOrganizationDocId) {
        if (!organizationLetterFile) {
          warning('Please attach scanned organization letter (PDF/JPEG).');
          return;
        }
        const formData = new FormData();
        formData.append('file', organizationLetterFile);
        formData.append('client_id', newLoan.clientId);
        formData.append('type', 'Organization Letter');
        try {
          setOrganizationLetterUploading(true);
          const uploadResult = await api.uploadLoanDocument(formData);
          uploadedOrganizationDocId = uploadResult?.id || '';
          if (!uploadedOrganizationDocId) throw new Error('Organization letter uploaded but no document id returned.');
          setOrganizationLetterDocumentId(uploadedOrganizationDocId);
        } catch (uploadErr) {
          error(uploadErr.message || 'Failed to upload organization letter');
          return;
        } finally {
          setOrganizationLetterUploading(false);
        }
      }
    }

    setIsSubmitting(true);
    try {
      await api.createLoan({
        client_id: newLoan.clientId,
        savings_account_id: newLoan.savingsAccountId,
        clientName: newLoan.clientName || undefined,
        type: newLoan.type,
        amount: amount,
        term: term,
        interestRate: Number(newLoan.interestRate),
        paymentFrequency: newLoan.paymentFrequency,
        purpose: newLoan.purpose || undefined,
        organization_letter_provided: newLoan.organizationLetterProvided,
        organization_letter_document_id: uploadedOrganizationDocId || undefined
      });
      setShowApplyModal(false);
      setNewLoan({
        clientId: '',
        savingsAccountId: '',
        clientName: '',
        amount: '',
        type: 'Micro Enterprise Loan',
        term: '12',
        interestRate: 8,
        paymentFrequency: 'Monthly',
        purpose: '',
        organizationLetterProvided: false
      });
      setAccountSearch('');
      setSavingsAccounts([]);
      setOrganizationLetterFile(null);
      setOrganizationLetterDocumentId('');
      fetchLoans();
      success('Loan application submitted successfully');
    } catch (err) {
      error(err.message || 'Failed to submit loan application');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async (loanId) => {
    try {
      const data = await fetch(`${BACKEND_BASE_URL}/api/clients/loans/${loanId}/approve`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      }).then(res => res.json());

      if (!data.error) {
        fetchLoans();
        success('Loan approved successfully');
      } else {
        error(data.error);
      }
    } catch (err) {
      error('Failed to approve loan');
    }
  };

  const handleReject = async (loanId) => {
    setRejectLoanId(loanId);
    setRejectReason('');
    setShowRejectModal(true);
  };

  const confirmReject = async () => {
    if (!rejectReason.trim()) {
      warning('Rejection reason is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await fetch(`${BACKEND_BASE_URL}/api/clients/loans/${rejectLoanId}/reject`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: rejectReason.trim() })
      }).then(res => res.json());

      if (!data.error) {
        setShowRejectModal(false);
        setRejectLoanId(null);
        setRejectReason('');
        fetchLoans();
        success('Loan rejected successfully');
      } else {
        error(data.error);
      }
    } catch (err) {
      error(err.message || 'Failed to reject loan');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRepay = async () => {
    if (!repayAmount || parseFloat(repayAmount) <= 0) {
      warning('Repayment amount must be greater than 0');
      return;
    }

    try {
      const data = await fetch(`${BACKEND_BASE_URL}/api/clients/loans/${selectedLoan.id}/repay`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ amount: parseFloat(repayAmount) })
      }).then(res => res.json());

      if (!data.error) {
        setShowRepayModal(false);
        setRepayAmount('');
        fetchLoans();
        success(`Repayment of ${repayAmount} ETB successful`);
      } else {
        error(data.error);
      }
    } catch (err) {
      error('Failed to process repayment');
    }
  };

  const handleCalculateInterest = async () => {
    if (!selectedLoan) return;

    try {
      const data = await fetch(`${BACKEND_BASE_URL}/api/clients/loans/${selectedLoan.id}/calculate-interest?months=${interestMonths}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      }).then(res => res.json());

      if (!data.error) {
        setInterestResult(data);
      } else {
        error(data.error);
      }
    } catch (err) {
      error('Failed to calculate interest');
    }
  };

  const handleViewPaymentHistory = async (loanId) => {
    try {
      const data = await fetch(`${BACKEND_BASE_URL}/api/clients/loans/${loanId}/payments`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      }).then(res => res.json());
      setPaymentHistory(Array.isArray(data) ? data : []);
      setShowPaymentHistoryModal(true);
    } catch (err) {
      error('Failed to fetch payment history');
    }
  };

  const filteredLoans = loans.filter(loan => {
    return loan.client_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           loan.id.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const getStatusColor = (status) => {
    switch (status) {
      case 'Pending': return '#f59e0b';
      case 'Approved': return '#10b981';
      case 'Rejected': return '#ef4444';
      case 'Paid': return '#6b7280';
      default: return '#6b7280';
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Loan Management</h1>
          <p>Apply for loans, review applications, approve/reject, and track repayments</p>
        </div>
        <button 
          className="btn-secondary" 
          onClick={handleRefresh}
          disabled={refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <RefreshCw size={18} className={refreshing ? 'spinning' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="page-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search loans..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <button className="btn-primary" onClick={() => setShowApplyModal(true)}>
          <Plus size={20} />
          Apply for Loan
        </button>
      </div>

      {loading ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <RefreshCw size={48} className="spinning" style={{ color: '#3b82f6', marginBottom: '1rem' }} />
            <p style={{ color: '#6b7280' }}>Loading loans...</p>
          </div>
        </div>
      ) : fetchError ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <AlertTriangle size={48} style={{ color: '#ef4444', marginBottom: '1rem' }} />
            <p style={{ color: '#ef4444', marginBottom: '1rem' }}>{fetchError}</p>
            <button className="btn-primary" onClick={handleRefresh}>
              <RefreshCw size={18} />
              Try Again
            </button>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Loan ID</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Balance</th>
                <th>Interest Rate</th>
                <th>Term</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLoans.map((loan) => (
                <tr key={loan.id}>
                  <td>{loan.id}</td>
                  <td>{loan.client_name}</td>
                  <td>{parseFloat(loan.amount).toLocaleString()} ETB</td>
                  <td>{parseFloat(loan.balance).toLocaleString()} ETB</td>
                  <td>{loan.interest_rate}%</td>
                  <td>{loan.term}</td>
                  <td>
                    <span style={{ color: getStatusColor(loan.status), fontWeight: 'bold' }}>
                      {loan.status}
                    </span>
                  </td>
                  <td>
                    {loan.status === 'Pending' && (
                      <>
                        <button className="btn-icon edit" title="Approve" onClick={() => handleApprove(loan.id)}>
                          <CheckCircle size={18} style={{ color: '#10b981' }} />
                        </button>
                        <button className="btn-icon delete" title="Reject" onClick={() => handleReject(loan.id)}>
                          <XCircle size={18} style={{ color: '#ef4444' }} />
                        </button>
                      </>
                    )}
                    {loan.status === 'Approved' && (
                      <>
                        <button className="btn-icon edit" title="Repay" onClick={() => { setSelectedLoan(loan); setShowRepayModal(true); setRepayAmount(''); }}>
                          <DollarSign size={18} />
                        </button>
                        <button className="btn-icon edit" title="Calculate Interest" onClick={() => { setSelectedLoan(loan); setShowInterestModal(true); setInterestMonths('1'); setInterestResult(null); }}>
                          <Calculator size={18} />
                        </button>
                        <button className="btn-icon edit" title="Payment History" onClick={() => handleViewPaymentHistory(loan.id)}>
                          <History size={18} />
                        </button>
                      </>
                    )}
                    {loan.status === 'Paid' && (
                      <button className="btn-icon edit" title="Payment History" onClick={() => handleViewPaymentHistory(loan.id)}>
                        <History size={18} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showApplyModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Apply for Loan</h2>
              <button onClick={() => setShowApplyModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Search Savings Account <span className="required">*</span></label>
                <input
                  type="text"
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  placeholder="Search by account number, client name, or phone"
                />
              </div>
              {savingsAccounts.length > 0 && (
                <div className="form-group">
                  <small style={{ color: '#6b7280', display: 'block', marginBottom: '0.35rem' }}>
                    {savingsAccounts.length} matching account(s) found.
                  </small>
                  <label>Select Savings Account <span className="required">*</span></label>
                  <select
                    value={newLoan.savingsAccountId}
                    onChange={(e) => {
                      const selected = savingsAccounts.find((acc) => (acc.account_id || acc.savings_account_id) === e.target.value);
                      setNewLoan({
                        ...newLoan,
                        savingsAccountId: selected?.savings_account_id || e.target.value,
                        clientId: selected?.client_id || '',
                        clientName: selected?.client_name || ''
                      });
                    }}
                  >
                    <option value="">-- Select an account --</option>
                    {savingsAccounts.map((account) => (
                      <option
                        key={account.account_id || account.savings_account_id}
                        value={account.account_id || account.savings_account_id}
                        disabled={String(account.status || '').toLowerCase() !== 'active'}
                      >
                        {(account.account_id || account.savings_account_id)} - {account.client_name} (Status: {account.status})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {newLoan.clientName && (
                <div className="info-card" style={{ marginBottom: '1rem', background: '#eff6ff', borderColor: '#bfdbfe' }}>
                  <CreditCard size={20} style={{ color: '#1e40af' }} />
                  <span style={{ color: '#1e40af' }}>
                    Selected: {newLoan.clientName} ({newLoan.savingsAccountId})
                  </span>
                </div>
              )}
              <div className="form-group">
                <label>Loan Amount (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={newLoan.amount}
                  onChange={(e) => setNewLoan({ ...newLoan, amount: e.target.value })}
                  placeholder="Enter loan amount"
                  min={LOAN_TYPE_CONFIG[newLoan.type]?.minAmount || 1}
                  max={LOAN_TYPE_CONFIG[newLoan.type]?.maxAmount || undefined}
                  required
                />
              </div>
              <div className="form-group">
                <label>Loan Type</label>
                <select
                  value={newLoan.type}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setNewLoan({
                      ...newLoan,
                      type: nextType,
                      interestRate: LOAN_TYPE_CONFIG[nextType]?.interestRate ?? newLoan.interestRate,
                      term: String(LOAN_TYPE_CONFIG[nextType]?.minTermMonths || newLoan.term)
                    });
                  }}
                >
                  <option value="Micro Enterprise Loan">Micro Enterprise Loan</option>
                  <option value="Individual Business Loan">Individual Business Loan</option>
                  <option value="Consumption Loan">Consumption Loan</option>
                  <option value="Construction Loan">Construction Loan</option>
                  <option value="Agricultural Business Loan">Agricultural Business Loan</option>
                </select>
              </div>
              <div className="form-group">
                <label>Term</label>
                <input
                  type="number"
                  value={newLoan.term}
                  onChange={(e) => setNewLoan({ ...newLoan, term: e.target.value })}
                  min={LOAN_TYPE_CONFIG[newLoan.type]?.minTermMonths || 1}
                  max={LOAN_TYPE_CONFIG[newLoan.type]?.maxTermMonths || undefined}
                />
              </div>
              <div className="form-group">
                <label>Interest Rate (%)</label>
                <input
                  type="number"
                  value={newLoan.interestRate}
                  onChange={(e) => setNewLoan({ ...newLoan, interestRate: e.target.value })}
                  placeholder="Enter interest rate"
                  min="0"
                  max="25"
                  step="0.1"
                  readOnly
                />
              </div>
              <div className="form-group">
                <label>Payment Frequency</label>
                <select
                  value={newLoan.paymentFrequency}
                  onChange={(e) => setNewLoan({ ...newLoan, paymentFrequency: e.target.value })}
                >
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="Annually">Annually</option>
                </select>
              </div>
              <div className="info-card" style={{ marginBottom: '1rem', background: '#eff6ff', borderColor: '#bfdbfe' }}>
                <CreditCard size={20} style={{ color: '#1e40af' }} />
                <span style={{ color: '#1e40af' }}>Client must have an active savings account to apply for a loan</span>
              </div>
              {LOAN_TYPE_CONFIG[newLoan.type]?.organizationLetterRequired && (
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(newLoan.organizationLetterProvided)}
                      onChange={(e) => setNewLoan({ ...newLoan, organizationLetterProvided: e.target.checked })}
                    />
                    Organization letter verified and available
                  </label>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg"
                    onChange={(e) => {
                      setOrganizationLetterFile(e.target.files?.[0] || null);
                      setOrganizationLetterDocumentId('');
                    }}
                  />
                  <small style={{ color: '#6b7280', display: 'block', marginTop: '0.35rem' }}>
                    {organizationLetterDocumentId
                      ? `Uploaded and linked: ${organizationLetterDocumentId}`
                      : (organizationLetterFile ? `Selected file: ${organizationLetterFile.name}` : 'No document uploaded yet')}
                  </small>
                </div>
              )}
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowApplyModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleApplyLoan} disabled={isSubmitting || organizationLetterUploading}>
                  <Plus size={18} />
                  {organizationLetterUploading ? 'Uploading document...' : (isSubmitting ? 'Submitting...' : 'Submit Application')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRepayModal && selectedLoan && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Make Repayment</h2>
              <button onClick={() => setShowRepayModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan.id}</p>
              <p><strong>Outstanding Balance:</strong> {parseFloat(selectedLoan.balance).toLocaleString()} ETB</p>
              <p><strong>Interest Rate:</strong> {selectedLoan.interest_rate}%</p>
              
              <div className="form-group">
                <label>Repayment Amount (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                  placeholder="Enter repayment amount"
                  min="1"
                  max={selectedLoan.balance}
                  required
                />
              </div>
              
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowRepayModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleRepay}>
                  <DollarSign size={18} />
                  Process Repayment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showInterestModal && selectedLoan && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Calculate Interest</h2>
              <button onClick={() => setShowInterestModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan.id}</p>
              <p><strong>Principal:</strong> {parseFloat(selectedLoan.balance).toLocaleString()} ETB</p>
              <p><strong>Interest Rate:</strong> {selectedLoan.interest_rate}%</p>
              
              <div className="form-group">
                <label>Number of Months <span className="required">*</span></label>
                <input
                  type="number"
                  value={interestMonths}
                  onChange={(e) => setInterestMonths(e.target.value)}
                  placeholder="Enter months"
                  min="1"
                  required
                />
              </div>
              
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowInterestModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleCalculateInterest}>
                  <Calculator size={18} />
                  Calculate
                </button>
              </div>

              {interestResult && (
                <div className="info-card" style={{ marginTop: '1rem', background: '#f0fdf4', borderColor: '#86efac' }}>
                  <Calculator size={20} style={{ color: '#166534' }} />
                  <div style={{ color: '#166534' }}>
                    <p><strong>Interest Amount:</strong> {interestResult.interest_amount.toFixed(2)} ETB</p>
                    <p><strong>Total Amount:</strong> {interestResult.total_amount.toFixed(2)} ETB</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showPaymentHistoryModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h2>Payment History</h2>
              <button onClick={() => setShowPaymentHistoryModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              {paymentHistory.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Payment ID</th>
                      <th>Amount</th>
                      <th>Principal</th>
                      <th>Interest</th>
                      <th>Balance Before</th>
                      <th>Balance After</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentHistory.map((payment) => (
                      <tr key={payment.id}>
                        <td>{payment.id}</td>
                        <td>{parseFloat(payment.amount).toLocaleString()} ETB</td>
                        <td>{parseFloat(payment.principal_amount).toLocaleString()} ETB</td>
                        <td>{parseFloat(payment.interest_amount).toLocaleString()} ETB</td>
                        <td>{parseFloat(payment.balance_before).toLocaleString()} ETB</td>
                        <td>{parseFloat(payment.balance_after).toLocaleString()} ETB</td>
                        <td>{new Date(payment.payment_date).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                  No payments found
                </p>
              )}
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowPaymentHistoryModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRejectModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Reject Loan</h2>
              <button onClick={() => (isSubmitting ? null : setShowRejectModal(false))} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {rejectLoanId}</p>
              <div className="form-group">
                <label>Rejection Reason <span className="required">*</span></label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Enter rejection reason for audit trail"
                  rows={4}
                  disabled={isSubmitting}
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowRejectModal(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button className="btn-primary delete" onClick={confirmReject} disabled={isSubmitting}>
                  {isSubmitting ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Loans;
