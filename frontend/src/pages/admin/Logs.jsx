import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, AlertCircle, User, Clock, FileText, RefreshCw, AlertTriangle } from 'lucide-react';
import './AdminPages.css';
import api from '../../utils/api';
import { formatDateTime } from '../../utils/dateTime';
import { useNavigate } from 'react-router-dom';

const Logs = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const fetchLogs = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    try {
      const data = await api.getAuditLogs();
      setLogs(data);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
      setFetchError(err.message || 'Failed to load audit logs');
      setLogs([
        { id: 1, action: 'LOGIN', user_role: 'admin', details: 'User admin logged in', timestamp: '2026-04-20 10:30:00' },
        { id: 2, action: 'USER_DELETE', user_role: 'admin', details: 'Deleted user ID 5', timestamp: '2026-04-20 09:15:00' },
        { id: 3, action: 'LOAN_APPROVE', user_role: 'branch_manager', details: 'Approved loan LN-009', timestamp: '2026-04-20 08:45:00' },
        { id: 4, action: 'BALANCE_ADJUST', user_role: 'ceo', details: 'Adjusted balance for ACC-001', timestamp: '2026-04-20 08:30:00' },
        { id: 5, action: 'DOCUMENT_UPLOAD', user_role: 'loan_staff', details: 'Uploaded document DOC-007', timestamp: '2026-04-20 08:15:00' },
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleRefresh = () => {
    fetchLogs(true);
  };

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

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

  const filteredLogs = logs.filter(log => {
    const detailText = getLogText(log);
    const matchesSearch = (log.action || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                         detailText.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (log.user_role || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterAction === 'all' || log.action === filterAction;
    return matchesSearch && matchesFilter;
  });

  const getActionColor = (action) => {
    const colors = {
      'LOGIN': 'active',
      'LOGOUT': 'pending',
      'USER_CREATE': 'active',
      'USER_CREATED': 'active',
      'USER_DELETE': 'inactive',
      'USER_DELETED': 'inactive',
      'USER_UPDATE': 'good',
      'USER_UPDATED': 'good',
      'USER_ARCHIVED': 'pending',
      'LOAN_APPROVE': 'active',
      'LOAN_REJECT': 'inactive',
      'LOAN_ESCALATE': 'high',
      'SAVINGS_APPROVE': 'active',
      'SAVINGS_REJECT': 'inactive',
      'BALANCE_ADJUST': 'high',
      'DOCUMENT_UPLOAD': 'good',
      'DOCUMENT_VERIFY': 'active',
      'DOCUMENT_REJECT': 'inactive',
      'PERMISSION_GRANTED': 'active',
      'PERMISSION_REVOKED': 'inactive',
    };
    return colors[action] || 'pending';
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Audit Trail Logs</h1>
          <p>View system audit logs for compliance and security monitoring</p>
          <div style={{ marginTop: '0.75rem' }}>
            <button className="btn-secondary" type="button" onClick={() => navigate(-1)}>
              Back
            </button>
          </div>
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

      <div className="info-card" style={{ marginBottom: '2rem', background: '#dbeafe', borderColor: '#93c5fd' }}>
        <AlertCircle size={24} style={{ color: '#1e40af' }} />
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 0.25rem 0', color: '#1e40af' }}>Audit Trail Information</h3>
          <p style={{ margin: 0, color: '#1e40af' }}>All system actions are logged for compliance. Logs include user actions, timestamp, and details. Logs are retained for 7 years per regulatory requirements.</p>
        </div>
      </div>

      <div className="page-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search logs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
            <option value="all">All Actions</option>
            <option value="LOGIN">Login</option>
            <option value="LOGOUT">Logout</option>
            <option value="USER_CREATE">User Create</option>
            <option value="USER_CREATED">User Created</option>
            <option value="USER_DELETE">User Delete</option>
            <option value="USER_DELETED">User Deleted</option>
            <option value="USER_UPDATE">User Update</option>
            <option value="USER_UPDATED">User Updated</option>
            <option value="USER_ARCHIVED">User Archived</option>
            <option value="LOAN_APPROVE">Loan Approve</option>
            <option value="LOAN_REJECT">Loan Reject</option>
            <option value="LOAN_ESCALATE">Loan Escalate</option>
            <option value="BALANCE_ADJUST">Balance Adjust</option>
            <option value="DOCUMENT_UPLOAD">Document Upload</option>
            <option value="PERMISSION_GRANTED">Permission Granted</option>
            <option value="PERMISSION_REVOKED">Permission Revoked</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <RefreshCw size={48} className="spinning" style={{ color: '#3b82f6', marginBottom: '1rem' }} />
            <p style={{ color: '#6b7280' }}>Loading audit logs...</p>
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
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Action</th>
                <th>User Role</th>
                <th>Details</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td>#{log.id}</td>
                  <td>
                    <span className={`status ${getActionColor(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <User size={16} />
                      {(log.user_role || 'unknown').replace('_', ' ').toUpperCase()}
                    </div>
                  </td>
                  <td>{getLogText(log)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Clock size={16} />
                      {formatDateTime(log.timestamp)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Logs;
