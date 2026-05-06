# Edekise Microfinance System - Deployment Guide

## Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- Git (for version control)
- Text editor (VS Code recommended)
- Command prompt/terminal access

---

## Quick Start (Development)

### 1. Backend Setup

**Navigate to backend directory:**
```bash
cd backend
```

**Install dependencies:**
```bash
npm install
```

**Configure environment variables:**
- Copy `.env.example` to `.env` (already exists)
- Ensure `JWT_SECRET` is set (required for server to start)
- Generate secure JWT secret:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Update `.env` with the generated secret

**Start backend server:**
```bash
npm start
# or for development with hot reload:
npm run dev
```

Backend will start on port 5000 (default)

### 2. Frontend Setup

**Navigate to frontend directory (new terminal):**
```bash
cd frontend
```

**Install dependencies:**
```bash
npm install
```

**Start frontend development server:**
```bash
npm run dev
```

Frontend will start on port 5173 (default)

### 3. Access the Application

- Frontend: http://localhost:5173
- Backend API: http://localhost:5000/api
- API Health Check: http://localhost:5000/api/health

---

## Default User Accounts

The system automatically seeds these accounts on first run:

| Username | Password | Role |
|----------|----------|------|
| admin | Admin@Secure2026 | Admin |
| manager | Manager@Secure2026 | Branch Manager |
| loanstaff | LoanStaff@2026 | Loan Staff |
| savingstaff | SavingStaff@2026 | Saving Staff |
| ceo | CEO@Secure2026 | CEO |
| client | Client@Secure2026 | Client |

**⚠️ IMPORTANT:** Change these passwords in production!

---

## Environment Variables

### Required Variables

```bash
# Server Configuration
PORT=5000
NODE_ENV=development

# Frontend URL
FRONTEND_URL=http://localhost:5173

# JWT Secret (REQUIRED - generate with crypto)
JWT_SECRET=your-generated-secret-here

# Database Configuration
DB_PATH=./database.sqlite
```

### Optional Variables (for Email Functionality)

```bash
# Email Configuration (SMTP)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM=noreply@edekise.com

# Encryption Key (optional, will generate if not set)
ENCRYPTION_KEY=your-encryption-key

# File Upload Configuration
MAX_FILE_SIZE=5242880
UPLOAD_DIR=./uploads
```

---

## Production Deployment

### 1. Build Frontend

```bash
cd frontend
npm run build
```

This creates an optimized production build in the `dist/` directory.

### 2. Configure Production Environment

**Update `.env` file:**
```bash
NODE_ENV=production
FRONTEND_URL=https://your-production-domain.com
JWT_SECRET=your-production-secret
```

### 3. Set Up Reverse Proxy (nginx)

**Install nginx** (if not already installed)

**Create nginx configuration:**
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Certificate Configuration
    ssl_certificate /path/to/your/certificate.crt;
    ssl_certificate_key /path/to/your/private.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Frontend (React build)
    location / {
        root /path/to/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # File uploads
    location /uploads {
        proxy_pass http://localhost:5000;
    }
}
```

**Restart nginx:**
```bash
sudo nginx -t
sudo systemctl restart nginx
```

### 4. Set Up Process Manager (PM2)

**Install PM2 globally:**
```bash
npm install -g pm2
```

**Start backend with PM2:**
```bash
cd backend
pm2 start server.js --name "edekise-backend"
pm2 save
pm2 startup
```

**PM2 commands:**
```bash
pm2 list              # List all processes
pm2 logs edekise-backend  # View logs
pm2 restart edekise-backend  # Restart
pm2 stop edekise-backend     # Stop
pm2 delete edekise-backend   # Remove
```

### 5. Set Up Automated Backups

**Create backup script:**
```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/path/to/backups"
DB_PATH="/path/to/backend/database.sqlite"

# Create backup directory if not exists
mkdir -p $BACKUP_DIR

# Copy database
cp $DB_PATH $BACKUP_DIR/database_$DATE.sqlite

# Keep only last 30 days of backups
find $BACKUP_DIR -name "database_*.sqlite" -mtime +30 -delete

echo "Backup completed: database_$DATE.sqlite"
```

**Add to crontab for daily backups:**
```bash
crontab -e
# Add this line for daily backup at 2 AM
0 2 * * * /path/to/backup.sh
```

---

## Database Management

### View Database
```bash
# Using SQLite command line
sqlite3 backend/database.sqlite

# Commands
.tables                    # List all tables
.schema table_name         # View table schema
SELECT * FROM users;      # Query data
.quit                      # Exit
```

### Reset Database
```bash
# Delete database file
rm backend/database.sqlite

# Restart server (will recreate with seed data)
pm2 restart edekise-backend
```

### Backup Database
```bash
cp backend/database.sqlite backup/database_$(date +%Y%m%d).sqlite
```

---

## Troubleshooting

### Server Won't Start

**Error: Missing JWT_SECRET**
- Ensure `.env` file exists in backend directory
- Set `JWT_SECRET` to a secure random string
- Restart server

**Error: Port already in use**
```bash
# Find process using port 5000
netstat -ano | findstr :5000

# Kill the process (Windows)
taskkill /PID <PID> /F

# Or change PORT in .env
PORT=5001
```

### Frontend Issues

**Error: API connection refused**
- Ensure backend server is running
- Check API_BASE_URL in `frontend/src/utils/api.js`
- Verify CORS configuration in backend

**Build errors**
```bash
# Clear cache and reinstall
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Email Not Working

**Error: Email configuration**
- Verify SMTP credentials in `.env`
- Check if email provider requires app-specific password
- Test email configuration using nodemailer test

---

## Security Checklist

Before going to production, ensure:

- [ ] JWT_SECRET is set to a cryptographically secure random string
- [ ] All default passwords are changed
- [ ] HTTPS/TLS is configured with valid SSL certificate
- [ ] CORS is configured for production domain only
- [ ] Rate limiting is enabled and tested
- [ ] Database backups are automated
- [ ] Firewall rules are configured
- [ ] Security headers (Helmet) are active
- [ ] Audit logging is enabled
- [ ] File upload limits are appropriate
- [ ] Environment variables are not committed to git

---

## Monitoring

### Check Server Status
```bash
# Backend health check
curl http://localhost:5000/api/health

# View PM2 status
pm2 status

# View logs
pm2 logs edekise-backend
```

### Monitor Database Size
```bash
ls -lh backend/database.sqlite
```

### Monitor Disk Space
```bash
df -h
```

---

## Scaling Considerations

### When to Migrate from SQLite

Consider migrating to PostgreSQL or MySQL when:
- Concurrent users exceed 50
- Database size exceeds 1GB
- Need advanced features (replication, clustering)
- Require better concurrency handling

### Migration Path

1. Export SQLite data
2. Set up PostgreSQL/MySQL instance
3. Create schema in new database
4. Import data
5. Update database configuration
6. Test thoroughly
7. Switch over

---

## Support

For issues or questions:
1. Check logs: `pm2 logs edekise-backend`
2. Review error messages in browser console
3. Verify environment variables
4. Check database connectivity
5. Review deployment documentation

---

## Quick Reference

**Start Backend:**
```bash
cd backend
npm start
```

**Start Frontend (Dev):**
```bash
cd frontend
npm run dev
```

**Build Frontend (Prod):**
```bash
cd frontend
npm run build
```

**View Logs:**
```bash
pm2 logs edekise-backend
```

**Restart Backend:**
```bash
pm2 restart edekise-backend
```

**Backup Database:**
```bash
cp backend/database.sqlite backup/database_$(date +%Y%m%d).sqlite
```
