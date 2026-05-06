import { useEffect, useMemo, useState } from 'react';
import { PiggyBank, TrendingUp, Plus, Download, X, Wallet, Landmark, FileText } from 'lucide-react';
import '../admin/AdminPages.css';
import './ClientPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const initialSavingForm = {
  type: 'Passbook Saving',
  amount: '',
  duration_months: '',
  description: ''
};

const MySavings = () => {
  const { success, warning } = useToast();
  const [savings, setSavings] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [savingOptions, setSavingOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showCreateSavingsModal, setShowCreateSavingsModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [transactionSuccess, setTransactionSuccess] = useState(false);
  const [formError, setFormError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [newSaving, setNewSaving] = useState(initialSavingForm);

  useEffect(() => {
    fetchSavings();
    fetchTransactions();
    fetchSavingOptions();
  }, []);

  const fetchSavings = async () => {
    try {
      const data = await api.getMySavings();
      setSavings(data.filter((saving) => saving.status === 'Active'));
    } catch (error) {
      console.error('Error fetching savings:', error);
      setSavings([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async () => {
    try {
      const data = await api.getMySavingsTransactions();
      const normalized = Array.isArray(data) ? data : [];
      normalized.sort((a, b) => {
        const aTime = new Date(a.created_at || 0).getTime();
        const bTime = new Date(b.created_at || 0).getTime();
        if (bTime !== aTime) return bTime - aTime;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
      setTransactions(normalized);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      setTransactions([]);
    }
  };

  const upsertRecentTransaction = (transaction) => {
    if (!transaction?.id) return;
    setTransactions((current) => {
      const next = [transaction, ...(Array.isArray(current) ? current : [])]
        .filter((item, idx, arr) => item?.id && arr.findIndex((x) => x?.id === item.id) === idx);
      next.sort((a, b) => {
        const aTime = new Date(a.created_at || 0).getTime();
        const bTime = new Date(b.created_at || 0).getTime();
        if (bTime !== aTime) return bTime - aTime;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
      return next.slice(0, 25);
    });
  };

  const fetchSavingOptions = async () => {
    try {
      const data = await api.getSavingsOptions();
      setSavingOptions(data);
    } catch (error) {
      console.error('Error fetching savings options:', error);
      setSavingOptions([]);
    }
  };

  const selectedSavingOption = savingOptions.find((option) => option.type === newSaving.type);

  const openWithdrawModal = (account) => {
    setSelectedAccount(account);
    setAmount('');
    setDescription('');
    setFormError('');
    setReceipt(null);
    setTransactionSuccess(false);
    setShowWithdrawModal(true);
  };

  const resetSavingForm = () => {
    setNewSaving(initialSavingForm);
    setFormError('');
    setReceipt(null);
    setTransactionSuccess(false);
  };

  const handleWithdrawSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    try {
      const result = await api.withdraw(selectedAccount.id, parseFloat(amount), description || 'Withdrawal');
      setTransactionSuccess(true);
      upsertRecentTransaction(result.transaction);
      await Promise.all([fetchSavings(), fetchTransactions()]);
      success('Withdrawal confirmed successfully');
    } catch (error) {
      console.error('Withdrawal error:', error);
      setFormError(error.message);
    }
  };

  const handleCreateSavingsSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!selectedSavingOption) {
      setFormError('Please select a valid saving type.');
      return;
    }

    if (selectedSavingOption.requires_duration && !newSaving.duration_months) {
      setFormError('Duration is required for the selected saving type.');
      return;
    }

    try {
      const result = await api.applySavings({
        type: newSaving.type,
        amount: parseFloat(newSaving.amount),
        duration_months: newSaving.duration_months ? parseInt(newSaving.duration_months, 10) : null,
        description: newSaving.description
      });

      setReceipt(result.receipt || null);
      setTransactionSuccess(true);
      await Promise.all([fetchSavings(), fetchTransactions()]);
      success(result.message || 'Saving transaction recorded successfully.');
    } catch (error) {
      console.error('Saving application error:', error);
      setFormError(error.message);
    }
  };

  const parseFilenameFromContentDisposition = (contentDisposition) => {
    if (!contentDisposition) return null;
    const match = /filename="([^"]+)"/i.exec(contentDisposition);
    return match?.[1] || null;
  };

  const downloadBlob = (blob, filename) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `statement_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleDownloadStatement = async (account) => {
    setFormError('');
    try {
      const { blob, contentDisposition } = await api.downloadSavingsStatementPdf(account.id);
      const filename = parseFilenameFromContentDisposition(contentDisposition)
        || `savings_statement_${account.id}_${new Date().toISOString().slice(0, 10)}.pdf`;
      downloadBlob(blob, filename);
      success('Statement downloaded successfully');
    } catch (err) {
      console.error('Statement download error:', err);
      setFormError(err?.message || 'Failed to download statement');
      warning(err?.message || 'Failed to download statement');
    }
  };

  const renderFeedback = () => (
    formError ? (
      <div className="info-card" style={{ marginBottom: '1rem', borderColor: '#fca5a5', background: '#fef2f2' }}>
        {formError}
      </div>
    ) : null
  );

  const renderReceipt = () => (
    receipt ? (
      <div className="info-card" style={{ marginTop: '1rem', textAlign: 'left' }}>
        <p><strong>Receipt:</strong> {receipt.receipt_id}</p>
        {'saving_type' in receipt && <p><strong>Saving Type:</strong> {receipt.saving_type}</p>}
        {'interest_rate' in receipt && <p><strong>Interest Rate:</strong> {receipt.interest_rate}%</p>}
        <p><strong>Amount:</strong> {Number(receipt.amount || 0).toLocaleString()} ETB</p>
        <p><strong>Confirmed At:</strong> {new Date(receipt.confirmed_at).toLocaleString()}</p>
      </div>
    ) : null
  );

  const savingsOverview = useMemo(() => {
    const totalBalance = savings.reduce((sum, saving) => sum + (Number(saving.amount) || 0), 0);
    const projectedInterest = savings.reduce(
      (sum, saving) => sum + ((Number(saving.amount) || 0) * ((Number(saving.interest_rate) || 0) / 100)),
      0
    );

    return [
      { icon: Wallet, label: 'Total balance', value: `${totalBalance.toLocaleString()} ETB` },
      { icon: PiggyBank, label: 'Active savings accounts', value: String(savings.length) },
      { icon: Landmark, label: 'Projected interest', value: `${projectedInterest.toLocaleString()} ETB` },
      { icon: FileText, label: 'Recent transactions', value: String(transactions.length) }
    ];
  }, [savings, transactions]);

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>My Savings</h1>
        <p>View your balances, open new savings schemes, and request withdrawals</p>
      </div>

      <section className="client-hero-card">
        <div>
          <span className="client-hero-eyebrow">Savings center</span>
          <h2>Track your savings growth in one place.</h2>
          <p>Open a new saving scheme, download statements, and review transactions without digging through multiple sections.</p>
        </div>
        <div className="client-hero-actions">
          <button className="btn-primary" onClick={() => {
            resetSavingForm();
            setShowCreateSavingsModal(true);
          }}>
            <Plus size={18} />
            Open Saving Scheme
          </button>
        </div>
      </section>

      <div className="client-overview-grid">
        {savingsOverview.map((item) => (
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

      <div className="page-actions" style={{ marginBottom: '1.5rem' }}>
        <button className="btn-primary" onClick={() => {
          resetSavingForm();
          setShowCreateSavingsModal(true);
        }}>
          <Plus size={18} />
          Open Saving Scheme
        </button>
      </div>

      <div className="savings-summary">
        <div className="summary-card">
          <div className="summary-icon">
            <PiggyBank size={32} />
          </div>
          <div className="summary-content">
            <h3>Total Balance</h3>
            <p className="summary-value">{savings.reduce((sum, saving) => sum + (saving.amount || 0), 0).toLocaleString()} ETB</p>
            <p className="summary-change">{savings.length} Active Account{savings.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon">
            <TrendingUp size={32} />
          </div>
          <div className="summary-content">
            <h3>Total Interest Projection</h3>
            <p className="summary-value">
              {savings.reduce((sum, saving) => sum + ((saving.amount || 0) * ((saving.interest_rate || 0) / 100)), 0).toLocaleString()} ETB
            </p>
            <p className="summary-change">Based on saving type rates</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Loading savings accounts...</div>
      ) : savings.length === 0 ? (
        <div className="info-card">
          <div className="info-header">
            <PiggyBank size={24} />
            <h3>No Active Savings Accounts</h3>
          </div>
          <p>You currently have no active savings accounts.</p>
        </div>
      ) : (
        <div className="savings-grid">
          {savings.map((saving) => (
            <div key={saving.id} className="savings-card">
              <div className="savings-header">
                <div className="savings-icon">
                  <PiggyBank size={32} />
                </div>
                <div className="savings-info">
                  <h3>{saving.type || 'Savings Account'}</h3>
                  <p>{saving.id}</p>
                  <span className={`status ${saving.status === 'Active' ? 'active' : 'pending'}`}>
                    {saving.status}
                  </span>
                </div>
              </div>

              <div className="savings-details">
                <div className="detail-row">
                  <span className="label">Current Balance</span>
                  <span className="value">{saving.amount?.toLocaleString() || '0'} ETB</span>
                </div>
                <div className="detail-row">
                  <span className="label">Interest Rate</span>
                  <span className="value">{saving.interest_rate || '0'}%</span>
                </div>
                <div className="detail-row">
                  <span className="label">Start Date</span>
                  <span className="value">{saving.created_at || 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Maturity Date</span>
                  <span className="value">{saving.maturity_date || 'Ongoing'}</span>
                </div>
              </div>

              <div className="savings-actions">
                <button className="btn-secondary" onClick={() => openWithdrawModal(saving)}>
                  <TrendingUp size={18} />
                  Withdraw
                </button>
                <button className="btn-secondary" onClick={() => handleDownloadStatement(saving)}>
                  <Download size={18} />
                  Statement
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="table-container">
        <div className="table-header">
          <h2>Recent Transactions</h2>
        </div>
        <table className="data-table">
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
            {transactions.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                  No transactions found
                </td>
              </tr>
            ) : (
              transactions.map((txn) => (
                <tr key={txn.id}>
                  <td>{txn.id}</td>
                  <td>
                    <span className={`txn-type ${txn.transaction_type === 'deposit' ? 'deposit' : txn.transaction_type === 'interest' ? 'interest' : 'withdrawal'}`}>
                      {txn.transaction_type}
                    </span>
                  </td>
                  <td>{Number(txn.amount || 0).toLocaleString()} ETB</td>
                  <td>{txn.created_at}</td>
                  <td>{Number(txn.balance_after || 0).toLocaleString()} ETB</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showWithdrawModal && selectedAccount && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Make Withdrawal</h2>
              <button className="modal-close" onClick={() => setShowWithdrawModal(false)}>
                <X size={24} />
              </button>
            </div>

            {transactionSuccess ? (
              <div className="payment-success">
                <div className="success-icon">OK</div>
                <h3>Withdrawal Successful!</h3>
                <p>Your withdrawal has been processed successfully.</p>
                <div className="modal-actions">
                  <button type="button" className="btn-primary" onClick={() => {
                    setShowWithdrawModal(false);
                    setTransactionSuccess(false);
                  }}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleWithdrawSubmit}>
                {renderFeedback()}
                <div className="payment-details">
                  <div className="payment-detail-row">
                    <span className="label">Account ID:</span>
                    <span className="value">{selectedAccount.id}</span>
                  </div>
                  <div className="payment-detail-row">
                    <span className="label">Available Balance:</span>
                    <span className="value">{selectedAccount.amount?.toLocaleString() || '0'} ETB</span>
                  </div>
                </div>

                <div className="form-group">
                  <label>Withdrawal Amount (ETB)</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="1"
                    max={selectedAccount.amount}
                    step="0.01"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Description (Optional)</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g., Emergency withdrawal"
                  />
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowWithdrawModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    <TrendingUp size={18} />
                    Confirm Withdrawal
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {showCreateSavingsModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Open Saving Scheme</h2>
              <button className="modal-close" onClick={() => setShowCreateSavingsModal(false)}>
                <X size={24} />
              </button>
            </div>

            {transactionSuccess ? (
              <div className="payment-success">
                <div className="success-icon">OK</div>
                <h3>Saving Recorded Successfully!</h3>
                <p>Your saving transaction has been stored and confirmed.</p>
                {renderReceipt()}
                <div className="modal-actions">
                  <button type="button" className="btn-primary" onClick={() => {
                    setShowCreateSavingsModal(false);
                    resetSavingForm();
                  }}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateSavingsSubmit}>
                {renderFeedback()}

                <div className="form-group">
                  <label>Saving Type</label>
                  <select
                    value={newSaving.type}
                    onChange={(e) => setNewSaving({ ...newSaving, type: e.target.value })}
                  >
                    {savingOptions.map((option) => (
                      <option key={option.type} value={option.type}>
                        {option.type}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedSavingOption && (
                  <div className="info-card" style={{ marginBottom: '1rem' }}>
                    <p><strong>Interest Rate:</strong> {selectedSavingOption.interest_rate}%</p>
                    <p><strong>Minimum Amount:</strong> {selectedSavingOption.minimum_amount.toLocaleString()} ETB</p>
                    <p><strong>Details:</strong> {selectedSavingOption.description}</p>
                  </div>
                )}

                <div className="form-group">
                  <label>Amount (ETB)</label>
                  <input
                    type="number"
                    value={newSaving.amount}
                    onChange={(e) => setNewSaving({ ...newSaving, amount: e.target.value })}
                    min={selectedSavingOption?.minimum_amount || 1}
                    step="0.01"
                    required
                  />
                </div>

                {selectedSavingOption?.requires_duration && (
                  <div className="form-group">
                    <label>Duration (Months)</label>
                    <input
                      type="number"
                      value={newSaving.duration_months}
                      onChange={(e) => setNewSaving({ ...newSaving, duration_months: e.target.value })}
                      min="1"
                      required
                    />
                  </div>
                )}

                <div className="form-group">
                  <label>Description (Optional)</label>
                  <input
                    type="text"
                    value={newSaving.description}
                    onChange={(e) => setNewSaving({ ...newSaving, description: e.target.value })}
                    placeholder="e.g., Monthly family savings"
                  />
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => {
                    setShowCreateSavingsModal(false);
                    resetSavingForm();
                  }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    <Plus size={18} />
                    Confirm Saving
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MySavings;
