import { useEffect, useMemo, useState } from 'react';
import { Calendar, DollarSign, Eye, FileText, PiggyBank, Upload, ArrowRight, Wallet, BellRing } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import './Dashboard.css';
import './client/ClientPages.css';
import { formatDateTime } from '../utils/dateTime';

const formatCurrency = (value) => `${Number(value || 0).toLocaleString()} ETB`;

const ClientDashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [balanceInquiryTime, setBalanceInquiryTime] = useState(null);
  const [noAccountsMessage, setNoAccountsMessage] = useState('');
  const [summaryAccounts, setSummaryAccounts] = useState([]);
  const [savingsAccounts, setSavingsAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [documents, setDocuments] = useState([]);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const [summary, savings, savingsTransactions, docs] = await Promise.all([
          api.getMyBalanceSummary().catch(() => ({ accounts: [], message: 'No active accounts found. Please contact your branch.' })),
          api.getMySavings().catch(() => []),
          api.getMySavingsTransactions().catch(() => []),
          api.getDocuments().catch(() => []),
        ]);

        setSummaryAccounts(Array.isArray(summary.accounts) ? summary.accounts : []);
        setNoAccountsMessage(summary.message || 'No active accounts found. Please contact your branch.');
        setSavingsAccounts(Array.isArray(savings) ? savings : []);
        setTransactions(Array.isArray(savingsTransactions) ? savingsTransactions : []);
        setDocuments(Array.isArray(docs) ? docs : []);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const loanRows = useMemo(
    () => summaryAccounts.filter((account) => String(account.account_type || '').toLowerCase().includes('loan')),
    [summaryAccounts]
  );

  const activeSavingsRows = useMemo(
    () => savingsAccounts.filter((account) => account.status === 'Active'),
    [savingsAccounts]
  );

  const stats = useMemo(() => {
    const savingsBalance = activeSavingsRows.reduce((sum, account) => sum + (Number(account.amount) || 0), 0);
    const pendingDocuments = documents.filter((doc) => doc.status === 'Pending').length;
    return [
      { icon: DollarSign, label: 'Active Loans', value: String(loanRows.length), change: 'Live' },
      { icon: PiggyBank, label: 'Savings Balance', value: formatCurrency(savingsBalance), change: 'Live' },
      { icon: Calendar, label: 'Next Payment', value: 'Check My Loans', change: 'Live' },
      { icon: FileText, label: 'Pending Documents', value: String(pendingDocuments), change: 'Live' },
    ];
  }, [activeSavingsRows, documents, loanRows]);

  const highlightItems = useMemo(() => {
    return [
      {
        icon: Wallet,
        title: 'Available savings',
        value: formatCurrency(activeSavingsRows.reduce((sum, account) => sum + (Number(account.amount) || 0), 0)),
        action: 'View savings',
        onClick: () => navigate('/client/savings')
      },
      {
        icon: Calendar,
        title: 'Loan accounts',
        value: `${loanRows.length} active`,
        action: 'Check loans',
        onClick: () => navigate('/client/loans')
      },
      {
        icon: BellRing,
        title: 'Document follow-up',
        value: `${documents.filter((doc) => doc.status === 'Pending').length} pending`,
        action: 'Open documents',
        onClick: () => navigate('/client/documents')
      }
    ];
  }, [activeSavingsRows, documents, loanRows, navigate]);

  const handleViewBalance = async () => {
    try {
      const summary = await api.getMyBalanceSummary();
      const accounts = Array.isArray(summary.accounts) ? summary.accounts : [];
      setSummaryAccounts(accounts);
      setNoAccountsMessage(summary.message || 'No active accounts found. Please contact your branch.');
    } catch (error) {
      setSummaryAccounts([]);
      setNoAccountsMessage(error.message || 'Unable to load your account balances right now.');
    }

    setBalanceInquiryTime(new Date());
    setShowBalanceModal(true);

    try {
      await api.logBalanceInquiry();
    } catch (error) {
      console.error('Error logging balance inquiry:', error);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Client Dashboard</h1>
        <p>View your current loan and savings position.</p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>Loading dashboard data...</div>
      ) : (
        <div>
          <div className="client-spotlight">
            <div>
              <span className="client-spotlight-label">Today at a glance</span>
              <h2>Everything important is one tap away.</h2>
              <p>Review balances, continue loan follow-up, and manage documents from a simpler client home screen.</p>
            </div>
            <div className="client-spotlight-actions">
              <button className="action-btn primary" onClick={handleViewBalance}>
                <Eye size={20} />
                View Balance
              </button>
              <button className="action-btn secondary" onClick={() => navigate('/client/profile')}>
                <Upload size={20} />
                Update Profile
              </button>
            </div>
          </div>

          <div className="client-highlights">
            {highlightItems.map((item) => (
              <button key={item.title} type="button" className="client-highlight-card" onClick={item.onClick}>
                <div className="client-highlight-icon">
                  <item.icon size={20} />
                </div>
                <div className="client-highlight-content">
                  <span>{item.title}</span>
                  <strong>{item.value}</strong>
                </div>
                <ArrowRight size={18} className="client-highlight-arrow" />
              </button>
            ))}
          </div>

          <div className="stats-grid">
            {stats.map((stat, index) => (
              <div key={index} className="stat-card">
                <div className="stat-icon">
                  <stat.icon size={24} />
                </div>
                <div className="stat-content">
                  <h3>{stat.value}</h3>
                  <p>{stat.label}</p>
                  <span className="stat-change">{stat.change}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="dashboard-sections">
            <div className="section-card">
              <div className="section-header-with-action">
                <h2>Loan Accounts</h2>
                <button className="btn-sm primary" onClick={handleViewBalance}>
                  <Eye size={16} />
                  View Balance
                </button>
              </div>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Account Number</th>
                      <th>Outstanding Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loanRows.length === 0 ? (
                      <tr>
                        <td colSpan="2" style={{ textAlign: 'center', padding: '2rem' }}>
                          No active loan accounts found.
                        </td>
                      </tr>
                    ) : loanRows.map((loan) => (
                      <tr key={loan.account_number}>
                        <td>{loan.account_number}</td>
                        <td>{formatCurrency(loan.available_credit_or_outstanding_loan_balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="section-card">
              <div className="section-header-with-action">
                <h2>Savings Accounts</h2>
                <button className="btn-sm secondary" onClick={() => navigate('/client/savings')}>
                  <PiggyBank size={16} />
                  Manage
                </button>
              </div>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Account ID</th>
                      <th>Type</th>
                      <th>Balance</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSavingsRows.length === 0 ? (
                      <tr>
                        <td colSpan="4" style={{ textAlign: 'center', padding: '2rem' }}>
                          No active savings accounts found.
                        </td>
                      </tr>
                    ) : activeSavingsRows.map((account) => (
                      <tr key={account.id}>
                        <td>{account.id}</td>
                        <td>{account.type}</td>
                        <td>{formatCurrency(account.amount)}</td>
                        <td><span className="status active">{account.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="section-card">
              <h2>Quick Actions</h2>
              <div className="action-buttons">
                <button className="action-btn primary" onClick={() => navigate('/client/loans')}>
                  <DollarSign size={20} />
                  My Loans
                </button>
                <button className="action-btn secondary" onClick={() => navigate('/client/savings')}>
                  <PiggyBank size={20} />
                  My Savings
                </button>
                <button className="action-btn secondary" onClick={handleViewBalance}>
                  <Eye size={20} />
                  View Balance
                </button>
                <button className="action-btn secondary" onClick={() => navigate('/client/profile')}>
                  <Upload size={20} />
                  Profile & Documents
                </button>
                <button className="action-btn secondary" onClick={() => navigate('/client/documents')}>
                  <FileText size={20} />
                  Upload Documents
                </button>
              </div>
            </div>

            <div className="section-card">
              <h2>Recent Savings Transactions</h2>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Transaction ID</th>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan="4" style={{ textAlign: 'center', padding: '2rem' }}>
                          No transactions found.
                        </td>
                      </tr>
                    ) : transactions.slice(0, 8).map((txn) => (
                      <tr key={txn.id}>
                        <td>{txn.id}</td>
                        <td>{txn.transaction_type}</td>
                        <td>{formatCurrency(txn.amount)}</td>
                        <td>{formatDateTime(txn.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBalanceModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Account Balance Summary</h2>
              <button onClick={() => setShowBalanceModal(false)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <div className="balance-summary">
                {summaryAccounts.length > 0 ? (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Account Type</th>
                        <th>Account Number</th>
                        <th>Current Deposit Balance</th>
                        <th>Available Credit/Outstanding Loan Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryAccounts.map((account) => (
                        <tr key={`${account.account_type}-${account.account_number}`}>
                          <td>{account.account_type}</td>
                          <td>{account.account_number}</td>
                          <td>{formatCurrency(account.current_deposit_balance)}</td>
                          <td>{formatCurrency(account.available_credit_or_outstanding_loan_balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="balance-note">{noAccountsMessage}</p>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setShowBalanceModal(false)}>
                  Close
                </button>
                <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  {balanceInquiryTime ? `Balance inquiry logged at ${formatDateTime(balanceInquiryTime)}` : 'Balance inquiry logged'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientDashboard;
