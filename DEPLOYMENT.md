# SIDEON QR Access Backend - Deployment Guide

## Overview

This guide covers production deployment of the SIDEON QR Access Control System backend. The system uses Node.js 18+, SQLite 3, and Express.js with comprehensive security hardening.

## Quick Start

```bash
docker-compose up -d
```

This starts the backend API on `http://localhost:3001/api` and the nginx-served frontend on `http://localhost:8080`.

## Phase 3 Load Test Results

Phase 3 load testing completed successfully on May 18, 2026. All three scenarios passed with a **100% success rate** and zero threshold breaches.

| Scenario | Checks | Pass Rate | Peak VUs | Result |
|---|---:|---:|---:|---|
| Happy path | 33,780 / 33,780 | 100% | 100 | PASS |
| Stress | 677,166 / 677,166 | 100% | 500 | PASS |
| Endurance | 129,100 / 129,100 | 100% | 50 | PASS |
| Total | 840,046 / 840,046 | 100% | - | PASS |

Summary: verify, check-in, QR generation, status checks, health checks, and memory stability passed under the tested load profiles. The stress run reached approximately 3,755 requests per second with sub-10ms p95 response times.

## Pre-Deployment Checklist

- [ ] Node.js 18+ installed
- [ ] SQLite 3 available
- [ ] Generated strong JWT_SECRET
- [ ] Configured production CORS origins
- [ ] Set up database backup directory
- [ ] Prepared log directory with proper permissions
- [ ] HTTPS certificate ready (if deploying behind reverse proxy)
- [ ] All Phase 2 tests passing (152 tests)

## 1. Environment Configuration

### Generate JWT Secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

This generates a secure 256-bit hex string. Copy this value to your `.env.production` file.

### Configure .env.production

```bash
cp .env.example .env.production
```

Edit `.env.production` with production values:

```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

JWT_SECRET=<your-generated-secret>
JWT_EXPIRY=1h
EXPIRATION_MINUTES=60

DATABASE_URL=/data/sideon.db
DATABASE_BACKUP_DIR=/data/backups
DATABASE_BACKUP_RETENTION_DAYS=30

CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com
CORS_CREDENTIALS=false

LOG_LEVEL=info
LOG_DIR=/var/log/sideon-backend
LOG_FILE_MAX_FILES=30

AUDIT_LOG_RETENTION_DAYS=90
EXPIRED_TOKEN_RETENTION_DAYS=30

GIT_COMMIT_SHA=$(git rev-parse HEAD)
DEPLOYMENT_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
VERSION=1.0.0
```

## 2. Database Initialization

### Create Database Directories

```bash
mkdir -p /data
mkdir -p /data/backups
chmod 755 /data /data/backups
```

### Initialize Database

The database is automatically initialized on first run:

```bash
npm start
# Database tables (members, tokens, audit_logs) created automatically
# Indexes created for performance
```

### Enable Write-Ahead Logging (WAL)

WAL mode is enabled automatically on startup for better concurrent access:

```sql
PRAGMA journal_mode = WAL;
PRAGMA wal_autocheckpoint = 1000;
```

## 3. Backup and Restore

### Automated Daily Backup

Backups run automatically every 24 hours and are stored in `DATABASE_BACKUP_DIR`.

### Manual Backup

```bash
node -e "
  const backup = require('./utils/databaseBackup');
  backup.backupDatabase()
    .then(path => console.log('Backup created:', path))
    .catch(err => console.error('Backup failed:', err.message));
"
```

### Restore from Backup

```bash
node -e "
  const backup = require('./utils/databaseBackup');
  const backupPath = '/data/backups/sideon-2024-01-15T10-30-45.db.backup';
  backup.restoreDatabase(backupPath)
    .then(() => console.log('Database restored'))
    .catch(err => console.error('Restore failed:', err.message));
"
```

### List Available Backups

```bash
node -e "
  const backup = require('./utils/databaseBackup');
  const backups = backup.listBackups();
  backups.forEach(b => console.log(b.name, b.size, b.created));
"
```

### Backup Retention Policy

- Default retention: 30 days
- Configure with `DATABASE_BACKUP_RETENTION_DAYS`
- Automatic cleanup runs daily
- Manual cleanup:

```bash
node -e "require('./utils/databaseBackup').cleanOldBackups()"
```

## 4. Phase 4 Docker Deployment

Phase 4 adds an nginx reverse proxy using the free official `nginx:alpine` image. The compose stack:

- Runs the backend API on `http://localhost:3001/api`
- Serves `../sideon-qr-web/` on `http://localhost:8080`
- Proxies `http://localhost:8080/api/*` to the backend service
- Waits for the backend healthcheck before starting the frontend proxy
- Healthchecks both the backend and nginx frontend containers

### Quick Start with Docker Compose

```bash
cp .env.example .env
docker-compose up -d
```

For a fresh build:

```bash
docker-compose up -d --build
```

Verify services:

```bash
docker-compose ps
curl http://localhost:3001/api/health
curl http://localhost:8080/api/health
```

Open the frontend:

```bash
open http://localhost:8080
```

Open the Admin Dashboard:

```bash
open http://localhost:8080/admin/
```

The admin dashboard provides real-time stats, QR token generation, token verification, manual check-in, QR image rendering, and a live CSV-exportable check-in feed.

Local compose defaults to `NODE_ENV=development` so HTTP works on `localhost`. For production with `NODE_ENV=production`, terminate HTTPS before the API or configure the reverse proxy to forward the original HTTPS protocol.

### Build Docker Image

```bash
docker build -t sideon-backend:latest .
```

### Run Docker Container

```bash
docker run -d \
  --name sideon-backend \
  -p 3001:3001 \
  -e NODE_ENV=production \
  -e JWT_SECRET=<your-secret> \
  -e DATABASE_URL=/app/data/sideon.db \
  -v /data/sideon-data:/app/data \
  -v /var/log/sideon:/app/logs \
  sideon-backend:latest
```

### Using Docker Compose

```bash
docker-compose up -d
```

Monitor with:
```bash
docker-compose logs -f sideon-backend sideon-frontend
```

Stop with:
```bash
docker-compose down
```

## 5. Startup and Management

### Start Server

```bash
./scripts/startup.sh
```

Or directly:
```bash
npm start
```

### Graceful Shutdown

The application handles SIGTERM and SIGINT signals for graceful shutdown:
- Closes HTTP server
- Completes in-flight requests
- Closes database connection
- Times out after 30 seconds (force exit)

Send shutdown signal:
```bash
kill -TERM <pid>
```

### Health Checks

#### Liveness Probe
```bash
curl http://localhost:3001/api/alive
# Returns: {"alive": true}
```

#### Readiness Probe
```bash
curl http://localhost:3001/api/ready
# Returns: {"ready": true}
```

#### Detailed Health
```bash
curl http://localhost:3001/api/health
# Returns full system status including memory, uptime, database connectivity
```

#### Version Info
```bash
curl http://localhost:3001/api/version
# Returns: version, environment, commit SHA, deployment date, features
```

## 6. Logging and Monitoring

### Log Files

Logs are written to `LOG_DIR` (default: `./logs`)

- **app-YYYY-MM-DD.log**: Application logs (errors, warnings, info)
- **requests-YYYY-MM-DD.log**: HTTP request logs
- **Console**: Real-time output to stdout/stderr

### Log Rotation

- Files are rotated when they exceed `LOG_FILE_MAX_SIZE` (default: 10MB)
- Automatic cleanup keeps only `LOG_FILE_MAX_FILES` (default: 14)
- Old files are archived with timestamps

### Log Levels

- `error`: Critical issues
- `warn`: Warnings (security issues, deprecated usage)
- `info`: General information (requests, startup, operations)
- `debug`: Detailed debug information

Set with `LOG_LEVEL` environment variable.

### Key Metrics to Monitor

1. **Error Rate**: Check `app-*.log` for error frequency
2. **Response Times**: Monitor `requests-*.log` for slow endpoints
3. **Database Size**: Check `/data/sideon.db` file size
4. **Backup Status**: Verify backups in `/data/backups` are recent
5. **Memory Usage**: Monitor via `/api/metrics` endpoint
6. **Uptime**: Track from `/api/health` uptime field

### Request Logging

All requests are logged with:
- Method (GET, POST, etc.)
- Path
- Status code
- Response time
- Member ID
- IP address
- (Optional) Request body (when `LOG_REQUEST_BODY=true`)

Example:
```
[2024-01-15T10:30:45.123Z] [INFO] POST /api/check-in 200 | {
  "method": "POST",
  "path": "/api/check-in",
  "status": 200,
  "responseTime": "45ms",
  "memberId": "member-123",
  "ip": "192.168.1.100"
}
```

## 7. Security Hardening

### HTTPS/TLS

Configure a reverse proxy (nginx, Apache, HAProxy) in front of the Node.js app:

**nginx example:**
```nginx
server {
  listen 443 ssl http2;
  server_name yourdomain.com;

  ssl_certificate /etc/ssl/certs/yourdomain.com.crt;
  ssl_certificate_key /etc/ssl/private/yourdomain.com.key;

  location /api {
    proxy_pass http://localhost:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### Security Headers

All responses include:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Content-Security-Policy: default-src 'self'...`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: [restricted features]`

### Rate Limiting

- **Check-in endpoints**: 100 requests per 15 minutes
- **Verify endpoints**: 100 requests per 15 minutes
- **Failure endpoints**: 5 attempts per 15 minutes

Configure in `.env`:
```env
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
FAILURE_RATE_LIMIT_MAX_ATTEMPTS=5
FAILURE_RATE_LIMIT_WINDOW_MS=900000
```

### CORS Configuration

Only allow specific origins (whitelist approach):

```env
CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com
```

Comma-separated list without spaces.

### Input Validation

All requests are validated for:
- Content-Type (must be `application/json` or `application/x-www-form-urlencoded`)
- Content-Length (limited to 100KB)
- Header sanitization (removes dangerous headers)

### SQL Injection Prevention

All database queries use parameterized statements:
```javascript
db.run('SELECT * FROM tokens WHERE token = ?', [userToken], callback);
```

## 8. Data Retention Policies

### Audit Logs

- **Retention**: 90 days (configurable with `AUDIT_LOG_RETENTION_DAYS`)
- **Automatic cleanup**: Daily at startup and every 24 hours
- **Manual cleanup**: Run `AuditLogger.cleanOldLogs()`

### Expired Tokens

- **Retention**: 30 days after expiration (configurable with `EXPIRED_TOKEN_RETENTION_DAYS`)
- **Automatic cleanup**: On token verification
- **Manual cleanup**: Run token cleanup job

### Member Data

- **Retention**: Permanent (no automatic cleanup)
- **Deletion**: Manual database operation required

## 9. Troubleshooting

### Server Won't Start

1. Check Node.js version: `node --version` (must be 18+)
2. Check if port is in use: `lsof -i :3001`
3. Check .env file: `cat .env | grep -v '^#'`
4. Check logs: `tail -50 logs/app-*.log`

### Database Issues

1. Check file permissions: `ls -la data/sideon.db`
2. Verify database integrity: `sqlite3 data/sideon.db "PRAGMA integrity_check;"`
3. Try restore from backup if corrupted
4. Check disk space: `df -h /data`

### High Memory Usage

1. Check log files for leaks
2. Monitor with: `curl http://localhost:3001/api/metrics`
3. Restart the service gracefully

### Slow Requests

1. Check database indexes: Run migration
2. Analyze logs for slow endpoints
3. Check system resources (CPU, disk)

### CORS Errors

1. Verify `CORS_ORIGIN` includes your frontend domain
2. Check if using HTTPS in production
3. Verify origin is exact match (including https://)

## 10. Performance Tuning

### SQLite Optimization

WAL mode is enabled automatically for:
- Better concurrent read/write access
- Faster checkpoint frequency (1000 pages)

### Connection Pooling

Currently uses single database connection. For higher throughput, consider:
- Better-sqlite3 for synchronous operations
- Connection pooling library for concurrent access

### Caching

Implement request caching for frequently accessed endpoints:
- Member lookup results
- Token verification results
- QR code validation results

## 11. Monitoring Best Practices

### Daily Checks

```bash
# Health status
curl http://localhost:3001/api/health

# Check recent errors
tail -20 logs/app-*.log | grep ERROR

# Database size
du -h data/sideon.db

# Backup status
ls -lh data/backups/ | tail -5
```

### Weekly Checks

- Review audit logs for anomalies
- Check backup integrity
- Monitor error rates
- Review performance metrics

### Monthly Tasks

- Review and archive old logs
- Update dependencies
- Security audit
- Capacity planning

## 12. Rollback Plan

If deployment fails:

1. **Verify backup exists**: `ls data/backups/`
2. **Stop current instance**: `kill -TERM <pid>`
3. **Restore from backup**: Use restore command above
4. **Verify database**: `sqlite3 data/sideon.db "SELECT COUNT(*) FROM members;"`
5. **Start previous version**: `git checkout <previous-tag> && npm install && npm start`

## 13. Compliance

### Audit Logging

All operations are logged to `audit_logs` table:
- Member creation/update
- Token generation/verification
- Check-in operations
- Errors and security events

Logs include:
- Timestamp
- Operation type
- Member ID
- Status (success/failure)
- IP address
- Error codes

### Data Protection

- Database backed up daily
- Encryption: Configure at reverse proxy layer (TLS)
- Access control: IP whitelisting recommended
- Audit trails: 90-day retention

## Support

For issues or questions:
1. Check logs first: `logs/app-*.log`
2. Run health check: `curl http://localhost:3001/api/health`
3. Verify database: `sqlite3 data/sideon.db ".tables"`
4. Review IMPLEMENTATION_NOTES.md for Phase 1-2 details
