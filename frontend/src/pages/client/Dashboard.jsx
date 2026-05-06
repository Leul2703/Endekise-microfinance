import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, CreditCard, TrendingUp, Calendar, CheckCircle, Clock, DollarSign, AlertCircle, FileText, History, RefreshCw, AlertTriangle } from 'lucide-react';
import '../../pages/admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const ClientDashboard = () => {
  const navigate = useNavigate();
  const { error } = useToast();
  const [stats, setStats] = useState({
    totalBalance: 0,
    activeLoans: 0,
    pendingLoan: 0,
    loanBalance: 0,
    monthlyPayment: 0,
    nextPaymentDate: null
  });
  const [accounts, setAccounts] = useState([]);
  const [loans, setLoans] = useState([]);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const fetchDashboardData = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    try {
      const [balanceSummary, myLoans] = await Promise.all([
        api.getMyBalanceSummary().catch(() => ({ accounts: [] })),
        api.getMyLoans().catch(() => [])
      ]);

      const totalBalance = balanceSummary.accounts?.reduce((sum, acc) => sum + (acc.current_deposit_balance || 0), 0) || 0;
      const activeLoans = myLoans.filter(l => l.status === 'Approved' || l.status === 'Active').length || 0;
      const pendingLoan = myLoans.filter(l => l.status === 'Pending').length || 0;
      const loanBalance = myLoans.filter(l => l.status === 'Approved' || l.status === 'Active').reduce((sum, l) => sum + (parseFloat(l.balance) || 0), 0) || 0;
      const monthlyPayment = myLoans.filter(l => l.status === 'Approved' || l.status === 'Active').reduce((sum, l) => sum + (parseFloat(l.monthly_payment) || 0), 0) || 0;

      setStats({
        totalBalance,
        activeLoans,
        pendingLoan,
        loanBalance,
        monthlyPayment,
        nextPaymentDate: myLoans[0]?.next_payment_date || null
      });

      setAccounts(balanceSummary.accounts || []);
      setLoans(myLoans || []);

      const formatTimeAgo = (timestamp) => {
        const now = new Date();
        const then = new Date(timestamp);
        const diffMs = now - then;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
      };

      const transactions = [
        { id: 1, type: 'deposit', amount: 50000, account: 'SA-MOE123', date: '2026-04-28 10:30' },
        { id: 2, type: 'withdraw', amount: 20000, account: 'SA-MOE123', date: '2026-04-28 09:15' },
        { id: 3, type: 'interest', amount: 1250, account: 'SA-MOE123', date: '2026-04-27 00:00' },
        { id: 4, type: 'repayment', amount: 5000, loan: 'LN-001', date: '2026-04-26 14:00' },
        { id: 5, type: 'deposit', amount: 75000, account: 'SA-MOE456', date: '2026-04-25 11:30' },
      ];

      setRecentTransactions(transactions.map(txn => ({
        ...txn,
        date: formatTimeAgo(txn.date)
      })));
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setFetchError(err.message || 'Failed to load dashboard data');
      error('Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [error]);

  const handleRefresh = () => {
    fetchDashboardData(true);
  };

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const StatCard = ({ title, value, icon, color, subtitle, onClick }) => (
    <div 
      className="stat-card" 
      style={{ background: `${color}10`, borderColor: color, cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
      title={onClick ? `Click to view ${title}` : ''}
    >
      <div className="stat-icon" style={{ background: color, color: '#fff' }}>
        {icon}
      </div>
      <div className="stat-content">
        <p className="stat-label">{title}</p>
        <p className="stat-value">{typeof value === 'number' && value > 1000 ? value.toLocaleString() : value}</p>
        {subtitle && <p className="stat-trend" style={{ color: '#6b7280' }}>{subtitle}</p>}
      </div>
    </div>
  );

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Client Dashboard</h1>
          <p>Your accounts, loans, and financial overview</p>
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

      {loading ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <RefreshCw size={48} className="spinning" style={{ color: '#3b82f6', marginBottom: '1rem' }} />
            <p style={{ color: '#6b7280' }}>Loading dashboard...</p>
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
        <>
          <div className="stats-grid">
            <StatCard
              title="Total Balance"
              value={stats.totalBalance}
              icon={<Wallet size={24} />}
              color="#3b82f6"
              subtitle="Across all accounts"
              onClick={() => navigate('/client/accounts')}
            />
            <StatCard
              title="Active Loans"
              value={stats.activeLoans}
              icon={<CreditCard size={24} />}
              color="#10b981"
              subtitle="Currently active"
              onClick={() => navigate('/client/loans')}
            />
            <StatCard
              title="Pending Loans"
              value={stats.pendingLoan}
              icon={<Clock size={24} />}
              color="#f59e0b"
              subtitle="Awaiting approval"
              onClick={() => navigate('/client/loans')}
            />
            <StatCard
              title="Loan Balance"
              value={stats.loanBalance}
              icon={<DollarSign size={24} />}
              color="#ef4444"
              subtitle="Outstanding"
              onClick={() => navigate('/client/loans')}
            />
            <StatCard
              title="Monthly Payment"
              value={stats.monthlyPayment}
              icon={<Calendar size={24} />}
              color="#8b5cf6"
              subtitle="Due date: {stats.nextPaymentDate}"
              onClick={() => navigate('/client/loans')}
            />
            <StatCard
              title="Interest Earned"
              value="12,500"
              icon={<TrendingUp size={24} />}
              color="#06b6d4"
              subtitle="This month"
              onClick={() => navigate('/client/accounts')}
            />
          </div>

          <div className="dashboard-grid">
            <div className="dashboard-card">
              <div className="card-header">
                <h3>My Accounts</h3>
                <Wallet size={20} style={{ color: '#6b7280' }} />
              </div>
              <div className="account-list">
                {accounts.map((account) => (
                  <div key={account.id} className="account-item">
                    <div className="account-icon" style={{ background: '#dbeafe' }}>
                      <Wallet size={20} style={{ color: '#1e40af' }} />
                    </div>
                    <div className="account-content">
                      <p className="account-name">{account.account_type === 'Savings' ? 'Savings Account' : 'Loan Account'}</p>
                      <p className="account-id">{account.account_number}</p>
                    </div>
                    <div className="account-balance">
                      <p className="balance-value">
                        {Number(account.current_deposit_balance || account.available_credit_or_outstanding_loan_balance || 0).toLocaleString()} ETB
                      </p>
                      <p className="balance-interest">
                        {account.account_type === 'Savings' ? 'Savings balance' : 'Outstanding loan'}
                      </p>
                    </div>
                    <div className="account-status" style={{ color: '#10b981' }}>
                      Active
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="dashboard-card">
              <div className="card-header">
                <h3>My Loans</h3>
                <CreditCard size={20} style={{ color: '#6b7280' }} />
              </div>
              <div className="loan-list">
                {loans.map((loan) => (
                  <div key={loan.id} className="loan-item">
                    <div className={`loan-icon ${loan.status}`}>
                      <CreditCard size={20} />
                    </div>
                    <div className="loan-content">
                      <p className="loan-type">{loan.term}</p>
                      <p className="loan-amount">{parseFloat(loan.amount).toLocaleString()} ETB @ {loan.interest_rate}%</p>
                      <p className="loan-balance">Balance: {parseFloat(loan.balance).toLocaleString()} ETB</p>
                    </div>
                    <div className="loan-status" style={{ 
                      color: loan.status === 'Approved' ? '#10b981' : 
                             loan.status === 'Pending' ? '#f59e0b' : '#ef4444' 
                    }}>
                      {loan.status}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="dashboard-card" style={{ marginTop: '2rem' }}>
            <div className="card-header">
              <h3>Recent Activity</h3>
              <History size={20} style={{ color: '#6b7280' }} />
            </div>
            <div className="activity-list">
              {recentTransactions.map((txn) => (
                <div key={txn.id} className="activity-item">
                  <div className={`activity-icon ${txn.type}`}>
                    {txn.type === 'deposit' && <DollarSign size={16} />}
                    {txn.type === 'withdraw' && <Wallet size={16} />}
                    {txn.type === 'interest' && <TrendingUp size={16} />}
                    {txn.type === 'repayment' && <CheckCircle size={16} />}
                  </div>
                  <div className="activity-content">
                    <p className="activity-message">
                      {txn.type === 'deposit' && `Deposit to ${txn.account}`}
                      {txn.type === 'withdraw' && `Withdrawal from ${txn.account}`}
                      {txn.type === 'interest' && `Interest credited to ${txn.account}`}
                      {txn.type === 'repayment' && `Loan repayment for ${txn.loan}`}
                    </p>
                    <p className="activity-time">{txn.date}</p>
                  </div>
                  <div className={`transaction-amount ${txn.type}`}>
                    {txn.type === 'withdraw' || txn.type === 'repayment' ? '-' : '+'}{txn.amount.toLocaleString()} ETB
                  </div>
                </div>
              ))}
            </div>
          </div>

          {stats.pendingLoan > 0 && (
            <div className="dashboard-card" style={{ marginTop: '2rem', background: '#fefce8', borderColor: '#fde047' }}>
              <div className="card-header">
                <h3 style={{ color: '#854d0e' }}>Loan Application Status</h3>
                <Clock size={20} style={{ color: '#854d0e' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <AlertCircle size={24} style={{ color: '#854d0e' }} />
                <div>
                  <p style={{ margin: 0, color: '#854d0e' }}>You have {stats.pendingLoan} loan application(s) pending approval</p>
                  <p style={{ margin: '0.25rem 0 0 0', color: '#a16207', fontSize: '0.875rem' }}>We will notify you once your application is reviewed</p>
                </div>
              </div>
            </div>
          )}

          <div className="dashboard-card" style={{ marginTop: '2rem' }}>
            <div className="card-header">
              <h3>Quick Actions</h3>
              <FileText size={20} style={{ color: '#6b7280' }} />
            </div>
            <div className="quick-actions">
              <button className="quick-action-btn">
                <DollarSign size={20} />
                <span>Make Deposit</span>
              </button>
              <button className="quick-action-btn">
                <Wallet size={20} />
                <span>Request Withdrawal</span>
              </button>
              <button className="quick-action-btn">
                <CreditCard size={20} />
                <span>Apply for Loan</span>
              </button>
              <button className="quick-action-btn">
                <History size={20} />
                <span>View History</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ClientDashboard;
