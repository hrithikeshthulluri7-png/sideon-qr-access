/**
 * Phase 5 Coverage Tests
 * Targets: systemRoutes, rateLimiter, databaseBackup, logger, qrController uncovered paths
 */

process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server');

// ============================================================
// SYSTEM ROUTES
// ============================================================
describe('System Routes', () => {
  test('GET /api/version returns version info', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('apiVersion', 'v1');
    expect(res.body).toHaveProperty('features');
  });

  test('GET /api/metrics returns system metrics', async () => {
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('memory');
    expect(res.body.memory).toHaveProperty('heapUsed');
  });

  test('GET /api/metrics disabled when ENABLE_METRICS=false', async () => {
    const old = process.env.ENABLE_METRICS;
    process.env.ENABLE_METRICS = 'false';
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/disabled/i);
    process.env.ENABLE_METRICS = old;
  });

  test('GET /api/ready returns ready status', async () => {
    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ready', true);
  });

  test('GET /api/alive returns alive status', async () => {
    const res = await request(app).get('/api/alive');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('alive', true);
  });

  test('GET /api/health (system route) returns healthy status', async () => {
    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
  });
});

// ============================================================
// HEALTH ROUTES
// ============================================================
describe('Health Routes', () => {
  test('GET /api/health returns OK', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toMatch(/OK|healthy/i);
  });

  test('GET /api/status returns active status', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'active');
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('environment');
  });
});

// ============================================================
// QR CONTROLLER — uncovered paths
// ============================================================
describe('QR Controller - Additional Coverage', () => {
  const validToken = () => {
    const memberId = Math.floor(Math.random() * 999999) + 1;
    const hex = Array.from({ length: 24 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    return `SIDN_EVENT_2026_M${memberId}_${hex}`;
  };

  test('POST /api/generate-qr missing member_id returns 400', async () => {
    const res = await request(app)
      .post('/api/generate-qr')
      .send({ name: 'Test User' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /api/generate-qr missing name returns 400', async () => {
    const res = await request(app)
      .post('/api/generate-qr')
      .send({ member_id: 'M001' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('GET /api/verify missing token returns 400', async () => {
    const res = await request(app).get('/api/verify');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('GET /api/verify invalid token format returns 400', async () => {
    const res = await request(app).get('/api/verify?token=INVALID_FORMAT');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid token format/i);
  });

  test('GET /api/verify valid format non-existent token returns 200 with success:false', async () => {
    const res = await request(app).get(`/api/verify?token=${validToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.is_valid).toBe(false);
  });

  test('POST /api/check-in missing token returns 400', async () => {
    const res = await request(app)
      .post('/api/check-in')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /api/check-in invalid token format returns 400', async () => {
    const res = await request(app)
      .post('/api/check-in')
      .send({ token: 'BAD_TOKEN' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid token format/i);
  });

  test('POST /api/check-in valid format non-existent token returns 200 with success:false', async () => {
    const res = await request(app)
      .post('/api/check-in')
      .send({ token: validToken() });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  test('GET /api/check-in-status missing token returns 400', async () => {
    const res = await request(app).get('/api/check-in-status');
    expect(res.status).toBe(400);
  });

  test('GET /api/check-in-status invalid format returns 400', async () => {
    const res = await request(app).get('/api/check-in-status?token=BAD');
    expect(res.status).toBe(400);
  });

  test('GET /api/check-in-status valid format non-existent returns 200 with success:false', async () => {
    const res = await request(app).get(`/api/check-in-status?token=${validToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  test('Full flow: generate → verify → check-in → status', async () => {
    const memberId = `${Date.now()}`;

    const gen = await request(app)
      .post('/api/generate-qr')
      .send({ member_id: memberId, name: 'Phase5 User', email: 'phase5@test.com', mobile: '+1234567890', agent: 'TestAgent' });
    expect([200, 201]).toContain(gen.status);
    expect(gen.body).toHaveProperty('token');

    const token = gen.body.token;

    const verify = await request(app).get(`/api/verify?token=${token}`);
    expect(verify.status).toBe(200);
    expect(verify.body.member_id).toBe(memberId);
    expect(verify.body.success).toBe(true);

    const checkIn = await request(app)
      .post('/api/check-in')
      .send({ token });
    expect([200, 201]).toContain(checkIn.status);
    expect(checkIn.body.success).toBe(true);
    expect(checkIn.body).toHaveProperty('check_in_time');

    const status = await request(app).get(`/api/check-in-status?token=${token}`);
    expect(status.status).toBe(200);
    expect(status.body.is_checked_in).toBe(true);
  });

  test('POST /api/verify-jwt handles invalid JWT', async () => {
    const res = await request(app)
      .post('/api/verify-jwt')
      .send({ jwt_token: 'invalid.jwt.token' });
    expect([200, 400, 401]).toContain(res.status);
  });

  test('GET /api/generate-qr-image missing token returns 400', async () => {
    const res = await request(app).get('/api/generate-qr-image');
    expect(res.status).toBe(400);
  });

  test('404 for unknown route', async () => {
    const res = await request(app).get('/api/nonexistent-route-xyz');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

// ============================================================
// LOGGER UTILITY
// ============================================================
describe('Logger Utility', () => {
  test('logger loads and has required methods', () => {
    const logger = require('../utils/logger');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  test('logger.info does not throw', () => {
    const logger = require('../utils/logger');
    expect(() => logger.info('test message', { key: 'value' })).not.toThrow();
  });

  test('logger.warn does not throw', () => {
    const logger = require('../utils/logger');
    expect(() => logger.warn('test warning')).not.toThrow();
  });

  test('logger.error does not throw', () => {
    const logger = require('../utils/logger');
    expect(() => logger.error('test error', { error: 'details' })).not.toThrow();
  });
});

// ============================================================
// DATABASE BACKUP UTILITY
// ============================================================
describe('Database Backup Utility', () => {
  test('databaseBackup module loads', () => {
    const backup = require('../utils/databaseBackup');
    expect(backup).toBeDefined();
    expect(typeof backup.backupDatabase).toBe('function');
    expect(typeof backup.cleanOldBackups).toBe('function');
    expect(typeof backup.enableWAL).toBe('function');
  });

  test('enableWAL resolves without error', async () => {
    const backup = require('../utils/databaseBackup');
    await expect(backup.enableWAL()).resolves.not.toThrow();
  });

  test('cleanOldBackups does not throw', () => {
    const backup = require('../utils/databaseBackup');
    expect(() => backup.cleanOldBackups()).not.toThrow();
  });
});

// ============================================================
// RATE LIMITER MIDDLEWARE
// ============================================================
describe('Rate Limiter Middleware', () => {
  test('rateLimiter module loads with correct exports', () => {
    const { memberRateLimiter, failureRateLimiter } = require('../middleware/rateLimiter');
    expect(typeof memberRateLimiter).toBe('function');
    expect(typeof failureRateLimiter).toBe('function');
  });
});
