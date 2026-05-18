const express = require('express');
const { db } = require('../utils/database');
const logger = require('../utils/logger');
const databaseBackup = require('../utils/databaseBackup');
const fs = require('fs');
const path = require('path');

const router = express.Router();

/**
 * Health check endpoint - returns system status
 * GET /api/health
 */
router.get('/health', (req, res) => {
  const startTime = Date.now();

  // Check database connectivity
  db.all('SELECT 1', (err, rows) => {
    const responseTime = Date.now() - startTime;
    
    if (err) {
      logger.error('Health check: database connection failed', { error: err.message });
      return res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'failed',
          error: err.message
        },
        responseTime: `${responseTime}ms`
      });
    }

    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.VERSION || '1.0.0',
      uptime: process.uptime(),
      checks: {
        database: 'ok',
        memory: {
          heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`
        },
        timestamp: new Date().toISOString()
      },
      responseTime: `${responseTime}ms`
    };

    res.status(200).json(healthData);
  });
});

/**
 * Version endpoint - returns deployment info
 * GET /api/version
 */
router.get('/version', (req, res) => {
  const versionInfo = {
    version: process.env.VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    commitSha: process.env.GIT_COMMIT_SHA || 'local',
    deploymentDate: process.env.DEPLOYMENT_DATE || 'development',
    buildDate: new Date().toISOString(),
    apiVersion: 'v1',
    features: {
      healthCheck: process.env.ENABLE_HEALTH_CHECK !== 'false',
      versionEndpoint: process.env.ENABLE_VERSION_ENDPOINT !== 'false',
      metrics: process.env.ENABLE_METRICS !== 'false',
      requestValidation: process.env.ENABLE_REQUEST_VALIDATION !== 'false',
      logging: process.env.LOG_LEVEL || 'info'
    }
  };

  res.status(200).json(versionInfo);
});

/**
 * System metrics endpoint (optional)
 * GET /api/metrics
 */
router.get('/metrics', (req, res) => {
  if (process.env.ENABLE_METRICS === 'false') {
    return res.status(403).json({ error: 'Metrics endpoint disabled' });
  }

  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(process.memoryUsage().external / 1024 / 1024)}MB`
    },
    cpu: {
      usage: process.cpuUsage()
    }
  };

  // Get database stats
  db.all(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `, (err, tables) => {
    if (!err && tables) {
      metrics.database = {
        tables: tables.length,
        tables: tables.map(t => t.name)
      };
    }

    res.status(200).json(metrics);
  });
});

/**
 * Readiness probe (for Kubernetes/container orchestration)
 * GET /api/ready
 */
router.get('/ready', (req, res) => {
  db.all('SELECT 1', (err) => {
    if (err) {
      return res.status(503).json({ ready: false, error: 'Database not ready' });
    }
    res.status(200).json({ ready: true });
  });
});

/**
 * Liveness probe (for Kubernetes/container orchestration)
 * GET /api/alive
 */
router.get('/alive', (req, res) => {
  res.status(200).json({ alive: true });
});

module.exports = router;
