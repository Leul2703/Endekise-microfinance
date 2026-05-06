import { useState, useEffect } from 'react';
import { Users, Settings, Database, Shield, FileClock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';
import api from '../utils/api';

const formatActivityText = (activity) => {
  if (activity.human_readable_description) {
    return activity.human_readable_description;
  }

  if (typeof activity.details === 'string') {
    try {
      const parsed = JSON.parse(activity.details);
      if (parsed?.action) {
        return parsed.action.replaceAll('_', ' ').toLowerCase();
      }
      return activity.details;
    } catch {
      return activity.details;
    }
  }

  return activity.action ? activity.action.replaceAll('_', ' ') : 'System activity';
};

const formatRelativeTime = (timestamp) => {
  if (!timestamp) {
    return 'Unknown time';
  }

  const eventTime = new Date(timestamp);
  const diffMs = Date.now() - eventTime.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));

  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
};

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState({
    stats: {
      total_users: 0,
      total_branches: 0,
      pending_approvals: 0,
      audit_events: 0,
    },
    recent_activities: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const data = await api.getAdminSummary();
      setSummary(data);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const stats = [
    { icon: Users, label: 'Total Users', value: String(summary.stats.total_users), change: 'Live' },
    { icon: Database, label: 'Branches', value: String(summary.stats.total_branches), change: 'Configured' },
    { icon: Shield, label: 'Pending Approvals', value: String(summary.stats.pending_approvals), change: 'Needs review' },
    { icon: FileClock, label: 'Audit Events', value: String(summary.stats.audit_events), change: 'Recorded' },
  ];

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Admin Dashboard</h1>
        <p>Manage users, monitor audit activity, and review operational health.</p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>Loading dashboard data...</div>
      ) : (
        <div>
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
              <h2>Recent Activities</h2>
              <div className="activity-list">
                {summary.recent_activities.length === 0 ? (
                  <div className="activity-item">
                    <span>No recent audit activity found.</span>
                    <span className="time">Now</span>
                  </div>
                ) : (
                  summary.recent_activities.map((activity) => (
                    <div className="activity-item" key={activity.id}>
                      <span>{formatActivityText(activity)}</span>
                      <span className="time">{formatRelativeTime(activity.timestamp)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="section-card">
              <h2>Quick Actions</h2>
              <div className="action-buttons">
                <button className="action-btn primary" onClick={() => navigate('/admin/accounts')}>
                  <Users size={20} />
                  Manage Users
                </button>
                <button className="action-btn secondary" onClick={() => navigate('/admin/settings')}>
                  <Settings size={20} />
                  System Overview
                </button>
                <button className="action-btn secondary" onClick={() => navigate('/admin/logs')}>
                  <Database size={20} />
                  View Audit Logs
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
