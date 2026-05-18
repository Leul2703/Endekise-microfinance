import { useEffect, useMemo, useState } from 'react';
import { Search, Filter, RefreshCw, Download } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../utils/dateTime';

const DAY_FILTERS = [
  { value: 'all', label: 'All Time' },
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' }
];

const TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'withdraw', label: 'Withdraw' },
  { value: 'disbursement', label: 'Disbursement' },
  { value: 'repayment', label: 'Repayment' }
];

const ACCOUNT_TYPE_OPTIONS = [
  { value: 'all', label: 'All Accounts' },
  { value: 'savings', label: 'Savings Accounts' },
  { value: 'loan', label: 'Loan Accounts' }
];

const TransactionHistory = () => {
  const { error } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dayFilter, setDayFilter] = useState('30');
  const [accountTypeFilter, setAccountTypeFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const loadTransactions = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const activeStart = startDate
        || (dayFilter !== 'all'
          ? new Date(Date.now() - (Number(dayFilter) * 24 * 60 * 60 * 1000)).toISOString()
          : '');
      const activeEnd = endDate ? `${endDate}T23:59:59.999Z` : '';
      const data = await api.getRecentTransactions(300, {
        query: debouncedSearchTerm || undefined,
        type: typeFilter !== 'all' ? typeFilter : undefined,
        account_type: accountTypeFilter !== 'all' ? accountTypeFilter : undefined,
        start_date: activeStart || undefined,
        end_date: activeEnd || undefined
      });
      setTransactions(Array.isArray(data) ? data : []);
    } catch (fetchError) {
      console.error('Failed to load transaction history:', fetchError);
      error(fetchError.message || 'Failed to load transaction history');
      setTransactions([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, [dayFilter, typeFilter, accountTypeFilter, startDate, endDate, debouncedSearchTerm]);

  const filteredTransactions = useMemo(() => transactions, [transactions]);

  const parseFilenameFromContentDisposition = (contentDisposition) => {
    if (!contentDisposition) return null;
    const match = /filename="([^"]+)"/i.exec(contentDisposition);
    return match?.[1] || null;
  };

  const triggerDownload = (blob, filename) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `transaction_statement_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleDownloadTransactionStatement = async (transactionId) => {
    try {
      const { blob, contentDisposition } = await api.downloadTransactionStatementPdf(transactionId);
      const filename = parseFilenameFromContentDisposition(contentDisposition)
        || `transaction_statement_${transactionId}_${new Date().toISOString().slice(0, 10)}.pdf`;
      triggerDownload(blob, filename);
    } catch (downloadError) {
      error(downloadError?.message || 'Failed to download transaction statement');
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Transaction History</h1>
        <p>View recent operational transactions recorded across branch-managed accounts.</p>
        <div style={{ marginTop: '0.75rem' }}>
          <span className="inline-meta">{filteredTransactions.length} records</span>
        </div>
      </div>

      <div className="page-actions sticky-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search by ID, client, account, type, or description..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={accountTypeFilter} onChange={(event) => setAccountTypeFilter(event.target.value)}>
            {ACCOUNT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={dayFilter} onChange={(event) => setDayFilter(event.target.value)}>
            {DAY_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          title="Start date"
        />

        <input
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          title="End date"
        />

        <button
          className="btn-secondary"
          onClick={() => loadTransactions(true)}
          disabled={refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <RefreshCw size={20} className={refreshing ? 'spinning' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            setSearchTerm('');
            setTypeFilter('all');
            setAccountTypeFilter('all');
            setDayFilter('30');
            setStartDate('');
            setEndDate('');
          }}
        >
          Reset Filters
        </button>
      </div>

      {loading ? (
        <div className="table-container">
          <p style={{ textAlign: 'center', padding: '2rem' }}>Loading transaction history...</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Transaction ID</th>
                <th>Client</th>
                <th>Account</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Balance Before</th>
                <th>Balance After</th>
                <th>Date</th>
                  <th>Statement</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((txn) => (
                <tr key={txn.id}>
                  <td>{txn.id}</td>
                  <td>{txn.client_name || '-'}</td>
                  <td>{txn.account_id || '-'}</td>
                  <td>{txn.transaction_type || '-'}</td>
                  <td>{Number(txn.amount || 0).toLocaleString()} ETB</td>
                  <td>{Number(txn.balance_before || 0).toLocaleString()} ETB</td>
                  <td>{Number(txn.balance_after || 0).toLocaleString()} ETB</td>
                  <td>{formatDateTime(txn.created_at)}</td>
                  <td>
                    <button
                      className="btn-sm secondary"
                      onClick={() => handleDownloadTransactionStatement(txn.id)}
                    >
                      <Download size={14} />
                      Statement
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredTransactions.length === 0 && (
            <div className="empty-state">
              <p>No transactions found for the selected filters.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TransactionHistory;
