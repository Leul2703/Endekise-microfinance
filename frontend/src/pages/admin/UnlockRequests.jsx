import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Key, RefreshCw, X, User } from 'lucide-react';
import './AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const UnlockRequests = () => {
  const { success, error, warning } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [requests, setRequests] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  const fetchRequests = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    try {
      const data = await api.getPendingUnlockRequests();
      const list = Array.isArray(data)
        ? data
        : (Array.isArray(data?.requests) ? data.requests : []);
      setRequests(list);
    } catch (err) {
      console.error('Error fetching unlock requests:', err);
      setFetchError(err.message || 'Failed to load unlock requests');
      setRequests([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests(false);
  }, [fetchRequests]);

  const filteredRequests = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return requests;

    return requests.filter((r) => {
      const username = (r.username || '').toLowerCase();
      const email = (r.requested_user_email || '').toLowerCase();
      const name = (r.requested_user_name || '').toLowerCase();
      const contact = (r.contact || '').toLowerCase();
      return (
        username.includes(q) ||
        email.includes(q) ||
        name.includes(q) ||
        contact.includes(q)
      );
    });
  }, [requests, searchTerm]);

  const handleRefresh = () => fetchRequests(true);

  const formatTs = (ts) => {
    if (!ts) return '-';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return String(ts);
    }
  };

  const openRejectModal = (request) => {
    setSelectedRequest(request);
    setRejectionReason('');
    setRejectModalOpen(true);
  };

  const closeRejectModal = () => {
    setRejectModalOpen(false);
    setSelectedRequest(null);
    setRejectionReason('');
    setSubmittingAction(false);
  };

  const handleApprove = async (request) => {
    if (!request?.id) return;
    setSubmittingAction(true);
    try {
      await api.approveUnlockRequest(request.id);
      success(`Unlocked account for ${request.username}`);
      await fetchRequests(true);
    } catch (err) {
      console.error('Approve unlock request error:', err);
      error(err.message || 'Failed to approve unlock request');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest?.id) return;
    setSubmittingAction(true);
    try {
      await api.rejectUnlockRequest(selectedRequest.id, rejectionReason);
      warning(`Rejected unlock request for ${selectedRequest.username}`);
      closeRejectModal();
      await fetchRequests(true);
    } catch (err) {
      console.error('Reject unlock request error:', err);
      error(err.message || 'Failed to reject unlock request');
      setSubmittingAction(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Unlock Requests</h1>
        <p>Review pending account unlock requests and approve/reject them.</p>
      </div>

      <div className="page-actions">
        <div className="search-bar">
          <User size={20} />
          <input
            type="text"
            placeholder="Search by username, email, or contact..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
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
      </div>

      {loading ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <RefreshCw size={48} className="spinning" style={{ color: '#3b82f6', marginBottom: '1rem' }} />
            <p style={{ color: '#6b7280' }}>Loading unlock requests...</p>
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
          {filteredRequests.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#6b7280' }}>
              No pending unlock requests{searchTerm.trim() ? ' matching your search.' : '.'}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Locked Until</th>
                  <th>Requested At</th>
                  <th>Contact</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div
                          style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            background: '#f3f4f6',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <Key size={18} style={{ color: '#6b7280' }} />
                        </div>
                        <div>
                          <div style={{ fontWeight: '600' }}>{r.requested_user_name || r.username}</div>
                          <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                            {r.username}
                            {r.requested_user_email ? ` • ${r.requested_user_email}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ color: '#374151', fontWeight: 600 }}>{formatTs(r.lock_until)}</span>
                    </td>
                    <td>
                      <span style={{ color: '#6b7280' }}>{formatTs(r.requested_at)}</span>
                    </td>
                    <td>
                      <div style={{ color: '#374151' }}>{r.contact || '-'}</div>
                      {r.reason ? <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>Reason: {r.reason}</div> : null}
                      {r.rejection_reason ? (
                        <div style={{ fontSize: '0.85rem', color: '#ef4444' }}>Reject reason: {r.rejection_reason}</div>
                      ) : null}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          className="btn-icon"
                          title="Approve and unlock"
                          onClick={() => handleApprove(r)}
                          disabled={submittingAction}
                          style={{ background: 'none', color: '#16a34a' }}
                        >
                          <CheckCircle2 size={18} />
                        </button>
                        <button
                          className="btn-icon"
                          title="Reject request"
                          onClick={() => openRejectModal(r)}
                          disabled={submittingAction}
                          style={{ background: 'none', color: '#ef4444' }}
                        >
                          <Clock size={18} />
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

      {/* Reject modal */}
      {rejectModalOpen && selectedRequest && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2>Reject Unlock Request</h2>
              <button onClick={closeRejectModal} className="modal-close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ color: '#6b7280', marginTop: 0 }}>
                  Rejecting request for <strong>{selectedRequest.username}</strong>.
                </p>
              </div>

              <div className="form-group">
                <label>Rejection Reason (optional)</label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Provide a short reason the requester can understand..."
                  rows={4}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
              </div>

              <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
                <button className="btn-secondary" onClick={closeRejectModal} disabled={submittingAction}>
                  Cancel
                </button>
                <button className="btn-danger" onClick={handleReject} disabled={submittingAction} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {submittingAction ? (
                    <>
                      <RefreshCw size={18} className="spinning" />
                      Rejecting...
                    </>
                  ) : (
                    <>
                      <X size={18} />
                      Reject
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

export default UnlockRequests;

