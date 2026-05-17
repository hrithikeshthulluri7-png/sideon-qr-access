require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize database
const db = require('./utils/database');
db.initializeDatabase();

// Rate limiting middleware (Phase 2)
const { memberRateLimiter, failureRateLimiter } = require('./middleware/rateLimiter');

// Apply rate limiting to check-in endpoints
app.use('/api/check-in', memberRateLimiter);
app.use('/api/verify', memberRateLimiter);
app.use('/api/check-in-status', failureRateLimiter);

// Routes
app.use('/api', require('./routes/qrRoutes'));
app.use('/api', require('./routes/healthRoutes'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    status: err.status || 500
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`SIDEON QR Access Backend listening on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Token expiration: ${process.env.EXPIRATION_MINUTES || 60} minutes`);

  // Clean old audit logs on startup (Phase 2)
  const AuditLogger = require('./utils/auditLogger');
  AuditLogger.cleanOldLogs();

  // Schedule daily cleanup of old audit logs
  setInterval(() => {
    AuditLogger.cleanOldLogs();
  }, 24 * 60 * 60 * 1000); // Every 24 hours
});

module.exports = app;
