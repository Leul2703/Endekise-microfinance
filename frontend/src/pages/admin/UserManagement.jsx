import { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, Plus, Search, Filter, Edit, Trash2, Shield, Key, MoreVertical, UserCheck, UserX, Mail, Building, RefreshCw, AlertTriangle } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const stripEmojis = (value) => String(value || '').replace(EMOJI_REGEX, '');
const hasEmoji = (value) => /\p{Extended_Pictographic}/u.test(String(value || ''));

const UserManagement = () => {
  const { success, error, warning } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [showArchiveConfirmModal, setShowArchiveConfirmModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [availablePermissions, setAvailablePermissions] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPermissionStep, setShowPermissionStep] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [secondaryPassword, setSecondaryPassword] = useState('');
  const [showSecondaryAuth, setShowSecondaryAuth] = useState(false);
  const [showArchivedModal, setShowArchivedModal] = useState(false);
  const [shouldArchiveData, setShouldArchiveData] = useState(false);
  const [archivedUsers, setArchivedUsers] = useState([]);
  
  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    password: '',
    role: 'loan_staff',
    branch_id: '',
    full_name: '',
    phone: ''
  });
  
  const [editUser, setEditUser] = useState({
    username: '',
    email: '',
    role: '',
    branch_id: '',
    full_name: '',
    phone: '',
    status: 'Active'
  });

  const [userPermissions, setUserPermissions] = useState([]);

  useEffect(() => {
    fetchUsers();
    fetchAvailablePermissions();
  }, []);

  const fetchUsers = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    try {
      const data = await api.getUsers();
      setUsers(data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
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
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [error]);

  const fetchAvailablePermissions = useCallback(async () => {
    try {
      const data = await api.getAvailablePermissions();
      setAvailablePermissions(data || []);
    } catch (err) {
      console.error('Error fetching permissions:', err);
    }
  }, []);

  const handleRefresh = () => {
    fetchUsers(true);
    fetchAvailablePermissions();
  };

  const fetchUserPermissions = async (userId) => {
    try {
      const data = await api.getUserPermissions(userId);
      setUserPermissions(data);
    } catch (err) {
      console.error('Error fetching user permissions:', err);
    }
  };

  const fetchArchivedUsers = async () => {
    try {
      const data = await api.getArchivedUsers();
      setArchivedUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching archived users:', err);
      error(err.message || 'Failed to load archived users');
      setArchivedUsers([]);
    }
  };

  const filteredUsers = users.filter(user => {
    if (user.role === 'client') {
      return false;
    }
    const matchesSearch = 
      (user.username?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (user.email?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (user.full_name?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesRole = filterRole === 'all' || user.role === filterRole;
    const matchesStatus = filterStatus === 'all' || user.status === filterStatus;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const handleCreateUser = async () => {
    // Validation
    if (!newUser.username || !newUser.email || !newUser.password || !newUser.role) {
      warning('Username, email, password, and role are required');
      return;
    }

    if (newUser.username.length < 3) {
      warning('Username must be at least 3 characters');
      return;
    }

    if (newUser.password.length < 10 || !/[A-Z]/.test(newUser.password) || !/[a-z]/.test(newUser.password) || !/[0-9]/.test(newUser.password) || !/[^A-Za-z0-9]/.test(newUser.password)) {
      warning('Password must be at least 10 characters and include upper, lower, number, and special character');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newUser.email)) {
      warning('Please enter a valid email address');
      return;
    }
    if (
      hasEmoji(newUser.full_name) ||
      hasEmoji(newUser.username) ||
      hasEmoji(newUser.email) ||
      hasEmoji(newUser.password) ||
      hasEmoji(newUser.branch_id)
    ) {
      warning('Emoji characters are not allowed.');
      return;
    }
    if (newUser.phone && !/^\d+$/.test(newUser.phone)) {
      warning('Phone number must contain digits only.');
      return;
    }

    setIsSubmitting(true);
    try {
      const createdUser = await api.createUser(newUser);
      
      // If permissions were selected, assign them
      if (selectedPermissions.length > 0) {
        for (const permissionId of selectedPermissions) {
          try {
            await api.assignUserPermission(createdUser.id, permissionId);
          } catch (permErr) {
            console.error('Error assigning permission:', permErr);
            warning(`User created but failed to assign some permissions`);
          }
        }
      }
      
      setShowCreateModal(false);
      setShowPermissionStep(false);
      setSelectedPermissions([]);
      setNewUser({
        username: '',
        email: '',
        password: '',
        role: 'loan_staff',
        branch_id: '',
        full_name: '',
        phone: ''
      });
      await fetchUsers();
      success('User created successfully' + (selectedPermissions.length > 0 ? ' with permissions' : ''));
    } catch (err) {
      console.error('Error creating user:', err);
      if (err.message?.includes('Username already exists')) {
        error('Username already exists. Please choose a different username.');
      } else if (err.message?.includes('Database error')) {
        error('A database error occurred. Please try again.');
      } else {
        error(err.message || 'Failed to create user. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateUser = async () => {
    // Validation
    if (!editUser.username || !editUser.email) {
      warning('Username and email are required');
      return;
    }

    if (editUser.username.length < 3) {
      warning('Username must be at least 3 characters');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editUser.email)) {
      warning('Please enter a valid email address');
      return;
    }
    if (
      hasEmoji(editUser.full_name) ||
      hasEmoji(editUser.username) ||
      hasEmoji(editUser.email) ||
      hasEmoji(editUser.branch_id)
    ) {
      warning('Emoji characters are not allowed.');
      return;
    }
    if (editUser.phone && !/^\d+$/.test(editUser.phone)) {
      warning('Phone number must contain digits only.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.updateUser(selectedUser.id, editUser);
      setShowEditModal(false);
      setSelectedUser(null);
      await fetchUsers();
      success('User updated successfully');
    } catch (err) {
      console.error('Error updating user:', err);
      if (err.message?.includes('Username already exists')) {
        error('Username already exists. Please choose a different username.');
      } else if (err.message?.includes('Database error')) {
        error('A database error occurred. Please try again.');
      } else {
        error(err.message || 'Failed to update user. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchiveUser = async (userId) => {
    setSelectedUser(users.find(u => u.id === userId));
    setShowArchiveConfirmModal(true);
    return;
  };

  const confirmArchive = async () => {
    if (!selectedUser?.id) return;
    setIsSubmitting(true);
    try {
      await api.archiveUser(selectedUser.id);
      setShowArchiveConfirmModal(false);
      setSelectedUser(null);
      await fetchUsers();
      success('User archived successfully');
    } catch (err) {
      console.error('Error archiving user:', err);
      if (err.message?.includes('Database error')) {
        error('A database error occurred. Please try again.');
      } else {
        error(err.message || 'Failed to archive user. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (userId, archiveData = false) => {
    // Show secondary authentication modal first
    setSelectedUser(users.find(u => u.id === userId));
    setShouldArchiveData(archiveData);
    setShowSecondaryAuth(true);
    setShowDeleteConfirmModal(false);
  };

  const confirmDeleteWithAuth = async () => {
    if (!secondaryPassword || secondaryPassword.trim() === '') {
      warning('Please enter your password for secondary authentication.');
      return;
    }

    setIsSubmitting(true);
    let archivedSuccessfully = false;
    try {
      // Archive data if requested
      if (shouldArchiveData) {
        try {
          await api.archiveUser(selectedUser.id);
          archivedSuccessfully = true;
        } catch (archiveErr) {
          console.error('Error archiving user:', archiveErr);
          warning('Archiving could not be completed, but deletion will continue after your confirmation.');
        }
      }
      
      // Delete user with secondary authentication
      await api.deleteUser(selectedUser.id, secondaryPassword);
      await fetchUsers();
      setShowSecondaryAuth(false);
      setSecondaryPassword('');
      setSelectedUser(null);
      setShouldArchiveData(false);
      
      // Show single success message
      if (archivedSuccessfully) {
        success('User deleted successfully (data archived)');
      } else if (shouldArchiveData) {
        success('User deleted successfully (archive failed but deletion completed)');
      } else {
        success('User deleted successfully');
      }
    } catch (err) {
      console.error('Error deleting user:', err);
      if (err.message?.includes('Invalid password') || err.message?.includes('Secondary authentication failed')) {
        error('Secondary authentication failed. Please check your password.');
      } else if (err.message?.includes('Database error')) {
        error('A database error occurred. Please try again.');
      } else if (err.message?.includes('not found')) {
        error('User not found or already deleted.');
      } else {
        error(err.message || 'Failed to delete user. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssignPermission = async (permissionId) => {
    try {
      await api.assignUserPermission(selectedUser.id, permissionId);
      await fetchUserPermissions(selectedUser.id);
      success('Permission assigned successfully');
    } catch (err) {
      console.error('Error assigning permission:', err);
      error(err.message || 'Failed to assign permission');
    }
  };

  const handleRemovePermission = async (permissionId) => {
    try {
      await api.revokeUserPermission(selectedUser.id, permissionId);
      await fetchUserPermissions(selectedUser.id);
      success('Permission removed successfully');
    } catch (err) {
      console.error('Error removing permission:', err);
      error(err.message || 'Failed to remove permission');
    }
  };

  const openEditModal = (user) => {
    setSelectedUser(user);
    setEditUser({
      username: user.username,
      email: user.email,
      role: user.role,
      branch_id: user.branch_id || '',
      full_name: user.full_name || user.name || '',
      phone: user.phone || '',
      status: user.status
    });
    setShowEditModal(true);
  };

  const openPermissionsModal = async (user) => {
    setSelectedUser(user);
    await fetchUserPermissions(user.id);
    setShowPermissionsModal(true);
  };

  const getRoleBadgeColor = (role) => {
    const colors = {
      admin: '#ef4444',
      ceo: '#8b5cf6',
      branch_manager: '#f59e0b',
      loan_staff: '#3b82f6',
      saving_staff: '#10b981',
      client: '#6b7280'
    };
    return colors[role] || '#6b7280';
  };

  const getStatusBadgeColor = (status) => {
    return status === 'Active' ? '#10b981' : '#ef4444';
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>User Management</h1>
        <p>Create and manage staff users with role-based access</p>
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className="inline-meta">Staff users: {users.filter((u) => u.role !== 'client').length}</span>
          <span className="inline-meta">Filtered: {filteredUsers.length}</span>
          <span className="inline-meta">Archived: {archivedUsers.length}</span>
        </div>
      </div>

      <div className="page-actions sticky-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search users by name, email, or username..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="ceo">CEO</option>
            <option value="branch_manager">Branch Manager</option>
            <option value="loan_staff">Loan Staff</option>
            <option value="saving_staff">Saving Staff</option>
            <option value="client">Client</option>
          </select>
        </div>

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Archived">Archived</option>
          </select>
        </div>

        <button 
          className="btn-secondary" 
          onClick={handleRefresh}
          disabled={refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <RefreshCw size={20} className={refreshing ? 'spinning' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>

        <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
          <Plus size={20} />
          Create User
        </button>
        <button
          className="btn-secondary"
          onClick={async () => {
            await fetchArchivedUsers();
            setShowArchivedModal(true);
          }}
        >
          Archived Users
        </button>
      </div>

      {loading ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <RefreshCw size={48} className="spinning" style={{ color: '#3b82f6', marginBottom: '1rem' }} />
            <p style={{ color: '#6b7280' }}>Loading users...</p>
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
          {filteredUsers.length === 0 ? (
            <div className="empty-state">
              <p>No users match the current search and filters.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Branch</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ 
                        width: '40px', 
                        height: '40px', 
                        borderRadius: '50%', 
                        background: '#f3f4f6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Users size={20} style={{ color: '#6b7280' }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: '600' }}>{user.full_name || user.name || user.username}</div>
                        <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span 
                      className="status" 
                      style={{ 
                        background: `${getRoleBadgeColor(user.role)}20`,
                        color: getRoleBadgeColor(user.role)
                      }}
                    >
                      {user.role.replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                  <td>{user.branch_id || '-'}</td>
                  <td>
                    <span 
                      className="status" 
                      style={{ 
                        background: `${getStatusBadgeColor(user.status)}20`,
                        color: getStatusBadgeColor(user.status)
                      }}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td>{user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button 
                        className="btn-icon edit" 
                        title="Edit User"
                        onClick={() => openEditModal(user)}
                      >
                        <Edit size={18} />
                      </button>
                      <button 
                        className="btn-icon edit" 
                        title="Manage Permissions"
                        onClick={() => openPermissionsModal(user)}
                      >
                        <Shield size={18} />
                      </button>
                      <button 
                        className="btn-icon edit" 
                        title="Archive User"
                        onClick={() => handleArchiveUser(user.id)}
                      >
                        <UserX size={18} />
                      </button>
                      <button 
                        className="btn-icon edit" 
                        title="Delete User"
                        onClick={() => {
                          setSelectedUser(user);
                          setShowDeleteConfirmModal(true);
                        }}
                        style={{ color: '#ef4444' }}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2>Create New User</h2>
              <button onClick={() => setShowCreateModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Full Name <span className="required">*</span></label>
                  <input
                    type="text"
                    value={newUser.full_name}
                    onChange={(e) => setNewUser({ ...newUser, full_name: stripEmojis(e.target.value) })}
                    placeholder="Enter full name"
                  />
                </div>
                <div className="form-group">
                  <label>Username <span className="required">*</span></label>
                  <input
                    type="text"
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: stripEmojis(e.target.value) })}
                    placeholder="Enter username"
                  />
                </div>
                <div className="form-group">
                  <label>Email <span className="required">*</span></label>
                  <div className="input-with-icon">
                    <Mail size={18} />
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: stripEmojis(e.target.value) })}
                      placeholder="Enter email address"
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={newUser.phone}
                    onChange={(e) => setNewUser({ ...newUser, phone: e.target.value.replace(/\D/g, '') })}
                    placeholder="Digits only"
                  />
                </div>
                <div className="form-group">
                  <label>Password <span className="required">*</span></label>
                  <div className="input-with-icon">
                    <Key size={18} />
                    <input
                      type="password"
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: stripEmojis(e.target.value) })}
                      placeholder="Enter password"
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Role <span className="required">*</span></label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  >
                    <option value="loan_staff">Loan Staff</option>
                    <option value="saving_staff">Saving Staff</option>
                    <option value="branch_manager">Branch Manager</option>
                    <option value="admin">Admin</option>
                    <option value="ceo">CEO</option>
                  </select>
                </div>
                <div className="form-group full-width">
                  <label>Branch ID</label>
                  <div className="input-with-icon">
                    <Building size={18} />
                    <input
                      type="text"
                      value={newUser.branch_id}
                      onChange={(e) => setNewUser({ ...newUser, branch_id: stripEmojis(e.target.value) })}
                      placeholder="Enter branch ID (optional)"
                    />
                  </div>
                </div>
              </div>
              <div className="info-card" style={{ marginTop: '1rem', background: '#eff6ff', borderColor: '#bfdbfe' }}>
                <div>
                  <strong>Role Information:</strong>
                  <ul style={{ margin: '0.5rem 0 0 1.5rem', fontSize: '0.9rem' }}>
                    <li><strong>Admin:</strong> Full system access, user management, bypass approvals</li>
                    <li><strong>CEO:</strong> High-value loan approvals, regulatory reports</li>
                    <li><strong>Branch Manager:</strong> Loan/savings approvals, branch operations</li>
                    <li><strong>Loan Staff:</strong> Loan applications, client management</li>
                    <li><strong>Saving Staff:</strong> Savings account management, deposits/withdrawals</li>
                    <li><strong>Client:</strong> View own accounts, make transactions</li>
                  </ul>
                </div>
              </div>
              <div className="info-card" style={{ marginTop: '1rem', background: '#f9fafb' }}>
                <p style={{ margin: 0 }}>
                  Better onboarding: fill user profile first, then optional permissions. Phone accepts digits only.
                </p>
              </div>

              {showPermissionStep && (
                <div className="step-content" style={{ marginTop: '1.5rem', borderTop: '1px solid #e5e7eb', paddingTop: '1.5rem' }}>
                  <h3 style={{ marginBottom: '1rem' }}>Assign Special Permissions (Optional)</h3>
                  <p style={{ color: '#6b7280', marginBottom: '1rem', fontSize: '0.9rem' }}>
                    Select additional permissions to grant to this user. These permissions are in addition to their role-based access.
                  </p>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', 
                    gap: '0.75rem',
                    maxHeight: '300px',
                    overflowY: 'auto'
                  }}>
                    {availablePermissions.map((perm) => (
                      <div
                        key={perm.id}
                        className="permission-card"
                        onClick={() => {
                          setSelectedPermissions(prev => 
                            prev.includes(perm.id) 
                              ? prev.filter(p => p !== perm.id)
                              : [...prev, perm.id]
                          );
                        }}
                        style={{
                          padding: '0.75rem',
                          border: `2px solid ${selectedPermissions.includes(perm.id) ? '#3b82f6' : '#e5e7eb'}`,
                          borderRadius: '0.375rem',
                          cursor: 'pointer',
                          background: selectedPermissions.includes(perm.id) ? '#eff6ff' : '#fff',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                          <Shield size={16} style={{ color: selectedPermissions.includes(perm.id) ? '#3b82f6' : '#6b7280' }} />
                          <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{perm.name}</span>
                        </div>
                        <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>{perm.description}</p>
                      </div>
                    ))}
                  </div>
                  {selectedPermissions.length === 0 && (
                    <p style={{ color: '#6b7280', marginTop: '1rem', fontStyle: 'italic' }}>
                      No special permissions selected. The user will have standard role-based access.
                    </p>
                  )}
                </div>
              )}

              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowCreateModal(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                {!showPermissionStep ? (
                  <button 
                    className="btn-primary" 
                    onClick={() => setShowPermissionStep(true)}
                    disabled={isSubmitting}
                  >
                    Next: Assign Permissions
                  </button>
                ) : (
                  <>
                    <button 
                      className="btn-secondary" 
                      onClick={() => setShowPermissionStep(false)}
                      disabled={isSubmitting}
                    >
                      Back
                    </button>
                    <button className="btn-primary" onClick={handleCreateUser} disabled={isSubmitting}>
                      {isSubmitting ? (
                        <>
                          <RefreshCw size={18} className="spinning" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Plus size={18} />
          Create Staff User
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2>Edit User</h2>
              <button onClick={() => setShowEditModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Full Name</label>
                  <input
                    type="text"
                    value={editUser.full_name}
                    onChange={(e) => setEditUser({ ...editUser, full_name: stripEmojis(e.target.value) })}
                  />
                </div>
                <div className="form-group">
                  <label>Username</label>
                  <input
                    type="text"
                    value={editUser.username}
                    onChange={(e) => setEditUser({ ...editUser, username: stripEmojis(e.target.value) })}
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={editUser.email}
                    onChange={(e) => setEditUser({ ...editUser, email: stripEmojis(e.target.value) })}
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editUser.phone}
                    onChange={(e) => setEditUser({ ...editUser, phone: e.target.value.replace(/\D/g, '') })}
                  />
                </div>
                <div className="form-group">
                  <label>Role</label>
                  <select
                    value={editUser.role}
                    onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}
                  >
                    <option value="loan_staff">Loan Staff</option>
                    <option value="saving_staff">Saving Staff</option>
                    <option value="branch_manager">Branch Manager</option>
                    <option value="admin">Admin</option>
                    <option value="ceo">CEO</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select
                    value={editUser.status}
                    onChange={(e) => setEditUser({ ...editUser, status: e.target.value })}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
                <div className="form-group full-width">
                  <label>Branch ID</label>
                  <input
                    type="text"
                    value={editUser.branch_id}
                    onChange={(e) => setEditUser({ ...editUser, branch_id: stripEmojis(e.target.value) })}
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowEditModal(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleUpdateUser} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={18} className="spinning" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Edit size={18} />
                      Update User
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showArchivedModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h2>Archived Users</h2>
              <button onClick={() => setShowArchivedModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Email</th>
                      <th>Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archivedUsers.length === 0 ? (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', padding: '1rem' }}>No archived users found.</td>
                      </tr>
                    ) : archivedUsers.map((user) => (
                      <tr key={user.id}>
                        <td>{user.name}</td>
                        <td>{user.username}</td>
                        <td>{user.role}</td>
                        <td>{user.email || '-'}</td>
                        <td>{user.phone || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowArchivedModal(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Permissions Modal */}
      {showPermissionsModal && selectedUser && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '700px' }}>
            <div className="modal-header">
              <h2>Manage Permissions - {selectedUser.full_name || selectedUser.username}</h2>
              <button onClick={() => setShowPermissionsModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '1.5rem' }}>
                <h3>Current Permissions</h3>
                {userPermissions.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                    {userPermissions.map((perm) => (
                      <div 
                        key={perm.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.5rem 1rem',
                          background: '#dbeafe',
                          borderRadius: '0.25rem',
                          border: '1px solid #93c5fd'
                        }}
                      >
                        <Shield size={16} style={{ color: '#1d4ed8' }} />
                        <span>{perm.name}</span>
                        <button
                          onClick={() => handleRemovePermission(perm.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '0.25rem'
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>No permissions assigned</p>
                )}
              </div>
              
              <div>
                <h3>Available Permissions</h3>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
                  gap: '0.5rem',
                  marginTop: '0.5rem',
                  maxHeight: '300px',
                  overflowY: 'auto'
                }}>
                  {availablePermissions
                    .filter(perm => !userPermissions.find(up => up.id === perm.id))
                    .map((perm) => (
                    <button
                      key={perm.id}
                      onClick={() => handleAssignPermission(perm.id)}
                      style={{
                        padding: '0.75rem',
                        background: '#f3f4f6',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.375rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => e.target.style.background = '#e5e7eb'}
                      onMouseLeave={(e) => e.target.style.background = '#f3f4f6'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Shield size={16} style={{ color: '#6b7280' }} />
                        <span style={{ fontSize: '0.9rem' }}>{perm.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
                <button className="btn-secondary" onClick={() => setShowPermissionsModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmModal && selectedUser && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2>Delete User</h2>
              <button onClick={() => setShowDeleteConfirmModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '1.5rem' }}>
                <AlertTriangle size={48} style={{ color: '#ef4444', marginBottom: '1rem' }} />
                <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                  Are you sure you want to delete <strong>{selectedUser.full_name || selectedUser.name || selectedUser.username}</strong>?
                </p>
                <p style={{ color: '#6b7280' }}>
                  This action cannot be undone. The user will be permanently removed from the system.
                </p>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="archiveData"
                    checked={shouldArchiveData}
                    onChange={(e) => setShouldArchiveData(e.target.checked)}
                    style={{ width: '18px', height: '18px' }}
                  />
                  <span>Archive user data before deletion</span>
                </label>
                <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: '0.5rem', marginLeft: '1.75rem' }}>
                  If checked, the user's data will be archived for record-keeping before deletion.
                </p>
              </div>

              <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
                <button 
                  className="btn-secondary" 
                  onClick={() => {
                    setShowDeleteConfirmModal(false);
                    setShouldArchiveData(false);
                  }}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button 
                  className="btn-primary" 
                  onClick={() => handleDeleteUser(selectedUser.id, shouldArchiveData)}
                  disabled={isSubmitting}
                  style={{ background: '#ef4444', borderColor: '#ef4444' }}
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={18} className="spinning" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 size={18} />
                      Delete User
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showArchiveConfirmModal && selectedUser && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2>Archive User</h2>
              <button onClick={() => setShowArchiveConfirmModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '1.5rem' }}>
                <AlertTriangle size={48} style={{ color: '#f59e0b', marginBottom: '1rem' }} />
                <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                  Archive <strong>{selectedUser.full_name || selectedUser.name || selectedUser.username}</strong>?
                </p>
                <p style={{ color: '#6b7280' }}>
                  The user will be marked as archived/inactive and excluded from normal operations.
                </p>
              </div>

              <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
                <button className="btn-secondary" onClick={() => setShowArchiveConfirmModal(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={confirmArchive}
                  disabled={isSubmitting}
                  style={{ background: '#f59e0b', borderColor: '#f59e0b' }}
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={18} className="spinning" />
                      Archiving...
                    </>
                  ) : (
                    <>
                      <UserX size={18} />
                      Archive User
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Secondary Authentication Modal */}
      {showSecondaryAuth && selectedUser && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <h2>Secondary Authentication</h2>
              <button onClick={() => {
                setShowSecondaryAuth(false);
                setSecondaryPassword('');
                setSelectedUser(null);
              }} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '1.5rem' }}>
                <Key size={48} style={{ color: '#3b82f6', marginBottom: '1rem' }} />
                <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                  Confirm deletion of <strong>{selectedUser.full_name || selectedUser.name || selectedUser.username}</strong>
                </p>
                <p style={{ color: '#6b7280' }}>
                  {shouldArchiveData 
                    ? 'Enter your password to delete this user and archive their data.'
                    : 'Enter your password to delete this user. This action cannot be undone.'}
                </p>
              </div>

              <div className="form-group">
                <label>Your Password <span className="required">*</span></label>
                <div className="input-with-icon">
                  <Key size={18} />
                  <input
                    type="password"
                    value={secondaryPassword}
                    onChange={(e) => setSecondaryPassword(e.target.value)}
                    placeholder="Enter your password"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        confirmDeleteWithAuth();
                      }
                    }}
                  />
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
                <button 
                  className="btn-secondary" 
                  onClick={() => {
                    setShowSecondaryAuth(false);
                    setSecondaryPassword('');
                    setSelectedUser(null);
                    setShouldArchiveData(false);
                  }}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button 
                  className="btn-primary" 
                  onClick={confirmDeleteWithAuth}
                  disabled={isSubmitting}
                  style={{ background: '#ef4444', borderColor: '#ef4444' }}
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={18} className="spinning" />
                      Authenticating...
                    </>
                  ) : (
                    <>
                      <Shield size={18} />
                      Confirm Deletion
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
