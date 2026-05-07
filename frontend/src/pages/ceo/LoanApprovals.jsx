import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Eye, Search, Filter, AlertTriangle, ArrowUp, FileText, Download } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const LoanApprovals = () => {
  const { success, error, warning } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [approveJustification, setApproveJustification] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [pendingLoans, setPendingLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showDocumentsModal, setShowDocumentsModal] = useState(false);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [loanDocuments, setLoanDocuments] = useState([]);

  useEffect(() => {
    fetchPendingLoans();
  }, []);

  const fetchPendingLoans = async () => {
    try {
      const data = await api.getPendingLoans();
      const ceoLoans = data.filter(loan => 
        loan.status === 'Pending CEO Review' || 
        (parseFloat(loan.amount?.replace(/[^0-9]/g, '') || 0) > 100000 && loan.status === 'Pending')
      );
      setPendingLoans(ceoLoans);
    } catch (error) {
      console.error('Error fetching pending loans:', error);
      setPendingLoans([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredLoans = pendingLoans.filter(loan => {
    const matchesSearch = (loan.client?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
                         (loan.id?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === 'all' || loan.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const handleReject = (loan) => {
    setSelectedLoan(loan);
    setShowRejectModal(true);
  };

  const handleApprove = (loan) => {
    setSelectedLoan(loan);
    setApproveJustification('');
    setShowApproveModal(true);
  };

  const confirmApprove = async () => {
    if (!approveJustification.trim()) {
      warning('CEO approval justification is required for audit compliance.');
      return;
    }

    setSubmitting(true);
    try {
      await api.approveLoan(selectedLoan.id, approveJustification.trim());
      setShowApproveModal(false);
      setSelectedLoan(null);
      setApproveJustification('');
      success('Loan approved successfully by CEO');
      fetchPendingLoans();
    } catch (err) {
      console.error('Error approving loan:', err);
      error(err.message || 'Failed to approve loan');
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewDetails = (loan) => {
    setSelectedLoan(loan);
    setShowDetailsModal(true);
  };

  const handleViewDocuments = (loan) => {
    setSelectedLoan(loan);
    setShowDocumentsModal(true);
    setDocumentsLoading(true);
    setLoanDocuments([]);
    api.getDocumentsByLoan(loan.id)
      .then((docs) => setLoanDocuments(Array.isArray(docs) ? docs : []))
      .catch((err) => warning(err?.message || 'Failed to load documents'))
      .finally(() => setDocumentsLoading(false));
  };

  const handleDownloadDocument = async (doc) => {
    if (!doc?.id) return;
    try {
      const { blob, contentDisposition } = await api.downloadDocument(doc.id);
      const match = /filename="([^"]+)"/i.exec(contentDisposition || '');
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match?.[1] || doc.file_name || `document_${doc.id}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      success('Document downloaded');
    } catch (err) {
      error(err.message || 'Failed to download document');
    }
  };

  const confirmReject = async () => {
    if (!rejectReason.trim()) {
      warning('Rejection reason is mandatory for audit compliance.');
      return;
    }
    try {
      await api.rejectLoan(selectedLoan.id, rejectReason);
      setShowRejectModal(false);
      setRejectReason('');
      setSelectedLoan(null);
      fetchPendingLoans();
      success('Loan rejected successfully');
    } catch (err) {
      console.error('Error rejecting loan:', err);
      error(err.message || 'Failed to reject loan');
    }
  };

  const getAmountValue = (amountStr) => {
    if (typeof amountStr === 'number') {
      return amountStr;
    }
    if (typeof amountStr === 'string') {
      return parseInt(amountStr.replace(/[^0-9]/g, ''));
    }
    return 0;
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>CEO Loan Approvals</h1>
        <p>Review and approve high-value loans (over 100K ETB) escalated from Branch Managers.</p>
      </div>

      <div className="page-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search loans..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">All Status</option>
            <option value="Pending CEO Review">Pending CEO Review</option>
            <option value="Pending">Pending</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="table-container">
          <p style={{ textAlign: 'center', padding: '2rem' }}>Loading pending loans...</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Loan ID</th>
                <th>Amount</th>
                <th>Type</th>
                <th>Term</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLoans.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>
                    No pending CEO loan approvals
                  </td>
                </tr>
              ) : filteredLoans.map((loan) => (
                <tr key={loan.id}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <strong>{loan.id}</strong>
                      <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>{loan.client}</span>
                    </div>
                  </td>
                  <td>
                    <span className="amount-highlight">{loan.amount}</span>
                    <ArrowUp size={12} className="escalation-icon" title="CEO Approval Required" />
                  </td>
                  <td>{loan.type}</td>
                  <td>{loan.term}</td>
                  <td>
                    <span className={`status ${loan.status === 'Pending CEO Review' ? 'high' : 'pending'}`}>
                      {loan.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn-icon edit" title="View Details" onClick={() => handleViewDetails(loan)}>
                      <Eye size={18} />
                    </button>
                    <button className="btn-icon edit" title="View Documents" onClick={() => handleViewDocuments(loan)}>
                      <FileText size={18} />
                    </button>
                    <button className="btn-icon edit" title="Approve" onClick={() => handleApprove(loan)}>
                      <CheckCircle size={18} />
                    </button>
                    <button className="btn-icon delete" title="Reject" onClick={() => handleReject(loan)}>
                      <XCircle size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showApproveModal && selectedLoan && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Approve Loan (CEO)</h2>
              <button onClick={() => (submitting ? null : setShowApproveModal(false))} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan?.id}</p>
              <p><strong>Client:</strong> {selectedLoan?.client}</p>
              <p><strong>Amount:</strong> {selectedLoan?.amount}</p>
              <div className="form-group">
                <label>Approval Justification <span className="required">*</span></label>
                <textarea
                  value={approveJustification}
                  onChange={(e) => setApproveJustification(e.target.value)}
                  placeholder="Provide justification for CEO approval (stored in audit trail)"
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

      {showRejectModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Reject Loan Application</h2>
              <button onClick={() => (submitting ? null : setShowRejectModal(false))} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan?.id}</p>
              <p><strong>Client:</strong> {selectedLoan?.client}</p>
              <p><strong>Amount:</strong> {selectedLoan?.amount}</p>
              <div className="info-card" style={{ marginBottom: '1rem' }}>
                <AlertTriangle size={20} />
                <span>This is a CEO-level rejection for a high-value loan.</span>
              </div>
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

      {showDetailsModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Loan Details</h2>
              <button onClick={() => setShowDetailsModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Loan ID</label>
                <p>{selectedLoan?.id}</p>
              </div>
              <div className="form-group">
                <label>Client</label>
                <p>{selectedLoan?.client}</p>
              </div>
              <div className="form-group">
                <label>Amount</label>
                <p>{selectedLoan?.amount}</p>
              </div>
              <div className="form-group">
                <label>Type</label>
                <p>{selectedLoan?.type}</p>
              </div>
              <div className="form-group">
                <label>Term</label>
                <p>{selectedLoan?.term}</p>
              </div>
              <div className="form-group">
                <label>Status</label>
                <span className={`status ${selectedLoan?.status === 'Pending CEO Review' ? 'high' : 'pending'}`}>
                  {selectedLoan?.status}
                </span>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowDetailsModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={() => {
                  setShowDetailsModal(false);
                  handleApprove(selectedLoan);
                }}>
                  <CheckCircle size={18} />
                  Approve Loan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDocumentsModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '650px' }}>
            <div className="modal-header">
              <h2>Loan Documents</h2>
              <button onClick={() => setShowDocumentsModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan?.id}</p>
              <p><strong>Client:</strong> {selectedLoan?.client}</p>

              {documentsLoading ? (
                <div style={{ padding: '1rem', color: '#6b7280' }}>Loading documents...</div>
              ) : loanDocuments.length === 0 ? (
                <div style={{ padding: '1rem', color: '#6b7280' }}>No documents attached yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
                  {loanDocuments.map((doc) => (
                    <div key={doc.id} className="info-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <strong>{doc.type || 'Document'}</strong>
                        <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>{doc.file_name}</span>
                        <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>
                          Uploaded: {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleString() : '-'}
                        </span>
                      </div>
                      <button className="btn-secondary" onClick={() => handleDownloadDocument(doc)}>
                        <Download size={18} />
                        Download
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowDocumentsModal(false)}>
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

export default LoanApprovals;
