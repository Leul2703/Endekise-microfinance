import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import './Login.css';
import { stripEmojis, formatPhoneInput, validateRegistrationForm } from '../utils/validation';

const Register = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    full_name: '',
    gender: '',
    date_of_birth: '',
    phone: '+251',
    address: '',
    id_number: '',
    id_type: '',
    id_document: '',
    monthly_income: '',
    requested_loan_amount: '',
    income_source: '',
    email: '',
    id_document_file: null,
    profile_photo_file: null
  });
  const [touched, setTouched] = useState({});
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fieldErrors = useMemo(() => validateRegistrationForm(formData), [formData]);
  const showFieldError = (name) => (touched[name] ? fieldErrors[name] : '');

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      setFormData((current) => ({ ...current, [name]: formatPhoneInput(value) }));
      return;
    }
    if (name === 'id_number' && (formData.id_type === 'National ID' || formData.id_type === 'Fayda ID')) {
      setFormData((current) => ({ ...current, [name]: value.replace(/\D/g, '').slice(0, 16) }));
      return;
    }
    setFormData((current) => ({ ...current, [name]: stripEmojis(value) }));
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched((current) => ({ ...current, [name]: true }));
    if (name === 'phone') {
      const normalized = formatPhoneInput(formData.phone);
      setFormData((current) => ({ ...current, phone: normalized || '+251' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setTouched({
      full_name: true,
      phone: true,
      email: true,
      id_number: true
    });

    if (Object.keys(validateRegistrationForm(formData)).length > 0) {
      setError('Please fix the highlighted fields before submitting.');
      return;
    }

    const required = ['full_name', 'gender', 'date_of_birth', 'phone', 'address', 'id_number', 'id_type'];
    const missing = required.filter((field) => !String(formData[field] || '').trim());
    if (missing.length > 0) {
      setError('Please complete all required KYC fields before submitting.');
      return;
    }
    if (!String(formData.id_document || '').trim() && !formData.id_document_file) {
      setError('Please provide ID document reference or upload ID picture.');
      return;
    }

    const monthlyIncome = Number(formData.monthly_income);
    if (!String(formData.monthly_income).trim() || Number.isNaN(monthlyIncome) || monthlyIncome <= 0) {
      setError('Monthly income must be a positive number.');
      return;
    }

    try {
      setSubmitting(true);
      const result = await api.publicClientRegistration({
        full_name: formData.full_name.trim(),
        gender: formData.gender,
        date_of_birth: formData.date_of_birth,
        phone: formatPhoneInput(formData.phone),
        address: formData.address.trim(),
        id_number: formData.id_number.trim(),
        id_type: formData.id_type,
        id_document: formData.id_document.trim(),
        monthly_income: formData.monthly_income,
        requested_loan_amount: formData.requested_loan_amount || 0,
        income_source: formData.income_source || '',
        email: formData.email.trim(),
        id_document_file: formData.id_document_file,
        profile_photo_file: formData.profile_photo_file
      });

      setSuccessMessage(result?.message || 'Registration submitted successfully.');
      setFormData({
        full_name: '',
        gender: '',
        date_of_birth: '',
        phone: '+251',
        address: '',
        id_number: '',
        id_type: '',
        id_document: '',
        monthly_income: '',
        requested_loan_amount: '',
        income_source: '',
        email: '',
        id_document_file: null,
        profile_photo_file: null
      });
      setTouched({});
    } catch (err) {
      setError(err.message || 'Failed to register client account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card register-card">
          <div className="login-header">
            <img src="/edekise-logo.svg" alt="Edekise Microfinance" className="login-logo" />
            <h1>Client Registration</h1>
            <p>Apply from home. Your registration will be reviewed by admin before account creation.</p>
          </div>

          <form className="login-form register-form" onSubmit={handleSubmit}>
            {error && <div className="error-message">{error}</div>}
            {successMessage && <div className="error-message success-inline">{successMessage}</div>}

            <section className="form-section">
              <h3>Personal Information</h3>
              <div className="form-grid">
                <div className="form-group form-group-full">
                  <label htmlFor="full_name">Full Name</label>
                  <input id="full_name" name="full_name" type="text" value={formData.full_name} onChange={handleChange} onBlur={handleBlur} required className={showFieldError('full_name') ? 'input-invalid' : ''} />
                  {showFieldError('full_name') && <small className="field-hint error">{showFieldError('full_name')}</small>}
                </div>
                <div className="form-group">
                  <label htmlFor="gender">Gender</label>
                  <select id="gender" name="gender" value={formData.gender} onChange={handleChange} required>
                    <option value="">Select gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="date_of_birth">Date of Birth</label>
                  <input id="date_of_birth" name="date_of_birth" type="date" value={formData.date_of_birth} onChange={handleChange} required />
                </div>
                <div className="form-group">
                  <label htmlFor="phone">Phone (+251)</label>
                  <input id="phone" name="phone" type="tel" placeholder="+251912345678" value={formData.phone} onChange={handleChange} onBlur={handleBlur} required className={showFieldError('phone') ? 'input-invalid' : ''} />
                  {showFieldError('phone') && <small className="field-hint error">{showFieldError('phone')}</small>}
                </div>
                <div className="form-group">
                  <label htmlFor="email">Email <span className="required">*</span></label>
                  <input id="email" name="email" type="email" value={formData.email} onChange={handleChange} onBlur={handleBlur} required className={showFieldError('email') ? 'input-invalid' : ''} />
                  {showFieldError('email') && <small className="field-hint error">{showFieldError('email')}</small>}
                </div>
                <div className="form-group form-group-full">
                  <label htmlFor="address">Address</label>
                  <input id="address" name="address" type="text" value={formData.address} onChange={handleChange} required />
                </div>
              </div>
            </section>

            <section className="form-section">
              <h3>KYC Verification</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="id_type">ID Type</label>
                  <select id="id_type" name="id_type" value={formData.id_type} onChange={handleChange} required>
                    <option value="">Select ID type</option>
                    <option value="National ID">National ID (Fayda 16-digit)</option>
                    <option value="Passport">Passport</option>
                    <option value="Driving License">Driving License</option>
                    <option value="Kebele ID">Kebele ID</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="id_number">ID Number</label>
                  <input id="id_number" name="id_number" type="text" value={formData.id_number} onChange={handleChange} onBlur={handleBlur} required placeholder={formData.id_type === 'National ID' ? '16-digit Fayda ID' : ''} className={showFieldError('id_number') ? 'input-invalid' : ''} />
                  {showFieldError('id_number') && <small className="field-hint error">{showFieldError('id_number')}</small>}
                </div>
                <div className="form-group form-group-full">
                  <label htmlFor="id_document">ID Document Reference</label>
                  <input id="id_document" name="id_document" type="text" value={formData.id_document} onChange={handleChange} placeholder="Document number or upload reference" />
                </div>
                <div className="form-group">
                  <label htmlFor="id_document_file">Upload ID Picture</label>
                  <input id="id_document_file" name="id_document_file" type="file" accept="image/*" onChange={(e) => setFormData((current) => ({ ...current, id_document_file: e.target.files?.[0] || null }))} />
                </div>
                <div className="form-group">
                  <label htmlFor="profile_photo_file">Upload Profile Picture</label>
                  <input id="profile_photo_file" name="profile_photo_file" type="file" accept="image/*" onChange={(e) => setFormData((current) => ({ ...current, profile_photo_file: e.target.files?.[0] || null }))} />
                </div>
              </div>
            </section>

            <section className="form-section">
              <h3>Financial Profile</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="monthly_income">Monthly Income (ETB)</label>
                  <input id="monthly_income" name="monthly_income" type="number" min="1" value={formData.monthly_income} onChange={handleChange} required />
                </div>
                <div className="form-group">
                  <label htmlFor="requested_loan_amount">Requested Loan Amount (Optional)</label>
                  <input id="requested_loan_amount" name="requested_loan_amount" type="number" min="0" value={formData.requested_loan_amount} onChange={handleChange} />
                </div>
                <div className="form-group form-group-full">
                  <label htmlFor="income_source">Income Source (Optional)</label>
                  <select id="income_source" name="income_source" value={formData.income_source} onChange={handleChange}>
                    <option value="">Select income source</option>
                    <option value="Agriculture">Agriculture</option>
                    <option value="Trade">Trade</option>
                    <option value="Professional Employment">Professional Employment</option>
                    <option value="Student">Student</option>
                    <option value="Casual Labor">Casual Labor</option>
                    <option value="Remittance">Remittance</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
            </section>

            <button type="submit" className="login-button" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit for Admin Review'}
            </button>
          </form>

          <div className="login-footer">
            <p>Already have an account? <Link to="/login">Sign in</Link></p>
            <p><button type="button" className="back-home-link" onClick={() => navigate('/')}>Back to home</button></p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
