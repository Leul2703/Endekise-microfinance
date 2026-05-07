import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Unauthorized from './pages/Unauthorized';
import Layout from './components/Layout';
import ToastContainer from './components/ToastContainer';
import ProtectedRoute from './utils/ProtectedRoute';
import AdminDashboard from './pages/AdminDashboard';
import BranchManagerDashboard from './pages/BranchManagerDashboard';
import LoanStaffDashboard from './pages/LoanStaffDashboard';
import SavingStaffDashboard from './pages/SavingStaffDashboard';
import CEODashboard from './pages/CEODashboard';
import ClientDashboard from './pages/ClientDashboard';

// Admin pages
import Accounts from './pages/admin/Accounts';
import Settings from './pages/admin/Settings';
import Logs from './pages/admin/Logs';
import UserManagement from './pages/admin/UserManagement';
import Clients from './pages/admin/Clients';
import UnlockRequests from './pages/admin/UnlockRequests';

// Branch Manager pages
import LoanApprovals from './pages/branch-manager/LoanApprovals';
import SavingsApprovals from './pages/branch-manager/SavingsApprovals';
import StatementApprovals from './pages/branch-manager/StatementApprovals';

// Loan Staff pages
import LoanManagement from './pages/loan-staff/LoanManagement';
import Documents from './pages/loan-staff/Documents';

// Saving Staff pages
import SavingsManagement from './pages/saving-staff/SavingsManagement';
import Requests from './pages/saving-staff/Requests';

// CEO pages
import Reports from './pages/ceo/Reports';
import BranchOverview from './pages/ceo/BranchOverview';
import BalanceManagement from './pages/ceo/BalanceManagement';
import UserAccounts from './pages/ceo/UserAccounts';
import CEOLoanApprovals from './pages/ceo/LoanApprovals';

// Client pages
import MyLoans from './pages/client/MyLoans';
import MySavings from './pages/client/MySavings';
import Profile from './pages/client/Profile';
import ClientDocuments from './pages/client/Documents';

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/unauthorized" element={<Unauthorized />} />
            
            <Route path="/" element={<Landing />} />
            
            <Route
              path="/admin/*"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<AdminDashboard />} />
              <Route path="accounts" element={<Accounts />} />
              <Route path="users" element={<UserManagement />} />
              <Route path="clients" element={<Clients />} />
              <Route path="unlock-requests" element={<UnlockRequests />} />
              <Route path="logs" element={<Logs />} />
              <Route path="settings" element={<Settings />} />
            </Route>

            <Route
              path="/branch-manager/*"
              element={
                <ProtectedRoute allowedRoles={['branch_manager']}>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<BranchManagerDashboard />} />
              <Route path="loans" element={<LoanApprovals />} />
              <Route path="savings" element={<SavingsApprovals />} />
              <Route path="statements" element={<StatementApprovals />} />
            </Route>

            <Route
              path="/loan-staff/*"
              element={
                <ProtectedRoute allowedRoles={['loan_staff']}>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<LoanStaffDashboard />} />
              <Route path="loans" element={<LoanManagement />} />
              <Route path="documents" element={<Documents />} />
            </Route>

            <Route
              path="/saving-staff/*"
              element={
                <ProtectedRoute allowedRoles={['saving_staff']}>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<SavingStaffDashboard />} />
              <Route path="savings" element={<SavingsManagement />} />
              <Route path="requests" element={<Requests />} />
            </Route>

            <Route
              path="/ceo/*"
              element={
                <ProtectedRoute allowedRoles={['ceo']}>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<CEODashboard />} />
              <Route path="reports" element={<Reports />} />
              <Route path="users" element={<UserAccounts />} />
              <Route path="branches" element={<BranchOverview />} />
              <Route path="balance-management" element={<BalanceManagement />} />
              <Route path="loans" element={<CEOLoanApprovals />} />
            </Route>

            <Route
              path="/client/*"
              element={
                <ProtectedRoute allowedRoles={['client']}>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<ClientDashboard />} />
              <Route path="loans" element={<MyLoans />} />
              <Route path="savings" element={<MySavings />} />
              <Route path="profile" element={<Profile />} />
              <Route path="documents" element={<ClientDocuments />} />
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
          <ToastContainer />
        </Router>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App
