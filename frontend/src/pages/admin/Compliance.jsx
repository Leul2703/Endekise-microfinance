import { useEffect, useMemo, useState } from 'react';
import { Filter, MessageSquareWarning, RefreshCw, Search } from 'lucide-react';
import './AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../utils/dateTime';

const Compliance = () => {
  const { success, error, warning } = useToast();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolving, setResolving] = useState(false);

  const loadMessages = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const data = await api.getContactMessages();
      setMessages(Array.isArray(data) ? data : []);
    } catch (err) {
      error(err?.message || 'Failed to load compliance messages');
      setMessages([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadMessages();
  }, []);

  const categories = useMemo(() => {
    const all = new Set(messages.map((msg) => msg.category).filter(Boolean));
    return ['all', ...Array.from(all)];
  }, [messages]);

  const filteredMessages = useMemo(() => (
    messages.filter((msg) => {
      const query = searchTerm.trim().toLowerCase();
      const matchesQuery = !query
        || String(msg.id || '').toLowerCase().includes(query)
        || String(msg.name || '').toLowerCase().includes(query)
        || String(msg.email || '').toLowerCase().includes(query)
        || String(msg.subject || '').toLowerCase().includes(query)
        || String(msg.message || '').toLowerCase().includes(query);
      const matchesStatus = statusFilter === 'all' || String(msg.status || '').toLowerCase() === statusFilter;
      const matchesCategory = categoryFilter === 'all' || String(msg.category || '').toLowerCase() === categoryFilter;
      return matchesQuery && matchesStatus && matchesCategory;
    })
  ), [messages, searchTerm, statusFilter, categoryFilter]);

  const handleResolve = async () => {
    if (!selectedMessage?.id) return;
    if (!resolutionNotes.trim()) {
      warning('Resolution notes are required.');
      return;
    }
    setResolving(true);
    try {
      await api.resolveContactMessage(selectedMessage.id, resolutionNotes.trim());
      success('Message marked as resolved.');
      setSelectedMessage(null);
      setResolutionNotes('');
      loadMessages(true);
    } catch (err) {
      error(err?.message || 'Failed to resolve message');
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Compliance View</h1>
        <p>Review customer complaints, compliance concerns, and resolution notes.</p>
        <div style={{ marginTop: '0.75rem' }}>
          <span className="inline-meta">Messages: {filteredMessages.length}</span>
        </div>
      </div>

      <div className="page-actions sticky-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search by reference, customer, email, subject, or message..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === 'all' ? 'All Categories' : cat}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-secondary" onClick={() => loadMessages(true)} disabled={refreshing}>
          <RefreshCw size={18} className={refreshing ? 'spinning' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {loading ? (
        <div className="table-container">
          <div className="empty-state">
            <p>Loading compliance messages...</p>
          </div>
        </div>
      ) : (
        <div className="table-container">
          {filteredMessages.length === 0 ? (
            <div className="empty-state">
              <MessageSquareWarning size={28} />
              <p>No messages matched your filters.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Customer</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Subject</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredMessages.map((msg) => (
                  <tr key={msg.id}>
                    <td>{msg.id}</td>
                    <td>
                      <div>{msg.name || 'Anonymous'}</div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{msg.email || '-'}</div>
                    </td>
                    <td>{msg.category || '-'}</td>
                    <td>
                      <span className={`status ${String(msg.status).toLowerCase() === 'resolved' ? 'active' : 'pending'}`}>
                        {msg.status || 'Pending'}
                      </span>
                    </td>
                    <td>{formatDateTime(msg.created_at)}</td>
                    <td>{msg.subject || '-'}</td>
                    <td>
                      <button
                        className="btn-sm secondary"
                        onClick={() => {
                          setSelectedMessage(msg);
                          setResolutionNotes(msg.resolution_notes || '');
                        }}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selectedMessage && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <div className="modal-header">
              <h2>Compliance Message Review</h2>
              <button className="modal-close" onClick={() => setSelectedMessage(null)}>×</button>
            </div>
            <div className="modal-body">
              <p><strong>Reference:</strong> {selectedMessage.id}</p>
              <p><strong>Customer:</strong> {selectedMessage.name || 'Anonymous'} ({selectedMessage.email || '-'})</p>
              <p><strong>Phone:</strong> {selectedMessage.phone || '-'}</p>
              <p><strong>Category:</strong> {selectedMessage.category || '-'}</p>
              <p><strong>Subject:</strong> {selectedMessage.subject || '-'}</p>
              <div className="form-group">
                <label>Message</label>
                <textarea value={selectedMessage.message || ''} readOnly rows={5} />
              </div>
              <div className="form-group">
                <label>Resolution Notes <span className="required">*</span></label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Enter compliance resolution notes"
                  rows={4}
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setSelectedMessage(null)} disabled={resolving}>
                  Close
                </button>
                <button
                  className="btn-primary"
                  onClick={handleResolve}
                  disabled={resolving || String(selectedMessage.status || '').toLowerCase() === 'resolved'}
                >
                  {String(selectedMessage.status || '').toLowerCase() === 'resolved'
                    ? 'Already Resolved'
                    : (resolving ? 'Resolving...' : 'Mark Resolved')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Compliance;
