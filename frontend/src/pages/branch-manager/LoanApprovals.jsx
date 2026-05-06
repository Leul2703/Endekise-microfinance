import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Eye, Search, Filter, FileText, AlertTriangle, ArrowUp } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const LoanApprovals = () => {
  let toast;
  try {
    toast = useToast();
  } catch (error) {
    console.warn('Toast context not available:', error);
    toast = { success: console.log, error: console.error, warning: console.warn };
  }
  const { success, error, warning } = toast;
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showEscalateModal, setShowEscalateModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showDocumentsModal, setShowDocumentsModal] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approvalJustification, setApprovalJustification] = useState('');
  const [escalationReason, setEscalationReason] = useState('');
  const [pendingLoans, setPendingLoans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPendingLoans();
  }, []);

  const fetchPendingLoans = async () => {
    try {
      const data = await api.getPendingLoans();
      setPendingLoans(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching pending loans:', error);
      setPendingLoans([]);
      warning(error?.message || 'Failed to load pending loan approvals');
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
    setApprovalJustification('');
    setShowApproveModal(true);
  };

  const confirmApprove = async () => {
    if (!approvalJustification.trim()) {
      warning('Please provide justification for approval.');
      return;
    }

    try {
      await api.approveLoan(selectedLoan.id, approvalJustification.trim());
      setShowApproveModal(false);
      setApprovalJustification('');
      setSelectedLoan(null);
      fetchPendingLoans(); // Refresh the list
      success(isOver100K(selectedLoan)
        ? 'Loan reviewed and forwarded to CEO approval successfully'
        : 'Loan approved successfully');
    } catch (err) {
      console.error('Error approving loan:', err);
      error(err.message || 'Failed to approve loan');
    }
  };

  const handleEscalate = (loan) => {
    setSelectedLoan(loan);
    setShowEscalateModal(true);
  };

  const handleViewDetails = (loan) => {
    setSelectedLoan(loan);
    setShowDetailsModal(true);
  };

  const handleViewDocuments = (loan) => {
    setSelectedLoan(loan);
    setShowDocumentsModal(true);
  };

  const handleDownloadDocument = (docName) => {
    warning(`Download for "${docName}" is not linked yet. Please use the central documents page.`);
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

  const confirmEscalate = async () => {
    if (!escalationReason.trim()) {
      warning('Justification is mandatory for escalation.');
      return;
    }
    try {
      await api.approveLoan(selectedLoan.id, escalationReason);
      setShowEscalateModal(false);
      setEscalationReason('');
      setSelectedLoan(null);
      fetchPendingLoans();
      success('Loan escalated to CEO successfully');
    } catch (err) {
      console.error('Error escalating loan:', err);
      error(err.message || 'Failed to escalate loan');
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

  const isOver100K = (loan) => getAmountValue(loan.amount) > 100000;

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Loan Approvals</h1>
        <p>Review and approve loan applications. Loans over 100K ETB require CEO approval.</p>
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
            <option value="Pending">Pending</option>
            <option value="High Priority">High Priority</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
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
                <th>Submitted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLoans.map((loan) => (
                <tr key={loan.id}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <strong>{loan.id}</strong>
                      <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>{loan.client}</span>
                    </div>
                  </td>
                  <td>
                    <span className={isOver100K(loan) ? 'amount-highlight' : ''}>{loan.amount}</span>
                    {isOver100K(loan) && <ArrowUp size={12} className="escalation-icon" title="Requires CEO Approval" />}
                  </td>
                  <td>{loan.type}</td>
                  <td>{loan.term}</td>
                  <td>
                    <span className={`status ${loan.status === 'High Priority' ? 'high' : loan.status === 'Pending' ? 'pending' : loan.status === 'Approved' ? 'active' : 'inactive'}`}>
                      {loan.status}
                    </span>
                  </td>
                  <td>{loan.submitted}</td>
                  <td>
                    <button className="btn-icon edit" title="View Details" onClick={() => handleViewDetails(loan)}>
                      <Eye size={18} />
                    </button>
                    <button className="btn-icon edit" title="View Documents" onClick={() => handleViewDocuments(loan)}>
                      <FileText size={18} />
                    </button>
                    <button className="btn-icon edit" title={isOver100K(loan) ? 'Approve and Send to CEO' : 'Approve'} onClick={() => handleApprove(loan)}>
                      <CheckCircle size={18} />
                    </button>
                    {isOver100K(loan) ? (
                      <button className="btn-icon edit" title="Review and Send to CEO" onClick={() => handleEscalate(loan)}>
                        <ArrowUp size={18} />
                      </button>
                    ) : (
                      <button className="btn-icon delete" title="Reject" onClick={() => handleReject(loan)}>
                        <XCircle size={18} />
                      </button>
                    )}
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
              <h2>Reject Loan Application</h2>
              <button onClick={() => setShowRejectModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan?.id}</p>
              <p><strong>Client:</strong> {selectedLoan?.client}</p>
              <p><strong>Amount:</strong> {selectedLoan?.amount}</p>
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

      {showApproveModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Approve Loan Application</h2>
              <button onClick={() => setShowApproveModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan?.id}</p>
              <p><strong>Client:</strong> {selectedLoan?.client}</p>
              <p><strong>Amount:</strong> {selectedLoan?.amount}</p>
              <div className="form-group">
                <label>Approval Justification <span className="required">*</span></label>
                <textarea
                  value={approvalJustification}
                  onChange={(e) => setApprovalJustification(e.target.value)}
                  placeholder="Please provide justification for approval"
                  rows={4}
                  required
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowApproveModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={confirmApprove}>
                  <CheckCircle size={18} />
                  Confirm Approval
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEscalateModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Escalate to CEO</h2>
              <button onClick={() => setShowEscalateModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan?.id}</p>
              <p><strong>Client:</strong> {selectedLoan?.client}</p>
              <p><strong>Amount:</strong> {selectedLoan?.amount}</p>
              <div className="info-card" style={{ marginBottom: '1rem' }}>
                <AlertTriangle size={20} />
                <span>This loan exceeds 100K ETB and requires CEO approval.</span>
              </div>
              <div className="form-group">
                <label>Justification for Escalation <span className="required">*</span></label>
                <textarea
                  value={escalationReason}
                  onChange={(e) => setEscalationReason(e.target.value)}
                  placeholder="Please provide justification for escalating this loan to the CEO"
                  rows={4}
                  required
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowEscalateModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={confirmEscalate}>
                  <ArrowUp size={18} />
                  Escalate to CEO
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
                <span className={`status ${selectedLoan?.status === 'High Priority' ? 'high' : selectedLoan?.status === 'Pending' ? 'pending' : 'active'}`}>
                  {selectedLoan?.status}
                </span>
              </div>
              <div className="form-group">
                <label>Submitted Date</label>
                <p>{selectedLoan?.submitted}</p>
              </div>
              {selectedLoan?.complianceFlag && (
                <div className="info-card" style={{ marginBottom: '1rem', background: '#fef3c7', borderColor: '#fcd34d' }}>
                  <AlertTriangle size={20} style={{ color: '#92400e' }} />
                  <span style={{ color: '#92400e' }}>Compliance flag detected - requires additional review</span>
                </div>
              )}
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
          <div className="modal" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2>Loan Documents</h2>
              <button onClick={() => setShowDocumentsModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan?.id}</p>
              <p><strong>Client:</strong> {selectedLoan?.client}</p>
              <div className="form-group">
                <label>Attached Documents</label>
                <div className="documents-list">
                  <div className="document-item">
                    <FileText size={20} />
                    <div>
                      <p className="document-name">Application Form</p>
                      <p className="document-meta">PDF • 245 KB • Uploaded 2026-04-18</p>
                    </div>
                    <button className="btn-sm secondary" onClick={() => handleDownloadDocument('Application Form')}>
                      Download
                    </button>
                  </div>
                  <div className="document-item">
                    <FileText size={20} />
                    <div>
                      <p className="document-name">ID Verification</p>
                      <p className="document-meta">PDF • 1.2 MB • Uploaded 2026-04-18</p>
                    </div>
                    <button className="btn-sm secondary" onClick={() => handleDownloadDocument('ID Verification')}>
                      Download
                    </button>
                  </div>
                  <div className="document-item">
                    <FileText size={20} />
                    <div>
                      <p className="document-name">Income Statement</p>
                      <p className="document-meta">PDF • 890 KB • Uploaded 2026-04-18</p>
                    </div>
                    <button className="btn-sm secondary" onClick={() => handleDownloadDocument('Income Statement')}>
                      Download
                    </button>
                  </div>
                  <div className="document-item">
                    <FileText size={20} />
                    <div>
                      <p className="document-name">Collateral Documents</p>
                      <p className="document-meta">PDF • 2.5 MB • Uploaded 2026-04-18</p>
                    </div>
                    <button className="btn-sm secondary" onClick={() => handleDownloadDocument('Collateral Documents')}>
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
    </div>
  );
};

export default LoanApprovals;
