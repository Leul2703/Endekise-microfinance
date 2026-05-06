import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Edit, Trash2, Filter, Lock, Archive, Shield, ShieldCheck, X, RefreshCw, AlertTriangle } from 'lucide-react';
import './AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const Accounts = () => {
  const { success, error: showError, warning } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [authPassword, setAuthPassword] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [availablePermissions, setAvailablePermissions] = useState([]);
  const [userPermissions, setUserPermissions] = useState([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [assigningPermission, setAssigningPermission] = useState(false);
  const [revokingPermissionId, setRevokingPermissionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newAccount, setNewAccount] = useState({
    name: '',
    username: '',
    password: '',
    role: 'client'
  });
  const [editAccount, setEditAccount] = useState({
    name: '',
    role: '',
    status: 'Active'
  });
  const [permissionForm, setPermissionForm] = useState({
    permission: '',
    expires_at: ''
  });

  const fetchAccounts = useCallback(async ({ preserveOnError = true, showRefresh = false } = {}) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    try {
      const data = await api.getUsers();
      setAccounts(data);
      return data;
    } catch (err) {
      console.error('Error fetching accounts:', err);
      setFetchError(err.message || 'Failed to load accounts');
      if (!preserveOnError) {
        setAccounts([]);
      }
      throw err;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleRefresh = () => {
    fetchAccounts({ showRefresh: true });
  };

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const filteredAccounts = accounts.filter(account => {
    const matchesSearch = account.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         account.username.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterRole === 'all' || account.role === filterRole;
    return matchesSearch && matchesFilter;
  });

  const handleDelete = (account) => {
    if (account.status === 'Active') {
      warning('Cannot delete active accounts. Account must be Inactive or Suspended before deletion.');
      return;
    }
    setSelectedAccount(account);
    setShowAuthModal(true);
  };

  const handleAuthConfirm = async () => {
    if (!authPassword) {
      warning('Password is required for account deletion per security protocol.');
      return;
    }

    if (selectedAccount.status === 'Active') {
      warning('Cannot delete active accounts. Only inactive or suspended accounts can be deleted.');
      return;
    }

    try {
      const deletedAccountId = selectedAccount.id;
      await api.deleteUser(selectedAccount.id, authPassword, true);
      setShowAuthModal(false);
      setAuthPassword('');
      setSelectedAccount(null);
      setAccounts((current) => current.filter((account) => account.id !== deletedAccountId));
      fetchAccounts().catch((refreshError) => {
        console.error('Error refreshing accounts after delete:', refreshError);
        warning('Account deleted, but the list could not be refreshed automatically.');
      });
      success('Account deleted successfully. Audit trail logged.');
    } catch (err) {
      console.error('Error deleting account:', err);
      showError(`Failed to delete account: ${err.message}`);
    }
  };

  const handleAddAccount = async () => {
    if (!newAccount.name || !newAccount.username || !newAccount.password || !newAccount.role) {
      warning('All fields are required.');
      return;
    }
    if (newAccount.username.trim().length < 3 || /\s/.test(newAccount.username)) {
      warning('Username must be at least 3 characters with no spaces.');
      return;
    }
    if (newAccount.password.length < 10 || !/[A-Z]/.test(newAccount.password) || !/[a-z]/.test(newAccount.password) || !/[0-9]/.test(newAccount.password) || !/[^A-Za-z0-9]/.test(newAccount.password)) {
      warning('Password must be at least 10 characters and include upper, lower, number, and special character.');
      return;
    }
    try {
      await api.createUser(newAccount);
      setShowAddModal(false);
      setNewAccount({ name: '', username: '', password: '', role: 'client' });
      await fetchAccounts();
      success('Account created successfully.');
    } catch (err) {
      console.error('Error creating account:', err);
      if (err.message?.includes('Username already exists')) {
        showError('Username already exists. Please choose a different username.');
      } else {
        showError(`Failed to create account: ${err.message}`);
      }
    }
  };

  const handleEdit = (account) => {
    setSelectedAccount(account);
    setEditAccount({
      name: account.name,
      role: account.role,
      status: account.status
    });
    setShowEditModal(true);
  };

  const handleUpdateAccount = async () => {
    if (!editAccount.name || !editAccount.role) {
      warning('Name and role are required.');
      return;
    }
    try {
      console.log('[UPDATE] Sending update for user ID:', selectedAccount.id, 'Data:', editAccount);
      await api.updateUser(selectedAccount.id, editAccount);
      setShowEditModal(false);
      setSelectedAccount(null);
      setEditAccount({ name: '', role: '', status: 'Active' });
      await fetchAccounts();
      success('Account updated successfully.');
    } catch (err) {
      console.error('Error updating account:', err);
      showError(`Failed to update account: ${err.message}`);
    }
  };

  const handleArchive = (account) => {
    if (account.status === 'Archived') {
      warning('Account is already archived.');
      return;
    }
    setSelectedAccount(account);
    setShowArchiveModal(true);
  };

  const confirmArchive = async () => {
    try {
      await api.archiveUser(selectedAccount.id);
      setShowArchiveModal(false);
      setSelectedAccount(null);
      await fetchAccounts();
      success('Account archived successfully. Audit trail logged.');
    } catch (err) {
      console.error('Error archiving account:', err);
      showError(`Failed to archive account: ${err.message}`);
    }
  };

  const openPermissionsModal = async (account) => {
    setSelectedAccount(account);
    setShowPermissionsModal(true);
    setPermissionsLoading(true);
    setPermissionForm({ permission: '', expires_at: '' });

    try {
      const [available, assigned] = await Promise.all([
        api.getAvailablePermissions(),
        api.getUserPermissions(account.id)
      ]);

      setAvailablePermissions(Array.isArray(available) ? available : []);
      setUserPermissions(Array.isArray(assigned) ? assigned : []);
    } catch (err) {
      console.error('Error loading permissions:', err);
      showError(`Failed to load permissions: ${err.message}`);
      setAvailablePermissions([]);
      setUserPermissions([]);
    } finally {
      setPermissionsLoading(false);
    }
  };

  const closePermissionsModal = () => {
    setShowPermissionsModal(false);
    setSelectedAccount(null);
    setAvailablePermissions([]);
    setUserPermissions([]);
    setPermissionForm({ permission: '', expires_at: '' });
    setPermissionsLoading(false);
    setAssigningPermission(false);
    setRevokingPermissionId(null);
  };

  const handleAssignPermission = async () => {
    if (!selectedAccount) {
      return;
    }

    if (!permissionForm.permission) {
      warning('Select a permission to assign.');
      return;
    }

    setAssigningPermission(true);
    try {
      await api.assignUserPermission(selectedAccount.id, {
        permission: permissionForm.permission,
        expires_at: permissionForm.expires_at || null
      });

      const refreshedPermissions = await api.getUserPermissions(selectedAccount.id);
      setUserPermissions(Array.isArray(refreshedPermissions) ? refreshedPermissions : []);
      setPermissionForm({ permission: '', expires_at: '' });
      success('Special permission assigned successfully.');
    } catch (err) {
      console.error('Error assigning permission:', err);
      showError(`Failed to assign permission: ${err.message}`);
    } finally {
      setAssigningPermission(false);
    }
  };

  const handleRevokePermission = async (permissionId) => {
    if (!selectedAccount) {
      return;
    }

    setRevokingPermissionId(permissionId);
    try {
      await api.revokeUserPermission(selectedAccount.id, permissionId);
      setUserPermissions((current) => current.filter((permission) => permission.id !== permissionId));
      success('Special permission revoked successfully.');
    } catch (err) {
      console.error('Error revoking permission:', err);
      showError(`Failed to revoke permission: ${err.message}`);
    } finally {
      setRevokingPermissionId(null);
    }
  };

  const assignedPermissionKeys = new Set(userPermissions.map((permission) => permission.permission));
  const unassignedPermissions = availablePermissions.filter(
    (permission) => !assignedPermissionKeys.has(permission.id)
  );

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Manage Accounts</h1>
          <p>Create, edit, archive, and delete user accounts. Archive preserves data while removing access. Only Inactive/Suspended accounts can be deleted.</p>
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

      <div className="info-card" style={{ marginBottom: '2rem', background: '#fef3c7', borderColor: '#fcd34d' }}>
        <Lock size={24} style={{ color: '#92400e' }} />
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 0.25rem 0', color: '#92400e' }}>Security Policy</h3>
          <p style={{ margin: 0, color: '#92400e' }}>Account deletion requires mandatory password verification. Only Inactive or Suspended accounts can be deleted. All deletions are logged in the audit trail for compliance review.</p>
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

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="branch_manager">Branch Manager</option>
            <option value="loan_staff">Loan Staff</option>
            <option value="saving_staff">Saving Staff</option>
            <option value="ceo">CEO</option>
            <option value="client">Client</option>
          </select>
        </div>

        <button className="btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus size={20} />
          Add New Account
        </button>
      </div>

      {loading ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <RefreshCw size={48} className="spinning" style={{ color: '#3b82f6', marginBottom: '1rem' }} />
            <p style={{ color: '#6b7280' }}>Loading accounts...</p>
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
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map((account) => (
                <tr key={account.id}>
                  <td>#{account.id}</td>
                  <td>{account.name}</td>
                  <td>{account.username}</td>
                  <td>
                    <span className="role-badge">{account.role.replace('_', ' ')}</span>
                  </td>
                  <td>
                    <span className={`status ${account.status === 'Active' ? 'active' : account.status === 'Archived' ? 'inactive' : 'inactive'}`}>
                      {account.status}
                    </span>
                  </td>
                  <td>{account.created}</td>
                  <td>
                    <button className="btn-icon edit" title="Edit" onClick={() => handleEdit(account)}>
                      <Edit size={18} />
                    </button>
                    <button className="btn-icon edit" title="Special Permissions" onClick={() => openPermissionsModal(account)}>
                      <Shield size={18} />
                    </button>
                    <button 
                      className="btn-icon edit" 
                      title="Archive"
                      onClick={() => handleArchive(account)}
                      disabled={account.status === 'Archived'}
                      style={{ opacity: account.status === 'Archived' ? 0.5 : 1, cursor: account.status === 'Archived' ? 'not-allowed' : 'pointer' }}
                    >
                      <Archive size={18} />
                    </button>
                    <button 
                      className="btn-icon delete" 
                      title="Delete"
                      onClick={() => handleDelete(account)}
                      disabled={account.status === 'Active'}
                      style={{ opacity: account.status === 'Active' ? 0.5 : 1, cursor: account.status === 'Active' ? 'not-allowed' : 'pointer' }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Add New Account</h2>
              <button onClick={() => setShowAddModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Full Name <span className="required">*</span></label>
                <input
                  type="text"
                  value={newAccount.name}
                  onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                  placeholder="Enter full name"
                  required
                />
              </div>
              <div className="form-group">
                <label>Username <span className="required">*</span></label>
                <input
                  type="text"
                  value={newAccount.username}
                  onChange={(e) => setNewAccount({ ...newAccount, username: e.target.value })}
                  placeholder="Enter username"
                  required
                />
              </div>
              <div className="form-group">
                <label>Password <span className="required">*</span></label>
                <input
                  type="password"
                  value={newAccount.password}
                  onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
                  placeholder="Enter password"
                  required
                />
              </div>
              <div className="form-group">
                <label>Role <span className="required">*</span></label>
                <select
                  value={newAccount.role}
                  onChange={(e) => setNewAccount({ ...newAccount, role: e.target.value })}
                  required
                >
                  <option value="admin">Admin</option>
                  <option value="branch_manager">Branch Manager</option>
                  <option value="loan_staff">Loan Staff</option>
                  <option value="saving_staff">Saving Staff</option>
                  <option value="ceo">CEO</option>
                  <option value="client">Client</option>
                </select>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleAddAccount}>
                  <Plus size={18} />
                  Create Account
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Edit Account</h2>
              <button onClick={() => setShowEditModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Account ID:</strong> #{selectedAccount?.id}</p>
              <p><strong>Username:</strong> {selectedAccount?.username}</p>
              <div className="form-group">
                <label>Full Name <span className="required">*</span></label>
                <input
                  type="text"
                  value={editAccount.name}
                  onChange={(e) => setEditAccount({ ...editAccount, name: e.target.value })}
                  placeholder="Enter full name"
                  required
                />
              </div>
              <div className="form-group">
                <label>Role <span className="required">*</span></label>
                <select
                  value={editAccount.role}
                  onChange={(e) => setEditAccount({ ...editAccount, role: e.target.value })}
                  required
                >
                  <option value="admin">Admin</option>
                  <option value="branch_manager">Branch Manager</option>
                  <option value="loan_staff">Loan Staff</option>
                  <option value="saving_staff">Saving Staff</option>
                  <option value="ceo">CEO</option>
                  <option value="client">Client</option>
                </select>
              </div>
              <div className="form-group">
                <label>Status <span className="required">*</span></label>
                <select
                  value={editAccount.status}
                  onChange={(e) => setEditAccount({ ...editAccount, status: e.target.value })}
                  required
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Suspended">Suspended</option>
                  <option value="Archived">Archived</option>
                </select>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleUpdateAccount}>
                  <Edit size={18} />
                  Update Account
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAuthModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Verify Admin Identity</h2>
              <button onClick={() => setShowAuthModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="info-card" style={{ marginBottom: '1rem' }}>
                <Lock size={20} />
                <span>For security, you must verify your identity before deleting an account.</span>
              </div>
              <div className="form-group">
                <label>Admin Password <span className="required">*</span></label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Enter your admin password"
                  required
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowAuthModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleAuthConfirm}>
                  <Lock size={18} />
                  Verify
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showArchiveModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Archive Account</h2>
              <button onClick={() => setShowArchiveModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Account ID:</strong> #{selectedAccount?.id}</p>
              <p><strong>Name:</strong> {selectedAccount?.name}</p>
              <p><strong>Username:</strong> {selectedAccount?.username}</p>
              <p><strong>Current Status:</strong> {selectedAccount?.status}</p>
              <div className="info-card" style={{ marginBottom: '1rem', background: '#eff6ff', borderColor: '#bfdbfe' }}>
                <Archive size={20} style={{ color: '#1e40af' }} />
                <span style={{ color: '#1e40af' }}>Archiving will preserve all account data but revoke system access. This action is logged in the audit trail.</span>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowArchiveModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={confirmArchive}>
                  <Archive size={18} />
                  Archive Account
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPermissionsModal && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <div className="modal-header">
              <h2>Special Permissions</h2>
              <button onClick={closePermissionsModal} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <p><strong>Account ID:</strong> #{selectedAccount?.id}</p>
              <p><strong>Name:</strong> {selectedAccount?.name}</p>
              <p><strong>Username:</strong> {selectedAccount?.username}</p>

              {permissionsLoading ? (
                <p style={{ padding: '1rem 0' }}>Loading permissions...</p>
              ) : (
                <>
                  <div className="permissions-section">
                    <div className="permissions-section-header">
                      <ShieldCheck size={18} />
                      <h3>Assigned Permissions</h3>
                    </div>
                    {userPermissions.length === 0 ? (
                      <p className="permissions-empty">No special permissions assigned.</p>
                    ) : (
                      <div className="permissions-list">
                        {userPermissions.map((permission) => (
                          <div key={permission.id} className="permission-card">
                            <div className="permission-card-content">
                              <p className="permission-title">{permission.permission}</p>
                              <p className="permission-meta">
                                Granted by {permission.granted_by_username || 'admin'}
                              </p>
                              <p className="permission-meta">
                                Expires {permission.expires_at ? permission.expires_at : 'Never'}
                              </p>
                            </div>
                            <button
                              className="btn-icon delete"
                              title="Revoke Permission"
                              onClick={() => handleRevokePermission(permission.id)}
                              disabled={revokingPermissionId === permission.id}
                            >
                              <X size={18} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="permissions-section">
                    <div className="permissions-section-header">
                      <Shield size={18} />
                      <h3>Assign New Permission</h3>
                    </div>
                    <div className="form-group">
                      <label>Permission <span className="required">*</span></label>
                      <select
                        value={permissionForm.permission}
                        onChange={(e) => setPermissionForm({ ...permissionForm, permission: e.target.value })}
                      >
                        <option value="">Select a permission</option>
                        {unassignedPermissions.map((permission) => (
                          <option key={permission.id} value={permission.id}>
                            {permission.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Expiry Date</label>
                      <input
                        type="datetime-local"
                        value={permissionForm.expires_at}
                        onChange={(e) => setPermissionForm({ ...permissionForm, expires_at: e.target.value })}
                      />
                    </div>
                    {permissionForm.permission && (
                      <div className="info-card permissions-info-card">
                        <Shield size={18} />
                        <span>
                          {availablePermissions.find((permission) => permission.id === permissionForm.permission)?.description}
                        </span>
                      </div>
                    )}
                    <div className="modal-actions">
                      <button className="btn-secondary" onClick={closePermissionsModal}>
                        Close
                      </button>
                      <button
                        className="btn-primary"
                        onClick={handleAssignPermission}
                        disabled={assigningPermission || unassignedPermissions.length === 0}
                      >
                        <ShieldCheck size={18} />
                        Assign Permission
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Accounts;
