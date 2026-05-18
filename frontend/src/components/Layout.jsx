import { useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import {
  LayoutDashboard,
  Users,
  DollarSign,
  LogOut,
  Menu,
  X,
  Building2,
  FileText,
  Settings,
  BarChart3,
  ChevronRight,
  ShieldCheck,
  Key
} from 'lucide-react';
import './Layout.css';

const Layout = () => {
  const { user, logout } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isClient = user?.role === 'client';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const menuItems = {
    admin: [
      { icon: LayoutDashboard, labelKey: 'nav_dashboard', path: '/admin' },
      { icon: Users, labelKey: 'nav_staff_users', path: '/admin/users' },
      { icon: Users, labelKey: 'nav_client_management', path: '/admin/clients' },
      { icon: DollarSign, labelKey: 'nav_manage_accounts', path: '/admin/accounts' },
      { icon: Key, labelKey: 'nav_unlock_requests', path: '/admin/unlock-requests' },
      { icon: ShieldCheck, labelKey: 'nav_compliance_view', path: '/admin/compliance' },
      { icon: FileText, labelKey: 'nav_view_logs', path: '/admin/logs' },
      { icon: Settings, labelKey: 'nav_settings', path: '/admin/settings' },
    ],
    branch_manager: [
      { icon: LayoutDashboard, labelKey: 'nav_dashboard', path: '/branch-manager' },
      { icon: DollarSign, labelKey: 'nav_loan_approvals', path: '/branch-manager/loans' },
      { icon: FileText, labelKey: 'nav_savings_approvals', path: '/branch-manager/savings' },
      { icon: FileText, labelKey: 'nav_statement_approvals', path: '/branch-manager/statements' },
      { icon: DollarSign, labelKey: 'nav_transaction_history', path: '/branch-manager/transactions' },
    ],
    loan_staff: [
      { icon: LayoutDashboard, labelKey: 'nav_dashboard', path: '/loan-staff' },
      { icon: DollarSign, labelKey: 'nav_loan_management', path: '/loan-staff/loans' },
      { icon: FileText, labelKey: 'nav_documents', path: '/loan-staff/documents' },
    ],
    saving_staff: [
      { icon: LayoutDashboard, labelKey: 'nav_dashboard', path: '/saving-staff' },
      { icon: DollarSign, labelKey: 'nav_savings_management', path: '/saving-staff/savings' },
      { icon: FileText, labelKey: 'nav_requests', path: '/saving-staff/requests' },
    ],
    ceo: [
      { icon: BarChart3, labelKey: 'nav_dashboard', path: '/ceo' },
      { icon: Users, labelKey: 'nav_user_accounts', path: '/ceo/users' },
      { icon: DollarSign, labelKey: 'nav_loan_approvals', path: '/ceo/loans' },
      { icon: FileText, labelKey: 'nav_reports', path: '/ceo/reports' },
      { icon: Building2, labelKey: 'nav_branch_overview', path: '/ceo/branches' },
      { icon: DollarSign, labelKey: 'nav_balance_management', path: '/ceo/balance-management' },
    ],
    client: [
      { icon: LayoutDashboard, labelKey: 'nav_dashboard', path: '/client' },
      { icon: DollarSign, labelKey: 'nav_my_loans', path: '/client/loans' },
      { icon: FileText, labelKey: 'nav_my_savings', path: '/client/savings' },
      { icon: FileText, labelKey: 'nav_my_documents', path: '/client/documents' },
      { icon: Settings, labelKey: 'nav_profile', path: '/client/profile' },
    ]
  };

  const dashboardPaths = new Set([
    '/admin',
    '/branch-manager',
    '/loan-staff',
    '/saving-staff',
    '/ceo',
    '/client'
  ]);

  const currentMenu = menuItems[user?.role] || [];
  const currentPage = useMemo(
    () => currentMenu.find((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)) || currentMenu[0],
    [currentMenu, location.pathname]
  );

  const roleLabel = useMemo(() => {
    const labels = {
      admin: 'Administrator',
      branch_manager: 'Branch Manager',
      loan_staff: 'Loan Staff',
      saving_staff: 'Saving Staff',
      ceo: 'CEO Workspace',
      client: 'Client Portal'
    };

    return labels[user?.role] || 'Workspace';
  }, [user?.role]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isClient) {
      return undefined;
    }

    document.body.style.overflow = sidebarOpen ? 'hidden' : '';

    return () => {
      document.body.style.overflow = '';
    };
  }, [isClient, sidebarOpen]);

  return (
    <div className={`layout ${isClient ? 'client-layout' : 'desktop-layout'}`}>
      {isClient && sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <button type="button" className="sidebar-brand-button" onClick={() => navigate('/')}>
            <img src="/assets/images/logo.png" alt="Edekise Microfinance" className="sidebar-logo-image" />
            <div className="sidebar-title">
              <h2>Edekise</h2>
              <p>Microfinance</p>
            </div>
          </button>
          <button
            className="close-sidebar"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X size={24} />
          </button>
        </div>

        <div className="sidebar-section-label">Navigation</div>
        <nav className="sidebar-nav">
          {currentMenu.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={dashboardPaths.has(item.path)}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <item.icon size={20} />
              <span>{t(item.labelKey)}</span>
              <ChevronRight size={16} className="nav-item-arrow" />
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-role-card">
            <ShieldCheck size={18} />
            <div>
              <strong>{roleLabel}</strong>
              <span>{user?.company_id ? `Branch ${user.company_id}` : 'Secure access enabled'}</span>
            </div>
          </div>

          <button onClick={handleLogout} className="logout-button">
            <LogOut size={20} />
            <span>{t('logout')}</span>
          </button>
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            {isClient && (
              <button
                className="menu-toggle"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation"
              >
                <Menu size={24} />
              </button>
            )}

            <div className="page-intro">
              <span className="page-eyebrow">{roleLabel}</span>
              <h1>{currentPage ? t(currentPage.labelKey) : 'Dashboard'}</h1>
            </div>
          </div>

          <div className="user-info">
            <div className="user-meta">
              <span className="user-name">{user?.name}</span>
              <span className="user-role">
                {(user?.company_id ? `${user.company_id} • ` : '')}
                {user?.role?.replace('_', ' ').toUpperCase()}
              </span>
            </div>

            <select
              className="language-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label={t('language')}
            >
              <option value="en">EN</option>
              <option value="am">AM</option>
            </select>
          </div>
        </header>

        {isClient && currentMenu.length > 0 && (
          <div className="client-quick-nav" aria-label="Quick navigation">
            {currentMenu.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/client'}
                className={({ isActive }) => `client-quick-link${isActive ? ' active' : ''}`}
              >
                <item.icon size={16} />
                <span>{t(item.labelKey)}</span>
              </NavLink>
            ))}
          </div>
        )}

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
