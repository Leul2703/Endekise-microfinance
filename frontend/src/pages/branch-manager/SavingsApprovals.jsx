import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, XCircle, Eye, Search, Filter, AlertTriangle, ShieldCheck } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const APPROVAL_TYPES = new Set(['account_creation', 'transaction_deposit', 'transaction_withdraw', 'savings_account_approval']);

const parseDetails = (details) => {
  if (!details) {
    return {};
  }

  if (typeof details === 'object') {
    return details;
  }

  try {
    return JSON.parse(details);
  } catch (parseError) {
    console.warn('Failed to parse approval details:', parseError);
    return {};
  }
};

const normalizeApproval = (request) => {
  const details = parseDetails(request.details);
  const amount = Number(request.amount || details.amount || details.initial_balance || 0);
  const approvalTypeLabel = {
    account_creation: 'Account Creation',
    transaction_deposit: 'Large Deposit',
    transaction_withdraw: 'Large Withdrawal',
    savings_account_approval: 'Savings Account Approval'
  }[request.type] || request.type;

  const clientName = details.client_name || details.client || details.clientName || 'Unassigned';
  const kycStatus = details.kyc_status || 'Pending';
  const requestedType = details.account_type || details.transaction_type || details.type || '-';

  return {
    ...request,
    details,
    amount,
    approvalTypeLabel,
    clientName,
    kycStatus,
    requestedType,
    createdAt: request.created_at || request.createdAt,
    status: request.status || 'Pending',
    requiresCeo: request.approval_level === 'ceo'
  };
};

const getStatusTone = (status) => {
  if (status === 'Verified' || status === 'Approved') return 'active';
  if (status === 'Pending') return 'pending';
  if (status === 'High') return 'high';
  return 'inactive';
};

const formatCurrency = (value) => `${Number(value || 0).toLocaleString()} ETB`;

const SavingsApprovals = () => {
  const { success, error, warning } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [approveJustification, setApproveJustification] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [historySummary, setHistorySummary] = useState({
    accountCreation: { approved: 0, rejected: 0, total: 0 },
    savingsApproval: { approved: 0, rejected: 0, total: 0 }
  });

  useEffect(() => {
    fetchPendingApprovals();
    fetchHistorySummary();
  }, []);

  const fetchPendingApprovals = async () => {
    setLoading(true);
    try {
      const data = await api.getPendingApprovals();
      const normalized = Array.isArray(data)
        ? data
            .filter((request) => APPROVAL_TYPES.has(request.type))
            .map(normalizeApproval)
        : [];
      console.debug('Loaded branch manager approval queue', normalized);
      setApprovals(normalized);
    } catch (fetchError) {
      console.error('Error fetching approval queue:', fetchError);
      error(fetchError.message || 'Failed to load approval queue');
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistorySummary = async () => {
    try {
      const data = await api.getApprovalHistory('account_creation,savings_account_approval');
      setHistorySummary({
        accountCreation: data?.summary?.account_creation || { approved: 0, rejected: 0, total: 0 },
        savingsApproval: data?.summary?.savings_account_approval || { approved: 0, rejected: 0, total: 0 }
      });
    } catch (historyErr) {
      console.error('Error fetching savings approval history summary:', historyErr);
    }
  };

  const filteredApprovals = useMemo(() => (
    approvals.filter((request) => {
      const matchesSearch = (
        (request.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (request.id || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (request.entity_id || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
      const matchesFilter = filterStatus === 'all' || request.type === filterStatus;
      return matchesSearch && matchesFilter;
    })
  ), [approvals, filterStatus, searchTerm]);

  const summary = useMemo(() => ({
    accountCreations: approvals.filter((request) => request.type === 'account_creation').length,
    transactionReviews: approvals.filter((request) => request.type !== 'account_creation').length,
    missingKyc: approvals.filter((request) => request.kycStatus !== 'Verified').length,
    escalated: approvals.filter((request) => request.requiresCeo).length
  }), [approvals]);

  const handleViewDetails = (approval) => {
    setSelectedApproval(approval);
    setShowDetailsModal(true);
  };

  const handleReject = (approval) => {
    setSelectedApproval(approval);
    setRejectReason('');
    setShowRejectModal(true);
  };

  const handleApprove = (approval) => {
    setSelectedApproval(approval);
    setApproveJustification('');
    setShowApproveModal(true);
  };

  const confirmApprove = async () => {
    if (!approveJustification.trim()) {
      warning('Approval justification is required for audit compliance.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.approveApprovalRequest(selectedApproval.id, approveJustification.trim());
      if (response?.warning) {
        warning(response.warning);
      }
      setShowApproveModal(false);
      setSelectedApproval(null);
      setApproveJustification('');
      success('Approval recorded successfully');
      fetchPendingApprovals();
    } catch (approveError) {
      console.error('Error approving request:', approveError);
      error(approveError.message || 'Failed to approve request');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmReject = async () => {
    if (!rejectReason.trim()) {
      warning('Rejection reason is mandatory for audit compliance.');
      return;
    }

    try {
      await api.rejectApprovalRequest(selectedApproval.id, rejectReason.trim());
      setShowRejectModal(false);
      setSelectedApproval(null);
      setRejectReason('');
      success(`${selectedApproval.approvalTypeLabel} rejected successfully`);
      fetchPendingApprovals();
    } catch (rejectError) {
      console.error('Error rejecting request:', rejectError);
      error(rejectError.message || 'Failed to reject request');
    }
  };

  const downloadBlob = (blob, filename) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `document_${new Date().toISOString().slice(0, 10)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleDownloadReceipt = async (documentId) => {
    if (!documentId) return;
    try {
      const { blob, contentDisposition } = await api.downloadDocument(documentId);
      const match = /filename="([^"]+)"/i.exec(contentDisposition || '');
      downloadBlob(blob, match?.[1] || `receipt_${documentId}.pdf`);
      success('Receipt downloaded');
    } catch (err) {
      console.error('Receipt download error:', err);
      error(err.message || 'Failed to download receipt');
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Approval Queue</h1>
        <p>Review savings account openings and high-value transactions that require maker-checker control.</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon"><ShieldCheck size={24} /></div>
          <div className="stat-content">
            <h3>{summary.accountCreations}</h3>
            <p>Pending Account Openings</p>
            <span className="stat-change">Live</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><AlertTriangle size={24} /></div>
          <div className="stat-content">
            <h3>{summary.transactionReviews}</h3>
            <p>Large Transaction Reviews</p>
            <span className="stat-change">Live</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><XCircle size={24} /></div>
          <div className="stat-content">
            <h3>{summary.missingKyc}</h3>
            <p>KYC Follow-up Needed</p>
            <span className="stat-change">Before activation</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><CheckCircle size={24} /></div>
          <div className="stat-content">
            <h3>{summary.escalated}</h3>
            <p>CEO-Level Reviews</p>
            <span className="stat-change">Escalated</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><CheckCircle size={24} /></div>
          <div className="stat-content">
            <h3>{historySummary.accountCreation.approved + historySummary.savingsApproval.approved}</h3>
            <p>Approved (History)</p>
            <span className="stat-change">Savings and account approvals</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><XCircle size={24} /></div>
          <div className="stat-content">
            <h3>{historySummary.accountCreation.rejected + historySummary.savingsApproval.rejected}</h3>
            <p>Rejected (History)</p>
            <span className="stat-change">Savings and account rejections</span>
          </div>
        </div>
      </div>

      <div className="page-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search approvals..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
            <option value="all">All Requests</option>
            <option value="account_creation">Account Creation</option>
            <option value="savings_account_approval">Savings Account Approval</option>
            <option value="transaction_deposit">Large Deposit</option>
            <option value="transaction_withdraw">Large Withdrawal</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="table-container">
          <p style={{ textAlign: 'center', padding: '2rem' }}>Loading approval queue...</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Client / Account</th>
                <th>Type</th>
                <th>Amount</th>
                <th>KYC</th>
                <th>Level</th>
                <th>Submitted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredApprovals.map((approval) => (
                <tr key={approval.id}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <strong>{approval.id}</strong>
                      <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>{approval.approvalTypeLabel}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <strong>{approval.clientName}</strong>
                      <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>{approval.entity_id}</span>
                    </div>
                  </td>
                  <td>{approval.requestedType}</td>
                  <td>{formatCurrency(approval.amount)}</td>
                  <td>
                    <span className={`status ${getStatusTone(approval.kycStatus)}`}>
                      {approval.kycStatus}
                    </span>
                  </td>
                  <td>
                    <span className={`status ${approval.requiresCeo ? 'high' : 'pending'}`}>
                      {approval.approval_level?.replace('_', ' ') || 'branch manager'}
                    </span>
                  </td>
                  <td>{approval.createdAt ? new Date(approval.createdAt).toLocaleString() : '-'}</td>
                  <td>
                    <button className="btn-icon edit" title="View Details" onClick={() => handleViewDetails(approval)}>
                      <Eye size={18} />
                    </button>
                    <button className="btn-icon edit" title="Approve" onClick={() => handleApprove(approval)}>
                      <CheckCircle size={18} />
                    </button>
                    <button className="btn-icon delete" title="Reject" onClick={() => handleReject(approval)}>
                      <XCircle size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredApprovals.length === 0 && (
            <p style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
              No pending approval requests matched your filters.
            </p>
          )}
        </div>
      )}

      {showApproveModal && selectedApproval && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Approve Request</h2>
              <button onClick={() => (submitting ? null : setShowApproveModal(false))} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <p><strong>Request:</strong> {selectedApproval.id}</p>
              <p><strong>Client:</strong> {selectedApproval.clientName}</p>
              <p><strong>Amount:</strong> {formatCurrency(selectedApproval.amount)}</p>
              <div className="form-group">
                <label>Approval Justification <span className="required">*</span></label>
                <textarea
                  value={approveJustification}
                  onChange={(event) => setApproveJustification(event.target.value)}
                  placeholder="Enter approval justification for audit trail"
                  rows={4}
                  disabled={submitting}
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowApproveModal(false)} disabled={submitting}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={confirmApprove} disabled={submitting}>
                  {submitting ? 'Approving...' : 'Approve'}
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
              <h2>Reject Approval Request</h2>
              <button onClick={() => (submitting ? null : setShowRejectModal(false))} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <p><strong>Request:</strong> {selectedApproval.id}</p>
              <p><strong>Client:</strong> {selectedApproval.clientName}</p>
              <p><strong>Amount:</strong> {formatCurrency(selectedApproval.amount)}</p>
              <div className="form-group">
                <label>Rejection Reason <span className="required">*</span></label>
                <textarea
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  placeholder="Provide the control or compliance reason for rejection"
                  rows={4}
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowRejectModal(false)} disabled={submitting}>
                  Cancel
                </button>
                <button className="btn-primary delete" onClick={confirmReject} disabled={submitting}>
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDetailsModal && selectedApproval && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Approval Details</h2>
              <button onClick={() => setShowDetailsModal(false)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Request ID</label>
                <p>{selectedApproval.id}</p>
              </div>
              <div className="form-group">
                <label>Approval Type</label>
                <p>{selectedApproval.approvalTypeLabel}</p>
              </div>
              <div className="form-group">
                <label>Client</label>
                <p>{selectedApproval.clientName}</p>
              </div>
              <div className="form-group">
                <label>Entity / Account</label>
                <p>{selectedApproval.entity_id}</p>
              </div>
              <div className="form-group">
                <label>KYC Status</label>
                <span className={`status ${getStatusTone(selectedApproval.kycStatus)}`}>
                  {selectedApproval.kycStatus}
                </span>
              </div>
              <div className="form-group">
                <label>Requested Amount</label>
                <p>{formatCurrency(selectedApproval.amount)}</p>
              </div>
              <div className="form-group">
                <label>Workflow Level</label>
                <p>{selectedApproval.approval_level?.replace('_', ' ') || 'branch manager'}</p>
              </div>
              <div className="form-group">
                <label>Maker Details</label>
                <p>{selectedApproval.requested_by_name || `User ${selectedApproval.requested_by || '-'}`}</p>
              </div>
              <div className="form-group">
                <label>Payload Snapshot</label>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>
                  {JSON.stringify(selectedApproval.details, null, 2)}
                </pre>
              </div>
              {selectedApproval.details?.requires_receipt_proof && (
                <div className="form-group">
                  <label>Receipt Proof</label>
                  {selectedApproval.details?.receipt_document_id ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleDownloadReceipt(selectedApproval.details.receipt_document_id)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                      <Eye size={18} />
                      Download Receipt ({selectedApproval.details.receipt_document_id})
                    </button>
                  ) : (
                    <div className="info-card" style={{ margin: 0, borderColor: '#fca5a5', background: '#fef2f2' }}>
                      Missing receipt proof. Maker must attach the receipt before approval.
                    </div>
                  )}
                </div>
              )}
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowDetailsModal(false)}>
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

export default SavingsApprovals;
