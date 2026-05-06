import { useState, useEffect } from 'react';
import { TrendingUp, Building2, DollarSign, BarChart3, Globe, AlertTriangle, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';
import api from '../utils/api';

const CEODashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState([
    { icon: DollarSign, label: 'Total Portfolio', value: '0 ETB', change: 'Live' },
    { icon: Building2, label: 'Active Branches', value: '0', change: 'Live' },
    { icon: TrendingUp, label: 'Deposit/Credit Ratio', value: '0.00', change: 'Live' },
    { icon: Globe, label: 'Total Clients', value: '0', change: 'Live' },
  ]);
  const [branchPerformance, setBranchPerformance] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [loansData, savingsData, branchesData] = await Promise.all([
        api.getLoans().catch(() => null),
        api.getSavings().catch(() => null),
        api.getBranches().catch(() => null)
      ]);

      const totalPortfolio = (loansData?.reduce((sum, l) => sum + (Number(l.amount) || 0), 0) || 0) +
                             (savingsData?.reduce((sum, s) => sum + (Number(s.amount) || 0), 0) || 0);
      const totalClients = new Set([
        ...(loansData?.map(l => l.client_id) || []),
        ...(savingsData?.map(s => s.client_id) || [])
      ]).size;
      const totalBranchDeposits = (branchesData || []).reduce((sum, branch) => sum + (Number(branch.total_deposits) || 0), 0);
      const totalBranchCredit = (branchesData || []).reduce((sum, branch) => sum + (Number(branch.total_credit) || 0), 0);
      const ratio = totalBranchCredit > 0 ? (totalBranchDeposits / totalBranchCredit).toFixed(2) : '0.00';

      setStats([
        { icon: DollarSign, label: 'Total Portfolio', value: `${(totalPortfolio / 1000000).toFixed(1)}M ETB`, change: 'Live' },
        { icon: Building2, label: 'Active Branches', value: branchesData?.length?.toString() || '0', change: 'Live' },
        { icon: TrendingUp, label: 'Deposit/Credit Ratio', value: ratio, change: 'Live' },
        { icon: Globe, label: 'Total Clients', value: totalClients.toString(), change: 'Live' },
      ]);

      setBranchPerformance((branchesData || []).slice(0, 6).map((branch) => {
        const deposits = Number(branch.total_deposits || 0);
        const credit = Number(branch.total_credit || 0);
        const branchRatio = credit > 0 ? deposits / credit : 0;
        const performance = branchRatio >= 1.3 ? 'Excellent' : branchRatio >= 1 ? 'Good' : 'Average';
        return {
          branch: branch.name,
          portfolio: `${((deposits + credit) / 1000000).toFixed(1)}M ETB`,
          clients: String(branch.client_count || 0),
          performance
        };
      }));
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>CEO Dashboard</h1>
        <p>Overview of all branch operations</p>
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
          <h2>Branch Performance Overview</h2>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Portfolio</th>
                  <th>Clients</th>
                  <th>Performance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {branchPerformance.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                      No branch performance data found.
                    </td>
                  </tr>
                ) : branchPerformance.map((branch, index) => (
                  <tr key={index}>
                    <td>{branch.branch}</td>
                    <td>{branch.portfolio}</td>
                    <td>{branch.clients}</td>
                    <td>
                      <span className={`status ${branch.performance === 'Excellent' ? 'active' : branch.performance === 'Good' ? 'good' : 'pending'}`}>
                        {branch.performance}
                      </span>
                    </td>
                    <td>
                      <button className="btn-sm primary" onClick={() => navigate('/ceo/branches')}>Details</button>
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
            <button className="action-btn primary" onClick={() => navigate('/ceo/reports')}>
              <BarChart3 size={20} />
              View Full Reports
            </button>
            <button className="action-btn secondary" onClick={() => navigate('/ceo/branches')}>
              <Building2 size={20} />
              Branch Deposits & Credit
            </button>
            <button className="action-btn warning" onClick={() => navigate('/ceo/loans')}>
              <AlertTriangle size={20} />
              Review High-Value Loans
            </button>
            <button className="action-btn secondary" onClick={() => navigate('/ceo/users')}>
              <Users size={20} />
              View User Accounts
            </button>
          </div>
        </div>
      </div>
      </div>
      )}
    </div>
  );
};

export default CEODashboard;
