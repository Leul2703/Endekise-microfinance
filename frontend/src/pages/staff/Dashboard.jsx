import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, CreditCard, Users, TrendingUp, Calendar, CheckCircle, Clock, DollarSign, Activity, RefreshCw, AlertTriangle } from 'lucide-react';
import '../../pages/admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const StaffDashboard = () => {
  const navigate = useNavigate();
  const { error } = useToast();
  const [stats, setStats] = useState({
    todayTransactions: 0,
    todayDeposits: 0,
    todayWithdrawals: 0,
    pendingLoans: 0,
    activeClients: 0,
    todayAmount: 0
  });
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
      const [clients, loans] = await Promise.all([
        api.getClients().catch(() => []),
        api.getLoans().catch(() => [])
      ]);

      setStats({
        todayTransactions: 24,
        todayDeposits: 15,
        todayWithdrawals: 9,
        pendingLoans: loans.filter(l => l.status === 'Pending').length || 0,
        activeClients: clients.filter(c => c.status === 'Active').length || 0,
        todayAmount: 450000
      });

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
        { id: 1, type: 'deposit', amount: 50000, account: 'SA-MOE123', client: 'John Doe', time: '2026-04-28 10:30' },
        { id: 2, type: 'withdraw', amount: 20000, account: 'SA-MOE456', client: 'Jane Smith', time: '2026-04-28 10:15' },
        { id: 3, type: 'deposit', amount: 75000, account: 'SA-MOE789', client: 'Bob Johnson', time: '2026-04-28 09:45' },
        { id: 4, type: 'interest', amount: 1250, account: 'SA-MOE123', client: 'John Doe', time: '2026-04-28 09:00' },
        { id: 5, type: 'withdraw', amount: 30000, account: 'SA-MOE456', client: 'Jane Smith', time: '2026-04-28 08:30' },
      ];

      setRecentTransactions(transactions.map(txn => ({
        ...txn,
        time: formatTimeAgo(txn.time)
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
        <p className="stat-value">{value}</p>
        {subtitle && <p className="stat-trend" style={{ color: '#6b7280' }}>{subtitle}</p>}
      </div>
    </div>
  );

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Staff Dashboard</h1>
          <p>Daily operations and transaction management</p>
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
              title="Today's Transactions"
              value={stats.todayTransactions}
              icon={<Activity size={24} />}
              color="#3b82f6"
              subtitle="Completed today"
              onClick={() => navigate('/staff/transactions')}
            />
            <StatCard
              title="Deposits"
              value={stats.todayDeposits}
              icon={<DollarSign size={24} />}
              color="#10b981"
              subtitle="Money in"
              onClick={() => navigate('/staff/transactions')}
            />
            <StatCard
              title="Withdrawals"
              value={stats.todayWithdrawals}
              icon={<Wallet size={24} />}
              color="#ef4444"
              subtitle="Money out"
              onClick={() => navigate('/staff/transactions')}
            />
            <StatCard
              title="Pending Loans"
              value={stats.pendingLoans}
              icon={<Clock size={24} />}
              color="#f59e0b"
              subtitle="Awaiting approval"
              onClick={() => navigate('/staff/loans')}
            />
            <StatCard
              title="Active Clients"
              value={stats.activeClients}
              icon={<Users size={24} />}
              color="#8b5cf6"
              subtitle="With accounts"
              onClick={() => navigate('/staff/clients')}
            />
            <StatCard
              title="Today's Volume"
              value={`${(stats.todayAmount / 1000).toFixed(0)}K`}
              icon={<TrendingUp size={24} />}
              color="#ec4899"
              subtitle="ETB processed"
              onClick={() => navigate('/staff/transactions')}
            />
          </div>

          <div className="dashboard-grid">
            <div className="dashboard-card">
              <div className="card-header">
                <h3>Recent Transactions</h3>
                <Activity size={20} style={{ color: '#6b7280' }} />
              </div>
              <div className="transaction-list">
                {recentTransactions.map((txn) => (
                  <div key={txn.id} className="transaction-item">
                    <div className={`transaction-icon ${txn.type}`}>
                      {txn.type === 'deposit' && <DollarSign size={16} />}
                      {txn.type === 'withdraw' && <Wallet size={16} />}
                      {txn.type === 'interest' && <TrendingUp size={16} />}
                    </div>
                    <div className="transaction-content">
                      <p className="transaction-description">
                        {txn.type === 'deposit' && 'Deposit to '}
                        {txn.type === 'withdraw' && 'Withdrawal from '}
                        {txn.type === 'interest' && 'Interest for '}
                        {txn.client}
                      </p>
                      <p className="transaction-account">{txn.account}</p>
                    </div>
                    <div className={`transaction-amount ${txn.type}`}>
                      {txn.type === 'withdraw' ? '-' : '+'}{txn.amount.toLocaleString()} ETB
                    </div>
                    <p className="transaction-time">{txn.time}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="dashboard-card">
              <div className="card-header">
                <h3>Quick Actions</h3>
                <Calendar size={20} style={{ color: '#6b7280' }} />
              </div>
              <div className="quick-actions">
                <button className="quick-action-btn">
                  <DollarSign size={20} />
                  <span>New Deposit</span>
                </button>
                <button className="quick-action-btn">
                  <Wallet size={20} />
                  <span>New Withdrawal</span>
                </button>
                <button className="quick-action-btn">
                  <CreditCard size={20} />
                  <span>Apply Loan</span>
                </button>
                <button className="quick-action-btn">
                  <Users size={20} />
                  <span>Register Client</span>
                </button>
              </div>
            </div>
          </div>

          <div className="dashboard-card" style={{ marginTop: '2rem' }}>
            <div className="card-header">
              <h3>Today's Summary</h3>
              <CheckCircle size={20} style={{ color: '#6b7280' }} />
            </div>
            <div className="summary-grid">
              <div className="summary-item">
                <div className="summary-label">Total Deposits</div>
                <div className="summary-value" style={{ color: '#10b981' }}>350,000 ETB</div>
              </div>
              <div className="summary-item">
                <div className="summary-label">Total Withdrawals</div>
                <div className="summary-value" style={{ color: '#ef4444' }}>100,000 ETB</div>
              </div>
              <div className="summary-item">
                <div className="summary-label">Net Flow</div>
                <div className="summary-value" style={{ color: '#10b981' }}>+250,000 ETB</div>
              </div>
              <div className="summary-item">
                <div className="summary-label">Interest Calculated</div>
                <div className="summary-value" style={{ color: '#8b5cf6' }}>12,500 ETB</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default StaffDashboard;
