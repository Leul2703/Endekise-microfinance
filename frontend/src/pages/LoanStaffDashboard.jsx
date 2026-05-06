import { useState, useEffect } from 'react';
import { DollarSign, FileText, Upload, Calendar, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';
import api from '../utils/api';
import { useToast } from '../context/ToastContext';

const LoanStaffDashboard = () => {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [stats, setStats] = useState([
    { icon: Users, label: 'Active Clients', value: '0', change: 'Live' },
    { icon: DollarSign, label: 'Total Loan Portfolio', value: '0 ETB', change: 'Live' },
    { icon: FileText, label: 'Pending Documents', value: '0', change: 'Live' },
    { icon: Calendar, label: 'Due This Week', value: '0', change: 'Live' },
  ]);
  const [recentLoans, setRecentLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportType, setReportType] = useState('portfolio');
  const [reportRange, setReportRange] = useState('month');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [loansData, documentsData] = await Promise.all([
        api.getLoans().catch(() => []),
        api.getDocuments().catch(() => [])
      ]);

      const activeLoans = loansData.filter((loan) => loan.status === 'Active' || loan.status === 'Pending');
      setRecentLoans(activeLoans.slice(0, 5).map((loan) => ({
        id: loan.id,
        client: loan.client_name || `Client-${loan.client_id}`,
        amount: `${Number(loan.amount || 0).toLocaleString()} ETB`,
        type: loan.type,
        status: loan.status
      })));

      const totalPortfolio = loansData.reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0);
      const uniqueClients = new Set(loansData.map((loan) => loan.client_id)).size;
      const pendingDocuments = documentsData.filter((doc) => doc.status === 'Pending').length;
      const today = new Date();
      const weekAhead = new Date();
      weekAhead.setDate(today.getDate() + 7);
      const dueThisWeek = loansData.filter((loan) => {
        if (!loan.dueDate) {
          return false;
        }
        const due = new Date(loan.dueDate);
        return due >= today && due <= weekAhead;
      }).length;

      setStats([
        { icon: Users, label: 'Active Clients', value: String(uniqueClients), change: 'Live' },
        {
          icon: DollarSign,
          label: 'Total Loan Portfolio',
          value: `${(totalPortfolio / 1000000).toFixed(1)}M ETB`,
          change: 'Live'
        },
        { icon: FileText, label: 'Pending Documents', value: String(pendingDocuments), change: 'Live' },
        { icon: Calendar, label: 'Due This Week', value: String(dueThisWeek), change: 'Live' },
      ]);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const reportContent = `
Loan Portfolio Report
======================
Report Type: ${reportType.charAt(0).toUpperCase() + reportType.slice(1)}
Date Range: ${reportRange.charAt(0).toUpperCase() + reportRange.slice(1)}
Generated: ${new Date().toLocaleDateString()}

Summary Statistics:
- Total Loans: ${recentLoans.length}
- Active Portfolio: ${stats[1].value}
- Active Clients: ${stats[0].value}
- Due This Week: ${stats[3].value}

Recent Loans:
${recentLoans.map(loan => `- ${loan.id}: ${loan.client} - ${loan.amount} (${loan.status})`).join('\n')}
      `.trim();

      const blob = new Blob([reportContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `loan_${reportType}_report_${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setShowReportModal(false);
      success('Report generated and downloaded successfully');
    } catch (error) {
      console.error('Error generating report:', error);
      error(error.message || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Loan Staff Dashboard</h1>
        <p>Manage loan accounts and documentation</p>
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
          <h2>Recent Loan Applications</h2>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Loan ID</th>
                  <th>Client</th>
                  <th>Amount</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentLoans.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>
                      No loan applications found.
                    </td>
                  </tr>
                ) : recentLoans.map((loan) => (
                  <tr key={loan.id}>
                    <td>{loan.id}</td>
                    <td>{loan.client}</td>
                    <td>{loan.amount}</td>
                    <td>{loan.type}</td>
                    <td>
                      <span className={`status ${loan.status === 'Active' ? 'active' : 'pending'}`}>
                        {loan.status}
                      </span>
                    </td>
                    <td>
                      <button className="btn-sm primary" onClick={() => navigate('/loan-staff/loans')}>View</button>
                      <button className="btn-sm secondary" onClick={() => navigate('/loan-staff/loans')}>Edit</button>
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
            <button className="action-btn primary" onClick={() => navigate('/loan-staff/loans')}>
              <DollarSign size={20} />
              New Loan Application
            </button>
            <button className="action-btn secondary" onClick={() => navigate('/loan-staff/documents')}>
              <Upload size={20} />
              Upload Documents
            </button>
            <button className="action-btn secondary" onClick={() => setShowReportModal(true)}>
              <FileText size={20} />
              Generate Report
            </button>
          </div>
        </div>
      </div>
      </div>
      )}

      {showReportModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Generate Loan Report</h2>
              <button onClick={() => setShowReportModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Report Type <span className="required">*</span></label>
                <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
                  <option value="portfolio">Portfolio Overview</option>
                  <option value="payments">Payment History</option>
                  <option value="overdue">Overdue Loans</option>
                  <option value="performance">Performance Analysis</option>
                </select>
              </div>
              <div className="form-group">
                <label>Date Range <span className="required">*</span></label>
                <select value={reportRange} onChange={(e) => setReportRange(e.target.value)}>
                  <option value="month">This Month</option>
                  <option value="quarter">This Quarter</option>
                  <option value="year">This Year</option>
                  <option value="all">All Time</option>
                </select>
              </div>
              <div className="info-card" style={{ marginBottom: '1rem' }}>
                <FileText size={20} />
                <span>Report will be generated as a text file and downloaded automatically.</span>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowReportModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleGenerateReport} disabled={generating}>
                  {generating ? 'Generating...' : 'Generate Report'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoanStaffDashboard;
