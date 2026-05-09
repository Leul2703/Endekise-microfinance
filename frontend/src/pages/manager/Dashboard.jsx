import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, DollarSign, TrendingUp, AlertTriangle, FileText, Activity, Shield, RefreshCw } from 'lucide-react';
import '../../pages/admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../utils/dateTime';

const ManagerDashboard = () => {
  const navigate = useNavigate();
  const { error } = useToast();
  const [stats, setStats] = useState({
    pendingApprovals: 0,
    approvedToday: 0,
    rejectedToday: 0,
    pendingLoans: 0,
    totalLoanVolume: 0,
    activeLoans: 0
  });
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const fetchDashboardData = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    try {
      const [approvals, loans] = await Promise.all([
        api.getPendingApprovals().catch(() => []),
        api.getLoans().catch(() => [])
      ]);

      setStats({
        pendingApprovals: approvals.length || 0,
        approvedToday: 8,
        rejectedToday: 2,
        pendingLoans: loans.filter(l => l.status === 'Pending').length || 0,
        totalLoanVolume: loans.filter(l => l.status === 'Approved').reduce((sum, l) => sum + parseFloat(l.amount || 0), 0),
        activeLoans: loans.filter(l => l.status === 'Approved').length || 0
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

      const formattedApprovals = approvals.slice(0, 5).map(approval => ({
        ...approval,
        time_ago: formatTimeAgo(approval.created_at)
      }));

      setPendingApprovals(formattedApprovals || []);
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
          <h1>Manager Dashboard</h1>
          <p>Approvals, reports, and branch oversight</p>
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
              title="Pending Approvals"
              value={stats.pendingApprovals}
              icon={<Clock size={24} />}
              color="#f59e0b"
              subtitle="Require action"
              onClick={() => navigate('/manager/approvals')}
            />
            <StatCard
              title="Approved Today"
              value={stats.approvedToday}
              icon={<CheckCircle size={24} />}
              color="#10b981"
              subtitle="Requests processed"
              onClick={() => navigate('/manager/approvals')}
            />
            <StatCard
              title="Rejected Today"
              value={stats.rejectedToday}
              icon={<XCircle size={24} />}
              color="#ef4444"
              subtitle="Requests declined"
              onClick={() => navigate('/manager/approvals')}
            />
            <StatCard
              title="Pending Loans"
              value={stats.pendingLoans}
              icon={<FileText size={24} />}
              color="#8b5cf6"
              subtitle="Awaiting review"
              onClick={() => navigate('/manager/loans')}
            />
            <StatCard
              title="Active Loans"
              value={stats.activeLoans}
              icon={<DollarSign size={24} />}
              color="#ec4899"
              subtitle="Currently active"
              onClick={() => navigate('/manager/loans')}
            />
            <StatCard
              title="Loan Volume"
              value={`${(stats.totalLoanVolume / 1000000).toFixed(2)}M`}
              icon={<TrendingUp size={24} />}
              color="#06b6d4"
              subtitle="ETB total"
              onClick={() => navigate('/manager/loans')}
            />
          </div>

          <div className="dashboard-grid">
            <div className="dashboard-card">
              <div className="card-header">
                <h3>Pending Approvals</h3>
                <Clock size={20} style={{ color: '#6b7280' }} />
              </div>
              <div className="approval-list">
                {pendingApprovals.length > 0 ? (
                  pendingApprovals.map((approval) => (
                    <div key={approval.id} className="approval-item">
                      <div className={`approval-icon ${approval.approval_level}`}>
                        <AlertTriangle size={16} />
                      </div>
                      <div className="approval-content">
                        <p className="approval-type">{approval.type.replace(/_/g, ' ').toUpperCase()}</p>
                        <p className="approval-details">
                          {approval.amount ? `${parseFloat(approval.amount).toLocaleString()} ETB` : '-'} • {approval.approval_level}
                        </p>
                        <p className="approval-time">{approval.time_ago || formatDateTime(approval.created_at)}</p>
                      </div>
                      <div className="approval-actions">
                        <button className="btn-icon edit" title="Approve">
                          <CheckCircle size={16} style={{ color: '#10b981' }} />
                        </button>
                        <button className="btn-icon delete" title="Reject">
                          <XCircle size={16} style={{ color: '#ef4444' }} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>No pending approvals</p>
                )}
              </div>
            </div>

            <div className="dashboard-card">
              <div className="card-header">
                <h3>Quick Actions</h3>
                <Shield size={20} style={{ color: '#6b7280' }} />
              </div>
              <div className="quick-actions">
                <button className="quick-action-btn">
                  <CheckCircle size={20} />
                  <span>Review Approvals</span>
                </button>
                <button className="quick-action-btn">
                  <FileText size={20} />
                  <span>Loan Applications</span>
                </button>
                <button className="quick-action-btn">
                  <Activity size={20} />
                  <span>Branch Reports</span>
                </button>
                <button className="quick-action-btn">
                  <Shield size={20} />
                  <span>Risk Assessment</span>
                </button>
              </div>
            </div>
          </div>

          <div className="dashboard-card" style={{ marginTop: '2rem' }}>
            <div className="card-header">
              <h3>Branch Performance</h3>
              <TrendingUp size={20} style={{ color: '#6b7280' }} />
            </div>
            <div className="performance-grid">
              <div className="performance-item">
                <div className="performance-label">Total Clients</div>
                <div className="performance-value">1,234</div>
                <div className="performance-change" style={{ color: '#10b981' }}>+12% this month</div>
              </div>
              <div className="performance-item">
                <div className="performance-label">Loan Portfolio</div>
                <div className="performance-value">2.5M ETB</div>
                <div className="performance-change" style={{ color: '#10b981' }}>+8% this month</div>
              </div>
              <div className="performance-item">
                <div className="performance-label">Savings Accounts</div>
                <div className="performance-value">1,890</div>
                <div className="performance-change" style={{ color: '#10b981' }}>+15% this month</div>
              </div>
              <div className="performance-item">
                <div className="performance-label">Approval Rate</div>
                <div className="performance-value">87%</div>
                <div className="performance-change" style={{ color: '#f59e0b' }}>-3% this month</div>
              </div>
            </div>
          </div>

          <div className="dashboard-card" style={{ marginTop: '2rem' }}>
            <div className="card-header">
              <h3>Risk Alerts</h3>
              <AlertTriangle size={20} style={{ color: '#6b7280' }} />
            </div>
            <div className="alert-list">
              <div className="alert-item" style={{ background: '#fef2f2', borderColor: '#fca5a5' }}>
                <AlertTriangle size={20} style={{ color: '#991b1b' }} />
                <div className="alert-content">
                  <p className="alert-title">High-Value Transaction Pending</p>
                  <p className="alert-description">Transaction of 500,000 ETB requires CEO approval</p>
                </div>
              </div>
              <div className="alert-item" style={{ background: '#fefce8', borderColor: '#fde047' }}>
                <AlertTriangle size={20} style={{ color: '#854d0e' }} />
                <div className="alert-content">
                  <p className="alert-title">Loan Overdue Alert</p>
                  <p className="alert-description">3 loans have overdue payments this week</p>
                </div>
              </div>
              <div className="alert-item" style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}>
                <AlertTriangle size={20} style={{ color: '#1e40af' }} />
                <div className="alert-content">
                  <p className="alert-title">Document Verification Pending</p>
                  <p className="alert-description">5 KYC documents awaiting verification</p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ManagerDashboard;
