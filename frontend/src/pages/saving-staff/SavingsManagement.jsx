import { useState, useEffect } from 'react';
import { Plus, Search, Filter, Edit, TrendingUp, DollarSign, PiggyBank, FileText, Eye } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const SavingsManagement = () => {
  let toast;
  try {
    toast = useToast();
  } catch (error) {
    console.warn('Toast context not available:', error);
    toast = { success: console.log, error: console.error, warning: console.warn };
  }
  const { success, error, warning } = toast;
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [showNewAccountModal, setShowNewAccountModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedSavings, setSelectedSavings] = useState(null);
  const [newAccountData, setNewAccountData] = useState({
    clientId: '',
    type: 'Regular Savings',
    amount: '',
    interestRate: '5',
    maturityDate: ''
  });
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [editInterestRate, setEditInterestRate] = useState('');
  const [savings, setSavings] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSavings();
    fetchClients();
  }, []);

  const fetchSavings = async () => {
    try {
      const data = await api.getSavings();
      setSavings(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching savings:', err);
      setSavings([]);
      error(err.message || 'Failed to load savings accounts');
    } finally {
      setLoading(false);
    }
  };

  const fetchClients = async () => {
    try {
      const data = await api.getClients();
      setClients(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching clients:', err);
      setClients([]);
    }
  };

  const filteredSavings = savings.filter(saving => {
    const clientName = saving.client_name || saving.client || '';
    const matchesSearch = clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (saving.id?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'all' || saving.type === filterType;
    return matchesSearch && matchesFilter;
  });

  const handleNewAccount = async () => {
    if (!newAccountData.clientId || !newAccountData.amount) {
      warning('Please fill in all required fields');
      return;
    }
    try {
      await api.createSavings({
        client_id: newAccountData.clientId,
        type: newAccountData.type,
        amount: newAccountData.amount,
        interest_rate: newAccountData.interestRate,
        maturity_date: newAccountData.maturityDate
      });
      setShowNewAccountModal(false);
      setNewAccountData({
        clientId: '',
        type: 'Regular Savings',
        amount: '',
        interestRate: '5',
        maturityDate: ''
      });
      fetchSavings();
      success('Savings account created and routed for approval');
    } catch (err) {
      console.error('Error creating savings account:', err);
      error(err.message || 'Failed to create savings account');
    }
  };

  const handleViewDetails = (saving) => {
    setSelectedSavings(saving);
    setShowDetailsModal(true);
  };

  const handleOpenEdit = (saving) => {
    setSelectedSavings(saving);
    setEditInterestRate(String(saving.interest_rate ?? saving.interestRate ?? 0));
    setShowEditModal(true);
  };

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      warning('Please enter a valid amount');
      return;
    }
    try {
      await api.recordDeposit(selectedSavings.id, depositAmount);
      setDepositAmount('');
      setShowDepositModal(false);
      fetchSavings();
      success('Deposit successful');
    } catch (err) {
      console.error('Error processing deposit:', err);
      error(err.message || 'Failed to process deposit');
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      warning('Please enter a valid amount');
      return;
    }
    try {
      await api.recordWithdrawal(selectedSavings.id, withdrawAmount);
      setWithdrawAmount('');
      setShowWithdrawModal(false);
      fetchSavings();
      success('Withdrawal successful');
    } catch (err) {
      console.error('Error processing withdrawal:', err);
      error(err.message || 'Failed to process withdrawal');
    }
  };

  const handleSaveEdit = async () => {
    const numericRate = Number(editInterestRate);
    if (!Number.isFinite(numericRate) || numericRate < 0) {
      warning('Please enter a valid non-negative interest rate');
      return;
    }
    try {
      await api.updateClientAccountInterestRate(selectedSavings.id, numericRate);
      setShowEditModal(false);
      setSelectedSavings(null);
      setEditInterestRate('');
      await fetchSavings();
      success('Savings account interest rate updated successfully');
    } catch (err) {
      console.error('Error updating savings account:', err);
      error(err.message || 'Failed to update savings account');
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Savings Management</h1>
        <p>Manage and monitor all savings accounts</p>
      </div>

      <div className="page-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search savings accounts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">All Types</option>
            <option value="Fixed Deposit">Fixed Deposit</option>
            <option value="Regular Savings">Regular Savings</option>
            <option value="Children Savings">Children Savings</option>
          </select>
        </div>

        <button className="btn-primary" onClick={() => setShowNewAccountModal(true)}>
          <Plus size={20} />
          New Savings Account
        </button>
      </div>

      {loading ? (
        <div className="table-container">
          <p style={{ textAlign: 'center', padding: '2rem' }}>Loading savings...</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Account ID</th>
                <th>Type</th>
                <th>Balance</th>
                <th>Interest Rate</th>
                <th>Maturity Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSavings.map((saving) => (
                <tr key={saving.id}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <strong>{saving.id}</strong>
                      <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>{saving.client_name || saving.client}</span>
                    </div>
                  </td>
                <td>{saving.type}</td>
                <td>{Number(saving.amount ?? saving.balance ?? 0).toLocaleString()} ETB</td>
                <td>{saving.interest_rate ?? saving.interestRate}%</td>
                <td>{saving.maturity_date || saving.maturityDate || 'Ongoing'}</td>
                <td>
                  <span className={`status ${saving.status === 'Active' ? 'active' : 'pending'}`}>
                    {saving.status}
                  </span>
                </td>
                <td>
                  <button className="btn-icon edit" title="View Details" onClick={() => handleViewDetails(saving)}>
                    <Eye size={18} />
                  </button>
                  <button className="btn-icon edit" title="Edit" onClick={() => handleOpenEdit(saving)}>
                    <Edit size={18} />
                  </button>
                  <button className="btn-icon edit" title="Process Deposit" onClick={() => { setSelectedSavings(saving); setShowDepositModal(true); }}>
                    <DollarSign size={18} />
                  </button>
                  <button className="btn-icon edit" title="Process Withdrawal" onClick={() => { setSelectedSavings(saving); setShowWithdrawModal(true); }}>
                    <TrendingUp size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {showNewAccountModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>New Savings Account</h2>
              <button onClick={() => setShowNewAccountModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Client <span className="required">*</span></label>
                <select
                  value={newAccountData.clientId}
                  onChange={(e) => setNewAccountData({ ...newAccountData, clientId: e.target.value })}
                  required
                >
                  <option value="">-- Select a client --</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name} {client.phone ? `(${client.phone})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Account Type</label>
                <select
                  value={newAccountData.type}
                  onChange={(e) => setNewAccountData({ ...newAccountData, type: e.target.value })}
                >
                  <option value="Regular Savings">Regular Savings</option>
                  <option value="Fixed Deposit">Fixed Deposit</option>
                  <option value="Children Savings">Children Savings</option>
                </select>
              </div>
              <div className="form-group">
                <label>Initial Amount (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={newAccountData.amount}
                  onChange={(e) => setNewAccountData({ ...newAccountData, amount: e.target.value })}
                  placeholder="Enter initial amount"
                  min="1"
                  required
                />
              </div>
              <div className="form-group">
                <label>Interest Rate (%)</label>
                <input
                  type="number"
                  value={newAccountData.interestRate}
                  onChange={(e) => setNewAccountData({ ...newAccountData, interestRate: e.target.value })}
                  placeholder="Enter interest rate"
                  min="0"
                  max="20"
                />
              </div>
              {newAccountData.type === 'Fixed Deposit' && (
                <div className="form-group">
                  <label>Maturity Date</label>
                  <input
                    type="date"
                    value={newAccountData.maturityDate}
                    onChange={(e) => setNewAccountData({ ...newAccountData, maturityDate: e.target.value })}
                  />
                </div>
              )}
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowNewAccountModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleNewAccount}>
                  Create Account
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
              <h2>Savings Account Details</h2>
              <button onClick={() => setShowDetailsModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Account ID</label>
                <p>{selectedSavings?.id}</p>
              </div>
              <div className="form-group">
                <label>Client</label>
                <p>{selectedSavings?.client_name || selectedSavings?.client}</p>
              </div>
              <div className="form-group">
                <label>Type</label>
                <p>{selectedSavings?.type}</p>
              </div>
              <div className="form-group">
                <label>Balance</label>
                <p>{Number(selectedSavings?.amount ?? selectedSavings?.balance ?? 0).toLocaleString()} ETB</p>
              </div>
              <div className="form-group">
                <label>Interest Rate</label>
                <p>{selectedSavings?.interest_rate ?? selectedSavings?.interestRate}%</p>
              </div>
              <div className="form-group">
                <label>Maturity Date</label>
                <p>{selectedSavings?.maturity_date || selectedSavings?.maturityDate || 'Ongoing'}</p>
              </div>
              <div className="form-group">
                <label>Status</label>
                <span className={`status ${selectedSavings?.status === 'Active' ? 'active' : 'pending'}`}>
                  {selectedSavings?.status}
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

      {showDepositModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Process Deposit</h2>
              <button onClick={() => setShowDepositModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Account ID:</strong> {selectedSavings?.id}</p>
              <p><strong>Client:</strong> {selectedSavings?.client_name || selectedSavings?.client}</p>
              <p><strong>Current Balance:</strong> {Number(selectedSavings?.amount ?? selectedSavings?.balance ?? 0).toLocaleString()} ETB</p>
              <div className="form-group">
                <label>Deposit Amount (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="Enter deposit amount"
                  min="1"
                  required
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowDepositModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleDeposit}>
                  <DollarSign size={18} />
                  Process Deposit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWithdrawModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Process Withdrawal</h2>
              <button onClick={() => setShowWithdrawModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Account ID:</strong> {selectedSavings?.id}</p>
              <p><strong>Client:</strong> {selectedSavings?.client_name || selectedSavings?.client}</p>
              <p><strong>Current Balance:</strong> {Number(selectedSavings?.amount ?? selectedSavings?.balance ?? 0).toLocaleString()} ETB</p>
              <div className="form-group">
                <label>Withdrawal Amount (ETB) <span className="required">*</span></label>
                <input
                  type="number"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="Enter withdrawal amount"
                  min="1"
                  required
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowWithdrawModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleWithdraw}>
                  <TrendingUp size={18} />
                  Process Withdrawal
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
              <h2>Edit Savings Account</h2>
              <button onClick={() => setShowEditModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Account ID:</strong> {selectedSavings?.id}</p>
              <p><strong>Client:</strong> {selectedSavings?.client_name || selectedSavings?.client}</p>
              <p><strong>Current Balance:</strong> {Number(selectedSavings?.amount ?? selectedSavings?.balance ?? 0).toLocaleString()} ETB</p>
              <div className="form-group">
                <label>Interest Rate (%) <span className="required">*</span></label>
                <input
                  type="number"
                  value={editInterestRate}
                  onChange={(e) => setEditInterestRate(e.target.value)}
                  min="0"
                  step="0.01"
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleSaveEdit}>
                  <Edit size={18} />
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SavingsManagement;
