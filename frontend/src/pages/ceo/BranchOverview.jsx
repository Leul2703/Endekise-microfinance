import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle,
  DollarSign,
  Eye,
  Filter,
  Landmark,
  MapPin,
  RefreshCw,
  Search,
  Wallet,
  XCircle
} from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const formatCurrency = (value) => `${Number(value || 0).toLocaleString()} ETB`;

const BranchOverview = () => {
  const { error, success, warning } = useToast();
  const [branches, setBranches] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [branchDetails, setBranchDetails] = useState(null);
  const [approvalDecision, setApprovalDecision] = useState('');
  const [approvalJustification, setApprovalJustification] = useState('');
  const [performanceFilter, setPerformanceFilter] = useState('all');
  const [escalatedRequests, setEscalatedRequests] = useState([]);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showBranchDetailsModal, setShowBranchDetailsModal] = useState(false);
  const [showRequestDetailsModal, setShowRequestDetailsModal] = useState(false);
  const [showCreditLimitModal, setShowCreditLimitModal] = useState(false);
  const [creditLimitValue, setCreditLimitValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchBranches = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    try {
      const data = await api.getBranches();
      setBranches(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching branches:', err);
      const errorMessage = err.message || 'Failed to load branches';
      if (!showRefresh) {
        if (errorMessage.includes('Database error')) {
          error('Unable to connect to the database. Please check your connection.');
        } else {
          error(errorMessage);
        }
      }
      setBranches([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [error]);

  const fetchApprovals = useCallback(async (showRefresh = false) => {
    try {
      const data = await api.getCEOPendingApprovals();
      setEscalatedRequests((Array.isArray(data) ? data : []).map((request) => ({
        id: request.id,
        branch: request.requester?.name || 'Branch Manager',
        type: 'Branch High-Value Loan Request',
        amount: formatCurrency(request.loan?.amount),
        client: request.loan?.client_name || 'Unknown Client',
        submitted: request.created_at,
        status: 'Pending CEO Review',
        loan: request.loan,
        requester: request.requester
      })));
    } catch (err) {
      console.error('Error fetching CEO approvals:', err);
      if (!showRefresh) {
        error('Failed to load pending approvals');
      }
      setEscalatedRequests([]);
    }
  }, [error]);

  const handleRefresh = () => {
    fetchBranches(true);
    fetchApprovals(true);
  };

  useEffect(() => {
    fetchBranches();
    fetchApprovals();
  }, [fetchBranches, fetchApprovals]);

  const filteredBranches = useMemo(() => (
    branches.filter((branch) => {
      const matchesSearch =
        branch.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        branch.location?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        branch.manager_name?.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) {
        return false;
      }

      if (performanceFilter === 'all') {
        return true;
      }

      const deposits = Number(branch.total_deposits || 0);
      const credit = Number(branch.total_credit || 0);
      const ratio = credit === 0 ? Infinity : deposits / credit;

      if (performanceFilter === 'Excellent') {
        return ratio >= 1.3;
      }
      if (performanceFilter === 'Good') {
        return ratio >= 1 && ratio < 1.3;
      }
      return ratio < 1;
    })
  ), [branches, performanceFilter, searchTerm]);

  const openReviewModal = (request) => {
    setSelectedRequest(request);
    setApprovalDecision('');
    setApprovalJustification('');
    setShowApproveModal(true);
  };

  const handleApprove = async () => {
    if (!approvalJustification.trim()) {
      warning('Approval justification is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.approveEscalatedRequest(selectedRequest.id, approvalJustification);
      setEscalatedRequests((current) => current.filter((request) => request.id !== selectedRequest.id));
      setShowApproveModal(false);
      setSelectedRequest(null);
      setApprovalDecision('');
      setApprovalJustification('');
      await fetchBranches();
      success('Branch request approved successfully.');
    } catch (err) {
      console.error('Error approving CEO request:', err);
      if (err.message?.includes('Database error')) {
        error('A database error occurred. Please try again.');
      } else {
        error(err.message || 'Failed to approve request. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!approvalJustification.trim()) {
      warning('Rejection justification is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.rejectEscalatedRequest(selectedRequest.id, approvalJustification);
      setEscalatedRequests((current) => current.filter((request) => request.id !== selectedRequest.id));
      setShowApproveModal(false);
      setSelectedRequest(null);
      setApprovalDecision('');
      setApprovalJustification('');
      success('Branch request rejected successfully.');
    } catch (err) {
      console.error('Error rejecting CEO request:', err);
      if (err.message?.includes('Database error')) {
        error('A database error occurred. Please try again.');
      } else {
        error(err.message || 'Failed to reject request. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewBranchDetails = async (branch) => {
    setSelectedBranch(branch);
    setShowBranchDetailsModal(true);
    setBranchDetails(null);

    try {
      const data = await api.getBranchDetails(branch.id);
      setBranchDetails(data);
    } catch (err) {
      console.error('Error fetching branch details:', err);
      error('Failed to fetch branch details. Please try again.');
      setShowBranchDetailsModal(false);
    }
  };

  const openCreditLimitModal = (branch) => {
    setSelectedBranch(branch);
    setCreditLimitValue(String(Number(branch.credit_limit || 0)));
    setShowCreditLimitModal(true);
  };

  const handleSetCreditLimit = async () => {
    if (!selectedBranch) {
      return;
    }

    if (!creditLimitValue || Number(creditLimitValue) < 0) {
      warning('Please enter a valid credit limit amount.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.setBranchCreditLimit(selectedBranch.id, Number(creditLimitValue));
      setShowCreditLimitModal(false);
      await fetchBranches();
      if (showBranchDetailsModal) {
        const refreshed = await api.getBranchDetails(selectedBranch.id);
        setBranchDetails(refreshed);
      }
      success('Branch credit limit updated successfully.');
    } catch (err) {
      console.error('Error setting branch credit limit:', err);
      if (err.message?.includes('Database error')) {
        error('A database error occurred. Please try again.');
      } else {
        error(err.message || 'Failed to set branch credit limit. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Branch Overview</h1>
        <p>Review branch requests, branch deposits and credit exposure, and manage branch credit limits.</p>
      </div>

      <div className="page-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search branches..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={performanceFilter} onChange={(event) => setPerformanceFilter(event.target.value)}>
            <option value="all">All Performance</option>
            <option value="Excellent">Excellent</option>
            <option value="Good">Good</option>
            <option value="Average">Average</option>
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
      </div>

      {loading ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <RefreshCw size={48} className="spinning" style={{ color: '#3b82f6', marginBottom: '1rem' }} />
            <p style={{ color: '#6b7280' }}>Loading branch data...</p>
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
      <>

      {escalatedRequests.length > 0 && (
        <div className="info-card" style={{ marginBottom: '1.5rem', background: '#fef3c7', borderColor: '#fcd34d' }}>
          <AlertTriangle size={24} style={{ color: '#92400e' }} />
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 0.25rem 0', color: '#92400e' }}>Pending Branch Requests</h3>
            <p style={{ margin: 0, color: '#92400e' }}>
              {escalatedRequests.length} branch request{escalatedRequests.length === 1 ? '' : 's'} waiting for CEO approval.
            </p>
          </div>
        </div>
      )}

      <div className="table-container">
        <div className="table-header">
          <h2>Approve / Reject Branch Requests</h2>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Request ID</th>
              <th>Source</th>
              <th>Type</th>
              <th>Client</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {escalatedRequests.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }}>No CEO branch requests are pending right now.</td>
              </tr>
            ) : escalatedRequests.map((request) => (
              <tr key={request.id}>
                <td>{request.id}</td>
                <td>{request.branch}</td>
                <td>{request.type}</td>
                <td>{request.client}</td>
                <td>{request.amount}</td>
                <td><span className="status pending">{request.status}</span></td>
                <td>
                  <button className="btn-icon edit" title="View Request" onClick={() => {
                    setSelectedRequest(request);
                    setShowRequestDetailsModal(true);
                  }}>
                    <Eye size={18} />
                  </button>
                  <button className="btn-icon edit" title="Review Request" onClick={() => openReviewModal(request)}>
                    <CheckCircle size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-container" style={{ marginTop: '2rem' }}>
        <div className="table-header">
          <h2>Branch Deposit / Credit Position</h2>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Branch</th>
              <th>Location</th>
              <th>Manager</th>
              <th>Total Deposits</th>
              <th>Total Credit</th>
              <th>Credit Limit</th>
              <th>Clients</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredBranches.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', padding: '2rem' }}>No branches matched your search.</td>
              </tr>
            ) : filteredBranches.map((branch) => (
              <tr key={branch.id}>
                <td>{branch.name}</td>
                <td>
                  <span className="location-badge">
                    <MapPin size={14} />
                    {branch.location}
                  </span>
                </td>
                <td>{branch.manager_name || 'Not assigned'}</td>
                <td>{formatCurrency(branch.total_deposits)}</td>
                <td>{formatCurrency(branch.total_credit)}</td>
                <td>{formatCurrency(branch.credit_limit)}</td>
                <td>{branch.client_count || 0}</td>
                <td>
                  <button className="btn-icon edit" title="View Branch" onClick={() => handleViewBranchDetails(branch)}>
                    <Eye size={18} />
                  </button>
                  <button className="btn-icon edit" title="Set Credit Limit" onClick={() => openCreditLimitModal(branch)}>
                    <Landmark size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showApproveModal && selectedRequest && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Review Branch Request</h2>
              <button onClick={() => setShowApproveModal(false)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <p><strong>Request ID:</strong> {selectedRequest.id}</p>
              <p><strong>Client:</strong> {selectedRequest.client}</p>
              <p><strong>Amount:</strong> {selectedRequest.amount}</p>
              <div className="form-group">
                <label>Decision</label>
                <select value={approvalDecision} onChange={(event) => setApprovalDecision(event.target.value)}>
                  <option value="">Select decision...</option>
                  <option value="approve">Approve</option>
                  <option value="reject">Reject</option>
                </select>
              </div>
              <div className="form-group">
                <label>Justification</label>
                <textarea
                  rows={4}
                  value={approvalJustification}
                  onChange={(event) => setApprovalJustification(event.target.value)}
                  placeholder="Enter the approval or rejection justification"
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowApproveModal(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                {approvalDecision === 'reject' ? (
                  <button className="btn-primary delete" onClick={handleReject} disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <RefreshCw size={18} className="spinning" />
                        Rejecting...
                      </>
                    ) : (
                      <>
                        <XCircle size={18} />
                        Reject Request
                      </>
                    )}
                  </button>
                ) : (
                  <button className="btn-primary" onClick={handleApprove} disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <RefreshCw size={18} className="spinning" />
                        Approving...
                      </>
                    ) : (
                      <>
                        <CheckCircle size={18} />
                        Approve Request
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showBranchDetailsModal && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <div className="modal-header">
              <h2>Branch Deposit and Credit Details</h2>
              <button onClick={() => setShowBranchDetailsModal(false)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              {!branchDetails ? (
                <p>Loading branch details...</p>
              ) : (
                <>
                  <div className="info-card" style={{ marginBottom: '1rem' }}>
                    <Building2 size={24} />
                    <div>
                      <h3 style={{ margin: '0 0 0.25rem 0' }}>{branchDetails.name}</h3>
                      <p style={{ margin: 0 }}>{branchDetails.location}</p>
                    </div>
                  </div>

                  <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
                    <div className="stat-card">
                      <Wallet size={20} />
                      <h3>{formatCurrency(branchDetails.statistics.branch_total_deposits)}</h3>
                      <p>Branch Deposits</p>
                    </div>
                    <div className="stat-card">
                      <DollarSign size={20} />
                      <h3>{formatCurrency(branchDetails.statistics.branch_total_credit)}</h3>
                      <p>Outstanding Credit</p>
                    </div>
                    <div className="stat-card">
                      <Landmark size={20} />
                      <h3>{formatCurrency(branchDetails.credit_limit)}</h3>
                      <p>Credit Limit</p>
                    </div>
                    <div className="stat-card">
                      <BarChart3 size={20} />
                      <h3>{formatCurrency(branchDetails.statistics.available_credit_capacity)}</h3>
                      <p>Available Capacity</p>
                    </div>
                  </div>

                  <div className="modal-actions" style={{ justifyContent: 'flex-start', marginBottom: '1rem' }}>
                    <button className="btn-primary" onClick={() => openCreditLimitModal(branchDetails)}>
                      <Landmark size={18} />
                      Set Credit Limit
                    </button>
                  </div>

                  <div className="table-container">
                    <h3 style={{ marginBottom: '1rem' }}>Recent Active Credit Accounts</h3>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Loan ID</th>
                          <th>Client ID</th>
                          <th>Amount</th>
                          <th>Balance</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(branchDetails.loans || []).slice(0, 5).map((loan) => (
                          <tr key={loan.id}>
                            <td>{loan.id}</td>
                            <td>{loan.client_id}</td>
                            <td>{formatCurrency(loan.amount)}</td>
                            <td>{formatCurrency(loan.balance)}</td>
                            <td><span className="status active">{loan.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showRequestDetailsModal && selectedRequest && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Branch Request Details</h2>
              <button onClick={() => setShowRequestDetailsModal(false)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Request ID</label>
                <p>{selectedRequest.id}</p>
              </div>
              <div className="form-group">
                <label>Source</label>
                <p>{selectedRequest.branch}</p>
              </div>
              <div className="form-group">
                <label>Client</label>
                <p>{selectedRequest.client}</p>
              </div>
              <div className="form-group">
                <label>Amount</label>
                <p>{selectedRequest.amount}</p>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowRequestDetailsModal(false)}>Close</button>
                <button className="btn-primary" onClick={() => {
                  setShowRequestDetailsModal(false);
                  openReviewModal(selectedRequest);
                }}>
                  <CheckCircle size={18} />
                  Review Request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreditLimitModal && selectedBranch && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Set Branch Credit Limit</h2>
              <button onClick={() => setShowCreditLimitModal(false)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <p><strong>Branch:</strong> {selectedBranch.name}</p>
              <p><strong>Current Credit Limit:</strong> {formatCurrency(selectedBranch.credit_limit)}</p>
              <div className="form-group">
                <label>New Credit Limit (ETB)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={creditLimitValue}
                  onChange={(event) => setCreditLimitValue(event.target.value)}
                  placeholder="Enter new branch credit limit"
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowCreditLimitModal(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleSetCreditLimit} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={18} className="spinning" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Landmark size={18} />
                      Save Credit Limit
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
};

export default BranchOverview;
