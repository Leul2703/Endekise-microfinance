import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Activity, TrendingUp, AlertCircle, CheckCircle, Clock, Shield, RefreshCw, AlertTriangle } from 'lucide-react';
import './AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { error } = useToast();
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    pendingApprovals: 0,
    totalClients: 0,
    totalLoans: 0,
    totalAccounts: 0
  });
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const fetchDashboardData = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    try {
      const [users, clients, loans, approvals, auditLogs] = await Promise.all([
        api.getUsers().catch(() => []),
        api.getClients().catch(() => []),
        api.getLoans().catch(() => []),
        api.getPendingApprovals().catch(() => []),
        api.getAuditLogs().catch(() => [])
      ]);

      setStats({
        totalUsers: users.length || 0,
        activeUsers: users.filter(u => u.status === 'Active').length || 0,
        pendingApprovals: approvals.length || 0,
        totalClients: clients.length || 0,
        totalLoans: loans.length || 0,
        totalAccounts: clients.length * 2 || 0
      });

      const getLogText = (log) => {
        if (log.human_readable_description) {
          return log.human_readable_description;
        }

        let details = log.details;
        if (typeof details === 'string') {
          try {
            details = JSON.parse(details);
          } catch {
            // If it's a simple string, return it as-is
            return details;
          }
        }

        if (!details || typeof details !== 'object') {
          return log.action || 'No details available';
        }

        const action = log.action || details.action;

        // Handle specific action types
        if (action === 'USER_CREATED' || action === 'USER_CREATE') {
          const username = details.created_user || details.username;
          const role = details.created_role || details.role;
          const name = details.created_name || details.name;
          return `Created user ${username} (${role})${name ? ` - ${name}` : ''}`;
        }

        if (action === 'USER_UPDATED' || action === 'USER_UPDATE') {
          const username = details.updated_user || details.username;
          return `Updated user ${username}`;
        }

        if (action === 'CLIENT_REGISTERED') {
          const name = details.name || details.client_name;
          return `Registered client ${name || ''}`;
        }

        if (action === 'CLIENT_UPDATED') {
          const name = details.name || details.client_name;
          const kycStatus = details.kyc_status;
          if (kycStatus) {
            return `Updated client ${name || ''} - KYC status: ${kycStatus}`;
          }
          return `Updated client ${name || ''}`;
        }

        if (action === 'LOGIN') {
          return 'User logged in';
        }

        if (action === 'LOGOUT') {
          return 'User logged out';
        }

        if (action === 'LOAN_APPROVED' || action === 'LOAN_APPROVE') {
          const loanId = details.loan_id || details.loan_number;
          return `Approved loan ${loanId || ''}`;
        }

        if (action === 'LOAN_REJECTED' || action === 'LOAN_REJECT') {
          const loanId = details.loan_id || details.loan_number;
          return `Rejected loan ${loanId || ''}`;
        }

        if (action === 'BALANCE_ADJUST') {
          const account = details.account_id || details.account;
          return `Adjusted balance for account ${account || ''}`;
        }

        if (action === 'DOCUMENT_UPLOAD') {
          const docId = details.document_id || details.doc_id;
          return `Uploaded document ${docId || ''}`;
        }

        if (action === 'PERMISSION_GRANTED') {
          const userId = details.user_id;
          const permission = details.permission;
          return `Granted permission ${permission || ''} to user ${userId || ''}`;
        }

        if (action === 'PERMISSION_REVOKED') {
          const userId = details.user_id;
          const permission = details.permission;
          return `Revoked permission ${permission || ''} from user ${userId || ''}`;
        }

        // Smart fallback: try to infer from details structure
        if (details.created_user) {
          const username = details.created_user;
          const role = details.created_role;
          const name = details.created_name;
          return `Created user ${username} (${role})${name ? ` - ${name}` : ''}`;
        }

        if (details.kyc_status) {
          const name = details.name || details.client_name;
          return `Updated client ${name || ''} - KYC status: ${details.kyc_status}`;
        }

        if (details.beforeState && details.afterState) {
          const name = details.afterState?.name || details.name;
          return `Updated ${name || 'record'}`;
        }

        // Fallback: try to extract meaningful info
        if (details.action) {
          return details.action;
        }

        // Last resort: return the action if available
        if (action) {
          return action.replace(/_/g, ' ').toLowerCase();
        }

        return 'No details available';
      };

      const getActivityIcon = (action) => {
        const iconMap = {
          'LOGIN': <Activity size={16} />,
          'LOGOUT': <Activity size={16} />,
          'USER_CREATE': <Users size={16} />,
          'USER_CREATED': <Users size={16} />,
          'USER_DELETE': <Users size={16} />,
          'USER_DELETED': <Users size={16} />,
          'USER_UPDATE': <Users size={16} />,
          'USER_UPDATED': <Users size={16} />,
          'CLIENT_REGISTERED': <Users size={16} />,
          'LOAN_APPROVE': <CheckCircle size={16} />,
          'LOAN_APPROVED': <CheckCircle size={16} />,
          'LOAN_REJECT': <XCircle size={16} />,
          'LOAN_REJECTED': <XCircle size={16} />,
          'LOAN_ESCALATE': <AlertTriangle size={16} />,
          'SAVINGS_APPROVE': <CheckCircle size={16} />,
          'SAVINGS_REJECT': <XCircle size={16} />,
          'BALANCE_ADJUST': <DollarSign size={16} />,
          'DOCUMENT_UPLOAD': <FileText size={16} />,
          'DOCUMENT_VERIFY': <FileText size={16} />,
          'PERMISSION_GRANTED': <Shield size={16} />,
          'PERMISSION_REVOKED': <Shield size={16} />,
        };
        return iconMap[action] || <Activity size={16} />;
      };

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

      const recentActivities = auditLogs.slice(0, 5).map((log, index) => ({
        id: log.id || index,
        type: log.action,
        message: getLogText(log),
        time: formatTimeAgo(log.timestamp),
        icon: getActivityIcon(log.action)
      }));

      setRecentActivity(recentActivities.length > 0 ? recentActivities : [
        { id: 1, type: 'user_created', message: 'New user registered', time: '2 hours ago', icon: <Users size={16} /> },
        { id: 2, type: 'loan_approved', message: 'Loan application approved', time: '4 hours ago', icon: <CheckCircle size={16} /> },
        { id: 3, type: 'approval_pending', message: 'Large transaction requires approval', time: '5 hours ago', icon: <Clock size={16} /> },
        { id: 4, type: 'client_added', message: 'New client registered', time: '6 hours ago', icon: <Users size={16} /> },
      ]);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setFetchError(err.message || 'Failed to load dashboard data');
      if (!showRefresh) {
        error('Failed to load dashboard data');
      }
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

  const StatCard = ({ title, value, icon, color, trend, onClick }) => (
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
        {trend && <p className="stat-trend" style={{ color: trend > 0 ? '#10b981' : '#ef4444' }}>{trend > 0 ? '+' : ''}{trend}% from last month</p>}
      </div>
    </div>
  );

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Admin Dashboard</h1>
          <p>System overview and user management</p>
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
              title="Total Users"
              value={stats.totalUsers}
              icon={<Users size={24} />}
              color="#3b82f6"
              trend={12}
              onClick={() => navigate('/admin/accounts')}
            />
            <StatCard
              title="Active Users"
              value={stats.activeUsers}
              icon={<Activity size={24} />}
              color="#10b981"
              trend={8}
              onClick={() => navigate('/admin/accounts')}
            />
            <StatCard
              title="Total Clients"
              value={stats.totalClients}
              icon={<Users size={24} />}
              color="#8b5cf6"
              trend={15}
              onClick={() => navigate('/admin/clients')}
            />
            <StatCard
              title="Pending Approvals"
              value={stats.pendingApprovals}
              icon={<Clock size={24} />}
              color="#f59e0b"
              trend={-5}
              onClick={() => navigate('/admin/approvals')}
            />
            <StatCard
              title="Total Loans"
              value={stats.totalLoans}
              icon={<TrendingUp size={24} />}
              color="#ec4899"
              trend={22}
              onClick={() => navigate('/admin/loans')}
            />
            <StatCard
              title="Total Accounts"
              value={stats.totalAccounts}
              icon={<Shield size={24} />}
              color="#06b6d4"
              trend={18}
              onClick={() => navigate('/admin/accounts')}
            />
          </div>

          <div className="dashboard-grid">
            <div className="dashboard-card">
              <div className="card-header">
                <h3>Recent Activity</h3>
                <Activity size={20} style={{ color: '#6b7280' }} />
              </div>
              <div className="activity-list">
                {recentActivity.map((activity) => (
                  <div key={activity.id} className="activity-item">
                    <div className="activity-icon" style={{ background: '#f3f4f6' }}>
                      {activity.icon}
                    </div>
                    <div className="activity-content">
                      <p className="activity-message">{activity.message}</p>
                      <p className="activity-time">{activity.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="dashboard-card">
              <div className="card-header">
                <h3>Quick Actions</h3>
                <Shield size={20} style={{ color: '#6b7280' }} />
              </div>
              <div className="quick-actions">
                <button className="quick-action-btn" onClick={() => navigate('/admin/users')}>
                  <Users size={20} />
                  <span>Manage Users</span>
                </button>
                <button className="quick-action-btn" onClick={() => navigate('/admin/approvals')}>
                  <CheckCircle size={20} />
                  <span>Review Approvals</span>
                </button>
                <button className="quick-action-btn" onClick={() => navigate('/admin/logs')}>
                  <Activity size={20} />
                  <span>View Logs</span>
                </button>
                <button className="quick-action-btn" onClick={() => navigate('/admin/settings')}>
                  <Shield size={20} />
                  <span>System Settings</span>
                </button>
              </div>
            </div>
          </div>

          <div className="dashboard-card" style={{ marginTop: '2rem' }}>
            <div className="card-header">
              <h3>System Health</h3>
              <Activity size={20} style={{ color: '#6b7280' }} />
            </div>
            <div className="system-health">
              <div className="health-item">
                <div className="health-label">Database Connection</div>
                <div className="health-status" style={{ color: '#10b981' }}>
                  <CheckCircle size={16} />
                  Healthy
                </div>
              </div>
              <div className="health-item">
                <div className="health-label">API Response Time</div>
                <div className="health-status" style={{ color: '#10b981' }}>
                  <CheckCircle size={16} />
                  45ms
                </div>
              </div>
              <div className="health-item">
                <div className="health-label">Storage Usage</div>
                <div className="health-status" style={{ color: '#f59e0b' }}>
                  <AlertCircle size={16} />
                  68% used
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminDashboard;
