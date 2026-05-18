import { useState, useEffect, useMemo } from 'react';
import { CheckCircle, XCircle, Eye, Search, Filter, FileText, AlertTriangle, ArrowUp, Download, Receipt, PiggyBank } from 'lucide-react';
import { formatScheduleAmount, getInstallmentRemainingFromRow } from '../../utils/paymentSchedule';
import { formatDateOnly } from '../../utils/dateTime';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../utils/dateTime';

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
  const [historySummary, setHistorySummary] = useState({ approved: 0, rejected: 0, total: 0 });
  const [creditLimit, setCreditLimit] = useState(100000);
  const [loanDocuments, setLoanDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewPackage, setReviewPackage] = useState(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [savingsPolicy, setSavingsPolicy] = useState(null);

  useEffect(() => {
    fetchPendingLoans();
    fetchLoanHistorySummary();
    fetchThresholds();
    api.getLoanSavingsPolicy().then(setSavingsPolicy).catch(() => {});
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

  const fetchLoanHistorySummary = async () => {
    try {
      const data = await api.getApprovalHistory('loan_origination');
      const loanSummary = data?.summary?.loan_origination || { approved: 0, rejected: 0, total: 0 };
      setHistorySummary(loanSummary);
    } catch (historyErr) {
      console.error('Error fetching loan approval history summary:', historyErr);
    }
  };

  const fetchThresholds = async () => {
    try {
      const thresholdData = await api.getApprovalThresholds();
      if (Number.isFinite(Number(thresholdData?.branch_manager))) {
        setCreditLimit(Number(thresholdData.branch_manager));
      }
    } catch (thresholdErr) {
      console.error('Error loading approval thresholds:', thresholdErr);
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
    setLoanDocuments([]);
    setDocumentsLoading(true);
    Promise.all([
      api.getDocumentsByLoan(loan.id).catch(() => []),
      api.getDocumentsByEntity('loan_account', loan.id).catch(() => []),
      loan?.approval_request_id ? api.getDocumentsByApprovalRequest(loan.approval_request_id).catch(() => []) : Promise.resolve([])
    ])
      .then(([byLoan, byEntity, byApproval]) => {
        const merged = [...(byLoan || []), ...(byEntity || []), ...(byApproval || [])];
        const deduped = merged.filter((doc, index, arr) => arr.findIndex((item) => item.id === doc.id) === index);
        setLoanDocuments(deduped);
      })
      .catch((err) => warning(err?.message || 'Failed to load loan documents'))
      .finally(() => setDocumentsLoading(false));
  };

  const handleReviewPackage = async (loan) => {
    setSelectedLoan(loan);
    setShowReviewModal(true);
    setReviewPackage(null);
    setReviewLoading(true);
    try {
      const data = await api.getLoanReviewPackage(loan.id);
      setReviewPackage(data);
    } catch (err) {
      error(err?.message || 'Failed to load loan review package');
    } finally {
      setReviewLoading(false);
    }
  };

  const handleDownloadTransactionReceipt = async (transactionId) => {
    try {
      const { blob, contentDisposition } = await api.downloadTransactionStatementPdf(transactionId);
      const match = /filename="([^"]+)"/i.exec(contentDisposition || '');
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match?.[1] || `receipt_${transactionId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      success('Receipt downloaded');
    } catch (err) {
      error(err?.message || 'Failed to download receipt');
    }
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
  const pendingExposure = useMemo(
    () => filteredLoans.reduce((sum, loan) => sum + getAmountValue(loan.amount), 0),
    [filteredLoans]
  );

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Loan Approvals</h1>
        <p>
          Review and approve loan applications. Clients must hold at least {savingsPolicy?.collateral_percent || 30}% of the loan in savings and upload supporting documents.
          Loans over 100K ETB require CEO approval.
        </p>
        <div style={{ marginTop: '0.75rem' }}>
          <span className="inline-meta">Pending loans: {filteredLoans.length}</span>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-content"><h3>{creditLimit.toLocaleString()} ETB</h3><p>Branch Credit Limit</p></div></div>
        <div className="stat-card"><div className="stat-content"><h3>{pendingExposure.toLocaleString()} ETB</h3><p>Pending Loan Exposure</p></div></div>
        <div className="stat-card"><div className="stat-content"><h3>{historySummary.approved}</h3><p>Approved (History)</p></div></div>
        <div className="stat-card"><div className="stat-content"><h3>{historySummary.rejected}</h3><p>Rejected (History)</p></div></div>
      </div>

      <div className="page-actions sticky-actions">
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
        <button
          className="btn-secondary"
          onClick={() => {
            setSearchTerm('');
            setFilterStatus('all');
          }}
        >
          Reset Filters
        </button>
      </div>

      {loading ? (
        <div className="table-container">
          <p style={{ textAlign: 'center', padding: '2rem' }}>Loading pending loans...</p>
        </div>
      ) : (
        <div className="table-container">
          {filteredLoans.length === 0 ? (
            <div className="empty-state">
              <p>No loan approvals found for the selected filters.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Loan ID</th>
                  <th>Amount</th>
                  <th>Type</th>
                  <th>Term</th>
                  <th>Savings Collateral</th>
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
                    {loan.savings_requirement ? (
                      <span className={`status ${loan.savings_requirement.eligible ? 'active' : 'high'}`}>
                        {loan.savings_requirement.savings_ratio_percent}% / {loan.savings_requirement.collateral_percent}% req.
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    <span className={`status ${loan.status === 'High Priority' ? 'high' : loan.status === 'Pending' ? 'pending' : loan.status === 'Approved' ? 'active' : 'inactive'}`}>
                      {loan.status}
                    </span>
                  </td>
                  <td>{formatDateTime(loan.submitted)}</td>
                  <td>
                    <button className="btn-icon edit" title="View Details" onClick={() => handleViewDetails(loan)}>
                      <Eye size={18} />
                    </button>
                    <button className="btn-icon edit" title="Review package (docs, receipts, schedule)" onClick={() => handleReviewPackage(loan)}>
                      <Receipt size={18} />
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
          )}
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

      {showReviewModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '960px', maxHeight: '90vh', overflow: 'auto' }}>
            <div className="modal-header">
              <h2>Loan Review Package</h2>
              <button onClick={() => setShowReviewModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan?.id}</p>
              <p><strong>Client:</strong> {selectedLoan?.client}</p>
              {reviewLoading ? (
                <p style={{ padding: '1.5rem', textAlign: 'center' }}>Loading review package...</p>
              ) : reviewPackage ? (
                <>
                  <div className="info-card" style={{ marginBottom: '1rem' }}>
                    <PiggyBank size={20} />
                    <div>
                      <strong>Savings + documents requirement</strong>
                      <p style={{ margin: '0.25rem 0 0' }}>{reviewPackage.savings_requirement?.message}</p>
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem' }}>
                        Balance: {Number(reviewPackage.savings_requirement?.savings_balance || 0).toLocaleString()} ETB •
                        Required: {Number(reviewPackage.savings_requirement?.required_savings_amount || 0).toLocaleString()} ETB •
                        Documents: {reviewPackage.savings_requirement?.document_count || 0}
                      </p>
                    </div>
                  </div>

                  <h3 style={{ marginTop: '1rem' }}>Application Documents</h3>
                  <div className="documents-list">
                    {(reviewPackage.documents || []).length === 0 ? (
                      <p style={{ color: '#6b7280' }}>No documents attached.</p>
                    ) : reviewPackage.documents.map((doc) => (
                      <div className="document-item" key={doc.id}>
                        <FileText size={20} />
                        <div>
                          <p className="document-name">{doc.type || 'Document'}</p>
                          <p className="document-meta">{doc.file_name}</p>
                        </div>
                        <button className="btn-sm secondary" type="button" onClick={() => handleDownloadDocument(doc)}>
                          Download
                        </button>
                      </div>
                    ))}
                  </div>

                  <h3 style={{ marginTop: '1.5rem' }}>Transaction Receipts</h3>
                  <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>Loan account transactions</p>
                  <div className="table-container" style={{ marginTop: '0.5rem' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Amount</th>
                          <th>Reference</th>
                          <th>Receipt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(reviewPackage.transactions?.loan || []).length === 0 ? (
                          <tr><td colSpan={5}>No loan transactions yet.</td></tr>
                        ) : reviewPackage.transactions.loan.map((txn) => (
                          <tr key={txn.id}>
                            <td>{formatDateTime(txn.created_at)}</td>
                            <td>{txn.transaction_type}</td>
                            <td>{Number(txn.amount || 0).toLocaleString()} ETB</td>
                            <td>{txn.transaction_reference || '—'}</td>
                            <td>
                              <button type="button" className="btn-sm secondary" onClick={() => handleDownloadTransactionReceipt(txn.id)}>
                                <Download size={14} /> PDF
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '1rem' }}>Linked savings account transactions</p>
                  <div className="table-container" style={{ marginTop: '0.5rem' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Amount</th>
                          <th>Receipt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(reviewPackage.transactions?.savings || []).length === 0 ? (
                          <tr><td colSpan={4}>No savings transactions.</td></tr>
                        ) : reviewPackage.transactions.savings.map((txn) => (
                          <tr key={txn.id}>
                            <td>{formatDateTime(txn.created_at)}</td>
                            <td>{txn.transaction_type}</td>
                            <td>{Number(txn.amount || 0).toLocaleString()} ETB</td>
                            <td>
                              <button type="button" className="btn-sm secondary" onClick={() => handleDownloadTransactionReceipt(txn.id)}>
                                <Download size={14} /> PDF
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {reviewPackage.penalty_schedule && (
                    <div className="info-card" style={{ marginTop: '1.5rem' }}>
                      <AlertTriangle size={18} />
                      <span>{reviewPackage.penalty_schedule.description}</span>
                    </div>
                  )}

                  {(reviewPackage.payment_schedule || []).length > 0 && (
                    <>
                      <h3 style={{ marginTop: '1.5rem' }}>Payment & Penalty Schedule</h3>
                      <div className="table-container">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Due</th>
                              <th>Total</th>
                              <th>Penalty</th>
                              <th>Paid</th>
                              <th>Remaining</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reviewPackage.payment_schedule.map((row) => {
                              const remaining = getInstallmentRemainingFromRow(row);
                              return (
                                <tr key={row.id}>
                                  <td>{formatDateOnly(row.due_date)}</td>
                                  <td>{formatScheduleAmount(row.total_amount)}</td>
                                  <td>{Number(row.penalty_amount || 0) > 0 ? formatScheduleAmount(row.penalty_amount) : '—'}</td>
                                  <td>{Number(row.paid_amount || 0) > 0 ? formatScheduleAmount(row.paid_amount) : '—'}</td>
                                  <td>{remaining > 0 ? formatScheduleAmount(remaining) : '—'}</td>
                                  <td>
                                    <span className={`status ${row.status === 'Partial' ? 'partial' : row.is_overdue ? 'high' : row.status === 'Paid' ? 'active' : 'pending'}`}>
                                      {row.status === 'Partial' && remaining > 0
                                        ? `Partial (${formatScheduleAmount(remaining)} due)`
                                        : row.status}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p style={{ color: '#6b7280' }}>No review data available.</p>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowReviewModal(false)}>Close</button>
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
                  {documentsLoading ? (
                    <div style={{ padding: '1rem', color: '#6b7280' }}>Loading documents...</div>
                  ) : loanDocuments.length === 0 ? (
                    <div style={{ padding: '1rem', color: '#6b7280' }}>No documents attached yet.</div>
                  ) : loanDocuments.map((doc) => (
                    <div className="document-item" key={doc.id}>
                      <FileText size={20} />
                      <div>
                        <p className="document-name">{doc.type || 'Document'}</p>
                        <p className="document-meta">{doc.file_name} • Uploaded {formatDateTime(doc.uploaded_at)}</p>
                      </div>
                      <button className="btn-sm secondary" onClick={() => handleDownloadDocument(doc)}>
                        Download
                      </button>
                    </div>
                  ))}
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
