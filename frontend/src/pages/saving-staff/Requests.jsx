import { useState, useEffect } from 'react';
import { XCircle, Eye, Search, Filter, FileText, AlertTriangle, Send } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const Requests = () => {
  let toast;
  try {
    toast = useToast();
  } catch (toastError) {
    console.warn('Toast context not available:', toastError);
    toast = { success: console.log, error: console.error, warning: console.warn };
  }

  const { success, error, warning } = toast;
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showDocumentsModal, setShowDocumentsModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [savingsAccounts, setSavingsAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountFetchError, setAccountFetchError] = useState('');
  const [submitData, setSubmitData] = useState({
    client: '',
    clientId: '',
    accountId: '',
    requestType: 'Withdrawal Request',
    amount: ''
  });
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRequests();
  }, []);

  useEffect(() => {
    if (showSubmitModal) {
      fetchSavingsAccounts();
    }
  }, [showSubmitModal]);

  const fetchSavingsAccounts = async () => {
    setAccountsLoading(true);
    setAccountFetchError('');

    try {
      const data = await api.getSavingsAccounts();
      const normalizedAccounts = Array.isArray(data)
        ? data.map((account) => ({
            accountId: String(account.account_id || account.id || ''),
            clientId: account.client_id ? String(account.client_id) : '',
            clientName: account.client_name || account.client || '',
            phone: account.phone || '',
            balance: Number(account.balance || account.amount || 0),
            status: account.status || '',
            source: account.account_source || account.source || 'accounts'
          })).filter((account) => account.accountId)
        : [];

      console.log('[Saving Staff][Requests] Loaded savings accounts:', normalizedAccounts);
      setSavingsAccounts(normalizedAccounts);
    } catch (fetchError) {
      console.error('[Saving Staff][Requests] Error fetching savings accounts:', fetchError);
      setAccountFetchError(fetchError?.message || 'Failed to load savings accounts');
      error(fetchError?.message || 'Failed to load savings accounts');
      setSavingsAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  };

  const fetchRequests = async () => {
    try {
      const data = await api.getRequests();
      setRequests(Array.isArray(data) ? data : []);
    } catch (requestError) {
      console.error('Error fetching requests:', requestError);
      setRequests([]);
      error(requestError?.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  };

  const filteredRequests = requests.filter((request) => {
    const matchesSearch = (request.client?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (request.id?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === 'all' || request.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const handleReject = (request) => {
    setSelectedRequest(request);
    setShowRejectModal(true);
  };

  const handleViewDetails = (request) => {
    setSelectedRequest(request);
    setShowDetailsModal(true);
  };

  const handleViewDocuments = (request) => {
    setSelectedRequest(request);
    setShowDocumentsModal(true);
  };

  const handleDownloadDocument = (docName) => {
    warning(`Download for "${docName}" is not linked yet. Please use the central documents page.`);
  };

  const handleSubmitForApproval = async (request) => {
    if (!request.kycComplete) {
      warning('Cannot submit: Mandatory KYC documents are missing. Please upload required documents before re-submission.');
      return;
    }

    try {
      await api.approveRequest(request.id);
      fetchRequests();
      success(`Request submitted for Branch Manager approval. Tracking ID: ${request.id}-APR`);
    } catch (submitError) {
      console.error('Error submitting request for approval:', submitError);
      error('Failed to submit request for approval');
    }
  };

  const confirmReject = async () => {
    if (!rejectReason.trim()) {
      warning('Rejection reason is mandatory for audit compliance.');
      return;
    }

    try {
      await api.rejectRequest(selectedRequest.id, rejectReason);
      setShowRejectModal(false);
      setRejectReason('');
      setSelectedRequest(null);
      fetchRequests();
      success('Request rejected successfully');
    } catch (rejectError) {
      console.error('Error rejecting request:', rejectError);
      error('Failed to reject request');
    }
  };

  const handleSubmitNewRequest = async () => {
    if (!submitData.client || !submitData.accountId || !submitData.amount) {
      warning('Please fill in all required fields');
      return;
    }

    try {
      const payload = {
        client: submitData.client,
        clientId: submitData.clientId || undefined,
        accountId: submitData.accountId,
        requestType: submitData.requestType,
        amount: Number(submitData.amount)
      };

      console.log('[Saving Staff][Requests] Submitting new request payload:', payload);
      await api.createRequest(payload);
      setShowSubmitModal(false);
      setSubmitData({
        client: '',
        clientId: '',
        accountId: '',
        requestType: 'Withdrawal Request',
        amount: ''
      });
      fetchRequests();
      success('New request submitted successfully');
    } catch (submitError) {
      console.error('[Saving Staff][Requests] Error submitting new request:', {
        message: submitError?.message,
        submitData
      });
      error(submitError?.message || 'Failed to submit new request');
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Savings Requests</h1>
        <p>Review and process savings account requests. Submit completed requests for Branch Manager approval.</p>
      </div>

      <div className="page-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search requests..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">All Status</option>
            <option value="Pending">Pending</option>
            <option value="High Priority">High Priority</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>

        <button className="btn-primary" onClick={() => setShowSubmitModal(true)}>
          <Send size={20} />
          Submit New Request
        </button>
      </div>

      {loading ? (
        <div className="table-container">
          <p style={{ textAlign: 'center', padding: '2rem' }}>Loading requests...</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Request ID</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Account</th>
                <th>KYC Status</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map((request) => (
                <tr key={request.id}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <strong>{request.id}</strong>
                      <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>{request.client}</span>
                    </div>
                  </td>
                  <td>{request.type}</td>
                  <td>{request.amount}</td>
                  <td>{request.account}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={`status ${request.kycComplete ? 'active' : 'inactive'}`}>
                        {request.kycComplete ? 'Complete' : 'Incomplete'}
                      </span>
                      {!request.kycComplete && <AlertTriangle size={16} className="warning-icon" title="Missing KYC documents" />}
                    </div>
                  </td>
                  <td>{request.submitted}</td>
                  <td>
                    <span className={`status ${request.status === 'High Priority' ? 'high' : request.status === 'Pending' ? 'pending' : request.status === 'Approved' ? 'active' : 'inactive'}`}>
                      {request.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn-icon edit" title="View Details" onClick={() => handleViewDetails(request)}>
                      <Eye size={18} />
                    </button>
                    <button className="btn-icon edit" title="View Documents" onClick={() => handleViewDocuments(request)}>
                      <FileText size={18} />
                    </button>
                    <button className="btn-icon edit" title="Submit for Approval" onClick={() => handleSubmitForApproval(request)}>
                      <Send size={18} />
                    </button>
                    <button className="btn-icon delete" title="Reject" onClick={() => handleReject(request)}>
                      <XCircle size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showRejectModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Reject Request</h2>
              <button onClick={() => setShowRejectModal(false)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <p><strong>Request ID:</strong> {selectedRequest?.id}</p>
              <p><strong>Client:</strong> {selectedRequest?.client}</p>
              <p><strong>Type:</strong> {selectedRequest?.type}</p>
              <div className="form-group">
                <label>Rejection Reason <span className="required">*</span></label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Please provide a detailed reason for rejection (mandatory for audit compliance)"
                  rows={4}
                  required
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowRejectModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary delete" onClick={confirmReject}>
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDetailsModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Request Details</h2>
              <button onClick={() => setShowDetailsModal(false)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Request ID</label>
                <p>{selectedRequest?.id}</p>
              </div>
              <div className="form-group">
                <label>Client</label>
                <p>{selectedRequest?.client}</p>
              </div>
              <div className="form-group">
                <label>Request Type</label>
                <p>{selectedRequest?.type}</p>
              </div>
              <div className="form-group">
                <label>Amount</label>
                <p>{selectedRequest?.amount}</p>
              </div>
              <div className="form-group">
                <label>Account</label>
                <p>{selectedRequest?.account}</p>
              </div>
              <div className="form-group">
                <label>KYC Status</label>
                <span className={`status ${selectedRequest?.kycComplete ? 'active' : 'inactive'}`}>
                  {selectedRequest?.kycComplete ? 'Complete' : 'Incomplete'}
                </span>
              </div>
              <div className="form-group">
                <label>Submitted Date</label>
                <p>{selectedRequest?.submitted}</p>
              </div>
              <div className="form-group">
                <label>Status</label>
                <span className={`status ${selectedRequest?.status === 'High Priority' ? 'high' : selectedRequest?.status === 'Pending' ? 'pending' : 'active'}`}>
                  {selectedRequest?.status}
                </span>
              </div>
              {!selectedRequest?.kycComplete && (
                <div className="info-card" style={{ marginBottom: '1rem', background: '#fef3c7', borderColor: '#fcd34d' }}>
                  <AlertTriangle size={20} style={{ color: '#92400e' }} />
                  <span style={{ color: '#92400e' }}>KYC documents incomplete - cannot submit for approval</span>
                </div>
              )}
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowDetailsModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={() => {
                  setShowDetailsModal(false);
                  handleSubmitForApproval(selectedRequest);
                }}>
                  <Send size={18} />
                  Submit for Approval
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDocumentsModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2>Request Documents</h2>
              <button onClick={() => setShowDocumentsModal(false)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <p><strong>Request ID:</strong> {selectedRequest?.id}</p>
              <p><strong>Client:</strong> {selectedRequest?.client}</p>
              <div className="form-group">
                <label>Attached Documents</label>
                <div className="documents-list">
                  <div className="document-item">
                    <FileText size={20} />
                    <div>
                      <p className="document-name">Request Form</p>
                      <p className="document-meta">PDF - 180 KB - Uploaded 2026-04-18</p>
                    </div>
                    <button className="btn-sm secondary" onClick={() => handleDownloadDocument('Request Form')}>
                      Download
                    </button>
                  </div>
                  <div className="document-item">
                    <FileText size={20} />
                    <div>
                      <p className="document-name">ID Verification</p>
                      <p className="document-meta">PDF - 1.2 MB - Uploaded 2026-04-18</p>
                    </div>
                    <button className="btn-sm secondary" onClick={() => handleDownloadDocument('ID Verification')}>
                      Download
                    </button>
                  </div>
                  <div className="document-item">
                    <FileText size={20} />
                    <div>
                      <p className="document-name">Supporting Documents</p>
                      <p className="document-meta">PDF - 450 KB - Uploaded 2026-04-18</p>
                    </div>
                    <button className="btn-sm secondary" onClick={() => handleDownloadDocument('Supporting Documents')}>
                      Download
                    </button>
                  </div>
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowDocumentsModal(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSubmitModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Submit New Request</h2>
              <button onClick={() => setShowSubmitModal(false)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Client Name <span className="required">*</span></label>
                <input
                  type="text"
                  value={submitData.client}
                  onChange={(e) => setSubmitData({ ...submitData, client: e.target.value })}
                  placeholder="Enter client name"
                  required
                />
              </div>
              <div className="form-group">
                <label>Account <span className="required">*</span></label>
                <select
                  value={submitData.accountId}
                  onChange={(e) => {
                    const accountId = e.target.value;
                    const selected = savingsAccounts.find((account) => account.accountId === accountId);
                    setSubmitData({
                      ...submitData,
                      accountId,
                      clientId: selected?.clientId || '',
                      client: selected?.clientName || submitData.client
                    });
                  }}
                  required
                >
                  <option value="">
                    {accountsLoading ? 'Loading accounts...' : 'Select savings account'}
                  </option>
                  {savingsAccounts.map((account) => (
                    <option key={account.accountId} value={account.accountId}>
                      {account.accountId} - {account.clientName}{account.phone ? ` (${account.phone})` : ''}
                    </option>
                  ))}
                </select>
                <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#6b7280' }}>
                  {accountFetchError || (savingsAccounts.length === 0 && !accountsLoading
                    ? 'No active savings accounts found (or you do not have permission).'
                    : null)}
                </div>
              </div>
              <div className="form-group">
                <label>Request Type</label>
                <select
                  value={submitData.requestType}
                  onChange={(e) => setSubmitData({ ...submitData, requestType: e.target.value })}
                >
                  <option value="Withdrawal Request">Withdrawal Request</option>
                  <option value="Deposit Request">Deposit Request</option>
                  <option value="Account Closure">Account Closure</option>
                  <option value="Interest Withdrawal">Interest Withdrawal</option>
                </select>
              </div>
              <div className="form-group">
                <label>Amount (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={submitData.amount}
                  onChange={(e) => setSubmitData({ ...submitData, amount: e.target.value })}
                  placeholder="Enter amount"
                  min="1"
                  required
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowSubmitModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleSubmitNewRequest}>
                  <Send size={18} />
                  Submit Request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Requests;
