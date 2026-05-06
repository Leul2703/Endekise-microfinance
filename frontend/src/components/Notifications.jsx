import { useState } from 'react';
import { Bell, CheckCircle, XCircle, Clock, AlertTriangle, DollarSign, CreditCard, Users, FileText, X } from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
import './Notifications.css';

const Notifications = () => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, removeNotification } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);

  const getIcon = (type) => {
    switch (type) {
      case 'success': return <CheckCircle size={16} />;
      case 'error': return <XCircle size={16} />;
      case 'warning': return <AlertTriangle size={16} />;
      case 'info': return <Clock size={16} />;
      case 'transaction': return <DollarSign size={16} />;
      case 'loan': return <CreditCard size={16} />;
      case 'user': return <Users size={16} />;
      case 'document': return <FileText size={16} />;
      default: return <Bell size={16} />;
    }
  };

  const getColor = (type) => {
    switch (type) {
      case 'success': return '#10b981';
      case 'error': return '#ef4444';
      case 'warning': return '#f59e0b';
      case 'info': return '#3b82f6';
      case 'transaction': return '#06b6d4';
      case 'loan': return '#8b5cf6';
      case 'user': return '#ec4899';
      case 'document': return '#6b7280';
      default: return '#6b7280';
    }
  };

  return (
    <div className="notifications-container">
      <button 
        className="notifications-toggle" 
        onClick={() => setIsOpen(!isOpen)}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="notifications-badge">{unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="notifications-dropdown">
          <div className="notifications-header">
            <h3>Notifications</h3>
            <div className="notifications-actions">
              {unreadCount > 0 && (
                <button 
                  className="mark-all-read"
                  onClick={() => { markAllAsRead(); }}
                >
                  Mark all as read
                </button>
              )}
              <button 
                className="close-notifications"
                onClick={() => setIsOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="notifications-list">
            {notifications.length === 0 ? (
              <p className="no-notifications">No notifications</p>
            ) : (
              notifications.map((notification) => (
                <div 
                  key={notification.id} 
                  className={`notification-item ${!notification.read ? 'unread' : ''}`}
                >
                  <div 
                    className="notification-icon"
                    style={{ background: `${getColor(notification.type)}20`, color: getColor(notification.type) }}
                  >
                    {getIcon(notification.type)}
                  </div>
                  <div className="notification-content">
                    <p className="notification-title">{notification.title}</p>
                    <p className="notification-message">{notification.message}</p>
                    <p className="notification-time">
                      {new Date(notification.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="notification-actions">
                    {!notification.read && (
                      <button 
                        className="mark-read"
                        onClick={() => markAsRead(notification.id)}
                        title="Mark as read"
                      >
                        <CheckCircle size={14} />
                      </button>
                    )}
                    <button 
                      className="remove-notification"
                      onClick={() => removeNotification(notification.id)}
                      title="Remove"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Notifications;
