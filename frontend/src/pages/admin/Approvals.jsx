import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Clock, AlertTriangle, Shield, RefreshCw } from 'lucide-react';
import './AdminPages.css';
import { useToast } from '../../context/ToastContext';
import api from '../../utils/api';
import { formatDateTime } from '../../utils/dateTime';

const Approvals = () => {
  const { success, error, warning } = useToast();
  const [approvals, setApprovals] = useState([]);
  const [thresholds, setThresholds] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [justification, setJustification] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchApprovals = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    try {
      const data = await api.getPendingApprovals();
      setApprovals(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching approvals:', err);
      setFetchError(err.message || 'Failed to load approvals');
      setApprovals([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchThresholds = useCallback(async () => {
    try {
      const data = await api.getApprovalThresholds();
      setThresholds(data);
    } catch (err) {
      console.error('Error fetching thresholds:', err);
    }
  }, []);

  const handleRefresh = () => {
    fetchApprovals(true);
    fetchThresholds();
  };

  useEffect(() => {
    fetchApprovals();
    fetchThresholds();
  }, [fetchApprovals, fetchThresholds]);

  const handleApprove = async () => {
    if (!justification.trim()) {
      warning('Justification is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await api.approveRequest(selectedApproval.id, justification);

      if (!data.error) {
        setShowApproveModal(false);
        setSelectedApproval(null);
        setJustification('');
        await fetchApprovals();
        success('Request approved successfully');
      } else {
        error(data.error);
      }
    } catch (err) {
      error('Failed to approve request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!justification.trim()) {
      warning('Rejection reason is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await api.rejectRequest(selectedApproval.id, justification);

      if (!data.error) {
        setShowRejectModal(false);
        setSelectedApproval(null);
        setJustification('');
        await fetchApprovals();
        success('Request rejected successfully');
      } else {
        error(data.error);
      }
    } catch (err) {
      error('Failed to reject request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getTypeLabel = (type) => {
    switch (type) {
      case 'transaction_deposit': return 'Deposit Transaction';
      case 'transaction_withdraw': return 'Withdrawal Transaction';
      case 'loan_application': return 'Loan Application';
      default: return type;
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'transaction_deposit': return '📥';
      case 'transaction_withdraw': return '📤';
      case 'loan_application': return '💰';
      default: return '📋';
    }
  };

  const getApprovalLevelColor = (level) => {
    switch (level) {
      case 'branch_manager': return '#3b82f6';
      case 'ceo': return '#8b5cf6';
      default: return '#6b7280';
    }
  };

  const getApprovalLevelLabel = (level) => {
    switch (level) {
      case 'branch_manager': return 'Branch Manager';
      case 'ceo': return 'CEO';
      default: return level;
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Approval Management</h1>
          <p>Review and approve pending requests requiring authorization</p>
          <div style={{ marginTop: '0.75rem' }}>
            <span className="inline-meta">Pending requests: {approvals.length}</span>
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

      <div className="info-card" style={{ marginBottom: '2rem', background: '#f0fdf4', borderColor: '#86efac' }}>
        <Shield size={24} style={{ color: '#166534' }} />
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: '#166534' }}>Approval Thresholds</h3>
          <p style={{ margin: 0, color: '#166534' }}>
            Branch Manager: up to {thresholds.branch_manager?.toLocaleString() || '100,000'} ETB | 
            CEO: Unlimited
          </p>
        </div>
      </div>

      {loading ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <RefreshCw size={48} className="spinning" style={{ color: '#3b82f6', marginBottom: '1rem' }} />
            <p style={{ color: '#6b7280' }}>Loading approvals...</p>
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
      ) : approvals.length === 0 ? (
        <div className="empty-state">
          <Clock size={48} />
          <p>No pending approvals</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Entity ID</th>
                <th>Amount</th>
                <th>Requested By</th>
                <th>Approval Level</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((approval) => (
                <tr key={approval.id}>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.2rem' }}>{getTypeIcon(approval.type)}</span>
                      {getTypeLabel(approval.type)}
                    </span>
                  </td>
                  <td>{approval.entity_id}</td>
                  <td style={{ fontWeight: 'bold' }}>
                    {approval.amount ? `${parseFloat(approval.amount).toLocaleString()} ETB` : '-'}
                  </td>
                  <td>{approval.requested_by_name || '-'}</td>
                  <td>
                    <span style={{ 
                      color: getApprovalLevelColor(approval.approval_level),
                      fontWeight: 'bold',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      background: `${getApprovalLevelColor(approval.approval_level)}20`
                    }}>
                      {getApprovalLevelLabel(approval.approval_level)}
                    </span>
                  </td>
                  <td>{formatDateTime(approval.created_at)}</td>
                  <td>
                    <button 
                      className="btn-icon edit" 
                      title="Approve"
                      onClick={() => { setSelectedApproval(approval); setShowApproveModal(true); setJustification(''); }}
                    >
                      <CheckCircle size={18} style={{ color: '#10b981' }} />
                    </button>
                    <button 
                      className="btn-icon delete" 
                      title="Reject"
                      onClick={() => { setSelectedApproval(approval); setShowRejectModal(true); setJustification(''); }}
                    >
                      <XCircle size={18} style={{ color: '#ef4444' }} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showApproveModal && selectedApproval && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Approve Request</h2>
              <button onClick={() => setShowApproveModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Request ID:</strong> {selectedApproval.id}</p>
              <p><strong>Type:</strong> {getTypeLabel(selectedApproval.type)}</p>
              <p><strong>Entity ID:</strong> {selectedApproval.entity_id}</p>
              <p><strong>Amount:</strong> {selectedApproval.amount ? `${parseFloat(selectedApproval.amount).toLocaleString()} ETB` : '-'}</p>
              <p><strong>Approval Level:</strong> {getApprovalLevelLabel(selectedApproval.approval_level)}</p>
              <p><strong>Requested By:</strong> {selectedApproval.requested_by_name || '-'}</p>
              
              {selectedApproval.details && (
                <div className="info-card" style={{ marginBottom: '1rem', background: '#eff6ff', borderColor: '#bfdbfe' }}>
                  <AlertTriangle size={20} style={{ color: '#1e40af' }} />
                  <span style={{ color: '#1e40af' }}>
                    {selectedApproval.details}
                  </span>
                </div>
              )}
              
              <div className="form-group">
                <label>Justification <span className="required">*</span></label>
                <textarea
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="Enter justification for approval"
                  rows={3}
                  required
                />
              </div>
              
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowApproveModal(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleApprove} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <span className="spinner"></span>
                      Approving...
                    </>
                  ) : (
                    <>
                      <CheckCircle size={18} />
                      Approve
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRejectModal && selectedApproval && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Reject Request</h2>
              <button onClick={() => setShowRejectModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Request ID:</strong> {selectedApproval.id}</p>
              <p><strong>Type:</strong> {getTypeLabel(selectedApproval.type)}</p>
              <p><strong>Entity ID:</strong> {selectedApproval.entity_id}</p>
              <p><strong>Amount:</strong> {selectedApproval.amount ? `${parseFloat(selectedApproval.amount).toLocaleString()} ETB` : '-'}</p>
              <p><strong>Requested By:</strong> {selectedApproval.requested_by_name || '-'}</p>
              
              <div className="info-card" style={{ marginBottom: '1rem', background: '#fef2f2', borderColor: '#fca5a5' }}>
                <AlertTriangle size={20} style={{ color: '#991b1b' }} />
                <span style={{ color: '#991b1b' }}>
                  This action will reject the request and the transaction will not be executed.
                </span>
              </div>
              
              <div className="form-group">
                <label>Rejection Reason <span className="required">*</span></label>
                <textarea
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="Enter reason for rejection"
                  rows={3}
                  required
                />
              </div>
              
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowRejectModal(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button className="btn-primary" style={{ background: '#ef4444' }} onClick={handleReject} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <span className="spinner"></span>
                      Rejecting...
                    </>
                  ) : (
                    <>
                      <XCircle size={18} />
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

export default Approvals;
