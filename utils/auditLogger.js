const { db } = require('./database');

/**
 * Log operations for audit trail and compliance
 * Async logging to prevent performance degradation
 */
class AuditLogger {
  /**
   * Log token operation (generation, verification, check-in)
   * @param {string} operation - Type of operation (generate, verify, check_in, verify_attempt)
   * @param {string} memberId - Member ID
   * @param {string} tokenId - Token (plain or hashed reference)
   * @param {string} status - Status (success, failure)
   * @param {number} errorCode - HTTP error code (optional)
   * @param {string} ipAddress - Client IP address
   * @param {object} metadata - Additional data (reason, attempt_count, etc)
   */
  static log(operation, memberId, tokenId, status, errorCode, ipAddress, metadata = {}) {
    // Use async to prevent blocking API responses. Returning the promise lets
    // tests and maintenance scripts wait for the write when they need to.
    return new Promise((resolve) => {
      setImmediate(() => {
        try {
          db.run(
            `INSERT INTO audit_logs
             (operation, member_id, token_id, status, error_code, ip_address, metadata, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [
              operation,
              memberId || null,
              tokenId || null,
              status,
              errorCode || null,
              ipAddress,
              JSON.stringify(metadata)
            ],
            (err) => {
              if (err) {
                console.error('[AUDIT LOG ERROR]', err.message);
                resolve(false);
                return;
              }

              resolve(true);
            }
          );
        } catch (error) {
          console.error('[AUDIT LOGGER ERROR]', error.message);
          resolve(false);
        }
      });
    });
  }

  /**
   * Get audit logs for a member or token (for debugging)
   * @param {string} memberId - Member ID to filter
   * @param {number} limit - Number of records (default 50)
   * @returns {Promise<array>}
   */
  static getLogs(memberId, limit = 50) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM audit_logs
         WHERE member_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
        [memberId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Clean old audit logs (retention policy: 90 days)
   */
  static cleanOldLogs() {
    setImmediate(() => {
      db.run(
        `DELETE FROM audit_logs
         WHERE timestamp < datetime('now', '-90 days')`,
        (err) => {
          if (err) {
            console.error('[AUDIT CLEANUP ERROR]', err.message);
          } else {
            console.log('[AUDIT] Old logs cleaned (90+ days)');
          }
        }
      );
    });
  }
}

module.exports = AuditLogger;
