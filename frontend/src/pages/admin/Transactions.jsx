import { useState, useEffect, useCallback } from 'react';
import { ArrowDown, ArrowUp, Calculator, History, Search, Wallet, RefreshCw, AlertTriangle } from 'lucide-react';
import './AdminPages.css';
import { useToast } from '../../context/ToastContext';
import api from '../../utils/api';
import { formatDateTime } from '../../utils/dateTime';

const Transactions = () => {
  const { success, error, warning } = useToast();
  const [accountId, setAccountId] = useState('');
  const [account, setAccount] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showInterestModal, setShowInterestModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [interestMonths, setInterestMonths] = useState('1');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSearchAccount = useCallback(async (showRefresh = false) => {
    if (!accountId) {
      warning('Please enter an account ID');
      return;
    }

    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    setLoading(true);
    try {
      const allAccounts = await api.getAllAccounts();
      const foundAccount = allAccounts.find(acc => acc.id === accountId);
      
      if (!foundAccount) {
        error('Account not found');
        setAccount(null);
        setTransactions([]);
        return;
      }

      if (foundAccount.type !== 'savings') {
        error('Only savings accounts can be operated on');
        setAccount(null);
        setTransactions([]);
        return;
      }

      setAccount(foundAccount);
      
      const txnData = await api.getAccountTransactions(accountId);
      setTransactions(txnData);
      
      success('Account loaded successfully');
    } catch (err) {
      setFetchError(err.message || 'Failed to load account');
      error('Failed to load account');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accountId, success, error, warning]);

  const handleRefresh = () => {
    if (account) {
      handleSearchAccount(true);
    }
  };

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      warning('Amount must be greater than 0');
      return;
    }

    try {
      const res = await fetch(`http://localhost:5000/api/clients/accounts/${accountId}/deposit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: parseFloat(depositAmount),
          description: description || 'Deposit'
        })
      });
      const data = await res.json();

      if (!data.error) {
        setShowDepositModal(false);
        setDepositAmount('');
        setDescription('');
        handleSearchAccount();
        success(`Deposited ${depositAmount} ETB successfully`);
      } else {
        error(data.error);
      }
    } catch (err) {
      error('Deposit failed');
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      warning('Amount must be greater than 0');
      return;
    }

    try {
      const res = await fetch(`http://localhost:5000/api/clients/accounts/${accountId}/withdraw`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: parseFloat(withdrawAmount),
          description: description || 'Withdrawal'
        })
      });
      const data = await res.json();

      if (!data.error) {
        setShowWithdrawModal(false);
        setWithdrawAmount('');
        setDescription('');
        handleSearchAccount();
        success(`Withdrew ${withdrawAmount} ETB successfully`);
      } else {
        error(data.error);
      }
    } catch (err) {
      error('Withdrawal failed');
    }
  };

  const handleInterest = async () => {
    if (!interestMonths || parseFloat(interestMonths) <= 0) {
      warning('Months must be greater than 0');
      return;
    }

    try {
      const res = await fetch(`http://localhost:5000/api/clients/accounts/${accountId}/interest`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          months: parseInt(interestMonths)
        })
      });
      const data = await res.json();

      if (!data.error) {
        setShowInterestModal(false);
        setInterestMonths('1');
        handleSearchAccount();
        success(`Interest calculated: ${data.transaction.interest_amount.toFixed(2)} ETB`);
      } else {
        error(data.error);
      }
    } catch (err) {
      error('Interest calculation failed');
    }
  };

  const getTransactionTypeIcon = (type) => {
    switch (type) {
      case 'deposit': return <ArrowDown size={16} style={{ color: '#10b981' }} />;
      case 'withdraw': return <ArrowUp size={16} style={{ color: '#ef4444' }} />;
      case 'interest': return <Calculator size={16} style={{ color: '#8b5cf6' }} />;
      default: return null;
    }
  };

  const getTransactionTypeColor = (type) => {
    switch (type) {
      case 'deposit': return '#10b981';
      case 'withdraw': return '#ef4444';
      case 'interest': return '#8b5cf6';
      default: return '#6b7280';
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Transaction Management</h1>
          <p>Search accounts, perform deposits/withdrawals, calculate interest, and view transaction history</p>
        </div>
        {account && (
          <button 
            className="btn-secondary" 
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <RefreshCw size={18} className={refreshing ? 'spinning' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </div>

      <div className="page-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Enter Account ID (e.g., SA-XXX-XXX)"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearchAccount()}
          />
          <button className="btn-primary" onClick={() => handleSearchAccount()} disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      {account && (
        <div className="info-card" style={{ marginBottom: '2rem', background: '#f0f9ff', borderColor: '#bae6fd' }}>
          <Wallet size={24} style={{ color: '#0369a1' }} />
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 0.5rem 0', color: '#0369a1' }}>
              {account.client_name} - {account.id}
            </h3>
            <p style={{ margin: 0, color: '#0369a1' }}>
              Type: {account.type === 'savings' ? 'Savings Account' : 'Loan Account'} | 
              Balance: <strong>{parseFloat(account.balance).toLocaleString()} ETB</strong> |
              Status: <span className={`status ${account.status === 'Active' ? 'active' : 'inactive'}`}>{account.status}</span> |
              Interest Rate: <strong>{account.interest_rate || 0}%</strong>
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn-primary" onClick={() => { setShowDepositModal(true); setDescription(''); }}>
              <ArrowDown size={18} />
              Deposit
            </button>
            <button className="btn-primary" onClick={() => { setShowWithdrawModal(true); setDescription(''); }}>
              <ArrowUp size={18} />
              Withdraw
            </button>
            <button className="btn-primary" onClick={() => setShowInterestModal(true)}>
              <Calculator size={18} />
              Interest
            </button>
          </div>
        </div>
      )}

      {fetchError && (
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
      )}

      {account && transactions.length > 0 && (
        <div className="table-container">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <History size={20} />
            <h3 style={{ margin: 0 }}>Transaction History</h3>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>Description</th>
                <th>Balance Before</th>
                <th>Balance After</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn) => (
                <tr key={txn.id}>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {getTransactionTypeIcon(txn.transaction_type)}
                      <span style={{ color: getTransactionTypeColor(txn.transaction_type), fontWeight: 'bold' }}>
                        {txn.transaction_type.toUpperCase()}
                      </span>
                    </span>
                  </td>
                  <td style={{ color: getTransactionTypeColor(txn.transaction_type), fontWeight: 'bold' }}>
                    {txn.transaction_type === 'withdraw' ? '-' : '+'}{parseFloat(txn.amount).toLocaleString()} ETB
                  </td>
                  <td>{txn.description || '-'}</td>
                  <td>{parseFloat(txn.balance_before).toLocaleString()} ETB</td>
                  <td>{parseFloat(txn.balance_after).toLocaleString()} ETB</td>
                  <td>{formatDateTime(txn.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {account && transactions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>
          <History size={48} style={{ marginBottom: '1rem' }} />
          <p>No transactions found for this account</p>
        </div>
      )}

      {showDepositModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Deposit Money</h2>
              <button onClick={() => setShowDepositModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Account:</strong> {account?.id}</p>
              <p><strong>Current Balance:</strong> {parseFloat(account?.balance || 0).toLocaleString()} ETB</p>
              
              <div className="form-group">
                <label>Amount (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="Enter amount"
                  min="1"
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter description (optional)"
                />
              </div>
              
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowDepositModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleDeposit}>
                  <ArrowDown size={18} />
                  Deposit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWithdrawModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Withdraw Money</h2>
              <button onClick={() => setShowWithdrawModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Account:</strong> {account?.id}</p>
              <p><strong>Available Balance:</strong> {parseFloat(account?.balance || 0).toLocaleString()} ETB</p>
              
              <div className="form-group">
                <label>Amount (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="Enter amount"
                  min="1"
                  max={account?.balance}
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter description (optional)"
                />
              </div>
              
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowWithdrawModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleWithdraw}>
                  <ArrowUp size={18} />
                  Withdraw
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showInterestModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Calculate Interest</h2>
              <button onClick={() => setShowInterestModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Account:</strong> {account?.id}</p>
              <p><strong>Current Balance:</strong> {parseFloat(account?.balance || 0).toLocaleString()} ETB</p>
              <p><strong>Interest Rate:</strong> {account?.interest_rate || 5}%</p>
              
              <div className="info-card" style={{ marginBottom: '1rem', background: '#fef3c7', borderColor: '#fcd34d' }}>
                <Calculator size={20} style={{ color: '#92400e' }} />
                <span style={{ color: '#92400e' }}>
                  Interest will be calculated as: (Balance × Interest Rate × Months) / 12
                </span>
              </div>
              
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
                <button className="btn-primary" onClick={handleInterest}>
                  <Calculator size={18} />
                  Calculate & Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Transactions;
