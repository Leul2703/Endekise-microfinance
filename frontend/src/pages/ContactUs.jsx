import { useMemo, useState } from 'react';
import { Mail, Phone, MessageSquareText, ShieldCheck } from 'lucide-react';
import './admin/AdminPages.css';
import api from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const stripEmojis = (value) => String(value || '').replace(EMOJI_REGEX, '');

const ContactUs = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { success, error, warning } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    category: 'complaint',
    subject: '',
    message: ''
  });

  const defaults = useMemo(() => ({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || ''
  }), [user?.email, user?.name, user?.phone]);

  const effectiveForm = useMemo(() => ({
    ...form,
    name: form.name || defaults.name,
    email: form.email || defaults.email,
    phone: form.phone || defaults.phone
  }), [defaults.email, defaults.name, defaults.phone, form]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!effectiveForm.email.trim()) {
      warning('Email is required so we can respond.');
      return;
    }
    if (!effectiveForm.message.trim()) {
      warning('Please enter your message.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(effectiveForm.email.trim())) {
      warning('Please enter a valid email address.');
      return;
    }
    if (effectiveForm.phone && !/^\d+$/.test(effectiveForm.phone)) {
      warning('Phone number must contain digits only.');
      return;
    }
    try {
      setSubmitting(true);
      const resp = await api.submitContactMessage({
        name: effectiveForm.name,
        email: effectiveForm.email,
        phone: effectiveForm.phone,
        category: effectiveForm.category,
        subject: effectiveForm.subject,
        message: effectiveForm.message
      });
      success(`Message received. Reference: ${resp?.id || 'N/A'}`);
      setForm((prev) => ({ ...prev, subject: '', message: '' }));
    } catch (err) {
      error(err?.message || 'Failed to submit message.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Contact Us</h1>
        <p>Submit complaints, compliance concerns, or service feedback. Our team will review and respond.</p>
        <div style={{ marginTop: '0.75rem' }}>
          <button className="btn-secondary" type="button" onClick={() => navigate(-1)}>
            Back
          </button>
        </div>
      </div>

      <div className="info-card" style={{ marginBottom: '1.25rem', background: '#f0fdf4', borderColor: '#86efac' }}>
        <ShieldCheck size={22} style={{ color: '#166534' }} />
        <div>
          <strong style={{ color: '#166534' }}>Compliance & customer protection</strong>
          <p style={{ margin: 0, color: '#166534' }}>
            Use this form to report issues, fraud suspicion, or unfair treatment. Include dates, amounts, and any reference IDs.
          </p>
        </div>
      </div>

      <div className="table-container" style={{ padding: '1.25rem' }}>
        <form onSubmit={onSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: stripEmojis(e.target.value) }))}
              placeholder={defaults.name || 'Your name'}
            />
          </div>

          <div className="form-group">
            <label>Email <span className="required">*</span></label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Mail size={18} />
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: stripEmojis(e.target.value) }))}
                placeholder={defaults.email || 'you@example.com'}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Phone (optional)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Phone size={18} />
              <input
                type="text"
                inputMode="numeric"
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value.replace(/\D/g, '') }))}
                placeholder={defaults.phone || '2519...'}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Category</label>
            <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
              <option value="complaint">Complaint</option>
              <option value="compliance">Compliance concern</option>
              <option value="fraud">Fraud suspicion</option>
              <option value="support">Support request</option>
              <option value="feedback">Feedback</option>
            </select>
          </div>

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Subject (optional)</label>
            <input
              type="text"
              value={form.subject}
              onChange={(e) => setForm((p) => ({ ...p, subject: stripEmojis(e.target.value) }))}
              placeholder="Short summary"
            />
          </div>

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Message <span className="required">*</span></label>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
              <MessageSquareText size={18} style={{ marginTop: '0.4rem' }} />
              <textarea
                value={form.message}
                onChange={(e) => setForm((p) => ({ ...p, message: stripEmojis(e.target.value) }))}
                placeholder="Describe what happened and include any IDs (loan id, savings id, transaction id, etc.)"
                rows={7}
                required
              />
            </div>
          </div>

          <div className="modal-actions" style={{ gridColumn: '1 / -1' }}>
            <button className="btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ContactUs;

