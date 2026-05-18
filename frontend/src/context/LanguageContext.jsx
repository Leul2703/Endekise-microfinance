import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const LanguageContext = createContext(null);

const STORAGE_KEY = 'lang';

const TRANSLATIONS = {
  en: {
    langName: 'English',
    nav_dashboard: 'Dashboard',
    nav_staff_users: 'Staff User Management',
    nav_client_management: 'Client Management',
    nav_manage_accounts: 'Manage Accounts',
    nav_unlock_requests: 'Unlock Requests',
    nav_compliance_view: 'Compliance View',
    nav_view_logs: 'View Logs',
    nav_settings: 'Settings',
    nav_loan_approvals: 'Loan Approvals',
    nav_savings_approvals: 'Savings Approvals',
    nav_statement_approvals: 'Statement Approvals',
    nav_transaction_history: 'Transaction History',
    nav_loan_management: 'Loan Management',
    nav_documents: 'Documents',
    nav_savings_management: 'Savings Management',
    nav_requests: 'Requests',
    nav_user_accounts: 'User Accounts',
    nav_reports: 'Reports',
    nav_branch_overview: 'Branch Overview',
    nav_balance_management: 'Balance Management',
    nav_my_loans: 'My Loans',
    nav_my_savings: 'My Savings',
    nav_my_documents: 'My Documents',
    nav_profile: 'Profile',
    logout: 'Logout',
    language: 'Language'
  },
  am: {
    langName: 'አማርኛ',
    nav_dashboard: 'ዳሽቦርድ',
    nav_staff_users: 'የሰራተኞች ተጠቃሚ አስተዳደር',
    nav_client_management: 'የደንበኛ አስተዳደር',
    nav_manage_accounts: 'መለያዎች አስተዳደር',
    nav_unlock_requests: 'የመክፈቻ ጥያቄዎች',
    nav_compliance_view: 'የኮምፕላየንስ እይታ',
    nav_view_logs: 'ሎጎች እይታ',
    nav_settings: 'ቅንብሮች',
    nav_loan_approvals: 'የብድር ማረጋገጫ',
    nav_savings_approvals: 'የቁጠባ ማረጋገጫ',
    nav_statement_approvals: 'የመግለጫ ማረጋገጫ',
    nav_transaction_history: 'የግብይት ታሪክ',
    nav_loan_management: 'የብድር አስተዳደር',
    nav_documents: 'ሰነዶች',
    nav_savings_management: 'የቁጠባ አስተዳደር',
    nav_requests: 'ጥያቄዎች',
    nav_user_accounts: 'የተጠቃሚ መለያዎች',
    nav_reports: 'ሪፖርቶች',
    nav_branch_overview: 'የቅርንጫፍ አጠቃላይ እይታ',
    nav_balance_management: 'ቀሪ ሂሳብ አስተዳደር',
    nav_my_loans: 'የእኔ ብድሮች',
    nav_my_savings: 'የእኔ ቁጠባ',
    nav_my_documents: 'የእኔ ሰነዶች',
    nav_profile: 'መገለጫ',
    logout: 'ውጣ',
    language: 'ቋንቋ'
  }
};

export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState('en');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (saved === 'en' || saved === 'am')) {
      setLanguage(saved);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language === 'am' ? 'am' : 'en';
  }, [language]);

  const t = useMemo(() => {
    const dict = TRANSLATIONS[language] || TRANSLATIONS.en;
    return (key) => dict[key] || TRANSLATIONS.en[key] || key;
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return ctx;
};

