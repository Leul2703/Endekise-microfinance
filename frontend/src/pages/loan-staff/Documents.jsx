import { useState, useEffect } from 'react';
import { Upload, Search, Download, Eye, Trash2, FileText, Check, XCircle, Filter, AlertCircle } from 'lucide-react';
import '../admin/AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const Documents = () => {
  const { success, error: showError, warning } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadData, setUploadData] = useState({
    client: '',
    loanId: '',
    documentType: 'ID Card'
  });
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const data = await api.getDocuments();
      setDocuments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      showError(error.message || 'Failed to load documents');
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredDocuments = documents.filter(doc => {
    const clientText = String(doc.client || doc.client_name || doc.client_id || '').toLowerCase();
    const fileText = String(doc.fileName || doc.file_name || '').toLowerCase();
    const loanText = String(doc.loanId || doc.loan_id || '').toLowerCase();
    const matchesSearch = clientText.includes(searchTerm.toLowerCase()) ||
                         fileText.includes(searchTerm.toLowerCase()) ||
                         loanText.includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'all' || doc.type === filterType;
    return matchesSearch && matchesFilter;
  });

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        warning('File size exceeds 10MB limit.');
        return;
      }
      // Validate file type (PDF, JPG, PNG)
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      if (!validTypes.includes(file.type)) {
        warning('Invalid file type. Only PDF, JPG, and PNG files are allowed.');
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !uploadData.client || !uploadData.loanId) {
      warning('Please fill in all required fields and select a file.');
      return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('client_id', uploadData.client);
    formData.append('loan_id', uploadData.loanId);
    formData.append('type', uploadData.documentType);

    try {
      await api.uploadDocument(formData);
      setShowUploadModal(false);
      setSelectedFile(null);
      setUploadData({ client: '', loanId: '', documentType: 'ID Card' });
      fetchDocuments();
      success('Document uploaded successfully');
    } catch (error) {
      console.error('Error uploading document:', error);
      showError(error.message || 'Failed to upload document');
    }
  };

  const handleViewDocument = (doc) => {
    setSelectedDoc(doc);
    setShowViewModal(true);
  };

  const handleDownloadDocument = (doc) => {
    warning(`Download for "${doc.fileName || doc.id}" is not linked yet. Please use the server download endpoint when available.`);
  };

  const handleVerify = (doc) => {
    setSelectedDoc(doc);
    setShowVerifyModal(true);
  };

  const handleReject = (doc) => {
    setSelectedDoc(doc);
    setRejectReason('');
    setShowRejectModal(true);
  };

  const handleDelete = (doc) => {
    setSelectedDoc(doc);
    setShowDeleteModal(true);
  };

  const confirmVerify = async () => {
    try {
      await api.verifyDocument(selectedDoc.id);
      setShowVerifyModal(false);
      fetchDocuments();
      success('Document verified successfully');
    } catch (error) {
      console.error('Error verifying document:', error);
      showError(error.message || 'Failed to verify document');
    }
  };

  const confirmReject = async () => {
    if (!rejectReason.trim()) {
      warning('Rejection reason is required');
      return;
    }
    try {
      await api.rejectDocument(selectedDoc.id, rejectReason);
      setShowRejectModal(false);
      setRejectReason('');
      fetchDocuments();
      success('Document rejected successfully');
    } catch (error) {
      console.error('Error rejecting document:', error);
      showError(error.message || 'Failed to reject document');
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteDocument(selectedDoc.id);
      setShowDeleteModal(false);
      fetchDocuments();
      success('Document deleted successfully');
    } catch (error) {
      console.error('Error deleting document:', error);
      showError(error.message || 'Failed to delete document');
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Document Management</h1>
        <p>Upload and verify client documents. Max file size: 10MB. Allowed formats: PDF, JPG, PNG</p>
      </div>

      <div className="page-actions">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-dropdown">
          <Filter size={20} />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">All Types</option>
            <option value="ID Card">ID Card</option>
            <option value="Business License">Business License</option>
            <option value="Land Title">Land Title</option>
            <option value="Bank Statement">Bank Statement</option>
            <option value="Income Proof">Income Proof</option>
          </select>
        </div>

        <button className="btn-primary" onClick={() => setShowUploadModal(true)}>
          <Upload size={20} />
          Upload Document
        </button>
      </div>

      {loading ? (
        <div className="table-container">
          <p style={{ textAlign: 'center', padding: '2rem' }}>Loading documents...</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Doc ID</th>
                <th>Client</th>
                <th>Loan ID</th>
                <th>Type</th>
                <th>File Name</th>
                <th>Size</th>
                <th>Upload Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.id}</td>
                  <td>{doc.client || doc.client_name || doc.client_id || '-'}</td>
                  <td>{doc.loanId || doc.loan_id || '-'}</td>
                  <td>{doc.type}</td>
                  <td>{doc.fileName || doc.file_name || '-'}</td>
                  <td>{doc.fileSize || (doc.file_name ? '-' : '-')}</td>
                  <td>{doc.uploadDate || doc.uploaded_at || '-'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={`status ${doc.status === 'Verified' ? 'active' : doc.status === 'Pending' ? 'pending' : 'inactive'}`}>
                        {doc.status}
                      </span>
                      {doc.status === 'Rejected' && doc.rejectionReason && (
                        <AlertCircle size={16} className="warning-icon" title={doc.rejectionReason} />
                      )}
                    </div>
                  </td>
                  <td>
                    <button className="btn-icon edit" title="View" onClick={() => handleViewDocument(doc)}>
                      <Eye size={18} />
                    </button>
                    <button className="btn-icon edit" title="Download" onClick={() => handleDownloadDocument(doc)}>
                      <Download size={18} />
                    </button>
                    {doc.status === 'Pending' && (
                      <>
                        <button className="btn-icon edit" title="Verify" onClick={() => handleVerify(doc)}>
                          <Check size={18} />
                        </button>
                        <button className="btn-icon delete" title="Reject" onClick={() => handleReject(doc)}>
                          <XCircle size={18} />
                        </button>
                      </>
                    )}
                    <button className="btn-icon delete" title="Delete" onClick={() => handleDelete(doc)}>
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showUploadModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Upload Document</h2>
              <button onClick={() => setShowUploadModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Client Name <span className="required">*</span></label>
                <input
                  type="text"
                  value={uploadData.client}
                  onChange={(e) => setUploadData({ ...uploadData, client: e.target.value })}
                  placeholder="Enter client name"
                  required
                />
              </div>
              <div className="form-group">
                <label>Loan ID <span className="required">*</span></label>
                <input
                  type="text"
                  value={uploadData.loanId}
                  onChange={(e) => setUploadData({ ...uploadData, loanId: e.target.value })}
                  placeholder="Enter loan ID (e.g., LN-001)"
                  required
                />
              </div>
              <div className="form-group">
                <label>Document Type <span className="required">*</span></label>
                <select
                  value={uploadData.documentType}
                  onChange={(e) => setUploadData({ ...uploadData, documentType: e.target.value })}
                  required
                >
                  <option value="ID Card">ID Card</option>
                  <option value="Business License">Business License</option>
                  <option value="Land Title">Land Title</option>
                  <option value="Bank Statement">Bank Statement</option>
                  <option value="Income Proof">Income Proof</option>
                </select>
              </div>
              <div className="form-group">
                <label>Upload File <span className="required">*</span></label>
                <div className="file-upload-area">
                  <input
                    type="file"
                    id="documentFile"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  <label htmlFor="documentFile" className="file-upload-label">
                    <Upload size={32} />
                    <p>Click to select a file</p>
                    <p className="file-hint">Max 10MB • PDF, JPG, PNG</p>
                  </label>
                  {selectedFile && (
                    <div className="selected-file">
                      <FileText size={16} />
                      <span>{selectedFile.name}</span>
                      <span className="file-size">({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</span>
                      <button onClick={() => setSelectedFile(null)} className="remove-file">×</button>
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowUploadModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleUpload}>
                  <Upload size={18} />
                  Upload Document
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showViewModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2>View Document</h2>
              <button onClick={() => setShowViewModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Document ID</label>
                <p>{selectedDoc?.id}</p>
              </div>
              <div className="form-group">
                <label>Client</label>
                <p>{selectedDoc?.client || selectedDoc?.client_name || selectedDoc?.client_id || '-'}</p>
              </div>
              <div className="form-group">
                <label>Loan ID</label>
                <p>{selectedDoc?.loanId || selectedDoc?.loan_id || '-'}</p>
              </div>
              <div className="form-group">
                <label>Document Type</label>
                <p>{selectedDoc?.type}</p>
              </div>
              <div className="form-group">
                <label>File Name</label>
                <p>{selectedDoc?.fileName || selectedDoc?.file_name || '-'}</p>
              </div>
              <div className="form-group">
                <label>File Size</label>
                <p>{selectedDoc?.fileSize || '-'}</p>
              </div>
              <div className="form-group">
                <label>Upload Date</label>
                <p>{selectedDoc?.uploadDate || selectedDoc?.uploaded_at || '-'}</p>
              </div>
              <div className="form-group">
                <label>Status</label>
                <span className={`status ${selectedDoc?.status === 'Verified' ? 'active' : selectedDoc?.status === 'Pending' ? 'pending' : 'inactive'}`}>
                  {selectedDoc?.status}
                </span>
              </div>
              {selectedDoc?.rejectionReason && (
                <div className="form-group">
                  <label>Rejection Reason</label>
                  <p style={{ color: '#dc2626' }}>{selectedDoc.rejectionReason}</p>
                </div>
              )}
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowViewModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={() => handleDownloadDocument(selectedDoc)}>
                  <Download size={18} />
                  Download
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showVerifyModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Verify Document</h2>
              <button onClick={() => setShowVerifyModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Document ID:</strong> {selectedDoc?.id}</p>
              <p><strong>File Name:</strong> {selectedDoc?.fileName || selectedDoc?.file_name || '-'}</p>
              <p><strong>Type:</strong> {selectedDoc?.type}</p>
              <p><strong>Client:</strong> {selectedDoc?.client || selectedDoc?.client_name || selectedDoc?.client_id || '-'}</p>
              <div className="info-card" style={{ marginBottom: '1rem' }}>
                <Check size={20} />
                <span>Are you sure you want to verify this document? This will mark it as approved.</span>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowVerifyModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={confirmVerify}>
                  <Check size={18} />
                  Verify Document
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRejectModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Reject Document</h2>
              <button onClick={() => setShowRejectModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Document ID:</strong> {selectedDoc?.id}</p>
              <p><strong>File Name:</strong> {selectedDoc?.fileName || selectedDoc?.file_name || '-'}</p>
              <p><strong>Type:</strong> {selectedDoc?.type}</p>
              <p><strong>Client:</strong> {selectedDoc?.client || selectedDoc?.client_name || selectedDoc?.client_id || '-'}</p>
              <div className="form-group">
                <label>Rejection Reason <span className="required">*</span></label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Please provide a reason for rejection"
                  rows={4}
                  required
                />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowRejectModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary delete" onClick={confirmReject}>
                  <XCircle size={18} />
                  Reject Document
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Delete Document</h2>
              <button onClick={() => setShowDeleteModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p><strong>Document ID:</strong> {selectedDoc?.id}</p>
              <p><strong>File Name:</strong> {selectedDoc?.fileName || selectedDoc?.file_name || '-'}</p>
              <p><strong>Type:</strong> {selectedDoc?.type}</p>
              <p><strong>Client:</strong> {selectedDoc?.client || selectedDoc?.client_name || selectedDoc?.client_id || '-'}</p>
              <div className="info-card" style={{ marginBottom: '1rem', background: '#fef2f2', borderColor: '#fca5a5' }}>
                <AlertCircle size={20} style={{ color: '#dc2626' }} />
                <span style={{ color: '#dc2626' }}>Warning: This action cannot be undone. The document will be permanently deleted.</span>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowDeleteModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary delete" onClick={confirmDelete}>
                  <Trash2 size={18} />
                  Delete Document
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Documents;
