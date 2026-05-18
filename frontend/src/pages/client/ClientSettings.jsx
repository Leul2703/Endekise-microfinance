import { useState, useEffect } from 'react';
import { Save, X, Lock, Bell, User, ShieldCheck } from 'lucide-react';
import '../admin/AdminPages.css';
import './ClientPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { validateEmail, validatePasswordStrength } from '../../utils/validation';

const ClientSettings = () => {
  const { success, error: showError, warning } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [notifications, setNotifications] = useState({ emailNotifications: true, smsNotifications: true, reminders: true });

  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const client = await api.getMyClientProfile();
      setProfile({
        firstName: client?.firstName || client?.name?.split?.(' ')?.[0] || '',
        lastName: client?.lastName || client?.name?.split?.(' ').slice(1).join(' ') || '',
        email: client?.email || '',
        phone: client?.phone || ''
      });
      const prefs = client?.notification_preferences || {};
      setNotifications({
        emailNotifications: prefs.emailNotifications !== false,
        smsNotifications: prefs.smsNotifications !== false,
        reminders: prefs.paymentReminders !== false
      });
    } catch (err) {
      console.error('Failed loading settings', err);
      showError(err.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!profile.firstName.trim()) return warning('First name required');
    if (!validateEmail(profile.email)) return warning('Enter a valid email');

    setSaving(true);
    try {
      await api.updateMyClientProfile({
        ...profile,
        notification_preferences: {
          emailNotifications: notifications.emailNotifications,
          smsNotifications: notifications.smsNotifications,
          paymentReminders: notifications.reminders
        }
      });
      success('Settings saved');
    } catch (err) {
      console.error('Save settings error', err);
      showError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!passwords.current || !passwords.new || !passwords.confirm) return warning('Fill all password fields');
    if (passwords.new !== passwords.confirm) return warning('New password and confirm do not match');
    const errors = validatePasswordStrength(passwords.new);
    if (errors.length) return warning('Password does not meet complexity requirements');

    setChangingPassword(true);
    try {
      await api.changeClientPassword(passwords.current, passwords.new, passwords.confirm);
      success('Password changed');
      setPasswords({ current: '', new: '', confirm: '' });
    } catch (err) {
      console.error('Change password error', err);
      showError(err.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1>Settings</h1>
        <p>Manage account, security and notification preferences</p>
      </div>

      {loading ? (
        <div className="table-container"><p style={{ padding: '2rem', textAlign: 'center' }}>Loading settings...</p></div>
      ) : (
        <div className="settings-grid">
          <section className="settings-card">
            <div className="settings-card-header"><User size={18} /><h3>Account</h3></div>
            <div className="settings-card-body">
              <label>First name</label>
              <input value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} />
              <label>Last name</label>
              <input value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} />
              <label>Email</label>
              <input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
              <label>Phone</label>
              <input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            </div>
            <div className="settings-card-actions">
              <button className="btn-primary" onClick={handleSaveSettings} disabled={saving}>{saving ? 'Saving...' : (<><Save size={14}/> Save</>)}</button>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-header"><Bell size={18} /><h3>Notifications</h3></div>
            <div className="settings-card-body">
              <label className="checkbox-row"><input type="checkbox" checked={notifications.emailNotifications} onChange={() => setNotifications({ ...notifications, emailNotifications: !notifications.emailNotifications })} /> Email alerts</label>
              <label className="checkbox-row"><input type="checkbox" checked={notifications.smsNotifications} onChange={() => setNotifications({ ...notifications, smsNotifications: !notifications.smsNotifications })} /> SMS alerts</label>
              <label className="checkbox-row"><input type="checkbox" checked={notifications.reminders} onChange={() => setNotifications({ ...notifications, reminders: !notifications.reminders })} /> Payment reminders</label>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-header"><Lock size={18} /><h3>Security</h3></div>
            <div className="settings-card-body">
              <label>Current password</label>
              <input type="password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} />
              <label>New password</label>
              <input type="password" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} />
              <label>Confirm new password</label>
              <input type="password" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} />
            </div>
            <div className="settings-card-actions">
              <button className="btn-primary" onClick={handleChangePassword} disabled={changingPassword}>{changingPassword ? 'Updating...' : 'Change password'}</button>
            </div>
          </section>

        </div>
      )}
    </div>
  );
};

export default ClientSettings;
