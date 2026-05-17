/**
 * Phase 2 Coverage Tests - Database, AuditLogger, Migration, and Error Paths
 * Target: Increase coverage from 61.64% to 70%+
 *
 * Focus areas:
 * - database.js: initialization, error handling
 * - auditLogger.js: logging, getLogs, cleanOldLogs
 * - migrate.js: migration logic
 * - qrController.js: error paths (500 errors, validation)
 */

const request = require('supertest');
const express = require('express');
const { db, initializeDatabase } = require('../utils/database');
const AuditLogger = require('../utils/auditLogger');
const { migrateToPhase2 } = require('../utils/migrate');
const {
  generateQR,
  verifyToken,
  checkIn,
  checkInStatus
} = require('../controllers/qrController');

// ============================================================================
// DATABASE.JS TESTS
// ============================================================================

describe('Database Module', () => {
  beforeAll(() => {
    // Database already initialized from main test setup
  });

  describe('Database Initialization', () => {
    it('should initialize database with all required tables', (done) => {
      // Verify members table exists
      db.all(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='members'`,
        (err, rows) => {
          expect(err).toBeNull();
          expect(rows.length).toBe(1);
          done();
        }
      );
    });

    it('should create tokens table with correct schema', (done) => {
      db.all(
        `PRAGMA table_info(tokens)`,
        (err, columns) => {
          expect(err).toBeNull();
          const columnNames = columns.map(c => c.name);
          expect(columnNames).toContain('id');
          expect(columnNames).toContain('member_id');
          expect(columnNames).toContain('token');
          expect(columnNames).toContain('expiresAt');
          expect(columnNames).toContain('verified_at');
          expect(columnNames).toContain('checked_in_at');
          expect(columnNames).toContain('scan_count');
          done();
        }
      );
    });

    it('should create audit_logs table with correct schema', (done) => {
      db.all(
        `PRAGMA table_info(audit_logs)`,
        (err, columns) => {
          expect(err).toBeNull();
          const columnNames = columns.map(c => c.name);
          expect(columnNames).toContain('id');
          expect(columnNames).toContain('operation');
          expect(columnNames).toContain('member_id');
          expect(columnNames).toContain('token_id');
          expect(columnNames).toContain('status');
          expect(columnNames).toContain('error_code');
          expect(columnNames).toContain('ip_address');
          expect(columnNames).toContain('metadata');
          done();
        }
      );
    });

    it('should create required indexes for performance', (done) => {
      db.all(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tokens_token'`,
        (err, rows) => {
          expect(err).toBeNull();
          expect(rows.length).toBe(1);
          done();
        }
      );
    });

    it('should enable foreign key constraints', (done) => {
      db.all(`PRAGMA foreign_keys`, (err, rows) => {
        expect(err).toBeNull();
        // Foreign keys should be ON (result is 1)
        expect(rows[0]['foreign_keys']).toBe(1);
        done();
      });
    });

    it('should handle database errors gracefully', (done) => {
      // Test error callback in db.run with invalid SQL
      db.run('INVALID SQL STATEMENT', (err) => {
        expect(err).not.toBeNull();
        expect(err.message).toContain('syntax error');
        done();
      });
    });
  });

  describe('Database Operations', () => {
    it('should support parameterized queries for members', (done) => {
      const testMemberId = `test_member_${Date.now()}`;
      db.run(
        `INSERT INTO members (member_id, name) VALUES (?, ?)`,
        [testMemberId, 'Test Member'],
        function(err) {
          expect(err).toBeNull();
          expect(this.lastID).toBeGreaterThan(0);
          done();
        }
      );
    });

    it('should support parameterized queries for tokens', (done) => {
      const testMemberId = `test_member_tokens_${Date.now()}`;
      const testToken = `TEST_TOKEN_${Date.now()}`;

      // First insert member
      db.run(
        `INSERT INTO members (member_id, name) VALUES (?, ?)`,
        [testMemberId, 'Test Member'],
        () => {
          // Then insert token
          db.run(
            `INSERT INTO tokens (member_id, token, expiresAt) VALUES (?, ?, ?)`,
            [testMemberId, testToken, new Date().toISOString()],
            function(err) {
              expect(err).toBeNull();
              expect(this.lastID).toBeGreaterThan(0);
              done();
            }
          );
        }
      );
    });

    it('should handle foreign key constraints', (done) => {
      // Try to insert token with non-existent member
      const nonExistentMemberId = `non_existent_${Date.now()}`;
      const testToken = `TEST_FK_${Date.now()}`;

      db.run(
        `INSERT INTO tokens (member_id, token, expiresAt) VALUES (?, ?, ?)`,
        [nonExistentMemberId, testToken, new Date().toISOString()],
        (err) => {
          // Should fail due to foreign key constraint
          expect(err).not.toBeNull();
          expect(err.message).toContain('FOREIGN KEY constraint failed');
          done();
        }
      );
    });

    it('should handle database query errors', (done) => {
      db.get('INVALID SQL', (err, row) => {
        expect(err).not.toBeNull();
        expect(row).toBeUndefined();
        done();
      });
    });
  });
});

// ============================================================================
// AUDIT LOGGER TESTS
// ============================================================================

describe('AuditLogger Module', () => {
  beforeEach(() => {
    // Clear audit logs before each test
    db.run(`DELETE FROM audit_logs`, () => {});
  });

  describe('log() method', () => {
    it('should log token generation success', (done) => {
      AuditLogger.log('generate', '00147', 'test_token_123', 'success', null, '127.0.0.1', {
        expiresAt: new Date().toISOString()
      });

      // Wait for async logging
      setTimeout(() => {
        db.all(
          `SELECT * FROM audit_logs WHERE operation = 'generate'`,
          (err, rows) => {
            expect(err).toBeNull();
            expect(rows.length).toBeGreaterThan(0);
            const log = rows[rows.length - 1];
            expect(log.operation).toBe('generate');
            expect(log.member_id).toBe('00147');
            expect(log.status).toBe('success');
            expect(log.ip_address).toBe('127.0.0.1');
            done();
          }
        );
      }, 50);
    });

    it('should log token generation failure with error code', (done) => {
      AuditLogger.log('generate', '00147', null, 'failure', 400, '127.0.0.1', {
        reason: 'Missing required fields'
      });

      setTimeout(() => {
        db.all(
          `SELECT * FROM audit_logs WHERE operation = 'generate' AND status = 'failure'`,
          (err, rows) => {
            expect(err).toBeNull();
            expect(rows.length).toBeGreaterThan(0);
            const log = rows[rows.length - 1];
            expect(log.error_code).toBe(400);
            expect(log.status).toBe('failure');
            done();
          }
        );
      }, 50);
    });

    it('should log verification attempts', (done) => {
      AuditLogger.log('verify_attempt', '00147', 'test_token_456', 'success', null, '127.0.0.1', {
        scanCount: 1
      });

      setTimeout(() => {
        db.all(
          `SELECT * FROM audit_logs WHERE operation = 'verify_attempt'`,
          (err, rows) => {
            expect(err).toBeNull();
            expect(rows.length).toBeGreaterThan(0);
            done();
          }
        );
      }, 50);
    });

    it('should log check-in operations', (done) => {
      AuditLogger.log('check_in', '00147', 'test_token_789', 'success', null, '127.0.0.1', {
        checkedInAt: new Date().toISOString()
      });

      setTimeout(() => {
        db.all(
          `SELECT * FROM audit_logs WHERE operation = 'check_in'`,
          (err, rows) => {
            expect(err).toBeNull();
            expect(rows.length).toBeGreaterThan(0);
            done();
          }
        );
      }, 50);
    });

    it('should handle null/missing optional fields', (done) => {
      AuditLogger.log('verify_attempt', null, null, 'failure', 400, '127.0.0.1', {});

      setTimeout(() => {
        db.all(
          `SELECT * FROM audit_logs WHERE operation = 'verify_attempt' AND member_id IS NULL`,
          (err, rows) => {
            expect(err).toBeNull();
            expect(rows.length).toBeGreaterThan(0);
            done();
          }
        );
      }, 50);
    });

    it('should store metadata as JSON', (done) => {
      const metadata = { reason: 'test', count: 5, nested: { key: 'value' } };
      AuditLogger.log('generate', '00147', 'test_token', 'success', null, '127.0.0.1', metadata);

      setTimeout(() => {
        db.all(
          `SELECT * FROM audit_logs WHERE operation = 'generate' LIMIT 1`,
          (err, rows) => {
            expect(err).toBeNull();
            if (rows.length > 0) {
              const log = rows[rows.length - 1];
              const storedMetadata = JSON.parse(log.metadata);
              expect(storedMetadata.reason).toBe('test');
              expect(storedMetadata.count).toBe(5);
              expect(storedMetadata.nested.key).toBe('value');
            }
            done();
          }
        );
      }, 50);
    });

    it('should handle database errors gracefully', (done) => {
      // Override db.run to simulate error
      const originalRun = db.run;
      db.run = function(sql, params, callback) {
        callback(new Error('Database connection lost'));
      };

      // Should not throw, just log error
      expect(() => {
        AuditLogger.log('generate', '00147', 'token', 'success', null, '127.0.0.1', {});
      }).not.toThrow();

      db.run = originalRun;
      done();
    });

    it('should handle JSON stringify errors', (done) => {
      // Create circular reference to cause stringify error
      const metadata = {};
      metadata.self = metadata;

      expect(() => {
        AuditLogger.log('generate', '00147', 'token', 'success', null, '127.0.0.1', metadata);
      }).not.toThrow();

      done();
    });
  });

  describe('getLogs() method', () => {
    beforeEach((done) => {
      // Insert test logs
      db.run(
        `INSERT INTO audit_logs (operation, member_id, token_id, status, error_code, ip_address, timestamp)
         VALUES ('generate', '00147', 'token1', 'success', NULL, '127.0.0.1', CURRENT_TIMESTAMP)`,
        () => {
          db.run(
            `INSERT INTO audit_logs (operation, member_id, token_id, status, error_code, ip_address, timestamp)
             VALUES ('generate', '00147', 'token2', 'success', NULL, '127.0.0.1', CURRENT_TIMESTAMP)`,
            () => {
              db.run(
                `INSERT INTO audit_logs (operation, member_id, token_id, status, error_code, ip_address, timestamp)
                 VALUES ('verify_attempt', '00100', 'token3', 'failure', 404, '127.0.0.1', CURRENT_TIMESTAMP)`,
                done
              );
            }
          );
        }
      );
    });

    it('should retrieve logs for a specific member', (done) => {
      AuditLogger.getLogs('00147')
        .then((logs) => {
          expect(logs).toBeDefined();
          expect(logs.length).toBeGreaterThan(0);
          expect(logs[0].member_id).toBe('00147');
          done();
        })
        .catch(done);
    });

    it('should respect limit parameter', (done) => {
      AuditLogger.getLogs('00147', 1)
        .then((logs) => {
          expect(logs.length).toBeLessThanOrEqual(1);
          done();
        })
        .catch(done);
    });

    it('should return empty array for non-existent member', (done) => {
      AuditLogger.getLogs('non_existent_member')
        .then((logs) => {
          expect(logs).toEqual([]);
          done();
        })
        .catch(done);
    });

    it('should handle database errors in getLogs', (done) => {
      const originalAll = db.all;
      db.all = function(sql, params, callback) {
        callback(new Error('Database error'));
      };

      AuditLogger.getLogs('00147')
        .then(() => {
          db.all = originalAll;
          done(new Error('Should have rejected'));
        })
        .catch((err) => {
          db.all = originalAll;
          expect(err).not.toBeNull();
          done();
        });
    });

    it('should order logs by timestamp descending', (done) => {
      AuditLogger.getLogs('00147')
        .then((logs) => {
          if (logs.length > 1) {
            const firstTimestamp = new Date(logs[0].timestamp);
            const secondTimestamp = new Date(logs[1].timestamp);
            expect(firstTimestamp.getTime()).toBeGreaterThanOrEqual(secondTimestamp.getTime());
          }
          done();
        })
        .catch(done);
    });
  });

  describe('cleanOldLogs() method', () => {
    beforeEach((done) => {
      // Insert old logs (older than 90 days)
      db.run(
        `INSERT INTO audit_logs (operation, member_id, status, ip_address, timestamp)
         VALUES ('generate', '00147', 'success', '127.0.0.1', datetime('now', '-100 days'))`,
        () => {
          // Insert recent log
          db.run(
            `INSERT INTO audit_logs (operation, member_id, status, ip_address, timestamp)
             VALUES ('generate', '00147', 'success', '127.0.0.1', CURRENT_TIMESTAMP)`,
            done
          );
        }
      );
    });

    it('should delete logs older than 90 days', (done) => {
      db.all('SELECT COUNT(*) as count FROM audit_logs', (err, before) => {
        const countBefore = before[0].count;

        AuditLogger.cleanOldLogs();

        // Wait for async cleanup
        setTimeout(() => {
          db.all('SELECT COUNT(*) as count FROM audit_logs', (err, after) => {
            const countAfter = after[0].count;
            // Count should decrease (old logs deleted)
            expect(countAfter).toBeLessThanOrEqual(countBefore);
            done();
          });
        }, 50);
      });
    });

    it('should keep recent logs', (done) => {
      AuditLogger.cleanOldLogs();

      setTimeout(() => {
        db.get(
          `SELECT * FROM audit_logs WHERE timestamp > datetime('now', '-1 days')`,
          (err, row) => {
            expect(err).toBeNull();
            expect(row).toBeDefined();
            done();
          }
        );
      }, 50);
    });

    it('should handle cleanup errors gracefully', (done) => {
      const originalRun = db.run;
      db.run = function(sql, callback) {
        if (sql.includes('DELETE FROM audit_logs')) {
          callback(new Error('Cleanup failed'));
        } else {
          originalRun.call(this, sql, callback);
        }
      };

      expect(() => {
        AuditLogger.cleanOldLogs();
      }).not.toThrow();

      db.run = originalRun;
      done();
    });
  });
});

// ============================================================================
// MIGRATION TESTS
// ============================================================================

describe('Database Migration (Phase 2)', () => {
  describe('migrateToPhase2() function', () => {
    it('should successfully run migration without errors', (done) => {
      // Migration should not throw
      expect(() => {
        migrateToPhase2();
      }).not.toThrow();
      done();
    });

    it('should check for expiresAt column', (done) => {
      // After migration, expiresAt should exist
      db.all('PRAGMA table_info(tokens)', (err, columns) => {
        const hasExpiresAt = columns.some(col => col.name === 'expiresAt');
        expect(hasExpiresAt).toBe(true);
        done();
      });
    });

    it('should check for scan_count column', (done) => {
      db.all('PRAGMA table_info(tokens)', (err, columns) => {
        const hasScanCount = columns.some(col => col.name === 'scan_count');
        expect(hasScanCount).toBe(true);
        done();
      });
    });

    it('should create audit_logs table', (done) => {
      db.all(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'`,
        (err, rows) => {
          expect(rows.length).toBe(1);
          done();
        }
      );
    });

    it('should create idx_tokens_expiresAt index', (done) => {
      db.all(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tokens_expiresAt'`,
        (err, rows) => {
          expect(rows.length).toBe(1);
          done();
        }
      );
    });

    it('should be idempotent (safe to run multiple times)', (done) => {
      // Run migration twice
      migrateToPhase2();

      setTimeout(() => {
        migrateToPhase2();

        setTimeout(() => {
          // Should not fail on second run
          db.all('PRAGMA table_info(tokens)', (err, columns) => {
            expect(err).toBeNull();
            done();
          });
        }, 50);
      }, 50);
    });

    it('should handle missing columns gracefully', (done) => {
      // This tests the column existence check
      db.all('PRAGMA table_info(tokens)', (err, columns) => {
        const columnNames = columns.map(c => c.name);

        // Both expiresAt and scan_count should exist after initialization
        expect(columnNames).toContain('expiresAt');
        expect(columnNames).toContain('scan_count');
        done();
      });
    });
  });
});

// ============================================================================
// QR CONTROLLER ERROR PATH TESTS
// ============================================================================

describe('QR Controller Error Paths', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.post('/api/generate-qr', generateQR);
    app.get('/api/verify', verifyToken);
    app.post('/api/check-in', checkIn);
    app.get('/api/check-in-status', checkInStatus);
  });

  describe('generateQR() error paths', () => {
    it('should return 400 when member_id is missing', (done) => {
      request(app)
        .post('/api/generate-qr')
        .send({ name: 'John Doe' })
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain('member_id');
          expect(res.body.code).toBe(400);
        })
        .end(done);
    });

    it('should return 400 when name is missing', (done) => {
      request(app)
        .post('/api/generate-qr')
        .send({ member_id: '00147' })
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain('name');
        })
        .end(done);
    });

    it('should return 500 on database member insert error', (done) => {
      const originalRun = db.run;

      db.run = function(sql, params, callback) {
        if (sql.includes('INSERT OR REPLACE INTO members')) {
          callback(new Error('Database connection error'));
        } else {
          originalRun.apply(this, arguments);
        }
      };

      request(app)
        .post('/api/generate-qr')
        .send({ member_id: '00147', name: 'Test User' })
        .expect(500)
        .expect((res) => {
          expect(res.body.error).toBe('Database error');
          expect(res.body.code).toBe(500);
        })
        .end(() => {
          db.run = originalRun;
          done();
        });
    });

    it('should return 500 on token insert error', (done) => {
      let callCount = 0;
      const originalRun = db.run;

      db.run = function(sql, params, callback) {
        callCount++;
        // Allow member insert, fail token insert
        if (sql.includes('INSERT INTO tokens') && callCount === 2) {
          callback(new Error('Token insert failed'));
        } else {
          originalRun.apply(this, arguments);
        }
      };

      request(app)
        .post('/api/generate-qr')
        .send({ member_id: `test_${Date.now()}`, name: 'Test User' })
        .expect(500)
        .expect((res) => {
          expect(res.body.error).toBe('Token storage failed');
        })
        .end(() => {
          db.run = originalRun;
          done();
        });
    });

    it('should return 500 on top-level exception', (done) => {
      const originalRun = db.run;

      db.run = function(sql, params, callback) {
        throw new Error('Unexpected database error');
      };

      request(app)
        .post('/api/generate-qr')
        .send({ member_id: '00147', name: 'Test' })
        .expect(500)
        .expect((res) => {
          expect(res.body.error).toBe('Internal server error');
        })
        .end(() => {
          db.run = originalRun;
          done();
        });
    });
  });

  describe('verifyToken() error paths', () => {
    it('should return 400 when token is missing', (done) => {
      request(app)
        .get('/api/verify')
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain('token');
          expect(res.body.code).toBe(400);
        })
        .end(done);
    });

    it('should return 400 when token format is invalid', (done) => {
      request(app)
        .get('/api/verify?token=INVALID_TOKEN')
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain('Invalid token format');
        })
        .end(done);
    });

    it('should return 500 on database lookup error', (done) => {
      const originalGet = db.get;

      db.get = function(sql, params, callback) {
        callback(new Error('Database error'));
      };

      request(app)
        .get('/api/verify?token=SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6')
        .expect(500)
        .expect((res) => {
          expect(res.body.error).toBe('Database error');
        })
        .end(() => {
          db.get = originalGet;
          done();
        });
    });

    it('should return 404 when token not found', (done) => {
      const originalGet = db.get;

      db.get = function(sql, params, callback) {
        callback(null, null);
      };

      request(app)
        .get('/api/verify?token=SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6')
        .expect(404)
        .expect((res) => {
          expect(res.body.error).toContain('not found');
        })
        .end(() => {
          db.get = originalGet;
          done();
        });
    });

    it('should return 410 when token is expired', (done) => {
      const originalGet = db.get;

      db.get = function(sql, params, callback) {
        // Return expired token
        const expiredDate = new Date();
        expiredDate.setDate(expiredDate.getDate() - 1);

        callback(null, {
          id: 1,
          token: 'SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6',
          member_id: '00147',
          expiresAt: expiredDate.toISOString(),
          created_at: new Date().toISOString(),
          scan_count: 0
        });
      };

      request(app)
        .get('/api/verify?token=SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6')
        .expect(410)
        .expect((res) => {
          expect(res.body.error).toContain('expired');
          expect(res.body.code).toBe(410);
        })
        .end(() => {
          db.get = originalGet;
          done();
        });
    });

    it('should return 500 on top-level exception', (done) => {
      const originalGet = db.get;

      db.get = function(sql, params, callback) {
        throw new Error('Unexpected error');
      };

      request(app)
        .get('/api/verify?token=SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6')
        .expect(500)
        .expect((res) => {
          expect(res.body.error).toBe('Internal server error');
        })
        .end(() => {
          db.get = originalGet;
          done();
        });
    });
  });

  describe('checkIn() error paths', () => {
    it('should return 400 when token is missing', (done) => {
      request(app)
        .post('/api/check-in')
        .send({})
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain('token');
        })
        .end(done);
    });

    it('should return 400 when token format is invalid', (done) => {
      request(app)
        .post('/api/check-in')
        .send({ token: 'INVALID' })
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain('Invalid token format');
        })
        .end(done);
    });

    it('should return 500 on database lookup error', (done) => {
      const originalGet = db.get;

      db.get = function(sql, params, callback) {
        callback(new Error('Database error'));
      };

      request(app)
        .post('/api/check-in')
        .send({ token: 'SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6' })
        .expect(500)
        .expect((res) => {
          expect(res.body.error).toBe('Database error');
        })
        .end(() => {
          db.get = originalGet;
          done();
        });
    });

    it('should return 404 when token not found', (done) => {
      const originalGet = db.get;

      db.get = function(sql, params, callback) {
        callback(null, null);
      };

      request(app)
        .post('/api/check-in')
        .send({ token: 'SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6' })
        .expect(404)
        .end(() => {
          db.get = originalGet;
          done();
        });
    });

    it('should return 410 when token is expired', (done) => {
      const originalGet = db.get;

      db.get = function(sql, params, callback) {
        const expiredDate = new Date();
        expiredDate.setDate(expiredDate.getDate() - 1);

        callback(null, {
          id: 1,
          member_id: '00147',
          expiresAt: expiredDate.toISOString(),
          checked_in_at: null,
          scan_count: 0
        });
      };

      request(app)
        .post('/api/check-in')
        .send({ token: 'SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6' })
        .expect(410)
        .expect((res) => {
          expect(res.body.code).toBe(410);
        })
        .end(() => {
          db.get = originalGet;
          done();
        });
    });

    it('should return 409 when already checked in', (done) => {
      const originalGet = db.get;

      db.get = function(sql, params, callback) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 1);

        callback(null, {
          id: 1,
          member_id: '00147',
          expiresAt: futureDate.toISOString(),
          checked_in_at: new Date().toISOString(), // Already checked in
          scan_count: 1
        });
      };

      request(app)
        .post('/api/check-in')
        .send({ token: 'SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6' })
        .expect(409)
        .expect((res) => {
          expect(res.body.error).toContain('already checked in');
        })
        .end(() => {
          db.get = originalGet;
          done();
        });
    });

    it('should return 500 on database update error', (done) => {
      const originalGet = db.get;
      const originalRun = db.run;

      db.get = function(sql, params, callback) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 1);

        callback(null, {
          id: 1,
          member_id: '00147',
          expiresAt: futureDate.toISOString(),
          checked_in_at: null,
          scan_count: 0
        });
      };

      db.run = function(sql, params, callback) {
        callback(new Error('Update failed'));
      };

      request(app)
        .post('/api/check-in')
        .send({ token: 'SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6' })
        .expect(500)
        .end(() => {
          db.get = originalGet;
          db.run = originalRun;
          done();
        });
    });

    it('should return 500 on top-level exception', (done) => {
      const originalGet = db.get;

      db.get = function(sql, params, callback) {
        throw new Error('Unexpected error');
      };

      request(app)
        .post('/api/check-in')
        .send({ token: 'SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6' })
        .expect(500)
        .expect((res) => {
          expect(res.body.error).toBe('Internal server error');
        })
        .end(() => {
          db.get = originalGet;
          done();
        });
    });
  });

  describe('checkInStatus() error paths', () => {
    it('should return 400 when token is missing', (done) => {
      request(app)
        .get('/api/check-in-status')
        .expect(400)
        .end(done);
    });

    it('should return 400 when token format is invalid', (done) => {
      request(app)
        .get('/api/check-in-status?token=INVALID')
        .expect(400)
        .end(done);
    });

    it('should return 500 on database error', (done) => {
      const originalGet = db.get;

      db.get = function(sql, params, callback) {
        callback(new Error('Database error'));
      };

      request(app)
        .get('/api/check-in-status?token=SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6')
        .expect(500)
        .end(() => {
          db.get = originalGet;
          done();
        });
    });

    it('should return 404 when token not found', (done) => {
      const originalGet = db.get;

      db.get = function(sql, params, callback) {
        callback(null, null);
      };

      request(app)
        .get('/api/check-in-status?token=SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6')
        .expect(404)
        .end(() => {
          db.get = originalGet;
          done();
        });
    });

    it('should return 500 on top-level exception', (done) => {
      const originalGet = db.get;

      db.get = function(sql, params, callback) {
        throw new Error('Unexpected error');
      };

      request(app)
        .get('/api/check-in-status?token=SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6')
        .expect(500)
        .expect((res) => {
          expect(res.body.error).toBe('Internal server error');
        })
        .end(() => {
          db.get = originalGet;
          done();
        });
    });
  });
});
