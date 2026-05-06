import { useState, useEffect, useCallback } from 'react';
import { CreditCard, CheckCircle, XCircle, DollarSign, Calculator, History, Plus, Search, RefreshCw, AlertTriangle } from 'lucide-react';
import './AdminPages.css';
import { useToast } from '../../context/ToastContext';
import api from '../../utils/api';

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
    amount: '',
    type: 'Personal Loan',
    term: '12 months',
    interestRate: 12,
    paymentFrequency: 'Monthly'
  });
  
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

  const handleApplyLoan = async () => {
    if (!newLoan.clientId || !newLoan.amount || parseFloat(newLoan.amount) <= 0) {
      warning('Client ID and amount are required');
      return;
    }

    try {
      const data = await fetch(`http://localhost:5000/api/clients/${newLoan.clientId}/loans/apply`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: parseFloat(newLoan.amount),
          type: newLoan.type,
          term: newLoan.term,
          interest_rate: parseFloat(newLoan.interestRate),
          payment_frequency: newLoan.paymentFrequency
        })
      }).then(res => res.json());

      if (!data.error) {
        setShowApplyModal(false);
        setNewLoan({ clientId: '', amount: '', type: 'Personal Loan', term: '12 months', interestRate: 12, paymentFrequency: 'Monthly' });
        fetchLoans();
        success('Loan application submitted successfully');
      } else {
        error(data.error);
      }
    } catch (err) {
      error('Failed to submit loan application');
    }
  };

  const handleApprove = async (loanId) => {
    try {
      const data = await fetch(`http://localhost:5000/api/clients/loans/${loanId}/approve`, {
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
      const data = await fetch(`http://localhost:5000/api/clients/loans/${rejectLoanId}/reject`, {
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
      const data = await fetch(`http://localhost:5000/api/clients/loans/${selectedLoan.id}/repay`, {
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
      const data = await fetch(`http://localhost:5000/api/clients/loans/${selectedLoan.id}/calculate-interest?months=${interestMonths}`, {
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
      const data = await fetch(`http://localhost:5000/api/clients/loans/${loanId}/payments`, {
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
                <label>Client ID <span className="required">*</span></label>
                <input
                  type="text"
                  value={newLoan.clientId}
                  onChange={(e) => setNewLoan({ ...newLoan, clientId: e.target.value })}
                  placeholder="Enter client ID"
                  required
                />
              </div>
              <div className="form-group">
                <label>Loan Amount (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={newLoan.amount}
                  onChange={(e) => setNewLoan({ ...newLoan, amount: e.target.value })}
                  placeholder="Enter loan amount"
                  min="1"
                  required
                />
              </div>
              <div className="form-group">
                <label>Loan Type</label>
                <select
                  value={newLoan.type}
                  onChange={(e) => setNewLoan({ ...newLoan, type: e.target.value })}
                >
                  <option value="Personal Loan">Personal Loan</option>
                  <option value="Business Loan">Business Loan</option>
                  <option value="Agricultural Loan">Agricultural Loan</option>
                </select>
              </div>
              <div className="form-group">
                <label>Term</label>
                <select
                  value={newLoan.term}
                  onChange={(e) => setNewLoan({ ...newLoan, term: e.target.value })}
                >
                  <option value="6 months">6 months</option>
                  <option value="12 months">12 months</option>
                  <option value="24 months">24 months</option>
                  <option value="36 months">36 months</option>
                </select>
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
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowApplyModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleApplyLoan}>
                  <Plus size={18} />
                  Submit Application
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
