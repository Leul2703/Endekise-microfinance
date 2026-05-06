import { Outlet, Link, useNavigate } from 'react-router-dom';
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
  TrendingUp,
  BarChart3
} from 'lucide-react';
import { useState } from 'react';
import './Layout.css';

const Layout = () => {
  const { user, logout } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      { icon: FileText, labelKey: 'nav_view_logs', path: '/admin/logs' },
      { icon: Settings, labelKey: 'nav_settings', path: '/admin/settings' },
    ],
    branch_manager: [
      { icon: LayoutDashboard, labelKey: 'nav_dashboard', path: '/branch-manager' },
      { icon: DollarSign, labelKey: 'nav_loan_approvals', path: '/branch-manager/loans' },
      { icon: FileText, labelKey: 'nav_savings_approvals', path: '/branch-manager/savings' },
      { icon: FileText, labelKey: 'nav_statement_approvals', path: '/branch-manager/statements' },
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

  const currentMenu = menuItems[user?.role] || [];

  return (
    <div className="layout">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <img src="/assets/images/logo.png" alt="Edekise Microfinance" className="sidebar-logo-image" />
          <div className="sidebar-title">
            <h2>Edekise</h2>
            <p>Microfinance</p>
          </div>
          <button
            className="close-sidebar"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={24} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {currentMenu.map((item, index) => (
            <Link
              key={index}
              to={item.path}
              className="nav-item"
              onClick={() => setSidebarOpen(false)}
            >
              <item.icon size={20} />
              <span>{t(item.labelKey)}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-button">
            <LogOut size={20} />
            <span>{t('logout')}</span>
          </button>
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <button 
            className="menu-toggle"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={24} />
          </button>
          
          <div className="user-info">
            <span className="user-name">{user?.name}</span>
            <span className="user-role">
              {(user?.company_id ? `${user.company_id} • ` : '')}{user?.role?.replace('_', ' ').toUpperCase()}
            </span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={{
                marginLeft: '0.75rem',
                padding: '0.35rem 0.5rem',
                borderRadius: '0.5rem',
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.10)',
                color: '#fff'
              }}
              aria-label={t('language')}
            >
              <option value="en">EN</option>
              <option value="am">አማ</option>
            </select>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
