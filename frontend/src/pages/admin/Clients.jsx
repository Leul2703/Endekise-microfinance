import { useState, useEffect, useCallback } from 'react';
import { Users, Search, Plus, Edit, Wallet, CreditCard, Power, PowerOff, Eye, RefreshCw, AlertTriangle, Trash2 } from 'lucide-react';
import './AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const EMPTY_CLIENT_FORM = {
  name: '',
  email: '',
  phone: '',
  address: '',
  gender: '',
  id_number: '',
  income_source: ''
};

const Clients = () => {
  const { success, error, warning } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showEditClientModal, setShowEditClientModal] = useState(false);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showViewAccountsModal, setShowViewAccountsModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clients, setClients] = useState([]);
  const [registrationRequests, setRegistrationRequests] = useState([]);
  const [reviewingRequest, setReviewingRequest] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [clientAccounts, setClientAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [newClient, setNewClient] = useState(EMPTY_CLIENT_FORM);
  const [editClient, setEditClient] = useState(EMPTY_CLIENT_FORM);
  const [newAccount, setNewAccount] = useState({
    type: 'savings',
    initial_balance: '',
    account_type: 'Passbook Saving'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteClientModal, setShowDeleteClientModal] = useState(false);
  const [deleteClientJustification, setDeleteClientJustification] = useState('');

  const fetchClients = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    try {
      const [clientsResponse, requestsResponse] = await Promise.all([
        api.getClients(),
        api.getClientRegistrationRequests().catch(() => [])
      ]);
      console.debug('Loaded client compliance context', {
        clients: Array.isArray(clientsResponse) ? clientsResponse.length : 0,
        registrationRequests: Array.isArray(requestsResponse) ? requestsResponse.length : 0
      });
      setClients(Array.isArray(clientsResponse) ? clientsResponse : []);
      setRegistrationRequests(Array.isArray(requestsResponse) ? requestsResponse : []);
    } catch (err) {
      console.error('Error fetching clients:', err);
      setFetchError(err.message || 'Failed to load clients');
      setClients([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchClientAccounts = useCallback(async (clientId) => {
    try {
      const data = await api.getClientAccounts(clientId);
      setClientAccounts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching accounts:', err);
      setClientAccounts([]);
    }
  }, []);

  const handleRefresh = () => {
    fetchClients(true);
  };

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const filteredClients = clients.filter(client => {
    return client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
           client.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           client.phone?.includes(searchTerm);
  });
  const pendingRequests = registrationRequests.filter((r) => !r.status || r.status === 'Pending Admin Review');
  const approvedRequests = registrationRequests.filter((r) => r.status === 'Approved');
  const rejectedRequests = registrationRequests.filter((r) => r.status === 'Rejected');

  const handleAddClient = async () => {
    if (!newClient.name) {
      warning('Name is required');
      return;
    }
    setIsSubmitting(true);
    try {
      const data = await api.registerClient(newClient);
      setShowAddClientModal(false);
      setNewClient(EMPTY_CLIENT_FORM);
      await fetchClients();
      if (data?.username && data?.temporary_password) {
        success(`Client registered. Username: ${data.username}, Temp Password: ${data.temporary_password}`);
      } else {
        success('Client registered successfully.');
      }
    } catch (err) {
      error(err.message || 'Failed to register client');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUseRegistrationRequest = (request) => {
    setNewClient({
      name: request.full_name || '',
      email: request.email || '',
      phone: request.phone || '',
      address: request.address || '',
      gender: request.gender || '',
      id_number: request.id_number || '',
      income_source: request.income_source || ''
    });
    setShowAddClientModal(true);
  };

  const openReviewModal = (request) => {
    setReviewingRequest(request);
    setReviewNotes('');
  };

  const closeReviewModal = () => {
    setReviewingRequest(null);
    setReviewNotes('');
    setReviewSubmitting(false);
  };

  const handleApproveRegistration = async () => {
    if (!reviewingRequest) return;
    try {
      setReviewSubmitting(true);
      const data = await api.approveClientRegistrationRequest(reviewingRequest.id, {
        is_match: true,
        notes: reviewNotes
      });
      if (data?.username && data?.temporary_password) {
        success(`Approved. Username: ${data.username}, Temp Password: ${data.temporary_password}`);
      } else {
        success('KYC matched and approved. Client is now active.');
      }
      closeReviewModal();
      fetchClients(true);
    } catch (err) {
      error(err.message || 'Failed to approve registration request');
      setReviewSubmitting(false);
    }
  };

  const handleRejectRegistration = async () => {
    if (!reviewingRequest) return;
    try {
      setReviewSubmitting(true);
      await api.rejectClientRegistrationRequest(reviewingRequest.id, {
        notes: reviewNotes
      });
      warning('Registration rejected due to KYC mismatch.');
      closeReviewModal();
      fetchClients(true);
    } catch (err) {
      error(err.message || 'Failed to reject registration request');
      setReviewSubmitting(false);
    }
  };

  const handleReopenRegistration = async (requestId) => {
    try {
      await api.reopenClientRegistrationRequest(requestId);
      success('Registration request moved back to pending review.');
      fetchClients(true);
    } catch (err) {
      error(err.message || 'Failed to reopen request');
    }
  };

  const openEditClientModal = (client) => {
    setSelectedClient(client);
    setEditClient({
      name: client.name || '',
      email: client.email || '',
      phone: client.phone || '',
      address: client.address || '',
      gender: client.gender || '',
      id_number: client.id_number || '',
      income_source: client.income_source || ''
    });
    setShowEditClientModal(true);
  };

  const handleUpdateClient = async () => {
    if (!selectedClient?.id) return;
    try {
      await api.updateClient(selectedClient.id, {
        ...editClient,
        status: selectedClient.status || 'Active'
      });
      success('Client updated successfully.');
      setShowEditClientModal(false);
      setSelectedClient(null);
      fetchClients(true);
    } catch (err) {
      error(err.message || 'Failed to update client');
    }
  };

  const handleDeleteClient = async (client) => {
    if (!client?.id) return;
    setSelectedClient(client);
    setShowDeleteClientModal(true);
    setDeleteClientJustification('');
    return;
  };

  const confirmDeleteClient = async () => {
    if (!selectedClient?.id) return;
    if (!deleteClientJustification.trim()) {
      warning('Deletion justification is required for audit compliance.');
      return;
    }
    try {
      await api.deleteClient(selectedClient.id, { justification: deleteClientJustification.trim() });
      success('Client deleted successfully.');
      setShowDeleteClientModal(false);
      setDeleteClientJustification('');
      setSelectedClient(null);
      fetchClients(true);
    } catch (err) {
      error(err.message || 'Failed to delete client');
    }
  };

  const handleViewAccounts = (client) => {
    setSelectedClient(client);
    fetchClientAccounts(client.id);
    setShowViewAccountsModal(true);
  };

  const handleAddAccount = (client) => {
    setSelectedClient(client);
    setNewAccount({ type: 'savings', initial_balance: '', account_type: 'Passbook Saving' });
    setShowAddAccountModal(true);
  };

  const handleCreateAccount = async () => {
    if (!newAccount.initial_balance || parseFloat(newAccount.initial_balance) <= 0) {
      warning('Initial balance must be greater than 0');
      return;
    }

    try {
      let data;
      if (newAccount.type === 'savings') {
        data = await api.createClientSavingsAccount(selectedClient.id, {
          initial_balance: parseFloat(newAccount.initial_balance),
          type: newAccount.account_type
        });
      } else {
        data = await api.createClientLoanAccount(selectedClient.id, {
          amount: parseFloat(newAccount.initial_balance),
          type: 'Micro Enterprise Loan',
          term: '12',
          interest_rate: 8
        });
      }

      setShowAddAccountModal(false);
      setNewAccount({ type: 'savings', initial_balance: '', account_type: 'Passbook Saving' });
      fetchClientAccounts(selectedClient.id);

      if (data?.requires_approval) {
        success(`Account submitted for approval. Request ID: ${data.approval_request_id}`);
      } else {
        success(`${newAccount.type === 'savings' ? 'Savings' : 'Loan'} account created successfully`);
      }
    } catch (err) {
      error(err.message || 'Failed to create account');
    }
  };

  const getKycTone = (status) => {
    if (status === 'Verified') return 'active';
    if (status === 'Pending') return 'pending';
    return 'inactive';
  };

  const getKycHint = (client) => {
    const missingFields = [];
    if (!client.phone) missingFields.push('phone');
    if (!client.address) missingFields.push('address');
    if (!client.id_number) missingFields.push('ID');
    if (!client.income_source) missingFields.push('income source');
    return missingFields.length ? `Missing: ${missingFields.join(', ')}` : 'KYC complete';
  };

  const handleToggleAccountStatus = async (accountId, currentStatus) => {
    const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    try {
      await api.updateClientAccountStatus(accountId, newStatus);
      fetchClientAccounts(selectedClient.id);
      success(`Account ${newStatus.toLowerCase()} successfully`);
    } catch (err) {
      error(err.message || 'Failed to update account status');
    }
  };

  const resolveAccountKind = (account) => {
    if (account?.account_kind) return account.account_kind;
    const id = String(account?.id || '').toUpperCase();
    if (id.startsWith('LA-')) return 'loan';
    return 'savings';
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Client Management</h1>
          <p>Register clients, create accounts, and manage client relationships</p>
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

      <div className="page-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search clients..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <button className="btn-primary" onClick={() => setShowAddClientModal(true)}>
          <Plus size={20} />
          Register New Client
        </button>
      </div>

      {registrationRequests.length > 0 && (
        <div className="table-container" style={{ marginBottom: '1.5rem' }}>
          <div style={{ padding: '1rem 1rem 0.5rem', fontWeight: 600, color: '#1f2937' }}>
            Home Registration Requests - Pending ({pendingRequests.length})
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>ID Number</th>
                <th>Decision</th>
                <th>KYC Images</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingRequests.slice(0, 8).map((request) => (
                <tr key={request.id}>
                  <td>{request.full_name}</td>
                  <td>{request.phone || '-'}</td>
                  <td>{request.id_number || '-'}</td>
                  <td>
                    <span className={`status ${request.decision === 'APPROVE' ? 'active' : 'pending'}`}>
                      {request.decision || 'PENDING'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {request.id_document_path ? <a href={`http://localhost:5000${request.id_document_path}`} target="_blank" rel="noreferrer">View ID</a> : <span>-</span>}
                      {request.photo_path ? <a href={`http://localhost:5000${request.photo_path}`} target="_blank" rel="noreferrer">View Photo</a> : <span>-</span>}
                    </div>
                  </td>
                  <td>{request.status || 'Pending Admin Review'}</td>
                  <td>
                    <button className="btn-icon edit" title="Use this data to create client profile" onClick={() => handleUseRegistrationRequest(request)}>
                      <Plus size={18} />
                    </button>
                    <button className="btn-icon edit" title="Review KYC Match" onClick={() => openReviewModal(request)}>
                      <Eye size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approvedRequests.length > 0 && (
        <div className="table-container" style={{ marginBottom: '1.5rem' }}>
          <div style={{ padding: '1rem 1rem 0.5rem', fontWeight: 600, color: '#065f46' }}>
            Approved Requests ({approvedRequests.length})
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Username</th>
                <th>Temporary Password</th>
              </tr>
            </thead>
            <tbody>
              {approvedRequests.slice(0, 8).map((request) => (
                <tr key={`approved-${request.id}`}>
                  <td>{request.full_name}</td>
                  <td>{request.status}</td>
                  <td>{request.generated_username || '-'}</td>
                  <td>{request.generated_temporary_password || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejectedRequests.length > 0 && (
        <div className="table-container" style={{ marginBottom: '1.5rem' }}>
          <div style={{ padding: '1rem 1rem 0.5rem', fontWeight: 600, color: '#991b1b' }}>
            Rejected Requests (Retrievable) ({rejectedRequests.length})
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rejectedRequests.slice(0, 8).map((request) => (
                <tr key={`rejected-${request.id}`}>
                  <td>{request.full_name}</td>
                  <td>{request.admin_review_notes || request.reason || '-'}</td>
                  <td>{request.status}</td>
                  <td>
                    <button className="btn-icon edit" title="Retrieve to pending review" onClick={() => handleReopenRegistration(request.id)}>
                      <RefreshCw size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reviewingRequest && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Review KYC Match</h2>
              <button onClick={closeReviewModal} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Client:</strong> {reviewingRequest.full_name}</p>
              <p><strong>ID Number:</strong> {reviewingRequest.id_number || '-'}</p>
              <p><strong>System Reason:</strong> {reviewingRequest.reason || '-'}</p>
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {reviewingRequest.id_document_path && (
                  <a className="btn-secondary" href={`http://localhost:5000${reviewingRequest.id_document_path}`} target="_blank" rel="noreferrer">Open ID Image</a>
                )}
                {reviewingRequest.photo_path && (
                  <a className="btn-secondary" href={`http://localhost:5000${reviewingRequest.photo_path}`} target="_blank" rel="noreferrer">Open Profile Photo</a>
                )}
              </div>
              <div className="form-group">
                <label>Review Notes</label>
                <input
                  type="text"
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Optional notes about match decision"
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={closeReviewModal} disabled={reviewSubmitting}>Cancel</button>
                <button className="btn-secondary" onClick={handleRejectRegistration} disabled={reviewSubmitting}>Reject Mismatch</button>
                <button className="btn-primary" onClick={handleApproveRegistration} disabled={reviewSubmitting}>Approve Match</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <RefreshCw size={48} className="spinning" style={{ color: '#3b82f6', marginBottom: '1rem' }} />
            <p style={{ color: '#6b7280' }}>Loading clients...</p>
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
                <th>Username</th>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Address</th>
                <th>KYC</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => (
                <tr key={client.id}>
                  <td>{client.username || '-'}</td>
                  <td>#{client.id}</td>
                  <td>{client.name}</td>
                  <td>{client.email || '-'}</td>
                  <td>{client.phone || '-'}</td>
                  <td>{client.address || '-'}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span className={`status ${getKycTone(client.kyc_status)}`}>
                        {client.kyc_status || 'Pending'}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{getKycHint(client)}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`status ${client.status === 'Active' ? 'active' : 'inactive'}`}>
                      {client.status || 'Active'}
                    </span>
                  </td>
                  <td>
                    <button className="btn-icon edit" title="View Accounts" onClick={() => handleViewAccounts(client)}>
                      <Eye size={18} />
                    </button>
                    <button className="btn-icon edit" title="Edit Client" onClick={() => openEditClientModal(client)}>
                      <Edit size={18} />
                    </button>
                    <button className="btn-icon edit" title="Create Account" onClick={() => handleAddAccount(client)}>
                      <Plus size={18} />
                    </button>
                    <button className="btn-icon delete" title="Delete Client" onClick={() => handleDeleteClient(client)}>
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddClientModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Register New Client</h2>
              <button onClick={() => setShowAddClientModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Full Name <span className="required">*</span></label>
                <input
                  type="text"
                  value={newClient.name}
                  onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                  placeholder="Enter full name"
                  required
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={newClient.email}
                  onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
                  placeholder="Enter email"
                />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input
                  type="tel"
                  value={newClient.phone}
                  onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
                  placeholder="Enter phone number"
                />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input
                  type="text"
                  value={newClient.address}
                  onChange={(e) => setNewClient({ ...newClient, address: e.target.value })}
                  placeholder="Enter address"
                />
              </div>
              <div className="form-group">
                <label>National ID / Kebele ID</label>
                <input
                  type="text"
                  value={newClient.id_number}
                  onChange={(e) => setNewClient({ ...newClient, id_number: e.target.value })}
                  placeholder="Enter verified ID number"
                />
              </div>
              <div className="form-group">
                <label>Income Source</label>
                <select
                  value={newClient.income_source}
                  onChange={(e) => setNewClient({ ...newClient, income_source: e.target.value })}
                >
                  <option value="">Select income source</option>
                  <option value="Agriculture">Agriculture</option>
                  <option value="Trade">Trade</option>
                  <option value="Professional Employment">Professional Employment</option>
                  <option value="Student">Student</option>
                  <option value="Casual Labor">Casual Labor</option>
                  <option value="Remittance">Remittance</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label>Gender</label>
                <select
                  value={newClient.gender}
                  onChange={(e) => setNewClient({ ...newClient, gender: e.target.value })}
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowAddClientModal(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleAddClient} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <span className="spinner"></span>
                      Registering...
                    </>
                  ) : (
                    <>
                      <Plus size={18} />
                      Register Client
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditClientModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Edit Client</h2>
              <button onClick={() => setShowEditClientModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Full Name</label>
                <input type="text" value={editClient.name} onChange={(e) => setEditClient({ ...editClient, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={editClient.email} onChange={(e) => setEditClient({ ...editClient, email: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input type="text" value={editClient.phone} onChange={(e) => setEditClient({ ...editClient, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input type="text" value={editClient.address} onChange={(e) => setEditClient({ ...editClient, address: e.target.value })} />
              </div>
              <div className="form-group">
                <label>ID Number</label>
                <input type="text" value={editClient.id_number} onChange={(e) => setEditClient({ ...editClient, id_number: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Income Source</label>
                <input type="text" value={editClient.income_source} onChange={(e) => setEditClient({ ...editClient, income_source: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowEditClientModal(false)}>Cancel</button>
                <button className="btn-primary" onClick={handleUpdateClient}>Update Client</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showViewAccountsModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h2>Client Accounts</h2>
              <button onClick={() => setShowViewAccountsModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Client:</strong> {selectedClient?.name}</p>
              <p><strong>Client ID:</strong> #{selectedClient?.id}</p>
              <p><strong>KYC Status:</strong> <span className={`status ${getKycTone(selectedClient?.kyc_status)}`}>{selectedClient?.kyc_status || 'Pending'}</span></p>
              <p style={{ color: '#6b7280' }}>{selectedClient ? getKycHint(selectedClient) : ''}</p>
              
              <div className="table-container" style={{ marginTop: '1rem' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Account ID</th>
                      <th>Type</th>
                      <th>Balance</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientAccounts.map((account) => (
                      <tr key={account.id}>
                        <td>{account.id}</td>
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {resolveAccountKind(account) === 'savings' ? <Wallet size={16} /> : <CreditCard size={16} />}
                            {resolveAccountKind(account) === 'savings' ? 'Savings' : 'Loan'}
                          </span>
                        </td>
                        <td>{Number(account.balance || 0).toLocaleString()} ETB</td>
                        <td>
                          <span className={`status ${account.status === 'Active' ? 'active' : 'inactive'}`}>
                            {account.status}
                          </span>
                        </td>
                        <td>
                          {resolveAccountKind(account) === 'savings' ? (
                            <button
                              className="btn-icon edit"
                              title={account.status === 'Active' ? 'Deactivate' : 'Activate'}
                              onClick={() => handleToggleAccountStatus(account.id, account.status)}
                            >
                              {account.status === 'Active' ? <PowerOff size={18} /> : <Power size={18} />}
                            </button>
                          ) : (
                            <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>Managed by loan workflow</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {clientAccounts.length === 0 && (
                  <p style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                    No accounts found for this client
                  </p>
                )}
              </div>
              
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowViewAccountsModal(false)}>
                  Close
                </button>
                <button className="btn-primary" onClick={() => { setShowViewAccountsModal(false); handleAddAccount(selectedClient); }}>
                  <Plus size={18} />
                  Add Account
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddAccountModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Create Account</h2>
              <button onClick={() => setShowAddAccountModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Client:</strong> {selectedClient?.name}</p>
              
              <div className="form-group">
                <label>Account Type <span className="required">*</span></label>
                <select
                  value={newAccount.type}
                  onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value })}
                >
                  <option value="savings">Savings Account</option>
                  <option value="loan">Loan Account</option>
                </select>
              </div>

              {newAccount.type === 'savings' && (
                <div className="form-group">
                  <label>Savings Type</label>
                  <select
                    value={newAccount.account_type}
                    onChange={(e) => setNewAccount({ ...newAccount, account_type: e.target.value })}
                  >
                    <option value="Passbook Saving">Passbook Saving</option>
                    <option value="Time Deposit Saving">Time Deposit Saving</option>
                    <option value="Growth Term Saving">Growth Term Saving</option>
                    <option value="Girls and Child Saving">Girls and Child Saving</option>
                  </select>
                </div>
              )}

              <div className="form-group">
                <label>{newAccount.type === 'savings' ? 'Initial Balance' : 'Loan Amount'} (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={newAccount.initial_balance}
                  onChange={(e) => setNewAccount({ ...newAccount, initial_balance: e.target.value })}
                  placeholder="Enter amount"
                  min="1"
                  required
                />
              </div>

              {newAccount.type === 'loan' && (
                <div className="info-card" style={{ marginBottom: '1rem', background: '#eff6ff', borderColor: '#bfdbfe' }}>
                  <CreditCard size={20} style={{ color: '#1e40af' }} />
                  <span style={{ color: '#1e40af' }}>Note: Client must have an active savings account to apply for a loan</span>
                </div>
              )}

              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowAddAccountModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleCreateAccount}>
                  <Plus size={18} />
                  Create Account
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeleteClientModal && selectedClient && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Delete Client</h2>
              <button onClick={() => setShowDeleteClientModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="info-card" style={{ marginBottom: '1rem' }}>
                <AlertTriangle size={20} />
                <span>This action permanently deletes the client record.</span>
              </div>
              <p><strong>Client:</strong> {selectedClient.name}</p>
              <p><strong>Client ID:</strong> {selectedClient.id}</p>
              <div className="form-group">
                <label>Deletion Justification <span className="required">*</span></label>
                <textarea
                  value={deleteClientJustification}
                  onChange={(e) => setDeleteClientJustification(e.target.value)}
                  placeholder="Provide justification for deletion (stored for audit/compliance)"
                  rows={4}
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowDeleteClientModal(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button className="btn-primary delete" onClick={confirmDeleteClient} disabled={isSubmitting}>
                  <Trash2 size={18} />
                  {isSubmitting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Clients;
