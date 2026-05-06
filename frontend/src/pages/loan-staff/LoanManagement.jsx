import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Search, Filter, Edit, Calendar, DollarSign, FileText, RefreshCw, AlertTriangle } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { io } from 'socket.io-client';

const LoanManagement = () => {
  const { success, error, warning } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showStatementModal, setShowStatementModal] = useState(false);
  const [showNewLoanModal, setShowNewLoanModal] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [statementDateRange, setStatementDateRange] = useState({ from: '', to: '' });
  const [editData, setEditData] = useState({});
  const [newLoanData, setNewLoanData] = useState({
    clientId: '',
    clientName: '',
    savingsAccountId: '',
    amount: '',
    type: 'Business Loan',
    term: '12',
    interestRate: '12',
    paymentFrequency: 'Monthly',
    originationDate: new Date().toISOString().split('T')[0],
    purpose: '',
    guarantors: []
  });
  const [newGuarantor, setNewGuarantor] = useState({ id: '', amount: '' });
  const [newClientData, setNewClientData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    gender: '',
    id_number: '',
    income_source: '',
    initialBalance: ''
  });
  const [loans, setLoans] = useState([]);
  const [savingsAccounts, setSavingsAccounts] = useState([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentSchedule, setPaymentSchedule] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');

  const fetchLoans = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setFetchError(null);
    try {
      const data = await api.getLoans();
      setLoans(data || []);
    } catch (err) {
      console.error('Error fetching loans:', err);
      setFetchError(err.message || 'Failed to load loans');
      setLoans([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchLoans();
  }, []);

  useEffect(() => {
    const socket = io('http://localhost:5000', { transports: ['websocket', 'polling'] });
    const onLoanUpdated = () => {
      fetchLoans();
    };
    socket.on('loanUpdated', onLoanUpdated);
    return () => {
      socket.off('loanUpdated', onLoanUpdated);
      socket.close();
    };
  }, [fetchLoans]);

  useEffect(() => {
    if (showNewLoanModal) {
      fetchSavingsAccounts();
    }
  }, [showNewLoanModal]);

  useEffect(() => {
    if (showNewLoanModal) {
      const timer = setTimeout(() => {
        fetchSavingsAccounts(accountSearch);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [accountSearch, showNewLoanModal]);

  const fetchSavingsAccounts = useCallback(async (search = '') => {
    try {
      const data = await api.getSavingsAccounts(search);
      setSavingsAccounts(data || []);
    } catch (err) {
      console.error('Error fetching savings accounts:', err);
      setSavingsAccounts([]);
    }
  }, []);


  const handleRefresh = () => {
    fetchLoans(true);
  };

  const filteredLoans = loans.filter(loan => {
    const matchesSearch = (loan.client?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
                         (loan.id?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === 'all' || loan.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const handleViewDetails = (loan) => {
    setSelectedLoan(loan);
    setShowDetailsModal(true);
  };

  const handleEdit = (loan) => {
    setSelectedLoan(loan);
    setEditData({
      amount: loan.amount,
      balance: loan.balance,
      nextPayment: loan.nextPayment,
      dueDate: loan.dueDate
    });
    setShowEditModal(true);
  };

  const handleViewSchedule = async (loan) => {
    setSelectedLoan(loan);
    setScheduleLoading(true);
    setScheduleError('');
    setPaymentSchedule([]);
    try {
      const data = await api.getPaymentSchedule(loan.id);
      setPaymentSchedule(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading payment schedule:', err);
      setScheduleError(err.message || 'Failed to load payment schedule');
    } finally {
      setScheduleLoading(false);
    }
    setShowScheduleModal(true);
  };

  const handleRecordPayment = (loan) => {
    setSelectedLoan(loan);
    setPaymentAmount('');
    setShowPaymentModal(true);
  };

  const handleRequestStatement = (loan) => {
    setSelectedLoan(loan);
    setStatementDateRange({ from: '', to: '' });
    setShowStatementModal(true);
  };

  const confirmPayment = async () => {
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      warning('Please enter a valid payment amount');
      return;
    }
    try {
      await api.recordPayment(selectedLoan.id, paymentAmount);
      setShowPaymentModal(false);
      setPaymentAmount('');
      fetchLoans();
      success('Payment recorded successfully');
    } catch (err) {
      console.error('Error recording payment:', err);
      error(err.message || 'Failed to record payment');
    }
  };

  const confirmRequestStatement = async () => {
    if (!selectedLoan?.id) {
      warning('Select a loan first.');
      return;
    }

    try {
      await api.requestLoanStatement({
        account_id: selectedLoan.id,
        date_from: statementDateRange.from || undefined,
        date_to: statementDateRange.to || undefined
      });
      setShowStatementModal(false);
      success('Statement request submitted to Branch Manager approval queue.');
    } catch (err) {
      console.error('Error requesting statement:', err);
      error(err.message || 'Failed to request statement');
    }
  };

  const saveEdit = async () => {
    try {
      await api.updateLoan(selectedLoan.id, {
        amount: editData.amount,
        originationDate: editData.dueDate,
        status: selectedLoan.status
      });
      setShowEditModal(false);
      fetchLoans();
      success('Loan updated successfully');
    } catch (err) {
      console.error('Error updating loan:', err);
      error(err.message || 'Failed to update loan');
    }
  };

  const handleNewLoan = async () => {
    if (!newLoanData.clientId || !newLoanData.savingsAccountId || !newLoanData.amount) {
      warning('Please select a savings account and enter loan amount');
      return;
    }
    try {
      await api.createLoan({
        client_id: newLoanData.clientId,
        savings_account_id: newLoanData.savingsAccountId,
        clientName: newLoanData.clientName,
        type: newLoanData.type,
        amount: newLoanData.amount,
        term: newLoanData.term,
        interestRate: newLoanData.interestRate,
        paymentFrequency: newLoanData.paymentFrequency,
        originationDate: newLoanData.originationDate,
        purpose: newLoanData.purpose,
        guarantors: newLoanData.guarantors
      });
      setShowNewLoanModal(false);
      setNewLoanData({
        clientId: '',
        clientName: '',
        savingsAccountId: '',
        amount: '',
        type: 'Business Loan',
        term: '12',
        interestRate: '12',
        paymentFrequency: 'Monthly',
        originationDate: new Date().toISOString().split('T')[0],
        purpose: '',
        guarantors: []
      });
      setNewGuarantor({ id: '', amount: '' });
      setNewClientData({
        name: '',
        email: '',
        phone: '',
        address: '',
        gender: '',
        id_number: '',
        income_source: '',
        initialBalance: ''
      });
      setAccountSearch('');
      fetchLoans();
      success(parseFloat(newLoanData.amount) > 100000
        ? 'High-value loan submitted for Branch Manager and CEO approval.'
        : 'Loan submitted for Branch Manager approval.');
    } catch (err) {
      console.error('Error creating loan:', err);
      error(err.message || 'Failed to submit loan application');
    }
  };

  const handleRegisterSavingsClient = async () => {
    if (
      !newClientData.name ||
      !newClientData.phone ||
      !newClientData.address ||
      !newClientData.id_number ||
      !newClientData.income_source ||
      !newClientData.initialBalance ||
      parseFloat(newClientData.initialBalance) <= 0
    ) {
      warning('Name, phone, address, ID number, income source, and opening balance are required for compliant account setup');
      return;
    }

    try {
      setCreatingClient(true);
      const clientResult = await api.registerClient({
        name: newClientData.name,
        email: newClientData.email,
        phone: newClientData.phone,
        address: newClientData.address,
        gender: newClientData.gender,
        id_number: newClientData.id_number,
        income_source: newClientData.income_source
      });

      const accountResult = await api.createClientSavingsAccount(clientResult.client.id, {
        initial_balance: parseFloat(newClientData.initialBalance),
        type: 'Regular Savings'
      });

      const refreshedAccounts = await api.getSavingsAccounts(newClientData.name);
      setSavingsAccounts(refreshedAccounts);
      setAccountSearch(newClientData.name);

      const selected = refreshedAccounts.find((account) => {
        const accountClientId = String(account.client_id || account.clientId || '');
        const normalizedStatus = String(account.status || '').toLowerCase();
        return accountClientId === String(clientResult.client.id) && normalizedStatus === 'active';
      }) || refreshedAccounts[0];

      if (selected && String(selected.status || '').toLowerCase() === 'active') {
        setNewLoanData((current) => ({
          ...current,
          savingsAccountId: selected.savings_account_id || selected.account_id || selected.accountId,
          clientId: selected.client_id || selected.clientId,
          clientName: selected.client_name || selected.clientName
        }));
      }

      setNewClientData({
        name: '',
        email: '',
        phone: '',
        address: '',
        gender: '',
        id_number: '',
        income_source: '',
        initialBalance: ''
      });

      if (accountResult?.requires_approval) {
        success(`Client registered. Savings account is pending checker approval (${accountResult.approval_request_id}) before loan creation can continue.`);
      } else {
        success('Savings client registered and returned to loan creation');
      }
    } catch (err) {
      console.error('Error registering savings client:', err);
      error(err.message || 'Failed to register savings client');
    } finally {
      setCreatingClient(false);
    }
  };

  const formatCurrency = (value) => `${parseFloat(value || 0).toLocaleString()} ETB`;
  const getLoanClientName = (loan) => loan.client || loan.client_name || '-';
  const getLoanDueDate = (loan) => loan.dueDate || loan.disbursement_date || '-';
  const getLoanNextPayment = (loan) => loan.nextPayment || loan.monthly_payment || '-';

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Loan Management</h1>
        <p>Manage and monitor all loan accounts</p>
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
            <option value="Active">Active</option>
            <option value="Pending">Pending</option>
            <option value="Completed">Completed</option>
            <option value="Defaulted">Defaulted</option>
          </select>
        </div>

        <button className="btn-primary" onClick={() => setShowNewLoanModal(true)}>
          <Plus size={20} />
          New Loan Application
        </button>
      </div>

      {loading ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <RefreshCw size={48} className="spinning" style={{ color: '#3b82f6', marginBottom: '1rem' }} />
            <p style={{ color: '#6b7280' }}>Loading loans...</p>
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
                <th>Loan ID</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Balance</th>
                <th>Next Payment</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLoans.map((loan) => (
                <tr key={loan.id}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <strong>{loan.id}</strong>
                      <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>{getLoanClientName(loan)}</span>
                    </div>
                  </td>
                  <td>{loan.type}</td>
                      <td>{formatCurrency(loan.amount)}</td>
                      <td>{formatCurrency(loan.balance)}</td>
                  <td>{getLoanNextPayment(loan)}</td>
                  <td>{getLoanDueDate(loan)}</td>
                  <td>
                    <span className={`status ${loan.status === 'Active' ? 'active' : loan.status === 'Pending' ? 'pending' : 'inactive'}`}>
                      {loan.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn-icon edit" title="View Details" onClick={() => handleViewDetails(loan)}>
                      <FileText size={18} />
                    </button>
                    <button className="btn-icon edit" title="Edit" onClick={() => handleEdit(loan)}>
                      <Edit size={18} />
                    </button>
                    <button className="btn-icon edit" title="Payment Schedule" onClick={() => handleViewSchedule(loan)}>
                      <Calendar size={18} />
                    </button>
                    <button className="btn-icon edit" title="Record Payment" onClick={() => handleRecordPayment(loan)}>
                      <DollarSign size={18} />
                    </button>
                    <button className="btn-icon edit" title="Request Statement" onClick={() => handleRequestStatement(loan)}>
                      <FileText size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                <p>{getLoanClientName(selectedLoan || {})}</p>
              </div>
              <div className="form-group">
                <label>Type</label>
                <p>{selectedLoan?.type}</p>
              </div>
              <div className="form-group">
                <label>Amount</label>
                <p>{selectedLoan?.amount}</p>
              </div>
              <div className="form-group">
                <label>Balance</label>
                <p>{selectedLoan?.balance}</p>
              </div>
              <div className="form-group">
                <label>Next Payment</label>
                <p>{getLoanNextPayment(selectedLoan || {})}</p>
              </div>
              <div className="form-group">
                <label>Due Date</label>
                <p>{getLoanDueDate(selectedLoan || {})}</p>
              </div>
              <div className="form-group">
                <label>Status</label>
                <span className={`status ${selectedLoan?.status === 'Active' ? 'active' : selectedLoan?.status === 'Pending' ? 'pending' : 'inactive'}`}>
                  {selectedLoan?.status}
                </span>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowDetailsModal(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Edit Loan</h2>
              <button onClick={() => setShowEditModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Loan ID</label>
                <p>{selectedLoan?.id}</p>
              </div>
              <div className="form-group">
                <label>Client</label>
                <p>{getLoanClientName(selectedLoan || {})}</p>
              </div>
              <div className="form-group">
                <label>Amount</label>
                <input
                  type="text"
                  value={editData.amount}
                  onChange={(e) => setEditData({ ...editData, amount: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Balance</label>
                <input
                  type="text"
                  value={editData.balance}
                  onChange={(e) => setEditData({ ...editData, balance: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Next Payment</label>
                <input
                  type="text"
                  value={editData.nextPayment}
                  onChange={(e) => setEditData({ ...editData, nextPayment: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Due Date</label>
                <input
                  type="date"
                  value={editData.dueDate}
                  onChange={(e) => setEditData({ ...editData, dueDate: e.target.value })}
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={saveEdit}>
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showScheduleModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '900px' }}>
            <div className="modal-header">
              <h2>Payment Schedule</h2>
              <button onClick={() => setShowScheduleModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan?.id}</p>
              <p><strong>Client:</strong> {getLoanClientName(selectedLoan || {})}</p>
              <p><strong>Total Amount:</strong> {selectedLoan?.amount}</p>
              {scheduleLoading ? (
                <p style={{ textAlign: 'center', padding: '1.5rem' }}>Loading payment schedule...</p>
              ) : scheduleError ? (
                <p style={{ color: '#ef4444', padding: '1rem 0' }}>{scheduleError}</p>
              ) : paymentSchedule.length === 0 ? (
                <p style={{ color: '#6b7280', padding: '1rem 0' }}>
                  No generated payment schedule found yet for this loan.
                </p>
              ) : (
                <div className="table-container" style={{ marginTop: '1rem' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Due Date</th>
                        <th>Principal</th>
                        <th>Interest</th>
                        <th>Total</th>
                        <th>Balance Remaining</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentSchedule.map((item, idx) => (
                        <tr key={item.id || `${item.loan_id}-${idx}`}>
                          <td>{idx + 1}</td>
                          <td>{item.due_date}</td>
                          <td>{Number(item.principal_amount || 0).toLocaleString()} ETB</td>
                          <td>{Number(item.interest_amount || 0).toLocaleString()} ETB</td>
                          <td>{Number(item.total_amount || 0).toLocaleString()} ETB</td>
                          <td>{Number(item.balance_remaining || 0).toLocaleString()} ETB</td>
                          <td>
                            <span className={`status ${item.status === 'Paid' ? 'active' : item.status === 'Overdue' ? 'high' : 'pending'}`}>
                              {item.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowScheduleModal(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Record Payment</h2>
              <button onClick={() => setShowPaymentModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan?.id}</p>
              <p><strong>Client:</strong> {getLoanClientName(selectedLoan || {})}</p>
              <p><strong>Current Balance:</strong> {selectedLoan?.balance}</p>
              <p><strong>Next Payment Due:</strong> {getLoanNextPayment(selectedLoan || {})}</p>
              <div className="form-group">
                <label>Payment Amount (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="Enter payment amount"
                  min="0"
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowPaymentModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={confirmPayment}>
                  <DollarSign size={18} />
                  Record Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showStatementModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Request Loan Statement</h2>
              <button onClick={() => setShowStatementModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Loan ID:</strong> {selectedLoan?.id}</p>
              <p><strong>Client:</strong> {getLoanClientName(selectedLoan || {})}</p>
              <div className="form-group">
                <label>From Date (Optional)</label>
                <input
                  type="date"
                  value={statementDateRange.from}
                  onChange={(e) => setStatementDateRange((current) => ({ ...current, from: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>To Date (Optional)</label>
                <input
                  type="date"
                  value={statementDateRange.to}
                  onChange={(e) => setStatementDateRange((current) => ({ ...current, to: e.target.value }))}
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowStatementModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={confirmRequestStatement}>
                  <FileText size={18} />
                  Submit Request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNewLoanModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>New Loan Application</h2>
              <button onClick={() => setShowNewLoanModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Search Savings Account <span className="required">*</span></label>
                <input
                  type="text"
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  placeholder="Search by account number, client name, or phone"
                />
              </div>
              {savingsAccounts.length > 0 && (
                <div className="form-group">
                  <label>Select Savings Account <span className="required">*</span></label>
                  <select
                    value={newLoanData.savingsAccountId}
                    onChange={(e) => {
                      const selected = savingsAccounts.find(acc => acc.account_id === e.target.value);
                      setNewLoanData({
                        ...newLoanData,
                        savingsAccountId: selected?.savings_account_id || e.target.value,
                        clientId: selected?.client_id || '',
                        clientName: selected?.client_name || ''
                      });
                    }}
                  >
                    <option value="">-- Select an account --</option>
                    {savingsAccounts.map((account) => (
                      <option key={account.account_id} value={account.account_id}>
                        {account.account_id} - {account.client_name} (Balance: {parseInt(account.balance || 0, 10).toLocaleString()} ETB)
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {savingsAccounts.length === 0 && accountSearch.trim() && (
                <div className="info-card" style={{ marginBottom: '1rem', background: '#fefce8', borderColor: '#fde68a' }}>
                  <div style={{ width: '100%' }}>
                    <strong>No savings client found.</strong>
                    <p style={{ margin: '0.5rem 0 1rem 0' }}>Register a new savings client, then continue the loan application here.</p>
                    <div className="form-group">
                      <label>Client Name <span className="required">*</span></label>
                      <input
                        type="text"
                        value={newClientData.name}
                        onChange={(e) => setNewClientData({ ...newClientData, name: e.target.value })}
                        placeholder="Enter client full name"
                      />
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input
                        type="email"
                        value={newClientData.email}
                        onChange={(e) => setNewClientData({ ...newClientData, email: e.target.value })}
                        placeholder="Enter client email"
                      />
                    </div>
                    <div className="form-group">
                      <label>Phone</label>
                      <input
                        type="text"
                        value={newClientData.phone}
                        onChange={(e) => setNewClientData({ ...newClientData, phone: e.target.value })}
                        placeholder="Enter phone number"
                      />
                    </div>
                    <div className="form-group">
                      <label>Address <span className="required">*</span></label>
                      <input
                        type="text"
                        value={newClientData.address}
                        onChange={(e) => setNewClientData({ ...newClientData, address: e.target.value })}
                        placeholder="Enter verified address"
                      />
                    </div>
                    <div className="form-group">
                      <label>National ID / Kebele ID <span className="required">*</span></label>
                      <input
                        type="text"
                        value={newClientData.id_number}
                        onChange={(e) => setNewClientData({ ...newClientData, id_number: e.target.value })}
                        placeholder="Enter verified ID number"
                      />
                    </div>
                    <div className="form-group">
                      <label>Income Source <span className="required">*</span></label>
                      <select
                        value={newClientData.income_source}
                        onChange={(e) => setNewClientData({ ...newClientData, income_source: e.target.value })}
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
                      <label>Opening Savings Balance (ETB) <span className="required">*</span></label>
                      <input
                        type="number"
                        min="1"
                        value={newClientData.initialBalance}
                        onChange={(e) => setNewClientData({ ...newClientData, initialBalance: e.target.value })}
                        placeholder="Enter opening savings balance"
                      />
                    </div>
                    <p style={{ margin: '0 0 1rem 0', color: '#92400e', fontSize: '0.9rem' }}>
                      Savings accounts created here may wait in the approval queue before the loan application can continue.
                    </p>
                    <button className="btn-secondary" onClick={handleRegisterSavingsClient} disabled={creatingClient}>
                      {creatingClient ? 'Registering...' : 'Register New Savings Client'}
                    </button>
                  </div>
                </div>
              )}
              {newLoanData.clientName && (
                <div className="info-card" style={{ marginBottom: '1rem', background: '#eff6ff', borderColor: '#bfdbfe' }}>
                  <div>
                    <strong>Selected Client:</strong> {newLoanData.clientName}<br />
                    <strong>Account:</strong> {newLoanData.savingsAccountId}
                  </div>
                </div>
              )}
              <div className="form-group">
                <label>Loan Type</label>
                <select
                  value={newLoanData.type}
                  onChange={(e) => setNewLoanData({ ...newLoanData, type: e.target.value })}
                >
                  <option value="Business Loan">Business Loan</option>
                  <option value="Personal Loan">Personal Loan</option>
                  <option value="Agricultural Loan">Agricultural Loan</option>
                  <option value="Education Loan">Education Loan</option>
                </select>
              </div>
              <div className="form-group">
                <label>Loan Amount (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={newLoanData.amount}
                  onChange={(e) => setNewLoanData({ ...newLoanData, amount: e.target.value })}
                  placeholder="Enter loan amount"
                  min="1"
                  required
                />
              </div>
              <div className="form-group">
                <label>Term (Months) <span className="required">*</span></label>
                <input
                  type="number"
                  min="1"
                  value={newLoanData.term}
                  onChange={(e) => setNewLoanData({ ...newLoanData, term: e.target.value })}
                  placeholder="Enter term in months"
                />
              </div>
              <div className="form-group">
                <label>Interest Rate (%) <span className="required">*</span></label>
                <input
                  type="number"
                  value={newLoanData.interestRate}
                  onChange={(e) => setNewLoanData({ ...newLoanData, interestRate: e.target.value })}
                  placeholder="Enter interest rate"
                  min="0"
                  max="30"
                />
              </div>
              <div className="form-group">
                <label>Origination Date</label>
                <input
                  type="date"
                  value={newLoanData.originationDate}
                  onChange={(e) => setNewLoanData({ ...newLoanData, originationDate: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Payment Frequency</label>
                <select
                  value={newLoanData.paymentFrequency}
                  onChange={(e) => setNewLoanData({ ...newLoanData, paymentFrequency: e.target.value })}
                >
                  <option value="Monthly">Monthly</option>
                  <option value="Bi-weekly">Bi-weekly</option>
                  <option value="Quarterly">Quarterly</option>
                </select>
              </div>
              <div className="form-group full-width">
                <label>Loan Purpose</label>
                <textarea
                  value={newLoanData.purpose}
                  onChange={(e) => setNewLoanData({ ...newLoanData, purpose: e.target.value })}
                  placeholder="Describe the purpose of this loan (e.g., Working capital, Equipment purchase, Expansion)"
                  rows="3"
                  style={{ width: '100%', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.5rem', fontFamily: 'inherit' }}
                />
              </div>
              <div className="form-group full-width">
                <label>Guarantors (Optional)</label>
                <div style={{ background: '#f9fafb', padding: '1rem', borderRadius: '0.5rem', border: '1px solid #e5e7eb' }}>
                  {newLoanData.guarantors.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      {newLoanData.guarantors.map((guarantor, index) => (
                        <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: '#fff', marginBottom: '0.5rem', borderRadius: '0.25rem', border: '1px solid #e5e7eb' }}>
                          <span>Guarantor ID: {guarantor.id} {guarantor.amount && `(Amount: ${guarantor.amount} ETB)`}</span>
                          <button
                            onClick={() => {
                              setNewLoanData({
                                ...newLoanData,
                                guarantors: newLoanData.guarantors.filter((_, i) => i !== index)
                              });
                            }}
                            style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', cursor: 'pointer' }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.875rem', marginBottom: '0.25rem', display: 'block' }}>Guarantor Client ID</label>
                      <input
                        type="text"
                        value={newGuarantor.id}
                        onChange={(e) => setNewGuarantor({ ...newGuarantor, id: e.target.value })}
                        placeholder="Enter client ID"
                        style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem' }}
                      />
                    </div>
                    <div style={{ width: '150px' }}>
                      <label style={{ fontSize: '0.875rem', marginBottom: '0.25rem', display: 'block' }}>Guarantee Amount (ETB)</label>
                      <input
                        type="number"
                        value={newGuarantor.amount}
                        onChange={(e) => setNewGuarantor({ ...newGuarantor, amount: e.target.value })}
                        placeholder="Optional"
                        min="0"
                        style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem' }}
                      />
                    </div>
                    <button
                      onClick={() => {
                        if (newGuarantor.id) {
                          setNewLoanData({
                            ...newLoanData,
                            guarantors: [...newLoanData.guarantors, { id: newGuarantor.id, amount: newGuarantor.amount || null }]
                          });
                          setNewGuarantor({ id: '', amount: '' });
                        }
                      }}
                      style={{ padding: '0.5rem 1rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', height: '38px' }}
                    >
                      Add
                    </button>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.5rem', margin: '0.5rem 0 0 0' }}>
                    Add guarantors for group loans. Guarantors must be active clients in the same group.
                  </p>
                </div>
              </div>
              {parseFloat(newLoanData.amount || 0) > 100000 && (
                <div className="info-card" style={{ marginBottom: '1rem', background: '#fff7ed', borderColor: '#fdba74' }}>
                  <div>
                    <strong>High-value loan workflow</strong>
                    <p style={{ margin: '0.5rem 0 0 0' }}>
                      This loan will wait for Branch Manager review and then CEO approval before activation and client confirmation.
                    </p>
                  </div>
                </div>
              )}
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowNewLoanModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleNewLoan}>
                  <Plus size={18} />
                  Submit Application
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoanManagement;
