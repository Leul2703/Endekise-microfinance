import { useEffect, useState } from 'react';
import { CheckCircle, FileText, RefreshCw, XCircle } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../utils/dateTime';

const StatementApprovals = () => {
  const { success, error, warning } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRow, setSelectedRow] = useState(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [justification, setJustification] = useState('');
  const [reason, setReason] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = async (asRefresh = false) => {
    if (asRefresh) setRefreshing(true);
    try {
      const data = await api.getPendingStatementApprovals();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      error(err.message || 'Failed to load pending statement requests');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleApprove = (row) => {
    setSelectedRow(row);
    setJustification('');
    setShowApproveModal(true);
  };

  const confirmApprove = async () => {
    if (!justification.trim()) {
      warning('Approval justification is mandatory.');
      return;
    }
    try {
      await api.approveStatement(selectedRow.id, justification.trim());
      await api.authorizeStatement(selectedRow.id);
      setShowApproveModal(false);
      setSelectedRow(null);
      success('Statement approved and authorized successfully.');
      load();
    } catch (err) {
      error(err.message || 'Failed to approve statement');
    }
  };

  const handleReject = (row) => {
    setSelectedRow(row);
    setReason('');
    setShowRejectModal(true);
  };

  const confirmReject = async () => {
    if (!reason.trim()) {
      warning('Rejection reason is mandatory.');
      return;
    }
    try {
      await api.rejectStatement(selectedRow.id, reason.trim());
      setShowRejectModal(false);
      setSelectedRow(null);
      success('Statement request rejected.');
      load();
    } catch (err) {
      error(err.message || 'Failed to reject statement request');
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Statement Approval Queue</h1>
        <p>Branch-level checker/approver queue for statement release requests.</p>
      </div>
      <div className="page-actions">
        <button className="btn-secondary" onClick={() => load(true)} disabled={refreshing}>
          <RefreshCw size={18} className={refreshing ? 'spinning' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh Queue'}
        </button>
      </div>

      <div className="table-container">
        {loading ? (
          <p style={{ textAlign: 'center', padding: '2rem' }}>Loading statement approvals...</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Statement ID</th>
                <th>Approval Request</th>
                <th>Statement Type</th>
                <th>Account/Loan ID</th>
                <th>Status</th>
                <th>Requested At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }}>
                    No pending statement requests.
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.approval_request_id || '-'}</td>
                  <td>{row.statement_type || row.type || 'statement'}</td>
                  <td>{row.account_id || row.loan_id || row.reference_id || '-'}</td>
                  <td><span className="status pending">{row.status || 'Pending'}</span></td>
                  <td>{formatDateTime(row.created_at)}</td>
                  <td>
                    <button className="btn-icon edit" title="Approve" onClick={() => handleApprove(row)}>
                      <CheckCircle size={18} />
                    </button>
                    <button className="btn-icon delete" title="Reject" onClick={() => handleReject(row)}>
                      <XCircle size={18} />
                    </button>
                    <button className="btn-icon edit" title="Type">
                      <FileText size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showApproveModal && selectedRow && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Approve Statement Request</h2>
              <button onClick={() => setShowApproveModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Request ID:</strong> {selectedRow.id}</p>
              <p><strong>Type:</strong> {selectedRow.statement_type || selectedRow.type || 'statement'}</p>
              <div className="form-group">
                <label>Approval Justification <span className="required">*</span></label>
                <textarea
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="Enter approval justification for audit trail"
                  rows={4}
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowApproveModal(false)}>Cancel</button>
                <button className="btn-primary" onClick={confirmApprove}>
                  <CheckCircle size={18} />
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRejectModal && selectedRow && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Reject Statement Request</h2>
              <button onClick={() => setShowRejectModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Request ID:</strong> {selectedRow.id}</p>
              <p><strong>Type:</strong> {selectedRow.statement_type || selectedRow.type || 'statement'}</p>
              <div className="form-group">
                <label>Rejection Reason <span className="required">*</span></label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Enter rejection reason for audit trail"
                  rows={4}
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowRejectModal(false)}>Cancel</button>
                <button className="btn-primary delete" onClick={confirmReject}>
                  <XCircle size={18} />
                  Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatementApprovals;
