/**
 * database.js
 *
 * Uses @libsql/client (Turso) via LibsqlAdapter for permanent cloud storage.
 * Falls back to a local SQLite file when TURSO_DATABASE_URL is not set (dev).
 *
 * The exported `db` object exposes the same sqlite3 callback API
 * (db.get / db.run / db.all / db.serialize / db.close) so all routes
 * and controllers work without any changes.
 */

const path = require('path');
const fs = require('fs');
const { LibsqlAdapter } = require('./libsqlAdapter');

// Ensure local data dir exists (used in dev / local fallback)
const LOCAL_DB_PATH = process.env.DATABASE_URL || path.join(__dirname, '../data/sideon.db');
fs.mkdirSync(path.dirname(LOCAL_DB_PATH), { recursive: true });

// Single shared DB instance
const db = new LibsqlAdapter();

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

const initializeDatabase = () => {
  // Rate limit table (optional module)
  try {
    const { initializeRateLimitTable } = require('./slidingWindowRateLimiter');
    initializeRateLimitTable();
  } catch (rateLimitErr) {
    console.error('[INIT ERROR] Rate limit initialization:', rateLimitErr.message);
  }

  db.serialize(() => {
    // ── Members ──────────────────────────────────────────────────────────────
    db.run(`
      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        mobile VARCHAR(20),
        agent VARCHAR(255),
        admission_status TEXT DEFAULT 'pending',
        admitted_at DATETIME,
        admitted_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('[DB ERROR] Members table:', err.message);
      else console.log('[DB] Members table ready');
    });

    // ── Tokens ───────────────────────────────────────────────────────────────
    db.run(`
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id VARCHAR(50) NOT NULL,
        token VARCHAR(255) UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expiresAt DATETIME NOT NULL,
        verified_at DATETIME,
        checked_in_at DATETIME,
        checked_out_at DATETIME,
        scan_count INTEGER DEFAULT 0,
        pin_hash TEXT,
        pin_failed_attempts INTEGER DEFAULT 0,
        FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('[DB ERROR] Tokens table:', err.message);
      else console.log('[DB] Tokens table ready');
    });

    // ── Admin users ───────────────────────────────────────────────────────────
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

    // ── Audit logs ────────────────────────────────────────────────────────────
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

    // ── Indexes ───────────────────────────────────────────────────────────────
    db.run(`CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_tokens_member_id ON tokens(member_id)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_tokens_expiresAt ON tokens(expiresAt)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_member_id ON audit_logs(member_id)`, () => {});

    // ── Auto-restore from QR backup on empty DB ───────────────────────────────
    setTimeout(() => {
      try {
        const { seedRestoreIfEmpty } = require('./seedRestore');
        seedRestoreIfEmpty(db, console);
      } catch (e) { /* seedRestore is optional */ }
    }, 800);
  });
};

module.exports = { db, initializeDatabase };
