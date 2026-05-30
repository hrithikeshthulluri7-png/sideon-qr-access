const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, '../data/sideon.db');

// Ensure the data directory exists (not committed to git)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Create connection
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[DB ERROR]', err.message);
  } else {
    console.log('[DB] Connected to SQLite database');
  }
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

const initializeDatabase = () => {
  // Run Phase 2 migration if needed
  try {
    const { migrateToPhase2 } = require('./migrate');
    migrateToPhase2();
  } catch (migrationErr) {
    // Migration module might not be required if not needed
  }

  // Phase 3: Initialize rate limit table
  try {
    const { initializeRateLimitTable } = require('./slidingWindowRateLimiter');
    initializeRateLimitTable();
  } catch (rateLimitErr) {
    console.error('[INIT ERROR] Rate limit initialization:', rateLimitErr.message);
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
    `, (err) => {
      if (err) console.error('[DB ERROR] Members table:', err.message);
      else console.log('[DB] Members table ready');
    });

    // Add admission columns to members if they don't exist (migration)
    db.run(`ALTER TABLE members ADD COLUMN admission_status TEXT DEFAULT 'pending'`, () => {});
    db.run(`ALTER TABLE members ADD COLUMN admitted_at DATETIME`, () => {});
    db.run(`ALTER TABLE members ADD COLUMN admitted_by TEXT`, () => {});

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
        pin_hash TEXT,
        checked_out_at DATETIME,
        FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('[DB ERROR] Tokens table:', err.message);
      else console.log('[DB] Tokens table ready');
    });

    // Add pin_hash and checked_out_at to tokens if upgrading existing DB
    db.run(`ALTER TABLE tokens ADD COLUMN pin_hash TEXT`, () => {});
    db.run(`ALTER TABLE tokens ADD COLUMN checked_out_at DATETIME`, () => {});
    db.run(`ALTER TABLE tokens ADD COLUMN pin_failed_attempts INTEGER DEFAULT 0`, () => {});

    // Admin users table
    db.run(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('[DB ERROR] Admin users table:', err.message);
      else console.log('[DB] Admin users table ready');
    });

    // Audit logs table for compliance and debugging
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
      if (err) console.error('[DB ERROR] Audit logs table:', err.message);
      else console.log('[DB] Audit logs table ready');
    });

    // Indexes for performance
    db.run(`CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token)`, (err) => {
      if (err) console.error('[DB ERROR] Index tokens_token:', err.message);
    });

    db.run(`CREATE INDEX IF NOT EXISTS idx_tokens_member_id ON tokens(member_id)`, (err) => {
      if (err) console.error('[DB ERROR] Index tokens_member_id:', err.message);
    });

    db.run(`CREATE INDEX IF NOT EXISTS idx_tokens_expiresAt ON tokens(expiresAt)`, (err) => {
      if (err) console.error('[DB ERROR] Index tokens_expiresAt:', err.message);
    });

    db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)`, (err) => {
      if (err) console.error('[DB ERROR] Index audit_logs_timestamp:', err.message);
    });

    db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_member_id ON audit_logs(member_id)`, (err) => {
      if (err) console.error('[DB ERROR] Index audit_logs_member_id:', err.message);
    });

    // Auto-restore members from QR backup if DB is empty
    setTimeout(() => {
      try {
        const { seedRestoreIfEmpty } = require('./seedRestore');
        seedRestoreIfEmpty(db, console);
      } catch (e) { /* seedRestore is optional */ }
    }, 500);

  });
};

module.exports = {
  db,
  initializeDatabase
};
