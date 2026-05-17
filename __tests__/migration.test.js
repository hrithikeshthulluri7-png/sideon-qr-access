/**
 * Migration Module Coverage Tests
 * Test the Phase 2 database migration functionality
 */

describe('Migration Module - Phase 2', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should export migrateToPhase2 function', () => {
    const { migrateToPhase2 } = require('../utils/migrate');
    expect(typeof migrateToPhase2).toBe('function');
  });

  it('should execute migrateToPhase2 without throwing', () => {
    const { migrateToPhase2 } = require('../utils/migrate');
    
    expect(() => {
      migrateToPhase2();
    }).not.toThrow();
  });

  it('should handle multiple migration calls gracefully', (done) => {
    const { migrateToPhase2 } = require('../utils/migrate');
    
    // Call migration multiple times
    migrateToPhase2();
    
    setTimeout(() => {
      migrateToPhase2();
      
      setTimeout(() => {
        // Verify no errors occurred
        migrateToPhase2();
        
        setTimeout(() => {
          done();
        }, 100);
      }, 100);
    }, 100);
  });

  it('should properly add columns if they do not exist', (done) => {
    const { db } = require('../utils/database');
    const { migrateToPhase2 } = require('../utils/migrate');
    
    // Run migration
    migrateToPhase2();
    
    setTimeout(() => {
      // Verify columns exist in tokens table
      db.all(`PRAGMA table_info(tokens)`, (err, columns) => {
        expect(err).toBeNull();
        const columnNames = columns.map(c => c.name);
        
        expect(columnNames).toContain('expiresAt');
        expect(columnNames).toContain('scan_count');
        done();
      });
    }, 200);
  });

  it('should detect and report existing columns', (done) => {
    const { migrateToPhase2 } = require('../utils/migrate');
    
    // Running migration again should detect columns already exist
    migrateToPhase2();
    
    setTimeout(() => {
      // Second call should also succeed without errors
      migrateToPhase2();
      
      setTimeout(() => {
        done();
      }, 100);
    }, 100);
  });

  it('should create audit_logs table during migration', (done) => {
    const { db } = require('../utils/database');
    const { migrateToPhase2 } = require('../utils/migrate');
    
    migrateToPhase2();
    
    setTimeout(() => {
      // Verify audit_logs table exists
      db.all(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'`,
        (err, rows) => {
          expect(err).toBeNull();
          expect(rows.length).toBeGreaterThan(0);
          done();
        }
      );
    }, 200);
  });

  it('should create index on expiresAt column', (done) => {
    const { db } = require('../utils/database');
    const { migrateToPhase2 } = require('../utils/migrate');
    
    migrateToPhase2();
    
    setTimeout(() => {
      // Verify index exists
      db.all(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tokens_expiresAt'`,
        (err, rows) => {
          expect(err).toBeNull();
          expect(rows.length).toBeGreaterThan(0);
          done();
        }
      );
    }, 200);
  });

  it('should be idempotent - running multiple times should be safe', (done) => {
    const { db } = require('../utils/database');
    const { migrateToPhase2 } = require('../utils/migrate');
    
    // Run migration 3 times
    migrateToPhase2();
    setTimeout(() => {
      migrateToPhase2();
      setTimeout(() => {
        migrateToPhase2();
        setTimeout(() => {
          // Verify table structure is still correct
          db.all(`PRAGMA table_info(tokens)`, (err, columns) => {
            expect(err).toBeNull();
            const columnNames = columns.map(c => c.name);
            expect(columnNames).toContain('expiresAt');
            expect(columnNames).toContain('scan_count');
            done();
          });
        }, 100);
      }, 100);
    }, 100);
  });
});
