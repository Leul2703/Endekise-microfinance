import { useEffect, useState } from 'react';
import { FileText, Upload, ShieldCheck, Files, Clock4 } from 'lucide-react';
import '../../pages/admin/AdminPages.css';
import './ClientPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../utils/dateTime';

const Documents = () => {
  const { success, error, warning } = useToast();
  const [documents, setDocuments] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [documentType, setDocumentType] = useState('id');
  const [uploading, setUploading] = useState(false);

  const loadDocuments = async () => {
    try {
      const data = await api.getDocuments();
      setDocuments(Array.isArray(data) ? data : []);
    } catch (err) {
      error(err.message || 'Failed to load documents');
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) {
      warning('Please choose a file to upload.');
      return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('type', documentType);

    try {
      setUploading(true);
      await api.uploadDocument(formData);
      success('Document uploaded successfully.');
      setSelectedFile(null);
      await loadDocuments();
    } catch (err) {
      error(err.message || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>My Documents</h1>
        <p>Upload and track your verification documents.</p>
      </div>

      <section className="client-hero-card">
        <div>
          <span className="client-hero-eyebrow">Document center</span>
          <h2>Keep verification files organized and easy to track.</h2>
          <p>Upload identification, income, or address proof and monitor the review status from one page.</p>
        </div>
        <div className="client-hero-actions">
          <div className="client-hero-note">
            <ShieldCheck size={18} />
            <span>{documents.filter((doc) => (doc.status || 'Pending') === 'Approved').length} documents approved</span>
          </div>
        </div>
      </section>

      <div className="client-overview-grid">
        <div className="client-overview-card">
          <div className="client-overview-icon">
            <Files size={18} />
          </div>
          <div className="client-overview-content">
            <span>Total uploaded</span>
            <strong>{documents.length}</strong>
          </div>
        </div>
        <div className="client-overview-card">
          <div className="client-overview-icon">
            <Clock4 size={18} />
          </div>
          <div className="client-overview-content">
            <span>Pending review</span>
            <strong>{documents.filter((doc) => (doc.status || 'Pending') === 'Pending').length}</strong>
          </div>
        </div>
        <div className="client-overview-card">
          <div className="client-overview-icon">
            <ShieldCheck size={18} />
          </div>
          <div className="client-overview-content">
            <span>Approved</span>
            <strong>{documents.filter((doc) => (doc.status || 'Pending') === 'Approved').length}</strong>
          </div>
        </div>
      </div>

      <div className="dashboard-card client-upload-card" style={{ marginBottom: '1.5rem' }}>
        <div className="form-group">
          <label>Document Type</label>
          <select value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
            <option value="id">Identification</option>
            <option value="income">Income Proof</option>
            <option value="address">Address Proof</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="form-group">
          <label>File</label>
          <input type="file" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
        </div>
        <button className="btn-primary" onClick={handleUpload} disabled={uploading}>
          <Upload size={18} />
          {uploading ? 'Uploading...' : 'Upload Document'}
        </button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Document ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Uploaded At</th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '2rem' }}>
                  <FileText size={18} style={{ marginRight: '0.5rem' }} />
                  No documents uploaded yet.
                </td>
              </tr>
            ) : documents.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.id}</td>
                <td>{doc.document_type || doc.type || '-'}</td>
                <td>{doc.status || 'Pending'}</td>
                <td>{formatDateTime(doc.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Documents;
