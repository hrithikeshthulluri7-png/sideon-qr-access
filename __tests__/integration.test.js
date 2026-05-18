/**
 * Integration Tests for QR Access Control System - Phase 2
 * Focus: API endpoints, error handling, and complete workflows
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// Create test database
const testDbPath = path.join(__dirname, '../data/test.db');

// Helper function to initialize test database schema synchronously
const initializeTestDatabase = () => {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(testDbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }

      db.serialize(() => {
        // Members table
        db.run(`
          CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id VARCHAR(50) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            mobile VARCHAR(20),
            agent VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Tokens table
        db.run(`
          CREATE TABLE IF NOT EXISTS tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id VARCHAR(50) NOT NULL,
            token VARCHAR(255) UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expiresAt DATETIME NOT NULL,
            verified_at DATETIME,
            checked_in_at DATETIME,
            scan_count INTEGER DEFAULT 0,
            FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE
          )
        `);

        // Audit logs table
        db.run(`
          CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation VARCHAR(50) NOT NULL,
            member_id VARCHAR(50),
            token_id VARCHAR(255),
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(20),
            error_code INTEGER,
            ip_address VARCHAR(45),
            metadata JSON,
            FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE
          )
        `, (err) => {
          if (err) {
            reject(err);
            return;
          }

          // Close the connection and resolve
          db.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });
    });
  });
};

beforeAll(async () => {
  // Use test database
  process.env.DATABASE_URL = testDbPath;

  // Clean up any existing test database
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  // Initialize test database schema
  await initializeTestDatabase();
});

afterEach(async () => {
  // Clean up test database data after each test
  if (fs.existsSync(testDbPath)) {
    const db = new sqlite3.Database(testDbPath);
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('DELETE FROM tokens');
        db.run('DELETE FROM members');
        db.run('DELETE FROM audit_logs', (err) => {
          db.close();
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }
});

afterAll(async () => {
  // Clean up test database file after all tests
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
});

describe('API Integration Tests', () => {
  let app;

  beforeEach(() => {
    // Create a minimal Express app without starting the server
    const express = require('express');
    const path = require('path');
    app = express();

    // Middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Initialize database (already done in beforeAll)
    const db = require('../utils/database');

    // Routes
    app.use('/api', require('../routes/qrRoutes'));
    app.use('/api', require('../routes/healthRoutes'));

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
  });

  describe('POST /api/generate-qr', () => {
    it('should generate token with valid member data', async () => {
      const response = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
          email: 'john@example.com',
          mobile: '+1-555-0123',
          agent: 'Agent Name',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeDefined();
      expect(response.body.token).toMatch(/^SIDN_EVENT_2026_M00147_/);
      expect(response.body.member_id).toBe('00147');
      expect(response.body.message).toBe('QR token generated successfully');
    });

    it('should require member_id field', async () => {
      const response = await request(app)
        .post('/api/generate-qr')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('member_id');
    });

    it('should require name field', async () => {
      const response = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          email: 'john@example.com',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('name');
    });

    it('should allow optional email and mobile', async () => {
      const response = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should generate unique tokens for same member', async () => {
      const response1 = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
        });

      const response2 = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
        });

      expect(response1.body.token).not.toBe(response2.body.token);
    });

    it('should handle empty request body', async () => {
      const response = await request(app)
        .post('/api/generate-qr')
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/verify', () => {
    it('should verify valid token and return member data', async () => {
      // First generate a token
      const genResponse = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
          email: 'john@example.com',
          mobile: '+1-555-0123',
          agent: 'Agent Name',
        });

      const token = genResponse.body.token;

      // Then verify it
      const response = await request(app)
        .get('/api/verify')
        .query({ token });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.token).toBe(token);
      expect(response.body.member.id).toBe('00147');
      expect(response.body.member.name).toBe('John Doe');
      expect(response.body.member.email).toBe('john@example.com');
      expect(response.body.token_status.is_checked_in).toBe(false);
    });

    it('should require token parameter', async () => {
      const response = await request(app).get('/api/verify');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('token');
    });

    it('should reject invalid token format', async () => {
      const response = await request(app)
        .get('/api/verify')
        .query({ token: 'INVALID_TOKEN' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should return code 404 for non-existent token', async () => {
      const response = await request(app)
        .get('/api/verify')
        .query({ token: 'SIDN_EVENT_2026_M99999_a1b2c3d4e5f6a1b2c3d4e5f6' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(404);
      expect(response.body.error).toContain('Token not found');
    });
  });

  describe('POST /api/check-in', () => {
    it('should check-in token and return success', async () => {
      // Generate token
      const genResponse = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
        });

      const token = genResponse.body.token;

      // Check in
      const response = await request(app)
        .post('/api/check-in')
        .send({ token });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Check-in successful');
      expect(response.body.member_id).toBe('00147');
      expect(response.body.checked_in_at).toBeDefined();
    });

    it('should require token field', async () => {
      const response = await request(app)
        .post('/api/check-in')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('token');
    });

    it('should prevent duplicate check-ins with code 409', async () => {
      // Generate and check in
      const genResponse = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
        });

      const token = genResponse.body.token;

      // First check-in
      const response1 = await request(app)
        .post('/api/check-in')
        .send({ token });

      expect(response1.status).toBe(200);

      // Second check-in (should fail)
      const response2 = await request(app)
        .post('/api/check-in')
        .send({ token });

      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(false);
      expect(response2.body.code).toBe(409);
      expect(response2.body.error).toContain('already checked in');
    });

    it('should reject invalid token format', async () => {
      const response = await request(app)
        .post('/api/check-in')
        .send({ token: 'INVALID_TOKEN' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should return code 404 for non-existent token', async () => {
      const response = await request(app)
        .post('/api/check-in')
        .send({ token: 'SIDN_EVENT_2026_M99999_a1b2c3d4e5f6a1b2c3d4e5f6' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(404);
      expect(response.body.error).toContain('Token not found');
    });
  });

  describe('GET /api/check-in-status', () => {
    it('should return check-in status for unchecked-in token', async () => {
      const genResponse = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
        });

      const token = genResponse.body.token;

      const response = await request(app)
        .get('/api/check-in-status')
        .query({ token });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.is_checked_in).toBe(false);
      expect(response.body.checked_in_at).toBeNull();
    });

    it('should return check-in status for checked-in token', async () => {
      const genResponse = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
        });

      const token = genResponse.body.token;

      // Check in
      await request(app)
        .post('/api/check-in')
        .send({ token });

      // Get status
      const response = await request(app)
        .get('/api/check-in-status')
        .query({ token });

      expect(response.status).toBe(200);
      expect(response.body.is_checked_in).toBe(true);
      expect(response.body.checked_in_at).toBeDefined();
    });

    it('should require token parameter', async () => {
      const response = await request(app).get('/api/check-in-status');

      expect(response.status).toBe(400);
    });

    it('should reject invalid token format', async () => {
      const response = await request(app)
        .get('/api/check-in-status')
        .query({ token: 'INVALID_TOKEN' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('OK');
      expect(response.body.service).toBeDefined();
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('Complete Workflow', () => {
    it('should execute full check-in workflow successfully', async () => {
      // Step 1: Generate token
      const genResponse = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
          email: 'john@example.com',
        });

      expect(genResponse.status).toBe(201);
      const token = genResponse.body.token;

      // Step 2: Verify token
      const verifyResponse = await request(app)
        .get('/api/verify')
        .query({ token });

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.member.name).toBe('John Doe');
      expect(verifyResponse.body.token_status.is_checked_in).toBe(false);

      // Step 3: Check-in
      const checkInResponse = await request(app)
        .post('/api/check-in')
        .send({ token });

      expect(checkInResponse.status).toBe(200);

      // Step 4: Verify status
      const statusResponse = await request(app)
        .get('/api/check-in-status')
        .query({ token });

      expect(statusResponse.status).toBe(200);
      expect(statusResponse.body.is_checked_in).toBe(true);
    });
  });

  describe('HTTP Status Codes', () => {
    it('should return 400 for bad requests', async () => {
      const response = await request(app)
        .post('/api/generate-qr')
        .send({ member_id: '00147' }); // Missing name

      expect(response.status).toBe(400);
    });

    it('should return code 404 for not found', async () => {
      const response = await request(app)
        .get('/api/verify')
        .query({ token: 'SIDN_EVENT_2026_M00001_a1b2c3d4e5f6a1b2c3d4e5f6' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe(404);
    });

    it('should return code 409 for duplicate check-in', async () => {
      const genResponse = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
        });

      const token = genResponse.body.token;

      // First check-in
      const response1 = await request(app)
        .post('/api/check-in')
        .send({ token });

      expect(response1.status).toBe(200);

      // Duplicate check-in returns HTTP 200 with semantic error code 409.
      const response2 = await request(app)
        .post('/api/check-in')
        .send({ token });

      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(false);
      expect(response2.body.code).toBe(409);
    });
  });

  describe('Data Validation & Error Handling', () => {
    it('should validate email format (optional field)', async () => {
      const response = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
          email: 'invalid-email',
          mobile: '+1-555-0123'
        });

      // Should still succeed even with invalid email (field is optional)
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should handle concurrent token generation', async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app)
            .post('/api/generate-qr')
            .send({
              member_id: `001${i}${i}`,
              name: `Member ${i}`
            })
        );
      }

      const responses = await Promise.all(promises);

      responses.forEach((response) => {
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.token).toBeDefined();
      });
    });

    it('should return consistent member data on verify', async () => {
      const genResponse = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe',
          email: 'john@example.com',
          mobile: '+1-555-0123'
        });

      const token = genResponse.body.token;

      // Verify multiple times
      const verify1 = await request(app)
        .get('/api/verify')
        .query({ token });

      const verify2 = await request(app)
        .get('/api/verify')
        .query({ token });

      expect(verify1.body.member.name).toBe(verify2.body.member.name);
      expect(verify1.body.member.email).toBe(verify2.body.member.email);
      expect(verify1.body.member.mobile).toBe(verify2.body.member.mobile);
    });

    it('should track check-in timestamp accurately', async () => {
      const genResponse = await request(app)
        .post('/api/generate-qr')
        .send({
          member_id: '00147',
          name: 'John Doe'
        });

      const token = genResponse.body.token;
      const beforeCheckIn = new Date();

      const checkInResponse = await request(app)
        .post('/api/check-in')
        .send({ token });

      const afterCheckIn = new Date();

      expect(checkInResponse.status).toBe(200);
      expect(checkInResponse.body.checked_in_at).toBeDefined();

      const checkedInTime = new Date(checkInResponse.body.checked_in_at);
      expect(checkedInTime.getTime()).toBeGreaterThanOrEqual(beforeCheckIn.getTime() - 1000);
      expect(checkedInTime.getTime()).toBeLessThanOrEqual(afterCheckIn.getTime() + 1000);
    });
  });
});
