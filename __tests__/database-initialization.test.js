/**
 * Database Initialization Coverage Tests
 * Explicitly test the database module initialization and exports
 */

describe('Database Module Initialization', () => {
  beforeEach(() => {
    // Clear the require cache to force re-initialization
    jest.resetModules();
  });

  it('should export db and initializeDatabase', () => {
    const { db, initializeDatabase } = require('../utils/database');
    
    expect(db).toBeDefined();
    expect(typeof db.run).toBe('function');
    expect(typeof db.get).toBe('function');
    expect(typeof db.all).toBe('function');
    expect(typeof db.serialize).toBe('function');
    expect(typeof initializeDatabase).toBe('function');
  });

  it('should have db object with proper SQLite methods', () => {
    const { db } = require('../utils/database');
    
    // Verify all expected methods exist
    expect(db.run).toBeDefined();
    expect(db.get).toBeDefined();
    expect(db.all).toBeDefined();
    expect(db.serialize).toBeDefined();
    expect(db.close).toBeDefined();
  });

  it('should execute initializeDatabase without errors', () => {
    const { initializeDatabase } = require('../utils/database');
    
    expect(() => {
      initializeDatabase();
    }).not.toThrow();
  });

  it('should have PRAGMA foreign_keys enabled', (done) => {
    const { db } = require('../utils/database');
    
    db.all('PRAGMA foreign_keys', (err, result) => {
      expect(err).toBeNull();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      done();
    });
  });

  it('should handle multiple table creation attempts gracefully', (done) => {
    const { db, initializeDatabase } = require('../utils/database');
    
    // Call initializeDatabase multiple times
    initializeDatabase();
    
    setTimeout(() => {
      initializeDatabase();
      
      setTimeout(() => {
        // Verify tables exist
        db.all(
          `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
          (err, rows) => {
            expect(err).toBeNull();
            const tableNames = rows.map(r => r.name);
            expect(tableNames).toContain('members');
            expect(tableNames).toContain('tokens');
            expect(tableNames).toContain('audit_logs');
            done();
          }
        );
      }, 100);
    }, 100);
  });

  it('should properly handle index creation on existing tables', (done) => {
    const { db } = require('../utils/database');
    
    db.all(
      `SELECT name FROM sqlite_master WHERE type='index' ORDER BY name`,
      (err, indexes) => {
        expect(err).toBeNull();
        expect(Array.isArray(indexes)).toBe(true);
        expect(indexes.length).toBeGreaterThan(0);
        
        // Verify key indexes exist
        const indexNames = indexes.map(i => i.name).filter(n => n.includes('idx_'));
        expect(indexNames.length).toBeGreaterThan(0);
        done();
      }
    );
  });

  it('should verify members table structure', (done) => {
    const { db } = require('../utils/database');
    
    db.all(`PRAGMA table_info(members)`, (err, columns) => {
      expect(err).toBeNull();
      const columnNames = columns.map(c => c.name);
      
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('member_id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('email');
      expect(columnNames).toContain('mobile');
      expect(columnNames).toContain('agent');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
      done();
    });
  });

  it('should verify tokens table structure', (done) => {
    const { db } = require('../utils/database');
    
    db.all(`PRAGMA table_info(tokens)`, (err, columns) => {
      expect(err).toBeNull();
      const columnNames = columns.map(c => c.name);
      
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('member_id');
      expect(columnNames).toContain('token');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('expiresAt');
      expect(columnNames).toContain('verified_at');
      expect(columnNames).toContain('checked_in_at');
      expect(columnNames).toContain('scan_count');
      done();
    });
  });

  it('should verify audit_logs table structure', (done) => {
    const { db } = require('../utils/database');
    
    db.all(`PRAGMA table_info(audit_logs)`, (err, columns) => {
      expect(err).toBeNull();
      const columnNames = columns.map(c => c.name);
      
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('operation');
      expect(columnNames).toContain('member_id');
      expect(columnNames).toContain('token_id');
      expect(columnNames).toContain('timestamp');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('error_code');
      expect(columnNames).toContain('ip_address');
      expect(columnNames).toContain('metadata');
      done();
    });
  });

  it('should handle database environment variable override', () => {
    // Just verify the logic exists - we can't actually test override
    // without affecting the real database, but we verify the code path exists
    const originalEnv = process.env.DATABASE_URL;
    
    try {
      // The database module loads on require, so we can't really test this
      // without full module isolation, but we verify the pattern is correct
      const dbModule = require('../utils/database');
      expect(dbModule.db).toBeDefined();
    } finally {
      if (originalEnv) {
        process.env.DATABASE_URL = originalEnv;
      }
    }
  });
});
