const express = require('express');
const router = express.Router();

/**
 * Health & Status Routes
 */

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'SIDEON QR Access Control Backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

router.get('/status', (req, res) => {
  res.status(200).json({
    status: 'active',
    version: process.env.VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3001
  });
});

module.exports = router;
