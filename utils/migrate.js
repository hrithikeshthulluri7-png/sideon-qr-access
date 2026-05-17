/**
 * Database migration script for Phase 2
 * Adds expiresAt column to tokens table and creates audit_logs table
 */

const { db } = require('./database');

function migrateToPhase2() {
  console.log('[MIGRATION] Starting Phase 2 database migration...');

  // Add expiresAt column to tokens table if it doesn't exist
  db.all(
    `PRAGMA table_info(tokens)`,
    (err, columns) => {
      if (err) {
        console.error('[MIGRATION ERROR]', err.message);
        return;
      }

      const hasExpiresAt = columns.some(col => col.name === 'expiresAt');
      const hasScanCount = columns.some(col => col.name === 'scan_count');

      if (!hasExpiresAt) {
        console.log('[MIGRATION] Adding expiresAt column...');
        db.run(
          `ALTER TABLE tokens ADD COLUMN expiresAt DATETIME DEFAULT CURRENT_TIMESTAMP`,
          (err) => {
            if (err) {
              console.error('[MIGRATION ERROR] Failed to add expiresAt:', err.message);
            } else {
              console.log('[MIGRATION] Added expiresAt column');
            }
          }
        );
      } else {
        console.log('[MIGRATION] expiresAt column already exists');
      }

      if (!hasScanCount) {
        console.log('[MIGRATION] Adding scan_count column...');
        db.run(
          `ALTER TABLE tokens ADD COLUMN scan_count INTEGER DEFAULT 0`,
          (err) => {
            if (err) {
              console.error('[MIGRATION ERROR] Failed to add scan_count:', err.message);
            } else {
              console.log('[MIGRATION] Added scan_count column');
            }
          }
        );
      } else {
        console.log('[MIGRATION] scan_count column already exists');
      }

      // Create audit logs table if it doesn't exist
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
          metadata JSON
        )
      `, (err) => {
        if (err) {
          console.error('[MIGRATION ERROR] Failed to create audit_logs:', err.message);
        } else {
          console.log('[MIGRATION] audit_logs table ready');
        }
      });

      // Create index on expiresAt
      db.run(`CREATE INDEX IF NOT EXISTS idx_tokens_expiresAt ON tokens(expiresAt)`, (err) => {
        if (err && !err.message.includes('already exists')) {
          console.error('[MIGRATION ERROR] Failed to create idx_tokens_expiresAt:', err.message);
        }
      });

      console.log('[MIGRATION] Phase 2 migration complete');
    }
  );
}

module.exports = { migrateToPhase2 };
