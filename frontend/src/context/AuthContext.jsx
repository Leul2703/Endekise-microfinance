import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);
const API_BASE = 'http://localhost:5000/api/auth';
const ROLE_ALIASES = {
  head_ceo: 'ceo',
  chief_executive_officer: 'ceo',
  chiefexecutiveofficer: 'ceo',
  savings_staff: 'saving_staff'
};

const normalizeRole = (role) => {
  const normalized = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return ROLE_ALIASES[normalized] || normalized;
};

const normalizeUser = (user) => {
  if (!user) return user;
  return {
    ...user,
    role: normalizeRole(user.role)
  };
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const persistSession = useCallback((sessionUser, token) => {
    const normalizedUser = normalizeUser(sessionUser);
    setUser(normalizedUser);
    setIsAuthenticated(true);
    localStorage.setItem('user', JSON.stringify(normalizedUser));
    localStorage.setItem('token', token);
  }, []);

  // Restore user session on app load
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        setUser(normalizeUser(JSON.parse(storedUser)));
        setIsAuthenticated(true);
      } catch (error) {
        console.error('Error parsing stored user:', error);
        localStorage.removeItem('user');
        localStorage.removeItem('token');
      }
    }
  }, []);

  const login = async (username, password) => {
    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Login failed' };
      }

      if (data.requiresTwoFactor) {
        return {
          success: false,
          requiresTwoFactor: true,
          twoFactorMode: data.twoFactorMode,
          challengeToken: data.challengeToken,
          setupToken: data.setupToken,
          setup: data.setup
        };
      }

      persistSession(data.user, data.token);
      return { success: true, user: data.user };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Invalid credentials' };
    }
  };

  const verifyTwoFactor = async (challengeToken, token) => {
    try {
      const response = await fetch(`${API_BASE}/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, token })
      });
      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Two-factor verification failed' };
      }

      persistSession(data.user, data.token);
      return { success: true, user: data.user };
    } catch (error) {
      console.error('2FA verification error:', error);
      return { success: false, error: 'Two-factor verification failed' };
    }
  };

  const completeTwoFactorSetup = async (setupToken, token) => {
    try {
      const response = await fetch(`${API_BASE}/2fa/setup/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken, token })
      });
      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Two-factor setup failed' };
      }

      persistSession(data.user, data.token);
      return { success: true, user: data.user };
    } catch (error) {
      console.error('2FA setup error:', error);
      return { success: false, error: 'Two-factor setup failed' };
    }
  };

  const logout = async () => {
    try {
      await fetch('http://localhost:5000/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      setIsAuthenticated(false);
      localStorage.removeItem('user');
      localStorage.removeItem('token');
    }
  };

  const checkAuth = useCallback(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        setUser(normalizeUser(JSON.parse(storedUser)));
        setIsAuthenticated(true);
      } catch (error) {
        console.error('Error parsing stored user:', error);
        localStorage.removeItem('user');
        localStorage.removeItem('token');
      }
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated, login, logout, checkAuth, verifyTwoFactor, completeTwoFactorSetup }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
