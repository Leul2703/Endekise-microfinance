import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, User, Sparkles, ArrowRight, AlertCircle, Home, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Login.css';
import api from '../utils/api';

const Login = () => {
  const [credentials, setCredentials] = useState({
    username: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorState, setTwoFactorState] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [unlockRequested, setUnlockRequested] = useState(false);
  const { login, verifyTwoFactor, completeTwoFactorSetup } = useAuth();
  const navigate = useNavigate();

  const roleRoutes = {
    admin: '/admin',
    branch_manager: '/branch-manager',
    loan_staff: '/loan-staff',
    saving_staff: '/saving-staff',
    ceo: '/ceo',
    client: '/client'
  };

  const navigateToDashboard = (sessionUser) => {
    const dashboardRoute = roleRoutes[sessionUser.role] || '/client';
    navigate(dashboardRoute);
  };

  const handleChange = (e) => {
    setCredentials({
      ...credentials,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setTwoFactorState(null);
    setTwoFactorCode('');
    setIsSubmitting(true);

    const result = await login(credentials.username, credentials.password);

    if (result.success) {
      navigateToDashboard(result.user);
    } else if (result.requiresTwoFactor) {
      setTwoFactorState({
        mode: result.twoFactorMode,
        challengeToken: result.challengeToken || null,
        setupToken: result.setupToken || null,
        setup: result.setup || null
      });
    } else if (result.error && result.error.includes('locked')) {
      setError(result.error);
    } else {
      setError('Invalid Username or Password. Please try again.');
    }

    setIsSubmitting(false);
  };

  const handleTwoFactorSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    if (!twoFactorState) {
      setIsSubmitting(false);
      return;
    }

    const action = twoFactorState.mode === 'setup'
      ? completeTwoFactorSetup(twoFactorState.setupToken, twoFactorCode)
      : verifyTwoFactor(twoFactorState.challengeToken, twoFactorCode);

    const result = await action;

    if (result.success) {
      navigateToDashboard(result.user);
    } else {
      setError(result.error || 'Two-factor authentication failed');
    }

    setIsSubmitting(false);
  };

  const handleRequestUnlock = async () => {
    if (!credentials.username.trim()) {
      setError('Enter your username first, then request account unlock.');
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await api.requestAccountUnlock({ username: credentials.username.trim() });
      setUnlockRequested(true);
      setError(response?.message || 'Unlock request submitted. Admin will review and unlock your account.');
    } catch (requestErr) {
      setError(requestErr.message || 'Failed to submit unlock request. Please contact admin.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-background">
        <div className="gradient-orb orb-1"></div>
        <div className="gradient-orb orb-2"></div>
        <div className="gradient-orb orb-3"></div>
      </div>

      <div className="login-card">
        <div className="login-utility-bar">
          <button type="button" className="utility-link" onClick={() => navigate('/')}>
            <Home size={16} />
            Landing Page
          </button>
          <button type="button" className="utility-link primary" onClick={() => navigate('/register')}>
            <UserPlus size={16} />
            Register
          </button>
        </div>

        <div className="login-header">
          <div className="login-brand-icon">
            <Sparkles size={32} />
          </div>
          <h1>Edekise Microfinance</h1>
          <p>Expense and Loan Tracker System</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="error-message">
              <AlertCircle size={18} />
              {error}
            </div>
          )}
          {error.toLowerCase().includes('account locked') && (
            <button
              type="button"
              className="btn-secondary"
              style={{ width: '100%', marginBottom: '0.75rem' }}
              disabled={isSubmitting || unlockRequested}
              onClick={handleRequestUnlock}
            >
              {unlockRequested ? 'Unlock Request Sent' : 'Request Admin Unlock'}
            </button>
          )}

          <div className="form-group">
            <label>Username</label>
            <div className="input-wrapper">
              <User className="input-icon" size={20} />
              <input
                type="text"
                name="username"
                value={credentials.username}
                onChange={handleChange}
                placeholder="Enter username"
                required
                autoComplete="username"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="input-wrapper">
              <Lock className="input-icon" size={20} />
              <input
                type="password"
                id="password"
                name="password"
                placeholder="Enter password"
                value={credentials.password}
                onChange={handleChange}
                required
                autoComplete="current-password"
              />
            </div>
          </div>

          <button type="submit" className="login-button" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <span className="spinner"></span>
                Signing in...
              </>
            ) : (
              <>
                Sign In
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        {twoFactorState && (
          <form onSubmit={handleTwoFactorSubmit} className="login-form">
            <div className="form-group">
              <label>
                {twoFactorState.mode === 'setup' ? 'Authenticator setup' : 'Two-factor code'}
              </label>
              {twoFactorState.mode === 'setup' && twoFactorState.setup && (
                <div className="setup-info">
                  <p>Secret: <strong>{twoFactorState.setup.secret}</strong></p>
                  <p>Use this secret or the OTPAuth URL in your authenticator app.</p>
                  <p className="otp-url">{twoFactorState.setup.otpauthUrl}</p>
                </div>
              )}
              <div className="input-wrapper">
                <Lock className="input-icon" size={20} />
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="Enter 6-digit code"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoComplete="one-time-code"
                />
              </div>
            </div>

            <button type="submit" className="login-button" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <span className="spinner"></span>
                  Verifying...
                </>
              ) : (
                <>
                  {twoFactorState.mode === 'setup' ? 'Complete Setup' : 'Verify Code'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
        )}

        <div className="login-footer">
          <p className="footer-links">
            <Link to="/">Back to landing page</Link>
            <span>•</span>
            <Link to="/register">Create client account</Link>
          </p>
          <p>&copy; 2026 Edekise Microfinance System</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
