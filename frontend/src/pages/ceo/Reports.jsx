import { AlertTriangle, BarChart3, DollarSign, Download, FileText, Filter, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../../utils/dateTime';
import { useNavigate } from 'react-router-dom';

const formatCurrency = (value) => `${(Number(value || 0) / 1000000).toFixed(1)}M ETB`;

const Reports = () => {
  const navigate = useNavigate();
  const [reportData, setReportData] = useState(null);
  const [riskData, setRiskData] = useState(null);
  const [complianceData, setComplianceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [recentReports] = useState([
    { id: 'RPT-001', name: 'Monthly Performance Report', period: 'April 2026', generated: '2026-04-20', type: 'Performance' },
    { id: 'RPT-002', name: 'Branch Comparison Report', period: 'Q1 2026', generated: '2026-04-15', type: 'Comparison' },
    { id: 'RPT-003', name: 'Loan Portfolio Analysis', period: 'March 2026', generated: '2026-04-10', type: 'Analysis' },
    { id: 'RPT-004', name: 'Risk Assessment Report', period: 'Q1 2026', generated: '2026-04-05', type: 'Risk' }
  ]);

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const [reports, risk, compliance] = await Promise.all([
        api.getCEOReports(),
        api.getRiskReport().catch(() => null),
        api.getComplianceOverview().catch(() => null)
      ]);
      console.debug('Loaded CEO reporting suite', { reports, risk, compliance });
      setReportData(reports);
      setRiskData(risk);
      setComplianceData(compliance);
    } catch (fetchError) {
      console.error('Error fetching reports:', fetchError);
    } finally {
      setLoading(false);
    }
  };

  const filteredReports = useMemo(() => (
    recentReports.filter((report) => filterType === 'all' || report.type === filterType)
  ), [filterType, recentReports]);

  const summaryStats = reportData ? [
    { icon: DollarSign, label: 'Total Portfolio', value: formatCurrency(reportData.summary.total_portfolio), change: 'Live' },
    { icon: Users, label: 'Total Clients', value: reportData.summary.total_clients, change: 'Live' },
    { icon: TrendingUp, label: 'Total Savings', value: formatCurrency(reportData.summary.total_savings), change: 'Live' },
    { icon: BarChart3, label: 'Active Loans', value: reportData.summary.active_loans, change: 'Live' }
  ] : [];

  const complianceStats = complianceData ? [
    { icon: ShieldCheck, label: 'Verified KYC', value: complianceData.summary.verified_kyc, tone: 'active' },
    { icon: AlertTriangle, label: 'Pending KYC', value: complianceData.summary.pending_kyc, tone: 'pending' },
    { icon: AlertTriangle, label: 'Open AML Alerts', value: complianceData.summary.open_aml_alerts, tone: 'high' },
    { icon: FileText, label: 'Pending Approvals', value: complianceData.summary.pending_approvals, tone: 'pending' },
    { icon: TrendingUp, label: 'Overdue Loans', value: complianceData.summary.overdue_loans, tone: 'inactive' },
    { icon: TrendingUp, label: 'Defaulted Loans', value: complianceData.summary.defaulted_loans, tone: 'high' }
  ] : [];

  const handleViewReport = (report) => {
    setSelectedReport(report);
    setShowReportModal(true);
  };

  const handleDownloadReport = (report) => {
    const reportContent = [
      `Report ID: ${report.id}`,
      `Report Name: ${report.name}`,
      `Period: ${report.period}`,
      `Generated: ${report.generated}`,
      `Type: ${report.type}`,
      '',
      reportData ? `Portfolio: ${formatCurrency(reportData.summary.total_portfolio)}` : '',
      complianceData ? `Open AML Alerts: ${complianceData.summary.open_aml_alerts}` : '',
      riskData ? `Risk Level: ${riskData.risk_metrics.risk_level}` : ''
    ].filter(Boolean).join('\n');

    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${report.name.replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Reports</h1>
        <p>Operational, risk, and compliance reporting for executive oversight.</p>
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn-secondary" type="button" onClick={() => navigate(-1)}>
            Back
          </button>
          <span className="inline-meta">Available reports: {filteredReports.length}</span>
        </div>
      </div>

      <div className="stats-grid">
        {summaryStats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="stat-icon">
              <stat.icon size={24} />
            </div>
            <div className="stat-content">
              <h3>{loading ? '...' : stat.value}</h3>
              <p>{stat.label}</p>
              <span className="stat-change">{stat.change}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="page-actions sticky-actions">
        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={filterType} onChange={(event) => setFilterType(event.target.value)}>
            <option value="all">All Types</option>
            <option value="Performance">Performance</option>
            <option value="Comparison">Comparison</option>
            <option value="Analysis">Analysis</option>
            <option value="Risk">Risk</option>
          </select>
        </div>

        <button className="btn-primary" onClick={fetchReports}>
          <BarChart3 size={20} />
          Refresh Reports
        </button>
      </div>

      <div className="table-container" style={{ marginBottom: '2rem' }}>
        {filteredReports.length === 0 ? (
          <div className="empty-state">
            <p>No reports available for the selected type.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Report ID</th>
                <th>Report Name</th>
                <th>Period</th>
                <th>Generated</th>
                <th>Type</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredReports.map((report) => (
                <tr key={report.id}>
                <td>{report.id}</td>
                <td>{report.name}</td>
                <td>{report.period}</td>
                <td>{formatDateTime(report.generated)}</td>
                <td><span className="role-badge">{report.type}</span></td>
                <td>
                  <button className="btn-icon edit" title="View" onClick={() => handleViewReport(report)}>
                    <FileText size={18} />
                  </button>
                  <button className="btn-icon edit" title="Download" onClick={() => handleDownloadReport(report)}>
                    <Download size={18} />
                  </button>
                </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="stats-grid" style={{ marginBottom: '2rem' }}>
        {complianceStats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="stat-icon">
              <stat.icon size={24} />
            </div>
            <div className="stat-content">
              <h3>{loading ? '...' : stat.value}</h3>
              <p>{stat.label}</p>
              <span className={`status ${stat.tone}`}>{stat.tone.replace('_', ' ')}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-sections">
        <div className="section-card">
          <h2>Recent AML Alerts</h2>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Alert</th>
                  <th>Account</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {(complianceData?.recent_aml_alerts || []).map((alert) => (
                  <tr key={alert.id}>
                    <td>{alert.alert_type}</td>
                    <td>{alert.account_id || '-'}</td>
                    <td><span className={`status ${alert.severity === 'high' ? 'high' : 'pending'}`}>{alert.severity}</span></td>
                    <td><span className={`status ${alert.status === 'Open' ? 'pending' : 'active'}`}>{alert.status}</span></td>
                    <td>{formatDateTime(alert.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!complianceData?.recent_aml_alerts || complianceData.recent_aml_alerts.length === 0) && (
              <p style={{ textAlign: 'center', padding: '1.5rem', color: '#6b7280' }}>No AML alerts logged yet.</p>
            )}
          </div>
        </div>

        <div className="section-card">
          <h2>Recent Audit Activity</h2>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Role</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {(complianceData?.recent_audit_events || []).map((event) => (
                  <tr key={event.id}>
                    <td>{event.action}</td>
                    <td>{(event.user_role || 'system').replace('_', ' ')}</td>
                    <td>{formatDateTime(event.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!complianceData?.recent_audit_events || complianceData.recent_audit_events.length === 0) && (
              <p style={{ textAlign: 'center', padding: '1.5rem', color: '#6b7280' }}>No audit activity available.</p>
            )}
          </div>
        </div>
      </div>

      {riskData && (
        <div className="info-card" style={{ marginTop: '2rem', background: '#fff7ed', borderColor: '#fdba74' }}>
          <AlertTriangle size={24} style={{ color: '#c2410c' }} />
          <div>
            <h3 style={{ margin: '0 0 0.5rem 0', color: '#9a3412' }}>Risk Snapshot</h3>
            <p style={{ margin: 0, color: '#9a3412' }}>
              Risk level: <strong>{riskData.risk_metrics.risk_level}</strong> with {riskData.risk_metrics.overdue_loans_count} overdue loans and {riskData.risk_metrics.high_interest_loans_count} high-interest accounts.
            </p>
          </div>
        </div>
      )}

      {showReportModal && selectedReport && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Report Details</h2>
              <button onClick={() => setShowReportModal(false)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Report ID</label>
                <p>{selectedReport.id}</p>
              </div>
              <div className="form-group">
                <label>Report Name</label>
                <p>{selectedReport.name}</p>
              </div>
              <div className="form-group">
                <label>Period</label>
                <p>{selectedReport.period}</p>
              </div>
              <div className="form-group">
                <label>Type</label>
                <span className="role-badge">{selectedReport.type}</span>
              </div>
              {reportData && (
                <div className="info-card" style={{ marginTop: '1.5rem' }}>
                  <BarChart3 size={24} />
                  <div>
                    <h3>Live Banking Snapshot</h3>
                    <p style={{ margin: '0.5rem 0 0 0' }}>
                      Portfolio {formatCurrency(reportData.summary.total_portfolio)}, savings {formatCurrency(reportData.summary.total_savings)}, active loans {reportData.summary.active_loans}.
                    </p>
                    {complianceData && (
                      <p style={{ margin: '0.5rem 0 0 0' }}>
                        Compliance watch: {complianceData.summary.open_aml_alerts} AML alerts, {complianceData.summary.pending_approvals} pending approvals, {complianceData.summary.pending_kyc} KYC records pending.
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowReportModal(false)}>
                  Close
                </button>
                <button className="btn-primary" onClick={() => handleDownloadReport(selectedReport)}>
                  <Download size={18} />
                  Download Report
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;
