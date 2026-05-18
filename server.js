require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');

// Utilities - logger is optional during test runs
let logger;
try {
  logger = require('./utils/logger');
} catch (err) {
  // Fallback logger for tests
  logger = {
    info: (msg, meta) => console.log(`[INFO] ${msg}`, meta || ''),
    warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta || ''),
    error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta || ''),
    debug: (msg, meta) => console.log(`[DEBUG] ${msg}`, meta || '')
  };
}

const { db, initializeDatabase } = require('./utils/database');
const databaseBackup = require('./utils/databaseBackup');
const { memberRateLimiter, failureRateLimiter } = require('./middleware/rateLimiter');

// Security middleware - optional for tests
let corsMiddleware, securityHeaders, httpsEnforce, validateContentType, validateContentLength, sanitizeHeaders;
try {
  const securityMW = require('./middleware/securityHeaders');
  corsMiddleware = securityMW.corsMiddleware;
  securityHeaders = securityMW.securityHeaders;
  httpsEnforce = securityMW.httpsEnforce;
} catch (err) {
  // Fallback for tests
  corsMiddleware = (req, res, next) => next();
  securityHeaders = (req, res, next) => next();
  httpsEnforce = (req, res, next) => next();
}

try {
  const requestValidator = require('./middleware/requestValidator');
  validateContentType = requestValidator.validateContentType;
  validateContentLength = requestValidator.validateContentLength;
  sanitizeHeaders = requestValidator.sanitizeHeaders;
} catch (err) {
  // Fallback for tests
  validateContentType = (req, res, next) => next();
  validateContentLength = (req, res, next) => next();
  sanitizeHeaders = (req, res, next) => next();
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Only log in non-test environments
if (process.env.NODE_ENV !== 'test') {
  logger.info('Starting SIDEON QR Access Backend', {
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    version: process.env.VERSION || '1.0.0'
  });
}

// ===============================================
// SECURITY MIDDLEWARE (Order matters!)
// ===============================================

// HTTPS enforcement (production)
app.use(httpsEnforce);

// Security headers
app.use(securityHeaders);

// Helmet for additional security headers
app.use(helmet({
  contentSecurityPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true },
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false
}));

// CORS
app.use(corsMiddleware);

// Request validation
app.use(sanitizeHeaders);
app.use(validateContentLength);

// Body parsing
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Validate Content-Type for POST/PUT/PATCH
app.use(validateContentType);

// ===============================================
// REQUEST LOGGING MIDDLEWARE
// ===============================================
if (process.env.NODE_ENV !== 'test') {
  app.use((req, res, next) => {
    const startTime = Date.now();
    
    // Capture original send
    const originalSend = res.send;
    res.send = function(data) {
      const responseTime = Date.now() - startTime;
      
      // Log the request
      if (process.env.LOG_REQUESTS !== 'false') {
        const meta = {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          responseTime: `${responseTime}ms`,
          memberId: req.headers['x-member-id'] || 'anonymous',
          ip: req.ip || req.connection.remoteAddress
        };
        
        if (res.statusCode >= 400) {
          logger.warn(`${req.method} ${req.path} ${res.statusCode}`, meta);
        } else {
          logger.info(`${req.method} ${req.path} ${res.statusCode}`, meta);
        }
      }

      return originalSend.call(this, data);
    };

    next();
  });
}

// ===============================================
// DATABASE INITIALIZATION
// ===============================================
if (process.env.NODE_ENV !== 'test') {
  logger.info('Initializing database...');
}
initializeDatabase();

// Enable WAL mode for better production performance (non-test only)
if (process.env.NODE_ENV !== 'test') {
  databaseBackup.enableWAL().catch(err => {
    logger.error('Failed to enable WAL mode', { error: err.message });
  });
}

// ===============================================
// RATE LIMITING
// ===============================================
if (process.env.NODE_ENV !== 'test') {
  logger.info('Configuring rate limiting...');
}
app.use('/api/check-in', memberRateLimiter);
app.use('/api/verify', memberRateLimiter);
app.use('/api/check-in-status', failureRateLimiter);

// ===============================================
// ROUTES
// ===============================================
app.use('/api', require('./routes/qrRoutes'));
app.use('/api', require('./routes/healthRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

// Load system routes (health, version, metrics) safely
try {
  app.use('/api', require('./routes/systemRoutes'));
} catch (err) {
  if (process.env.NODE_ENV !== 'test') {
    logger.warn('System routes not available', { error: err.message });
  }
}

// ===============================================
// ERROR HANDLING & 404
// ===============================================

// 404 handler
app.use((req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    logger.warn('Route not found', { method: req.method, path: req.path });
  }
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler (must be last)
app.use((err, req, res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    logger.error('Unhandled error', {
      message: err.message,
      stack: err.stack,
      method: req.method,
      path: req.path
    });
  }

  const statusCode = err.status || err.statusCode || 500;
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    status: statusCode,
    ...(isDevelopment && { stack: err.stack })
  });
});

// ===============================================
// GRACEFUL SHUTDOWN
// ===============================================
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (process.env.NODE_ENV !== 'test') {
    logger.info(`Graceful shutdown initiated by ${signal}`);
  }

  const server = app.listen(PORT, HOST);
  
  server.close(async () => {
    if (process.env.NODE_ENV !== 'test') {
      logger.info('HTTP server closed');
    }

    // Close database connection
    db.close((err) => {
      if (err) {
        logger.error('Database close error', { error: err.message });
      } else if (process.env.NODE_ENV !== 'test') {
        logger.info('Database connection closed');
      }

      if (process.env.NODE_ENV !== 'test') {
        logger.info('SIDEON QR Access Backend shutdown complete');
      }
      process.exit(err ? 1 : 0);
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  });

  // Close existing connections
  server.closeAllConnections();
}

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// ===============================================
// START SERVER (only if not in test mode)
// ===============================================
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, HOST, () => {
    logger.info('SIDEON QR Access Backend started', {
      port: PORT,
      host: HOST,
      environment: process.env.NODE_ENV || 'development',
      logLevel: process.env.LOG_LEVEL || 'info'
    });

    // Run initial audit log cleanup (Phase 2)
    try {
      const AuditLogger = require('./utils/auditLogger');
      AuditLogger.cleanOldLogs();
      logger.info('Audit log cleanup completed');
    } catch (err) {
      logger.warn('Audit log cleanup failed', { error: err.message });
    }

    // Schedule daily maintenance tasks
    scheduleMaintenanceTasks();
  });
}

/**
 * Schedule background maintenance tasks
 */
function scheduleMaintenanceTasks() {
  if (process.env.NODE_ENV === 'test') return;

  // Daily audit log cleanup
  const auditCleanupInterval = setInterval(() => {
    try {
      const AuditLogger = require('./utils/auditLogger');
      AuditLogger.cleanOldLogs();
      logger.info('Scheduled audit log cleanup completed');
    } catch (err) {
      logger.warn('Scheduled audit log cleanup failed', { error: err.message });
    }
  }, 24 * 60 * 60 * 1000);

  // Daily database backup
  const backupInterval = setInterval(async () => {
    try {
      const backupPath = await databaseBackup.backupDatabase();
      logger.info('Scheduled database backup completed', { path: backupPath });
    } catch (err) {
      logger.error('Scheduled database backup failed', { error: err.message });
    }
  }, 24 * 60 * 60 * 1000);

  // Clean up old backups
  const backupCleanupInterval = setInterval(() => {
    databaseBackup.cleanOldBackups();
  }, 7 * 24 * 60 * 60 * 1000); // Weekly

  // Gracefully close intervals on shutdown
  process.on('exit', () => {
    clearInterval(auditCleanupInterval);
    clearInterval(backupInterval);
    clearInterval(backupCleanupInterval);
  });
}

module.exports = app;
