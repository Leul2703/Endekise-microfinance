import { useEffect, useMemo, useState } from 'react';
import { User, Mail, Phone, MapPin, Camera, Save, Lock, Bell, Upload, FileText, AlertCircle, BadgeCheck, ShieldCheck, FolderOpen, PiggyBank } from 'lucide-react';
import '../admin/AdminPages.css';
import './ClientPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { formatPhoneInput, validateEmail, validateEthiopianPhone, validatePasswordStrength } from '../../utils/validation';

const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const stripEmojis = (value) => String(value || '').replace(EMOJI_REGEX, '');
const hasEmoji = (value) => /\p{Extended_Pictographic}/u.test(String(value || ''));

const EMPTY_PROFILE = {
  id: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: '',
  idNumber: '',
  gender: '',
  disabilityStatus: 'None',
  marginalizedGroup: 'None',
  incomeSource: '',
  photoPath: '',
  groupId: ''
};

const PROFILE_KEYS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'address',
  'idNumber',
  'gender',
  'disabilityStatus',
  'marginalizedGroup',
  'incomeSource',
  'photoPath',
  'groupId'
];

const splitName = (name = '') => {
  const trimmed = name.trim();
  if (!trimmed) {
    return { firstName: '', lastName: '' };
  }

  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts.shift() || '',
    lastName: parts.join(' ')
  };
};

const mapClientToProfile = (client) => {
  const { firstName, lastName } = splitName(client?.name);
  return {
    id: client?.id || '',
    firstName,
    lastName,
    email: client?.email || '',
    phone: client?.phone || '',
    address: client?.address || '',
    idNumber: client?.id_number || '',
    gender: client?.gender || '',
    disabilityStatus: client?.disability_status || 'None',
    marginalizedGroup: client?.marginalized_group || 'None',
    incomeSource: client?.income_source || '',
    photoPath: client?.photo_path || '',
    groupId: client?.group_id || ''
  };
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const Profile = () => {
  const { success, error: showError, warning } = useToast();
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [originalProfile, setOriginalProfile] = useState(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [documentType, setDocumentType] = useState('kyc');
  const [selectedFile, setSelectedFile] = useState(null);
  const [kycStatus, setKycStatus] = useState('Pending');
  const [notifications, setNotifications] = useState({
    emailNotifications: true,
    smsNotifications: true,
    paymentReminders: true
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [originalNotifications, setOriginalNotifications] = useState({
    emailNotifications: true,
    smsNotifications: true,
    paymentReminders: true
  });
  const [depositObligations, setDepositObligations] = useState([]);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const client = await api.getMyClientProfile();
      const mappedProfile = mapClientToProfile(client);
      setProfile(mappedProfile);
      setOriginalProfile(deepClone(mappedProfile));
      setKycStatus(client?.kyc_status || 'Pending');
      const prefs = client?.notification_preferences || {};
      const loadedNotifications = {
        emailNotifications: prefs.emailNotifications !== false,
        smsNotifications: prefs.smsNotifications !== false,
        paymentReminders: prefs.paymentReminders !== false
      };
      setNotifications(loadedNotifications);
      setOriginalNotifications(deepClone(loadedNotifications));
      const [docs, depositData] = await Promise.all([
        api.getDocuments().catch(() => []),
        api.getMyDepositSchedule().catch(() => ({ obligations: [] }))
      ]);
      setDocuments(Array.isArray(docs) ? docs : []);
      setDepositObligations(Array.isArray(depositData?.obligations) ? depositData.obligations : []);
    } catch (error) {
      console.error('Error loading client profile:', error);
      showError(error.message || 'Failed to load client profile');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    if (name === 'phone') {
      setProfile((current) => ({
        ...current,
        [name]: formatPhoneInput(value)
      }));
      return;
    }
    setProfile((current) => ({
      ...current,
      [name]: stripEmojis(value)
    }));
  };

  const handleNotificationToggle = (fieldName) => {
    setNotifications((current) => ({
      ...current,
      [fieldName]: !current[fieldName]
    }));
  };

  const handleSave = async () => {
    if (!profile.firstName.trim()) {
      warning('First name is required');
      return;
    }
    if (!String(profile.email || '').trim()) {
      warning('Email is required.');
      return;
    }
    const emailErr = validateEmail(profile.email);
    const phoneErr = validateEthiopianPhone(profile.phone, { required: true });
    if (emailErr) {
      warning(emailErr);
      return;
    }
    if (phoneErr) {
      warning(phoneErr);
      return;
    }
    if (
      hasEmoji(profile.firstName) ||
      hasEmoji(profile.lastName) ||
      hasEmoji(profile.email) ||
      hasEmoji(profile.phone) ||
      hasEmoji(profile.address) ||
      hasEmoji(profile.idNumber) ||
      hasEmoji(profile.groupId)
    ) {
      warning('Emoji characters are not allowed.');
      return;
    }

    setSaving(true);
    try {
      const response = await api.updateMyClientProfile({
        ...profile,
        emailNotifications: notifications.emailNotifications,
        smsNotifications: notifications.smsNotifications,
        paymentReminders: notifications.paymentReminders
      });
      const updatedProfile = mapClientToProfile(response.client);
      setProfile(updatedProfile);
      setOriginalProfile(deepClone(updatedProfile));
      const prefs = response.client?.notification_preferences || {};
      const savedNotifications = {
        emailNotifications: prefs.emailNotifications !== false,
        smsNotifications: prefs.smsNotifications !== false,
        paymentReminders: prefs.paymentReminders !== false
      };
      setNotifications(savedNotifications);
      setOriginalNotifications(deepClone(savedNotifications));
      success('Client profile saved successfully');
    } catch (error) {
      console.error('Error saving client profile:', error);
      showError(error.message || 'Failed to save client profile');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setProfile(deepClone(originalProfile));
    setNotifications(deepClone(originalNotifications));
  };

  const handleDocumentUpload = async () => {
    if (!selectedFile) {
      warning('Please choose a PDF or JPEG document to upload');
      return;
    }

    if (!profile.id) {
      showError('Client profile is not ready yet. Please reload and try again.');
      return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('type', documentType);
    formData.append('client_id', profile.id);

    setUploading(true);
    try {
      const uploadedDocument = await api.uploadDocument(formData);
      setDocuments((current) => [uploadedDocument, ...current]);
      setSelectedFile(null);
      success('Document uploaded successfully');
    } catch (uploadError) {
      console.error('Document upload error:', uploadError);
      showError(uploadError.message || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const hasProfileChanges = useMemo(
    () => JSON.stringify(PROFILE_KEYS.reduce((acc, key) => ({ ...acc, [key]: profile[key] }), {}))
      !== JSON.stringify(PROFILE_KEYS.reduce((acc, key) => ({ ...acc, [key]: originalProfile[key] }), {})),
    [originalProfile, profile]
  );

  const hasNotificationChanges = JSON.stringify(notifications) !== JSON.stringify(originalNotifications);
  const hasChanges = hasProfileChanges || hasNotificationChanges;
  const completedProfileChecks = [profile.phone, profile.idNumber, profile.address, profile.incomeSource].filter(Boolean).length;
  const kycChecklist = [
    { label: 'Phone number', done: Boolean(profile.phone) },
    { label: 'National ID', done: Boolean(profile.idNumber) },
    { label: 'Address', done: Boolean(profile.address) },
    { label: 'Income source', done: Boolean(profile.incomeSource) },
    { label: 'KYC document uploaded', done: documents.length > 0 },
    { label: 'Staff verification', done: kycStatus === 'Verified' }
  ];

  const handlePasswordChange = async () => {
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      warning('Please fill current, new, and confirm password fields');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      warning('New password and confirmation do not match');
      return;
    }

    const strengthErrors = validatePasswordStrength(passwordData.newPassword);
    if (strengthErrors.length > 0) {
      setPasswordErrors(strengthErrors);
      warning('Password does not meet complexity requirements');
      return;
    }

    setChangingPassword(true);
    try {
      setPasswordErrors([]);
      await api.changeClientPassword(
        passwordData.currentPassword,
        passwordData.newPassword,
        passwordData.confirmPassword
      );
      success('Password changed successfully');
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (passwordError) {
      if (Array.isArray(passwordError?.details) && passwordError.details.length > 0) {
        setPasswordErrors(passwordError.details);
        showError(passwordError.message || 'Password does not meet complexity requirements');
      } else {
        showError(passwordError.message || 'Failed to change password');
      }
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>My Profile</h1>
        <p>Manage your personal information and preferences</p>
      </div>

      {loading ? (
        <div className="table-container">
          <p style={{ textAlign: 'center', padding: '2rem' }}>Loading client profile...</p>
        </div>
      ) : (
        <>
          <section className="client-hero-card">
            <div>
              <span className="client-hero-eyebrow">Profile center</span>
              <h2>Keep your records complete and verified.</h2>
              <p>Update personal details, manage security, and upload KYC files from one client profile workspace.</p>
            </div>
            <div className="client-hero-actions">
              <div className="client-hero-note">
                <BadgeCheck size={18} />
                <span>KYC status: {kycStatus}</span>
              </div>
            </div>
          </section>

          <div className="client-overview-grid">
            <div className="client-overview-card">
              <div className="client-overview-icon">
                <ShieldCheck size={18} />
              </div>
              <div className="client-overview-content">
                <span>Profile completion</span>
                <strong>{completedProfileChecks}/4 key items ready</strong>
              </div>
            </div>
            <div className="client-overview-card">
              <div className="client-overview-icon">
                <FolderOpen size={18} />
              </div>
              <div className="client-overview-content">
                <span>Uploaded documents</span>
                <strong>{documents.length}</strong>
              </div>
            </div>
            <div className="client-overview-card">
              <div className="client-overview-icon">
                <Bell size={18} />
              </div>
              <div className="client-overview-content">
                <span>Active alerts</span>
                <strong>{Object.values(notifications).filter(Boolean).length}</strong>
              </div>
            </div>
          </div>

          {kycStatus !== 'Verified' && (
            <section className="profile-kyc-banner">
              <AlertCircle size={20} />
              <div>
                <strong>KYC verification {kycStatus === 'Rejected' ? 'required again' : 'in progress'}</strong>
                <p>Complete the checklist below. A branch manager will verify your identity before all services are enabled.</p>
                <ul className="kyc-checklist">
                  {kycChecklist.map((item) => (
                    <li key={item.label} className={item.done ? 'done' : ''}>{item.label}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {depositObligations.length > 0 && (
            <section className="profile-section profile-section-standalone">
              <div className="section-header">
                <PiggyBank size={24} />
                <h2>Monthly deposit schedule</h2>
              </div>
              <div className="mobile-card-list profile-deposit-list">
                {depositObligations.slice(0, 6).map((row) => (
                  <div className="schedule-mobile-card" key={row.id}>
                    <div className="schedule-mobile-card-header">
                      <strong>{row.account_type || 'Savings'}</strong>
                      <span className={`status ${row.status === 'paid' ? 'active' : row.status === 'missed' ? 'high' : 'pending'}`}>
                        {row.status}
                      </span>
                    </div>
                    <div className="schedule-mobile-row"><span>Due</span><span>{row.due_date}</span></div>
                    <div className="schedule-mobile-row"><span>Required</span><strong>{Number(row.required_amount || 0).toLocaleString()} ETB</strong></div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="profile-container">
          <div className="profile-sidebar">
            <div className="profile-photo">
              <div className="photo-placeholder">
                <User size={64} />
              </div>
              <button className="btn-icon edit photo-upload" type="button">
                <Camera size={20} />
              </button>
            </div>
            <div className="profile-name">
              <h2>{profile.firstName} {profile.lastName}</h2>
              <p>Client ID: {profile.id ? `CLI-${profile.id}` : 'Unavailable'}</p>
            </div>
            <div className="profile-stats">
              <div className="stat-item">
                <span className={`stat-value ${kycStatus === 'Verified' ? 'verified' : 'pending'}`}>{kycStatus}</span>
                <span className="stat-label">KYC Status</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{profile.phone ? 'Verified' : 'Pending'}</span>
                <span className="stat-label">Phone</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{profile.idNumber ? 'Verified' : 'Pending'}</span>
                <span className="stat-label">ID</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{profile.address ? 'Complete' : 'Pending'}</span>
                <span className="stat-label">Address</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{profile.incomeSource ? 'Complete' : 'Pending'}</span>
                <span className="stat-label">Income Source</span>
              </div>
            </div>
          </div>

          <div className="profile-main">
            <div className="profile-section">
              <div className="section-header">
                <User size={24} />
                <h2>Personal Information</h2>
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label>First Name</label>
                  <input type="text" name="firstName" value={profile.firstName} onChange={handleChange} />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input type="text" name="lastName" value={profile.lastName} onChange={handleChange} />
                </div>
                <div className="form-group">
                  <label>Email Address</label>
                  <div className="input-with-icon">
                    <Mail size={18} />
                    <input type="email" name="email" value={profile.email} onChange={handleChange} required />
                  </div>
                </div>
                <div className="form-group">
                  <label>Phone Number</label>
                  <div className="input-with-icon">
                    <Phone size={18} />
                    <input type="tel" name="phone" inputMode="numeric" value={profile.phone} onChange={handleChange} />
                  </div>
                </div>
                <div className="form-group">
                  <label>ID Number</label>
                  <input type="text" name="idNumber" value={profile.idNumber} onChange={handleChange} />
                </div>
                <div className="form-group full-width">
                  <label>Address</label>
                  <div className="input-with-icon">
                    <MapPin size={18} />
                    <input type="text" name="address" value={profile.address} onChange={handleChange} />
                  </div>
                </div>
                <div className="form-group">
                  <label>Gender</label>
                  <select name="gender" value={profile.gender} onChange={handleChange}>
                    <option value="">Select Gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Disability Status</label>
                  <select name="disabilityStatus" value={profile.disabilityStatus} onChange={handleChange}>
                    <option value="None">None</option>
                    <option value="Visual Impairment">Visual Impairment</option>
                    <option value="Hearing Impairment">Hearing Impairment</option>
                    <option value="Mobility Impairment">Mobility Impairment</option>
                    <option value="Cognitive Impairment">Cognitive Impairment</option>
                    <option value="Other">Other</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>
                <div className="form-group full-width">
                  <label>Marginalized Group</label>
                  <select name="marginalizedGroup" value={profile.marginalizedGroup} onChange={handleChange}>
                    <option value="None">None</option>
                    <option value="Women">Women</option>
                    <option value="Persons with Disabilities">Persons with Disabilities</option>
                    <option value="Youth">Youth</option>
                    <option value="Rural Communities">Rural Communities</option>
                    <option value="Indigenous Communities">Indigenous Communities</option>
                    <option value="Other">Other</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>
                <div className="form-group full-width">
                  <label>Income Source</label>
                  <select name="incomeSource" value={profile.incomeSource} onChange={handleChange}>
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
                <div className="form-group full-width">
                  <label>Group ID (Optional)</label>
                  <input type="text" name="groupId" value={profile.groupId} onChange={handleChange} placeholder="Enter group ID if you belong to a lending group" />
                </div>
              </div>
            </div>

            <div className="profile-section">
              <div className="section-header">
                <Lock size={24} />
                <h2>Security Settings</h2>
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Current Password</label>
                  <input
                    type="password"
                    placeholder="Enter current password"
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData((current) => ({ ...current, currentPassword: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>New Password</label>
                  <input
                    type="password"
                    placeholder="Enter new password"
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData((current) => ({ ...current, newPassword: e.target.value }))}
                  />
                </div>
                <div className="form-group full-width">
                  <label>Confirm New Password</label>
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData((current) => ({ ...current, confirmPassword: e.target.value }))}
                  />
                </div>
                <div className="form-group full-width">
                  <div className="info-card" style={{ marginBottom: '0.5rem' }}>
                    <Lock size={18} />
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Password requirements</div>
                      <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#374151' }}>
                        <li>At least 12 characters</li>
                        <li>At least 1 uppercase and 1 lowercase letter</li>
                        <li>At least 1 number</li>
                        <li>At least 1 special character (example: !@#$)</li>
                        <li>Must not contain common weak patterns (example: password123)</li>
                      </ul>
                    </div>
                  </div>
                  {passwordErrors.length > 0 && (
                    <div className="info-card" style={{ borderColor: '#fecaca', background: '#fff1f2' }}>
                      <AlertCircle size={18} />
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Fix these issues</div>
                        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                          {passwordErrors.map((msg) => (
                            <li key={msg}>{msg}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
                <div className="form-group full-width">
                  <button className="btn-primary" type="button" onClick={handlePasswordChange} disabled={changingPassword}>
                    <Lock size={18} />
                    {changingPassword ? 'Changing Password...' : 'Change Password'}
                  </button>
                </div>
              </div>
            </div>

            <div className="profile-section">
              <div className="section-header">
                <Bell size={24} />
                <h2>Notification Preferences</h2>
              </div>
              <div className="preferences-list">
                <div className="preference-item">
                  <div className="preference-info">
                    <h3>Email Notifications</h3>
                    <p>Receive payment reminders and account updates via email</p>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={notifications.emailNotifications}
                      onChange={() => handleNotificationToggle('emailNotifications')}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
                <div className="preference-item">
                  <div className="preference-info">
                    <h3>SMS Notifications</h3>
                    <p>Receive important alerts via SMS</p>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={notifications.smsNotifications}
                      onChange={() => handleNotificationToggle('smsNotifications')}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
                <div className="preference-item">
                  <div className="preference-info">
                    <h3>Payment & deposit reminders</h3>
                    <p>Loan payments and monthly savings deposit due dates</p>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={notifications.paymentReminders}
                      onChange={() => handleNotificationToggle('paymentReminders')}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>
            </div>

            <div className="profile-section">
              <div className="section-header">
                <Upload size={24} />
                <h2>KYC Documents</h2>
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Document Type</label>
                  <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
                    <option value="kyc">KYC Document</option>
                    <option value="id">National ID</option>
                    <option value="collateral">Collateral</option>
                    <option value="income_proof">Income Proof</option>
                  </select>
                </div>
                <div className="form-group full-width">
                  <label>Choose file</label>
                  <label className="file-input-label">
                    <Upload size={18} />
                    {selectedFile ? selectedFile.name : 'Select PDF or JPEG'}
                    <input
                      type="file"
                      className="file-input-hidden"
                      accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg"
                      onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                    />
                  </label>
                </div>
              </div>
              <div className="profile-actions" style={{ marginTop: '1rem' }}>
                <button className="btn-primary" type="button" onClick={handleDocumentUpload} disabled={uploading || !selectedFile}>
                  <Upload size={20} />
                  {uploading ? 'Uploading...' : 'Upload Document'}
                </button>
              </div>

              <div className="mobile-card-list profile-docs-mobile" style={{ marginTop: '1.5rem' }}>
                {documents.length === 0 ? (
                  <p className="profile-empty-docs">No documents uploaded yet.</p>
                ) : documents.map((document) => (
                  <div className="mobile-record-card" key={document.id}>
                    <div className="mobile-record-header">
                      <strong>{document.type || 'Document'}</strong>
                      <span className="status pending">{document.status || 'Pending'}</span>
                    </div>
                    <p className="mobile-record-meta">{document.id}</p>
                  </div>
                ))}
              </div>
              <div className="table-container desktop-table-only" style={{ marginTop: '1.5rem' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Document ID</th>
                      <th>Type</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => (
                      <tr key={document.id}>
                        <td>{document.id}</td>
                        <td>{document.type}</td>
                        <td>{document.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="profile-actions">
              <button className="btn-primary" type="button" onClick={handleSave} disabled={saving || !hasChanges}>
                <Save size={20} />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button className="btn-secondary" type="button" onClick={handleCancel} disabled={!hasChanges}>
                Cancel
              </button>
            </div>
          </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Profile;
