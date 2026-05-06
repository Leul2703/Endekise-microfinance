import { useNavigate } from 'react-router-dom';
import { ArrowRight, Shield, TrendingUp, Users, Building2, Zap, Lock } from 'lucide-react';
import './Landing.css';

const Landing = () => {
  const navigate = useNavigate();

  return (
    <div className="landing-page">
      <nav className="landing-nav">
        <div className="nav-brand">
          <div className="brand-icon">
            <img src="/edekise-logo.svg" alt="Edekise logo" className="nav-logo" />
          </div>
          <span>Edekise Microfinance</span>
        </div>
        <div className="nav-actions">
          <button className="btn-ghost" onClick={() => navigate('/register')}>Register</button>
          <button className="btn-ghost" onClick={() => navigate('/login')}>Sign In</button>
          <button className="btn-primary" onClick={() => navigate('/login')}>
            Get Started
            <ArrowRight size={18} />
          </button>
        </div>
      </nav>

      <section className="hero-section">
        <div className="hero-background">
          <div className="gradient-orb orb-1"></div>
          <div className="gradient-orb orb-2"></div>
          <div className="gradient-orb orb-3"></div>
        </div>
        <div className="hero-content">
          <div className="hero-badge">
            <Zap size={16} />
            <span>Trusted by 15,000+ Ethiopians</span>
          </div>
          <h1 className="hero-title">
            Empowering Your
            <span className="highlight"> Financial Future</span>
          </h1>
          <p className="hero-subtitle">
            Access affordable loans, secure savings, and personalized financial services designed for your success. 
            Join thousands building their dreams with Edekise Microfinance.
          </p>
          <div className="hero-buttons">
            <button className="btn-secondary large" onClick={() => navigate('/register')}>
              Register as Client
            </button>
            <button className="btn-primary large" onClick={() => navigate('/login')}>
              Get Started Free
              <ArrowRight size={20} />
            </button>
            <button className="btn-secondary large" onClick={() => navigate('/login')}>
              Sign In
            </button>
          </div>
          <div className="hero-stats">
            <div className="stat-item">
              <div className="stat-number">15K+</div>
              <div className="stat-label">Active Clients</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">500M+</div>
              <div className="stat-label">ETB Disbursed</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">6</div>
              <div className="stat-label">Branches</div>
            </div>
            <div className="stat-item">
              <div className="stat-number">98%</div>
              <div className="stat-label">Satisfaction</div>
            </div>
          </div>
        </div>
        <div className="hero-visual">
          <div className="floating-card card-1">
            <div className="card-icon blue">
              <Shield size={32} />
            </div>
            <div>
              <div className="card-label">Secure Banking</div>
              <div className="card-value">256-bit Encryption</div>
            </div>
          </div>
          <div className="floating-card card-2">
            <div className="card-icon green">
              <TrendingUp size={32} />
            </div>
            <div>
              <div className="card-label">Growth Rate</div>
              <div className="card-value">24% Annual</div>
            </div>
          </div>
          <div className="floating-card card-3">
            <div className="card-icon purple">
              <Users size={32} />
            </div>
            <div>
              <div className="card-label">Community</div>
              <div className="card-value">15,000+ Members</div>
            </div>
          </div>
          <div className="floating-card card-4">
            <div className="card-icon orange">
              <Lock size={32} />
            </div>
            <div>
              <div className="card-label">Protected</div>
              <div className="card-value">NBE Regulated</div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="features-section">
        <div className="section-header">
          <h2>Why Choose Edekise?</h2>
          <p>We're committed to your financial success with innovative solutions</p>
        </div>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon blue">
              <TrendingUp size={32} />
            </div>
            <h3>Competitive Interest Rates</h3>
            <p>Enjoy some of the best interest rates on savings and most affordable loan rates in the market.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon green">
              <Shield size={32} />
            </div>
            <h3>Secure & Reliable</h3>
            <p>Your money is protected with bank-grade security and backed by National Bank of Ethiopia regulations.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon purple">
              <Building2 size={32} />
            </div>
            <h3>Multiple Branches</h3>
            <p>Access our services at 6 convenient locations across Ethiopia, including Addis Ababa HQ.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon orange">
              <Users size={32} />
            </div>
            <h3>Dedicated Support</h3>
            <p>Our experienced team provides personalized guidance to help you achieve your financial goals.</p>
          </div>
        </div>
      </section>

      <section id="services" className="services-section">
        <div className="section-header">
          <h2>Our Services</h2>
          <p>Comprehensive financial solutions tailored to your needs</p>
        </div>
        <div className="services-grid">
          <div className="service-card">
            <div className="service-icon">💰</div>
            <h3>Personal Loans</h3>
            <p>Quick access to funds for education, healthcare, or personal emergencies.</p>
          </div>
          <div className="service-card">
            <div className="service-icon">🏠</div>
            <h3>Business Loans</h3>
            <p>Grow your business with flexible financing options and competitive rates.</p>
          </div>
          <div className="service-card">
            <div className="service-icon">🌾</div>
            <h3>Agricultural Loans</h3>
            <p>Support for farmers and agricultural businesses with seasonal repayment options.</p>
          </div>
          <div className="service-card">
            <div className="service-icon">💳</div>
            <h3>Fixed Deposits</h3>
            <p>Earn higher interest rates with our fixed deposit savings accounts.</p>
          </div>
          <div className="service-card">
            <div className="service-icon">📊</div>
            <h3>Regular Savings</h3>
            <p>Build your savings habit with flexible deposit options and attractive returns.</p>
          </div>
          <div className="service-card">
            <div className="service-icon">📱</div>
            <h3>Mobile Banking</h3>
            <p>Manage your accounts from anywhere with our convenient mobile services.</p>
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="cta-content">
          <h2>Ready to Start Your Financial Journey?</h2>
          <p>Join thousands of satisfied customers who trust Edekise Microfinance for their financial needs.</p>
          <div className="cta-buttons">
            <button className="btn-primary large" onClick={() => navigate('/login')}>
              Open an Account
              <ArrowRight size={20} />
            </button>
            <button className="btn-secondary large" onClick={() => navigate('/login')}>
              Sign In to Dashboard
            </button>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="footer-content">
          <div className="footer-section">
            <div className="footer-brand">
              <img src="/edekise-logo.svg" alt="Edekise Microfinance" className="footer-logo" />
              <span>Edekise Microfinance</span>
            </div>
            <p>Empowering communities through accessible financial services since 2010.</p>
          </div>
          <div className="footer-section">
            <h4>Quick Links</h4>
            <a href="#features">Features</a>
            <a href="#services">Services</a>
          </div>
          <div className="footer-section">
            <h4>Services</h4>
            <a href="#">Personal Loans</a>
            <a href="#">Business Loans</a>
            <a href="#">Savings Accounts</a>
            <a href="#">Fixed Deposits</a>
          </div>
          <div className="footer-section">
            <h4>Contact</h4>
            <p>Addis Ababa, Ethiopia</p>
            <p>+251-11-1234567</p>
            <p>info@edekise.com</p>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; 2026 Edekise Microfinance. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
