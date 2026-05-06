 import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

const Unauthorized = () => {
  const navigate = useNavigate();

  return (
    <div className="unauthorized-container">
      <div className="unauthorized-card">
        <AlertTriangle className="warning-icon" size={64} />
        <h1>Unauthorized Access</h1>
        <p>You do not have permission to access this page.</p>
        <button onClick={() => navigate(-1)} className="back-button">
          Go Back
        </button>
      </div>
    </div>
  );
};

export default Unauthorized;
