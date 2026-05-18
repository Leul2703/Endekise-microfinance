import { useState, useEffect, useMemo } from 'react';
import { DollarSign, Calendar, FileText, TrendingUp, AlertCircle, X, PiggyBank, CreditCard, Wallet } from 'lucide-react';
import '../admin/AdminPages.css';
import './ClientPages.css';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import api from '../../utils/api';
import { io } from 'socket.io-client';
import { formatDateOnly, formatDateTime } from '../../utils/dateTime';
import { getInstallmentRemainingFromRow, formatScheduleAmount } from '../../utils/paymentSchedule';

const MyLoans = () => {
  const { success, error: showError, warning } = useToast();
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentType, setPaymentType] = useState('full');
  const [paymentSource, setPaymentSource] = useState('cash');
  const [loans, setLoans] = useState([]);
  const [savings, setSavings] = useState([]);
  const [paymentSchedule, setPaymentSchedule] = useState([]);
  const [penaltyScheduleInfo, setPenaltyScheduleInfo] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [uploadingLoanDoc, setUploadingLoanDoc] = useState(false);
  const [loanDocFile, setLoanDocFile] = useState(null);
  const { user } = useAuth();

  useEffect(() => {
    fetchLoans();
    fetchSavings();
  }, []);

  useEffect(() => {
    const socketBaseUrl = import.meta.env.VITE_SOCKET_URL
      || import.meta.env.VITE_API_BASE_URL?.replace(/\/api\/?$/, '')
      || window.location.origin;
    const socket = io(socketBaseUrl, { transports: ['websocket', 'polling'] });
    const onLoanUpdated = () => {
      fetchLoans();
      fetchSavings();
    };
    socket.on('loanUpdated', onLoanUpdated);
    socket.on('balanceUpdated', onLoanUpdated);
    return () => {
      socket.off('loanUpdated', onLoanUpdated);
      socket.off('balanceUpdated', onLoanUpdated);
      socket.close();
    };
  }, []);

  const fetchLoans = async () => {
    try {
      const data = await api.getMyLoans().catch(() => []);
      setLoans(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching loans:', error);
      showError(error.message || 'Failed to load loans');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadLoanSupportDocument = async (loan) => {
    if (!loanDocFile) {
      warning('Choose a document first.');
      return;
    }
    try {
      setUploadingLoanDoc(true);
      const formData = new FormData();
      formData.append('file', loanDocFile);
      formData.append('loan_id', loan.id);
      formData.append('type', `Loan Request Support - ${loan.status || 'Pending'}`);
      await api.uploadDocument(formData);
      success('Supporting document uploaded for this loan request.');
      setLoanDocFile(null);
    } catch (uploadError) {
      showError(uploadError.message || 'Failed to upload supporting document.');
    } finally {
      setUploadingLoanDoc(false);
    }
  };

  const fetchSavings = async () => {
    try {
      const data = await api.getMySavings().catch(() => []);
      const activeSavings = data.filter(s => s.status === 'Active');
      setSavings(activeSavings);
    } catch (error) {
      console.error('Error fetching savings:', error);
      showError(error.message || 'Failed to load savings accounts');
    }
  };

  const fetchPaymentSchedule = async (loanId) => {
    try {
      const { schedule, penalty_schedule: penaltyInfo } = await api.getPaymentSchedule(loanId);
      setPaymentSchedule(schedule);
      setPenaltyScheduleInfo(penaltyInfo);
    } catch (error) {
      console.error('Error fetching payment schedule:', error);
      setPaymentSchedule([]);
    }
  };

  const fetchPaymentHistory = async (loanId) => {
    try {
      const data = await api.getAccountTransactions(loanId);
      setPaymentHistory(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching payment history:', error);
      showError(error.message || 'Failed to load payment history');
    }
  };

  const handleMakePayment = (loan) => {
    setSelectedLoan(loan);
    setPaymentAmount(loan.nextPayment || loan.balance);
    setPaymentType('full');
    // Default to the linked savings account when available (required by spec)
    setPaymentSource(loan.savings_account_id || 'cash');
    setShowPaymentModal(true);
    setPaymentSuccess(false);
  };

  const handleViewSchedule = async (loan) => {
    setSelectedLoan(loan);
    await fetchPaymentSchedule(loan.id);
    setShowScheduleModal(true);
  };

  const handleViewHistory = async (loan) => {
    setSelectedLoan(loan);
    await fetchPaymentHistory(loan.id);
    setShowHistoryModal(true);
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) {
      warning('Please enter a valid payment amount');
      return;
    }

    if (!selectedLoan || !selectedLoan.id) {
      warning('No loan selected');
      return;
    }
    
    try {
      // Per institutional rule: repayments are paid from savings account.
      if (paymentSource === 'cash') {
        warning('Loan repayments must be paid from a savings account.');
        return;
      }

      const selectedSavings = savings.find(s => s.id === paymentSource);
      if (!selectedSavings) {
        warning('Please select a valid savings account');
        return;
      }

      if (amount > (selectedSavings.amount || 0)) {
        warning('Insufficient savings balance');
        return;
      }

      const data = await api.payment({
          account_id: selectedLoan.id,
          savings_account_id: paymentSource,
          amount: amount,
          description: 'Loan repayment (paid from savings)'
      });
      if (data?.error) {
        showError(`Payment failed: ${data.error}`);
        return;
      }
      setPaymentSuccess(true);
      fetchLoans();
      fetchSavings();
      success('Payment submitted successfully');
      setTimeout(() => {
        setShowPaymentModal(false);
        setPaymentSuccess(false);
      }, 2000);
    } catch (error) {
      console.error('Payment error:', error);
      showError(error.message || 'Payment failed');
    }
  };

  const loanOverview = useMemo(() => {
    const totalBalance = loans.reduce((sum, loan) => sum + (Number(loan.balance) || 0), 0);
    const totalOriginal = loans.reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0);
    const availableSavings = savings.reduce((sum, account) => sum + (Number(account.amount) || 0), 0);

    return [
      { icon: CreditCard, label: 'Active loans', value: String(loans.length) },
      { icon: DollarSign, label: 'Outstanding balance', value: `${totalBalance.toLocaleString()} ETB` },
      { icon: Wallet, label: 'Original loan value', value: `${totalOriginal.toLocaleString()} ETB` },
      { icon: PiggyBank, label: 'Savings available for repayment', value: `${availableSavings.toLocaleString()} ETB` }
    ];
  }, [loans, savings]);

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>My Loans</h1>
        <p>View and manage your loan accounts</p>
      </div>

      <section className="client-hero-card">
        <div>
          <span className="client-hero-eyebrow">Loan center</span>
          <h2>Keep repayments clear and easy to follow.</h2>
          <p>Review active loans, check repayment history, and pay directly from your savings account.</p>
        </div>
        <div className="client-hero-actions">
          <div className="client-hero-note">
            <AlertCircle size={18} />
            <span>{user?.name ? `${user.name}, repayments must come from savings.` : 'Repayments must come from savings.'}</span>
          </div>
        </div>
      </section>

      <div className="client-overview-grid">
        {loanOverview.map((item) => (
          <div key={item.label} className="client-overview-card">
            <div className="client-overview-icon">
              <item.icon size={18} />
            </div>
            <div className="client-overview-content">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="loading-state">Loading loans...</div>
      ) : loans.length === 0 ? (
        <div className="info-card">
          <div className="info-header">
            <AlertCircle size={24} />
            <h3>No Active Loans</h3>
          </div>
          <p>You currently have no active loan accounts.</p>
        </div>
      ) : (
        <div className="loans-grid">
          {loans.map((loan) => (
            <div key={loan.id} className="loan-card">
              <div className="loan-header">
                <div className="loan-icon">
                  <DollarSign size={32} />
                </div>
                <div className="loan-info">
                  <h3>{loan.type || 'Loan'}</h3>
                  <p>{loan.id}</p>
                  <span className={`status ${loan.status === 'Active' ? 'active' : 'pending'}`}>
                    {loan.status}
                  </span>
                </div>
              </div>

              <div className="loan-details">
                <div className="detail-row">
                  <span className="label">Total Amount</span>
                  <span className="value">{loan.amount?.toLocaleString() || '0'} ETB</span>
                </div>
                <div className="detail-row">
                  <span className="label">Current Balance</span>
                  <span className="value">{loan.balance?.toLocaleString() || '0'} ETB</span>
                </div>
                <div className="detail-row">
                  <span className="label">Interest Rate</span>
                  <span className="value">{loan.interest_rate || loan.interestRate || '0'}%</span>
                </div>
                <div className="detail-row">
                  <span className="label">Term</span>
                  <span className="value">{loan.term || 'N/A'}</span>
                </div>
              </div>

              <div className="loan-payment">
                <div className="payment-info">
                  <div className="payment-label">
                    <Calendar size={16} />
                    Current Balance
                  </div>
                  <div className="payment-amount">{loan.balance?.toLocaleString() || '0'} ETB</div>
                </div>
                <button 
                  className="btn-primary"
                  disabled={loan.status !== 'Active'}
                  onClick={() => handleMakePayment(loan)}
                >
                  <DollarSign size={18} />
                  {loan.status === 'Active' ? 'Make Payment' : `Status: ${loan.status}`}
                </button>
              </div>

              <div className="loan-actions">
                <button 
                  className="btn-secondary"
                  onClick={() => handleViewSchedule(loan)}
                >
                  <FileText size={18} />
                  View Schedule
                </button>
                <button 
                  className="btn-secondary"
                  onClick={() => handleViewHistory(loan)}
                >
                  <TrendingUp size={18} />
                  Payment History
                </button>
              </div>
              {loan.status !== 'Active' && (
                <div style={{ marginTop: '0.75rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem' }}>
                  <p style={{ marginBottom: '0.5rem', color: '#6b7280' }}>
                    Request status: <strong>{loan.status}</strong>
                  </p>
                  <input
                    type="file"
                    onChange={(e) => setLoanDocFile(e.target.files?.[0] || null)}
                    style={{ marginBottom: '0.5rem' }}
                  />
                  <button
                    className="btn-secondary"
                    onClick={() => handleUploadLoanSupportDocument(loan)}
                    disabled={uploadingLoanDoc}
                  >
                    {uploadingLoanDoc ? 'Uploading...' : 'Upload Supporting Document'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="info-card client-info-banner">
        <div className="info-header">
          <AlertCircle size={24} />
          <h3>Payment Reminders</h3>
        </div>
        <p>Ensure timely payments to avoid late fees. Automatic payment notifications will be sent 1, 3, and 7 days before due date.</p>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && selectedLoan && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Make Payment</h2>
              <button 
                className="modal-close"
                onClick={() => setShowPaymentModal(false)}
              >
                <X size={24} />
              </button>
            </div>

            {paymentSuccess ? (
              <div className="payment-success">
                <div className="success-icon">✓</div>
                <h3>Payment Successful!</h3>
                <p>Your payment has been processed successfully.</p>
              </div>
            ) : (
              <form onSubmit={handlePaymentSubmit}>
                <div className="payment-details">
                  <div className="payment-detail-row">
                    <span className="label">Loan ID:</span>
                    <span className="value">{selectedLoan.id}</span>
                  </div>
                  <div className="payment-detail-row">
                    <span className="label">Current Balance:</span>
                    <span className="value">{selectedLoan.balance?.toLocaleString() || '0'} ETB</span>
                  </div>
                </div>

                <div className="form-group">
                  <label>Payment Type</label>
                  <select 
                    value={paymentType}
                    onChange={(e) => {
                      setPaymentType(e.target.value);
                      if (e.target.value === 'full') {
                        setPaymentAmount(selectedLoan.balance);
                      } else if (e.target.value === 'partial') {
                        setPaymentAmount('');
                      }
                    }}
                  >
                    <option value="full">Full Payment (Pay Off Balance)</option>
                    <option value="partial">Partial Payment</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Payment Source</label>
                  <select 
                    value={paymentSource}
                    onChange={(e) => setPaymentSource(e.target.value)}
                  >
                    <option value="cash">Cash Payment (Not allowed)</option>
                    {savings.length > 0 && savings.map(s => (
                      <option key={s.id} value={s.id}>
                        Savings: {s.id} ({s.amount?.toLocaleString() || '0'} ETB)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Payment Amount (ETB)</label>
                  <input 
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    min="1"
                    max={selectedLoan.balance}
                    step="0.01"
                    required
                    disabled={paymentType === 'full'}
                  />
                </div>

                <div className="modal-actions">
                  <button 
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowPaymentModal(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    <DollarSign size={18} />
                    Confirm Payment
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Payment Schedule Modal */}
      {showScheduleModal && selectedLoan && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '700px' }}>
            <div className="modal-header">
              <h2>Payment Schedule</h2>
              <button 
                className="modal-close"
                onClick={() => setShowScheduleModal(false)}
              >
                <X size={24} />
              </button>
            </div>

            <div className="payment-details">
              <div className="payment-detail-row">
                <span className="label">Loan ID:</span>
                <span className="value">{selectedLoan.id}</span>
              </div>
              <div className="payment-detail-row">
                <span className="label">Total Amount:</span>
                <span className="value">{selectedLoan.amount?.toLocaleString() || '0'} ETB</span>
              </div>
            </div>

            {paymentSchedule.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                No payment schedule found yet. The schedule appears after loan approval/activation.
              </div>
            ) : (
              <>
              {penaltyScheduleInfo && (
                <div className="info-card" style={{ marginTop: '1rem' }}>
                  <AlertCircle size={18} />
                  <span>
                    Late payment penalty: {penaltyScheduleInfo.penalty_rate_percent}% of installment when overdue.
                    {Number(penaltyScheduleInfo.total_penalty_outstanding) > 0
                      ? ` Total penalties due: ${Number(penaltyScheduleInfo.total_penalty_outstanding).toLocaleString()} ETB.`
                      : ''}
                  </span>
                </div>
              )}
              <div className="mobile-card-list">
                {paymentSchedule.map((payment, index) => {
                  const installmentRemaining = getInstallmentRemainingFromRow(payment);
                  return (
                    <div className="schedule-mobile-card" key={`mobile-${payment.id}`}>
                      <div className="schedule-mobile-card-header">
                        <strong>#{index + 1} · {formatDateOnly(payment.due_date)}</strong>
                        <span className={`status ${
                          payment.status === 'Paid' ? 'active'
                          : payment.status === 'Overdue' ? 'high'
                          : payment.status === 'Partial' ? 'partial'
                          : 'pending'
                        }`}>
                          {payment.status === 'Partial' && installmentRemaining > 0
                            ? `Partial (${formatScheduleAmount(installmentRemaining)} due)`
                            : payment.status}
                        </span>
                      </div>
                      <div className="schedule-mobile-row"><span>Total</span><span>{payment.total_amount?.toFixed(2) || '0'} ETB</span></div>
                      {Number(payment.paid_amount || 0) > 0 && (
                        <div className="schedule-mobile-row"><span>Paid</span><span>{Number(payment.paid_amount).toFixed(2)} ETB</span></div>
                      )}
                      {installmentRemaining > 0 && (
                        <div className="schedule-mobile-row"><span>Remaining</span><strong>{formatScheduleAmount(installmentRemaining)}</strong></div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="table-container desktop-table-only">
              <table className="data-table" style={{ marginTop: '1rem' }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Due Date</th>
                    <th>Principal</th>
                    <th>Interest</th>
                    <th>Total</th>
                    <th>Penalty</th>
                    <th>Paid</th>
                    <th>Remaining Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentSchedule.map((payment, index) => {
                    const installmentRemaining = getInstallmentRemainingFromRow(payment);
                    return (
                    <tr key={payment.id}>
                      <td>{index + 1}</td>
                      <td>{formatDateOnly(payment.due_date)}</td>
                      <td>{payment.principal_amount?.toFixed(2) || '0'} ETB</td>
                      <td>{payment.interest_amount?.toFixed(2) || '0'} ETB</td>
                      <td>{payment.total_amount?.toFixed(2) || '0'} ETB</td>
                      <td>{Number(payment.penalty_amount || 0) > 0 ? `${Number(payment.penalty_amount).toFixed(2)} ETB` : '—'}</td>
                      <td>{Number(payment.paid_amount || 0) > 0 ? `${Number(payment.paid_amount).toFixed(2)} ETB` : '—'}</td>
                      <td>
                        {installmentRemaining > 0
                          ? formatScheduleAmount(installmentRemaining)
                          : '—'}
                      </td>
                      <td>
                        <span className={`status ${
                          payment.status === 'Paid' ? 'active'
                          : payment.status === 'Overdue' ? 'high'
                          : payment.status === 'Partial' ? 'partial'
                          : 'pending'
                        }`}>
                          {payment.status === 'Partial' && installmentRemaining != null
                            ? `Partial (${formatScheduleAmount(installmentRemaining)} due)`
                            : payment.status}
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Payment History Modal */}
      {showHistoryModal && selectedLoan && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '700px' }}>
            <div className="modal-header">
              <h2>Payment History</h2>
              <button 
                className="modal-close"
                onClick={() => setShowHistoryModal(false)}
              >
                <X size={24} />
              </button>
            </div>

            <div className="payment-details">
              <div className="payment-detail-row">
                <span className="label">Loan ID:</span>
                <span className="value">{selectedLoan.id}</span>
              </div>
              <div className="payment-detail-row">
                <span className="label">Current Balance:</span>
                <span className="value">{selectedLoan.balance?.toLocaleString() || '0'} ETB</span>
              </div>
            </div>

            {paymentHistory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                No payment history found
              </div>
            ) : (
              <table className="data-table" style={{ marginTop: '1rem' }}>
                <thead>
                  <tr>
                    <th>Transaction ID</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Date</th>
                    <th>Balance After</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentHistory.map((txn) => (
                    <tr key={txn.id}>
                      <td>{txn.id}</td>
                      <td>
                        <span className={`txn-type ${txn.transaction_type === 'deposit' ? 'deposit' : 'withdrawal'}`}>
                          {txn.transaction_type}
                        </span>
                      </td>
                      <td>{txn.amount?.toLocaleString() || '0'} ETB</td>
                      <td>{formatDateTime(txn.created_at)}</td>
                      <td>{txn.balance_after?.toLocaleString() || '0'} ETB</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MyLoans;
