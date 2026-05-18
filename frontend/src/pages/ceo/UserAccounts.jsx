import { useEffect, useMemo, useState, useCallback } from 'react';
import { Search, Users, ShieldCheck, Mail, UserCircle2, RefreshCw, AlertTriangle } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const UserAccounts = () => {
  const { error, success } = useToast();
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);

  const fetchUsers = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    try {
      const [userData, clientData] = await Promise.all([
        api.getUsers(),
        api.getClients().catch(() => [])
      ]);
      setUsers(Array.isArray(userData) ? userData : []);
      setClients(Array.isArray(clientData) ? clientData : []);
    } catch (err) {
      console.error('Error loading CEO user accounts view:', err);
      const errorMessage = err.message || 'Failed to load users';
      setFetchError(errorMessage);
      if (!showRefresh) {
        if (errorMessage.includes('Database error')) {
          error('Unable to connect to the database. Please check your connection.');
        } else if (errorMessage.includes('Unauthorized')) {
          error('You are not authorized to view users. Please log in again.');
        } else {
          error(errorMessage);
        }
      }
      setUsers([]);
      setClients([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [error]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const filteredStaffUsers = useMemo(() => (
    users.filter((user) => {
      if (user.role === 'client') return false;
      const query = searchTerm.toLowerCase();
      return (
        user.name?.toLowerCase().includes(query) ||
        user.username?.toLowerCase().includes(query) ||
        user.role?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query)
      );
    })
  ), [searchTerm, users]);

  const filteredClientUsers = useMemo(() => (
    clients.filter((client) => {
      const query = searchTerm.toLowerCase();
      return (
        client.name?.toLowerCase().includes(query) ||
        client.email?.toLowerCase().includes(query) ||
        client.phone?.toLowerCase().includes(query)
      );
    })
  ), [clients, searchTerm]);

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>User Accounts</h1>
        <p>Review registered system users and account status after CEO login.</p>
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className="inline-meta">Staff: {filteredStaffUsers.length}</span>
          <span className="inline-meta">Clients: {filteredClientUsers.length}</span>
        </div>
      </div>

      <div className="info-card" style={{ marginBottom: '1.5rem' }}>
        <Users size={24} />
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 0.25rem 0' }}>CEO Oversight</h3>
          <p style={{ margin: 0 }}>
            This view is read-only for account visibility so you can inspect staff and client access without changing user administration rules.
          </p>
        </div>
      </div>

      <div className="page-actions sticky-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search users by name, username, role, or email..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <button 
          className="btn-secondary" 
          onClick={() => fetchUsers(true)}
          disabled={refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <RefreshCw size={20} className={refreshing ? 'spinning' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {loading ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <RefreshCw size={48} className="spinning" style={{ color: '#3b82f6', marginBottom: '1rem' }} />
            <p style={{ color: '#6b7280' }}>Loading user accounts...</p>
          </div>
        </div>
      ) : fetchError ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <AlertTriangle size={48} style={{ color: '#ef4444', marginBottom: '1rem' }} />
            <p style={{ color: '#ef4444', marginBottom: '1rem' }}>{fetchError}</p>
            <button className="btn-primary" onClick={() => fetchUsers(true)}>
              <RefreshCw size={18} />
              Try Again
            </button>
          </div>
        </div>
      ) : (
      <>
      <div className="table-container" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '1rem' }}>Staff Users</h3>
        {filteredStaffUsers.length === 0 ? (
          <div className="empty-state">
            <p>No staff user accounts matched your search.</p>
          </div>
        ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredStaffUsers.map((user) => (
                <tr key={user.id}>
                  <td>#{user.id}</td>
                  <td>{user.name}</td>
                  <td>{user.username}</td>
                  <td>{user.email || 'Not set'}</td>
                  <td><span className="role-badge">{user.role.replace('_', ' ')}</span></td>
                  <td>
                    <span className={`status ${user.status === 'Active' ? 'active' : 'inactive'}`}>
                      {user.status}
                    </span>
                  </td>
                  <td>{user.created}</td>
                  <td>
                    <button className="btn-icon edit" title="View Account" onClick={() => setSelectedUser(user)}>
                      <ShieldCheck size={18} />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        )}
      </div>
      <div className="table-container">
        <h3 style={{ margin: '1rem' }}>Clients</h3>
        {filteredClientUsers.length === 0 ? (
          <div className="empty-state">
            <p>No clients matched your search.</p>
          </div>
        ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>KYC Status</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredClientUsers.map((client) => (
                <tr key={`client-${client.id}`}>
                  <td>#{client.id}</td>
                  <td>{client.name}</td>
                  <td>{client.email || 'Not set'}</td>
                  <td>{client.phone || 'Not set'}</td>
                  <td>{client.kyc_status || 'Pending'}</td>
                  <td>
                    <span className={`status ${client.status === 'Active' ? 'active' : 'inactive'}`}>
                      {client.status || 'Active'}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        )}
      </div>
      </>
      )}

      {selectedUser && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>User Account Details</h2>
              <button onClick={() => setSelectedUser(null)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <div className="info-card" style={{ marginBottom: '1rem' }}>
                <UserCircle2 size={24} />
                <div>
                  <h3 style={{ margin: '0 0 0.25rem 0' }}>{selectedUser.name}</h3>
                  <p style={{ margin: 0 }}>#{selectedUser.id} • {selectedUser.username}</p>
                </div>
              </div>

              <div className="form-group">
                <label>Email</label>
                <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Mail size={16} />
                  {selectedUser.email || 'Not set'}
                </p>
              </div>
              <div className="form-group">
                <label>Role</label>
                <p>{selectedUser.role.replace('_', ' ')}</p>
              </div>
              <div className="form-group">
                <label>Status</label>
                <span className={`status ${selectedUser.status === 'Active' ? 'active' : 'inactive'}`}>
                  {selectedUser.status}
                </span>
              </div>
              <div className="form-group">
                <label>Created</label>
                <p>{selectedUser.created}</p>
              </div>

              <div className="modal-actions">
                <button className="btn-primary" onClick={() => setSelectedUser(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserAccounts;
