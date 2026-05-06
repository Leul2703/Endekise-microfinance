import { useState, useEffect } from 'react';
import { PiggyBank, FileText, TrendingUp, Users, DollarSign } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';
import api from '../utils/api';
import { useToast } from '../context/ToastContext';

const SavingStaffDashboard = () => {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [stats, setStats] = useState([
    { icon: Users, label: 'Active Savers', value: '0', change: 'Live' },
    { icon: PiggyBank, label: 'Total Savings', value: '0 ETB', change: 'Live' },
    { icon: FileText, label: 'Pending Requests', value: '0', change: 'Live' },
    { icon: DollarSign, label: "Today's Deposits", value: '0 ETB', change: 'Live' },
  ]);
  const [recentSavings, setRecentSavings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showStatementModal, setShowStatementModal] = useState(false);
  const [statementType, setStatementType] = useState('account');
  const [statementRange, setStatementRange] = useState('month');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [savingsData, pendingSavings] = await Promise.all([
        api.getSavings().catch(() => []),
        api.getPendingSavings().catch(() => [])
      ]);

      setRecentSavings(savingsData.slice(0, 5).map((saving) => ({
        id: saving.id,
        client: saving.client_name || `Client-${saving.client_id}`,
        balance: `${Number(saving.amount || 0).toLocaleString()} ETB`,
        type: saving.type,
        status: saving.status
      })));

      const totalSavings = savingsData.reduce((sum, saving) => sum + (Number(saving.amount) || 0), 0);
      const activeSavers = new Set(
        savingsData
          .filter((saving) => saving.status === 'Active')
          .map((saving) => saving.client_id)
      ).size;
      const today = new Date().toISOString().split('T')[0];
      const todaysDeposits = savingsData
        .filter((saving) => String(saving.created_at || '').startsWith(today))
        .reduce((sum, saving) => sum + (Number(saving.amount) || 0), 0);

      setStats([
        { icon: Users, label: 'Active Savers', value: String(activeSavers), change: 'Live' },
        {
          icon: PiggyBank,
          label: 'Total Savings',
          value: `${(totalSavings / 1000000).toFixed(1)}M ETB`,
          change: 'Live'
        },
        { icon: FileText, label: 'Pending Requests', value: String(pendingSavings.length), change: 'Live' },
        { icon: DollarSign, label: "Today's Deposits", value: `${todaysDeposits.toLocaleString()} ETB`, change: 'Live' },
      ]);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateStatement = async () => {
    setGenerating(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const statementContent = `
Savings Account Statement
==========================
Statement Type: ${statementType.charAt(0).toUpperCase() + statementType.slice(1)}
Date Range: ${statementRange.charAt(0).toUpperCase() + statementRange.slice(1)}
Generated: ${new Date().toLocaleDateString()}

Summary Statistics:
- Total Savings Accounts: ${recentSavings.length}
- Total Savings Balance: ${stats[1].value}
- Active Savers: ${stats[0].value}
- Pending Requests: ${stats[2].value}

Recent Accounts:
${recentSavings.map(saving => `- ${saving.id}: ${saving.client} - ${saving.balance} (${saving.status})`).join('\n')}
      `.trim();

      const blob = new Blob([statementContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `savings_${statementType}_statement_${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setShowStatementModal(false);
      success('Statement generated and downloaded successfully');
    } catch (error) {
      console.error('Error generating statement:', error);
      error(error.message || 'Failed to generate statement');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Saving Staff Dashboard</h1>
        <p>Manage savings accounts and requests</p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>Loading dashboard data...</div>
      ) : (
      <div>
      <div className="stats-grid">
        {stats.map((stat, index) => (
          <div key={index} className="stat-card">
            <div className="stat-icon">
              <stat.icon size={24} />
            </div>
            <div className="stat-content">
              <h3>{stat.value}</h3>
              <p>{stat.label}</p>
              <span className="stat-change">{stat.change}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-sections">
        <div className="section-card">
          <h2>Recent Savings Accounts</h2>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account ID</th>
                  <th>Client</th>
                  <th>Balance</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentSavings.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>
                      No savings accounts found.
                    </td>
                  </tr>
                ) : recentSavings.map((saving) => (
                  <tr key={saving.id}>
                    <td>{saving.id}</td>
                    <td>{saving.client}</td>
                    <td>{saving.balance}</td>
                    <td>{saving.type}</td>
                    <td>
                      <span className={`status ${saving.status === 'Active' ? 'active' : 'pending'}`}>
                        {saving.status}
                      </span>
                    </td>
                    <td>
                      <button className="btn-sm primary" onClick={() => navigate('/saving-staff/savings')}>View</button>
                      <button className="btn-sm secondary" onClick={() => navigate('/saving-staff/savings')}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section-card">
          <h2>Quick Actions</h2>
          <div className="action-buttons">
            <button className="action-btn primary" onClick={() => navigate('/saving-staff/savings')}>
              <PiggyBank size={20} />
              New Savings Account
            </button>
            <button className="action-btn secondary" onClick={() => navigate('/saving-staff/requests')}>
              <TrendingUp size={20} />
              Process Deposit
            </button>
            <button className="action-btn secondary" onClick={() => setShowStatementModal(true)}>
              <FileText size={20} />
              Generate Statement
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
              <h2>Generate Savings Statement</h2>
              <button onClick={() => setShowStatementModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Statement Type <span className="required">*</span></label>
                <select value={statementType} onChange={(e) => setStatementType(e.target.value)}>
                  <option value="account">Account Statement</option>
                  <option value="transaction">Transaction History</option>
                  <option value="interest">Interest Report</option>
                  <option value="summary">Summary Report</option>
                </select>
              </div>
              <div className="form-group">
                <label>Date Range <span className="required">*</span></label>
                <select value={statementRange} onChange={(e) => setStatementRange(e.target.value)}>
                  <option value="month">This Month</option>
                  <option value="quarter">This Quarter</option>
                  <option value="year">This Year</option>
                  <option value="all">All Time</option>
                </select>
              </div>
              <div className="info-card" style={{ marginBottom: '1rem' }}>
                <FileText size={20} />
                <span>Statement will be generated as a text file and downloaded automatically.</span>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowStatementModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleGenerateStatement} disabled={generating}>
                  {generating ? 'Generating...' : 'Generate Statement'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SavingStaffDashboard;
