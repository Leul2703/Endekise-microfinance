import { Database, Bell, Shield, Globe, RefreshCw, Save, ServerCrash, Undo2, AlertTriangle } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import './AdminPages.css';
import api from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const Settings = () => {
  const { success, error: showError } = useToast();
  const [settings, setSettings] = useState(null);
  const [originalSettings, setOriginalSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchSettings = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    }
    setError('');

    try {
      const data = await api.getAdminSettings();
      setSettings(data);
      setOriginalSettings(deepClone(data));
    } catch (err) {
      console.error('Error fetching admin settings:', err);
      setError(err.message || 'Failed to load system settings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleRefresh = () => {
    fetchSettings(true);
  };

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSection = (section, field, value) => {
    setSettings((current) => ({
      ...current,
      [section]: {
        ...(current?.[section] || {}),
        [field]: value
      }
    }));
  };

  const handleSave = async () => {
    if (!settings) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      const updated = await api.updateAdminSettings(settings);
      setSettings(updated);
      setOriginalSettings(deepClone(updated));
      success('System settings saved successfully');
    } catch (err) {
      console.error('Error updating admin settings:', err);
      const message = err.message || 'Failed to save system settings';
      setError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (!originalSettings) {
      return;
    }
    setSettings(deepClone(originalSettings));
    setError('');
  };

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);
  const database = settings?.database || {};
  const notifications = settings?.notifications || {};
  const security = settings?.security || {};
  const system = settings?.system || {};

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>System Settings</h1>
          <p>Current runtime configuration and operational posture for the admin team.</p>
        </div>
        <button 
          className="btn-secondary" 
          onClick={handleRefresh}
          disabled={refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <RefreshCw size={18} className={refreshing ? 'spinning' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="info-card" style={{ marginBottom: '2rem', background: '#eff6ff', borderColor: '#bfdbfe' }}>
        <RefreshCw size={20} style={{ color: '#1d4ed8' }} />
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 0.25rem 0', color: '#1d4ed8' }}>Live Configuration View</h3>
          <p style={{ margin: 0, color: '#1d4ed8' }}>
            Runtime fields stay read-only, while the operational settings below now keep editable state until you save or cancel.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <RefreshCw size={48} className="spinning" style={{ color: '#3b82f6', marginBottom: '1rem' }} />
            <p style={{ color: '#6b7280' }}>Loading system settings...</p>
          </div>
        </div>
      ) : !settings ? (
        <div className="table-container">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem' }}>
            <AlertTriangle size={48} style={{ color: '#ef4444', marginBottom: '1rem' }} />
            <p style={{ color: '#ef4444', marginBottom: '1rem' }}>{error}</p>
            <button className="btn-primary" onClick={handleRefresh}>
              <RefreshCw size={18} />
              Try Again
            </button>
          </div>
        </div>
      ) : (
        <>
          {error ? (
            <div className="info-card" style={{ marginBottom: '1rem', background: '#fee2e2', borderColor: '#fecaca' }}>
              <ServerCrash size={20} style={{ color: '#b91c1c' }} />
              <span style={{ color: '#b91c1c' }}>{error}</span>
            </div>
          ) : null}
          <div className="settings-grid">
            <div className="settings-card">
              <div className="settings-header">
                <Database size={24} />
                <h2>Database Settings</h2>
              </div>
              <div className="settings-content">
                <div className="form-group">
                  <label>Database Engine</label>
                  <input type="text" value={database.engine || 'Unknown'} readOnly />
                </div>
                <div className="form-group">
                  <label>Database Host</label>
                  <input type="text" value={database.host || 'Unknown'} readOnly />
                </div>
                <div className="form-group">
                  <label>Database Port</label>
                  <input type="text" value={database.port || 'Unknown'} readOnly />
                </div>
                <div className="form-group">
                  <label>Database Name</label>
                  <input type="text" value={database.name || 'Unknown'} readOnly />
                </div>
                <div className="form-group">
                  <label>SSL Enabled</label>
                  <input type="text" value={database.ssl_enabled ? 'Yes' : 'No'} readOnly />
                </div>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-header">
                <Bell size={24} />
                <h2>Notification Settings</h2>
              </div>
              <div className="settings-content">
                <div className="form-group">
                  <label>Frontend URL</label>
                  <input
                    type="text"
                    value={notifications.frontend_url || ''}
                    onChange={(e) => updateSection('notifications', 'frontend_url', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Email Host</label>
                  <input
                    type="text"
                    value={notifications.email_host || ''}
                    onChange={(e) => updateSection('notifications', 'email_host', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Email Port</label>
                  <input
                    type="text"
                    value={notifications.email_port || ''}
                    onChange={(e) => updateSection('notifications', 'email_port', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Outgoing Email</label>
                  <input
                    type="text"
                    value={notifications.email_from || ''}
                    onChange={(e) => updateSection('notifications', 'email_from', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-header">
                <Shield size={24} />
                <h2>Security Settings</h2>
              </div>
              <div className="settings-content">
                <div className="form-group">
                  <label>JWT Secret</label>
                  <input type="text" value={security.jwt_configured ? 'Configured' : 'Missing'} readOnly />
                </div>
                <div className="form-group">
                  <label>Encryption Key</label>
                  <input type="text" value={security.encryption_key_configured ? 'Configured' : 'Missing'} readOnly />
                </div>
                <div className="form-group">
                  <label>Staff Session Timeout</label>
                  <input
                    type="text"
                    value={security.session_timeout_staff || ''}
                    onChange={(e) => updateSection('security', 'session_timeout_staff', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Client Session Timeout</label>
                  <input
                    type="text"
                    value={security.session_timeout_client || ''}
                    onChange={(e) => updateSection('security', 'session_timeout_client', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Admin Session Timeout</label>
                  <input
                    type="text"
                    value={security.session_timeout_admin || ''}
                    onChange={(e) => updateSection('security', 'session_timeout_admin', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Password Policy</label>
                  <input
                    type="text"
                    value={security.password_policy || ''}
                    onChange={(e) => updateSection('security', 'password_policy', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Two-Factor Authentication</label>
                  <input
                    type="text"
                    value={security.two_factor_auth || ''}
                    onChange={(e) => updateSection('security', 'two_factor_auth', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-header">
                <Globe size={24} />
                <h2>System Configuration</h2>
              </div>
              <div className="settings-content">
                <div className="form-group">
                  <label>System Name</label>
                  <input
                    type="text"
                    value={system.system_name || ''}
                    onChange={(e) => updateSection('system', 'system_name', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Environment</label>
                  <input type="text" value={system.environment || 'Unknown'} readOnly />
                </div>
                <div className="form-group">
                  <label>Timezone</label>
                  <input
                    type="text"
                    value={system.timezone || ''}
                    onChange={(e) => updateSection('system', 'timezone', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Currency</label>
                  <input
                    type="text"
                    value={system.currency || ''}
                    onChange={(e) => updateSection('system', 'currency', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Upload Directory</label>
                  <input
                    type="text"
                    value={system.upload_dir || ''}
                    onChange={(e) => updateSection('system', 'upload_dir', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Max File Size</label>
                  <input
                    type="text"
                    value={system.max_file_size || ''}
                    onChange={(e) => updateSection('system', 'max_file_size', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="settings-footer">
            <button className="btn-secondary" onClick={handleCancel} disabled={!hasChanges || saving}>
              <Undo2 size={20} />
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={!hasChanges || saving}>
              <Save size={20} />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button className="btn-primary" onClick={handleRefresh} disabled={saving || refreshing}>
              <RefreshCw size={20} />
              {refreshing ? 'Refreshing...' : 'Refresh Configuration'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default Settings;
