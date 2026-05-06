import { useEffect, useMemo, useState } from 'react';
import { DollarSign, AlertTriangle, Lock, Check, Search, RefreshCw } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const INITIAL_ADJUSTMENT = {
  adjustmentType: 'credit',
  amount: '',
  justificationCode: '',
  justificationText: ''
};

const BalanceManagement = () => {
  const { success, error: showError, warning } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [adjustmentData, setAdjustmentData] = useState(INITIAL_ADJUSTMENT);
  const [authPassword, setAuthPassword] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    const canPreview = selectedAccount && adjustmentData.amount && Number(adjustmentData.amount) > 0;
    if (!canPreview) {
      setPreview(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const response = await api.previewBalanceAdjustment({
          account_id: selectedAccount.accountId,
          account_type: selectedAccount.accountType,
          adjustment_type: adjustmentData.adjustmentType,
          amount: Number(adjustmentData.amount)
        });
        setPreview(response);
      } catch (previewError) {
        console.error('Balance preview error:', previewError);
        setPreview(null);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [adjustmentData.adjustmentType, adjustmentData.amount, selectedAccount]);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const [savingsAccounts, loanAccounts] = await Promise.all([
        api.getAllClientAccounts().catch(() => []),
        api.getLoans().catch(() => [])
      ]);

      const savingsRows = Array.isArray(savingsAccounts)
        ? savingsAccounts.map((account) => ({
            id: `SV-${account.id}`,
            client: account.client_name || 'Unknown Client',
            account: account.id,
            accountId: account.id,
            accountType: 'savings',
            currentBalanceValue: Number(account.balance || 0),
            currentBalance: `${Number(account.balance || 0).toLocaleString()} ETB`,
            type: 'Savings'
          }))
        : [];

      const loanRows = Array.isArray(loanAccounts)
        ? loanAccounts.map((loan) => ({
            id: `LN-${loan.id}`,
            client: loan.client || loan.client_name || 'Unknown Client',
            account: loan.id,
            accountId: loan.id,
            accountType: 'loan',
            currentBalanceValue: Number(loan.balance || 0),
            currentBalance: `${Number(loan.balance || 0).toLocaleString()} ETB`,
            type: 'Loan'
          }))
        : [];

      setAccounts([...savingsRows, ...loanRows]);
    } catch (fetchError) {
      console.error('Error loading balance management accounts:', fetchError);
      showError(fetchError.message || 'Failed to load accounts for balance adjustment');
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredAccounts = useMemo(() => (
    accounts.filter((account) => (
      account.client.toLowerCase().includes(searchTerm.toLowerCase()) ||
      account.account.toLowerCase().includes(searchTerm.toLowerCase()) ||
      account.id.toLowerCase().includes(searchTerm.toLowerCase())
    ))
  ), [accounts, searchTerm]);

  const resetAdjustmentState = () => {
    setShowAdjustModal(false);
    setShowAuthModal(false);
    setSelectedAccount(null);
    setAdjustmentData(INITIAL_ADJUSTMENT);
    setAuthPassword('');
    setPreview(null);
  };

  const handleAdjustBalance = (account) => {
    setSelectedAccount(account);
    setAdjustmentData(INITIAL_ADJUSTMENT);
    setPreview(null);
    setShowAuthModal(true);
  };

  const handleAuthConfirm = () => {
    if (!authPassword.trim()) {
      warning('Password is required for secondary authentication.');
      return;
    }

    setShowAuthModal(false);
    setShowAdjustModal(true);
  };

  const calculateNewBalance = () => {
    if (!selectedAccount || !adjustmentData.amount) return null;
    const currentBalance = Number(selectedAccount.currentBalanceValue || 0);
    const adjustmentAmount = Number(adjustmentData.amount || 0);
    const newBalance = adjustmentData.adjustmentType === 'credit'
      ? currentBalance + adjustmentAmount
      : currentBalance - adjustmentAmount;
    return `${newBalance.toLocaleString()} ETB`;
  };

  const confirmAdjustment = async () => {
    if (!selectedAccount) {
      warning('Select an account before submitting an adjustment.');
      return;
    }

    if (!adjustmentData.amount || Number(adjustmentData.amount) <= 0 || !adjustmentData.justificationCode || !adjustmentData.justificationText) {
      warning('All fields are mandatory. Justification is required for audit compliance.');
      return;
    }

    const justification = `[${adjustmentData.justificationCode}] ${adjustmentData.justificationText}`.trim();
    if (justification.length < 20) {
      warning('Detailed justification must be at least 20 characters.');
      return;
    }

    setProcessing(true);
    try {
      const response = await api.adjustBalance({
        account_id: selectedAccount.accountId,
        account_type: selectedAccount.accountType,
        adjustment_type: adjustmentData.adjustmentType,
        amount: Number(adjustmentData.amount),
        justification,
        secondary_auth: authPassword
      });
      success(`Balance adjustment completed. Transaction ID: ${response.transaction_id}`);
      resetAdjustmentState();
      fetchAccounts();
    } catch (error) {
      console.error('Error processing balance adjustment:', error);
      showError(error.message || 'Failed to process balance adjustment');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Balance Management</h1>
        <p>Perform highly sensitive balance adjustments with mandatory audit logging and secondary authentication</p>
      </div>

      <div className="info-card" style={{ marginBottom: '2rem', background: '#fef3c7', borderColor: '#fcd34d' }}>
        <Lock size={24} style={{ color: '#92400e' }} />
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 0.25rem 0', color: '#92400e' }}>Security Notice</h3>
          <p style={{ margin: 0, color: '#92400e' }}>All balance adjustments require secondary authentication and are logged with your digital signature for audit compliance.</p>
        </div>
      </div>

      <div className="page-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search accounts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button className="btn-secondary" type="button" onClick={fetchAccounts}>
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      <div className="table-container">
        {loading ? (
          <p style={{ textAlign: 'center', padding: '2rem' }}>Loading accounts...</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Account ID</th>
                <th>Client</th>
                <th>Account</th>
                <th>Type</th>
                <th>Current Balance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.id}</td>
                  <td>{account.client}</td>
                  <td>{account.account}</td>
                  <td>{account.type}</td>
                  <td>
                    <span className="amount-highlight">{account.currentBalance}</span>
                  </td>
                  <td>
                    <button className="btn-primary btn-sm" type="button" onClick={() => handleAdjustBalance(account)}>
                      <DollarSign size={16} />
                      Adjust Balance
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAuthModal && selectedAccount && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Secondary Authentication</h2>
              <button onClick={resetAdjustmentState} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <div className="info-card" style={{ marginBottom: '1rem' }}>
                <Lock size={20} />
                <span>For security, you must re-authenticate before performing balance adjustments.</span>
              </div>
              <div className="form-group">
                <label>Password <span className="required">*</span></label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" type="button" onClick={resetAdjustmentState}>
                  Cancel
                </button>
                <button className="btn-primary" type="button" onClick={handleAuthConfirm}>
                  <Check size={18} />
                  Authenticate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAdjustModal && selectedAccount && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Balance Adjustment</h2>
              <button onClick={resetAdjustmentState} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <p><strong>Account ID:</strong> {selectedAccount.accountId}</p>
              <p><strong>Client:</strong> {selectedAccount.client}</p>
              <p><strong>Current Balance:</strong> {selectedAccount.currentBalance}</p>

              <div className="form-group">
                <label>Adjustment Type <span className="required">*</span></label>
                <select
                  value={adjustmentData.adjustmentType}
                  onChange={(e) => setAdjustmentData({ ...adjustmentData, adjustmentType: e.target.value })}
                  required
                >
                  <option value="credit">Credit (Add)</option>
                  <option value="debit">Debit (Subtract)</option>
                </select>
              </div>

              <div className="form-group">
                <label>Adjustment Amount (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={adjustmentData.amount}
                  onChange={(e) => setAdjustmentData({ ...adjustmentData, amount: e.target.value })}
                  placeholder="Enter amount"
                  min="1"
                  required
                />
              </div>

              {(preview || calculateNewBalance()) && (
                <div className="info-card" style={{ marginBottom: '1rem', background: '#dbeafe', borderColor: '#93c5fd' }}>
                  <DollarSign size={20} style={{ color: '#1e40af' }} />
                  <div>
                    <p style={{ margin: 0, color: '#1e40af' }}>
                      Proposed Final Balance: <strong>{preview ? `${Number(preview.proposed_final_balance || 0).toLocaleString()} ETB` : calculateNewBalance()}</strong>
                    </p>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Justification Code <span className="required">*</span></label>
                <select
                  value={adjustmentData.justificationCode}
                  onChange={(e) => setAdjustmentData({ ...adjustmentData, justificationCode: e.target.value })}
                  required
                >
                  <option value="">Select code...</option>
                  <option value="CORRECTION">Correction Error</option>
                  <option value="REFUND">Refund Processing</option>
                  <option value="ADJUSTMENT">Manual Adjustment</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <div className="form-group">
                <label>Detailed Justification <span className="required">*</span></label>
                <textarea
                  value={adjustmentData.justificationText}
                  onChange={(e) => setAdjustmentData({ ...adjustmentData, justificationText: e.target.value })}
                  placeholder="Provide detailed justification for this adjustment (mandatory for audit compliance)"
                  rows={4}
                  required
                />
              </div>

              <div className="info-card" style={{ marginBottom: '1rem' }}>
                <AlertTriangle size={20} />
                <span>This action will create an irreversible audit log entry with your digital signature.</span>
              </div>

              <div className="modal-actions">
                <button className="btn-secondary" type="button" onClick={resetAdjustmentState}>
                  Cancel
                </button>
                <button className="btn-primary" type="button" onClick={confirmAdjustment} disabled={processing}>
                  <Check size={18} />
                  {processing ? 'Processing...' : 'Confirm Adjustment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BalanceManagement;
