const { db } = require('../utils/database');
const { generateToken, validateTokenFormat } = require('../utils/tokenGenerator');
const AuditLogger = require('../utils/auditLogger');

// Token expiration window in minutes (configurable via env var)
const EXPIRATION_MINUTES = parseInt(process.env.EXPIRATION_MINUTES || '60', 10);

/**
 * POST /api/generate-qr
 * Generate a QR access token for a member
 *
 * Expected request body:
 * {
 *   "member_id": "00147",
 *   "name": "John Doe",
 *   "email": "john@example.com",
 *   "mobile": "+1234567890",
 *   "agent": "Agent Name"
 * }
 *
 * Phase 2 enhancements:
 * - All queries use parameterized statements (SQL injection protection)
 * - Token includes expiresAt timestamp (configurable expiration window)
 * - Audit logging for all token generations
 */
const generateQR = (req, res) => {
  try {
    const { member_id, name, email, mobile, agent } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

    // Validation
    if (!member_id || !name) {
      AuditLogger.log('generate', null, null, 'failure', 400, clientIp, {
        reason: 'Missing required fields (member_id or name)'
      });
      return res.status(400).json({
        error: 'member_id and name are required',
        code: 400
      });
    }

    // Calculate expiration time (current time + EXPIRATION_MINUTES)
    const expiresAt = new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000).toISOString();

    // Insert or update member (parameterized query)
    db.run(
      `INSERT OR REPLACE INTO members (member_id, name, email, mobile, agent, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [member_id, name, email || null, mobile || null, agent || null],
      function(err) {
        if (err) {
          console.error('[DB ERROR] Insert member:', err.message);
          AuditLogger.log('generate', member_id, null, 'failure', 500, clientIp, {
            reason: 'Member insert failed',
            error: err.message
          });
          return res.status(500).json({
            error: 'Database error',
            code: 500
          });
        }

        // Generate token
        let token;
        try {
          token = generateToken(member_id);
        } catch (tokenErr) {
          console.error('[TOKEN ERROR]', tokenErr.message);
          AuditLogger.log('generate', member_id, null, 'failure', 500, clientIp, {
            reason: 'Token generation failed'
          });
          return res.status(500).json({
            error: 'Token generation failed',
            code: 500
          });
        }

        // Insert token with expiresAt timestamp (parameterized query)
        db.run(
          `INSERT INTO tokens (member_id, token, expiresAt, created_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [member_id, token, expiresAt],
          function(err) {
            if (err) {
              console.error('[DB ERROR] Insert token:', err.message);
              AuditLogger.log('generate', member_id, token, 'failure', 500, clientIp, {
                reason: 'Token insert failed'
              });
              return res.status(500).json({
                error: 'Token storage failed',
                code: 500
              });
            }

            console.log(`[TOKEN] Generated token for member ${member_id}: ${token}`);
            AuditLogger.log('generate', member_id, token, 'success', null, clientIp, {
              expiresAt: expiresAt,
              expirationMinutes: EXPIRATION_MINUTES
            });

            res.status(201).json({
              success: true,
              token: token,
              member_id: member_id,
              created_at: new Date().toISOString(),
              expiresAt: expiresAt,
              expirationMinutes: EXPIRATION_MINUTES,
              message: 'QR token generated successfully'
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('[ERROR] generateQR:', error.message);
    AuditLogger.log('generate', null, null, 'failure', 500, req.ip, {
      reason: 'Unexpected error',
      error: error.message
    });
    res.status(500).json({
      error: 'Internal server error',
      code: 500
    });
  }
};

/**
 * GET /api/verify?token=X
 * Verify a token and retrieve member information
 *
 * Returns member data without plaintext storage of sensitive info in token
 *
 * Phase 2 enhancements:
 * - Token expiration validation
 * - Returns scan_count for rate tracking
 * - Enhanced error codes and messages
 * - Audit logging for verification attempts
 */
const verifyToken = (req, res) => {
  try {
    const { token } = req.query;
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

    if (!token) {
      AuditLogger.log('verify_attempt', null, null, 'failure', 400, clientIp, {
        reason: 'Missing token parameter'
      });
      return res.status(400).json({
        error: 'token query parameter is required',
        code: 400
      });
    }

    // Validate token format
    if (!validateTokenFormat(token)) {
      AuditLogger.log('verify_attempt', null, token, 'failure', 400, clientIp, {
        reason: 'Invalid token format'
      });
      return res.status(400).json({
        error: 'Invalid token format',
        code: 400
      });
    }

    // Look up token and member (parameterized query)
    db.get(
      `SELECT t.id, t.token, t.created_at, t.expiresAt, t.verified_at, t.checked_in_at, t.scan_count,
              m.member_id, m.name, m.email, m.mobile, m.agent
       FROM tokens t
       JOIN members m ON t.member_id = m.member_id
       WHERE t.token = ?`,
      [token],
      (err, row) => {
        if (err) {
          console.error('[DB ERROR] Verify token:', err.message);
          AuditLogger.log('verify_attempt', null, token, 'failure', 500, clientIp, {
            reason: 'Database error',
            error: err.message
          });
          return res.status(500).json({
            error: 'Database error',
            code: 500
          });
        }

        if (!row) {
          AuditLogger.log('verify_attempt', null, token, 'failure', 404, clientIp, {
            reason: 'Token not found'
          });
          return res.status(404).json({
            error: 'Token not found or invalid',
            code: 404
          });
        }

        // Check token expiration
        const now = new Date();
        const expiresAt = new Date(row.expiresAt);

        if (now > expiresAt) {
          AuditLogger.log('verify_attempt', row.member_id, token, 'failure', 410, clientIp, {
            reason: 'Token expired',
            expiresAt: row.expiresAt
          });
          return res.status(410).json({
            error: 'This QR code has expired',
            code: 410,
            expiredAt: row.expiresAt,
            message: `This QR code expired at ${expiresAt.toISOString()}`
          });
        }

        // Increment scan count (parameterized query)
        db.run(
          `UPDATE tokens SET scan_count = scan_count + 1 WHERE id = ?`,
          [row.id],
          (updateErr) => {
            if (updateErr) {
              console.warn('[DB WARN] Failed to update scan_count:', updateErr.message);
            }
          }
        );

        AuditLogger.log('verify_attempt', row.member_id, token, 'success', null, clientIp, {
          scanCount: row.scan_count + 1,
          isCheckedIn: !!row.checked_in_at
        });

        res.status(200).json({
          success: true,
          token: row.token,
          member: {
            id: row.member_id,
            name: row.name,
            email: row.email,
            mobile: row.mobile,
            agent: row.agent
          },
          token_status: {
            created_at: row.created_at,
            expiresAt: row.expiresAt,
            verified_at: row.verified_at,
            checked_in_at: row.checked_in_at,
            is_checked_in: !!row.checked_in_at,
            scan_count: row.scan_count + 1
          }
        });
      }
    );
  } catch (error) {
    console.error('[ERROR] verifyToken:', error.message);
    AuditLogger.log('verify_attempt', null, null, 'failure', 500, req.ip, {
      reason: 'Unexpected error',
      error: error.message
    });
    res.status(500).json({
      error: 'Internal server error',
      code: 500
    });
  }
};

/**
 * POST /api/check-in
 * Mark a token as verified/checked-in
 *
 * Expected request body:
 * {
 *   "token": "SIDN_EVENT_2026_M00147_xyz7k9q..."
 * }
 *
 * Phase 2 enhancements:
 * - Token expiration validation
 * - Duplicate detection (409 if already checked in)
 * - Enhanced error responses with specific codes
 * - Row-level checks to prevent race conditions
 * - Audit logging for all check-in attempts
 * - scan_count tracking
 * - Returns verified_at, checked_in_at, scan_count in response
 */
const checkIn = (req, res) => {
  try {
    const { token } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

    if (!token) {
      AuditLogger.log('check_in', null, null, 'failure', 400, clientIp, {
        reason: 'Missing token in request body'
      });
      return res.status(400).json({
        error: 'token is required',
        code: 400
      });
    }

    if (!validateTokenFormat(token)) {
      AuditLogger.log('check_in', null, token, 'failure', 400, clientIp, {
        reason: 'Invalid token format'
      });
      return res.status(400).json({
        error: 'Invalid token format',
        code: 400
      });
    }

    // Look up token with all required fields (parameterized query)
    db.get(
      `SELECT id, member_id, expiresAt, checked_in_at, verified_at, scan_count
       FROM tokens
       WHERE token = ?`,
      [token],
      (err, row) => {
        if (err) {
          console.error('[DB ERROR] Check-in lookup:', err.message);
          AuditLogger.log('check_in', null, token, 'failure', 500, clientIp, {
            reason: 'Database error during lookup',
            error: err.message
          });
          return res.status(500).json({
            error: 'Database error',
            code: 500
          });
        }

        if (!row) {
          AuditLogger.log('check_in', null, token, 'failure', 404, clientIp, {
            reason: 'Token not found'
          });
          return res.status(404).json({
            error: 'Token not found',
            code: 404
          });
        }

        const memberId = row.member_id;
        const expiresAt = new Date(row.expiresAt);
        const now = new Date();

        // Check token expiration BEFORE attempting check-in
        if (now > expiresAt) {
          AuditLogger.log('check_in', memberId, token, 'failure', 410, clientIp, {
            reason: 'Token expired',
            expiresAt: row.expiresAt
          });
          return res.status(410).json({
            error: 'This QR code has expired',
            code: 410,
            expiredAt: row.expiresAt,
            details: `This QR code expired at ${expiresAt.toISOString()}`,
            retryAfter: 3600
          });
        }

        // Prevent duplicate check-ins (idempotency)
        if (row.checked_in_at) {
          AuditLogger.log('check_in', memberId, token, 'failure', 409, clientIp, {
            reason: 'Duplicate check-in attempt',
            previousCheckInAt: row.checked_in_at,
            duplicate: true
          });
          return res.status(409).json({
            error: 'Token already checked in',
            code: 409,
            checked_in_at: row.checked_in_at,
            message: 'This member has already checked in with this QR code'
          });
        }

        // Mark as checked in with transaction-like behavior
        // Update both checked_in_at and verified_at in one atomic operation
        const checkedInAt = new Date().toISOString();
        db.run(
          `UPDATE tokens
           SET checked_in_at = ?, verified_at = ?, scan_count = scan_count + 1
           WHERE id = ? AND checked_in_at IS NULL`,
          [checkedInAt, checkedInAt, row.id],
          function(err) {
            if (err) {
              console.error('[DB ERROR] Check-in update:', err.message);
              AuditLogger.log('check_in', memberId, token, 'failure', 500, clientIp, {
                reason: 'Database error during update',
                error: err.message
              });
              return res.status(500).json({
                error: 'Check-in failed',
                code: 500
              });
            }

            // Check if update actually affected a row (race condition check)
            if (this.changes === 0) {
              // Another request checked in this token concurrently
              AuditLogger.log('check_in', memberId, token, 'failure', 409, clientIp, {
                reason: 'Concurrent check-in detected',
                concurrent: true
              });
              return res.status(409).json({
                error: 'Token already checked in',
                code: 409,
                message: 'This token was checked in by another request. This is the second check-in attempt.'
              });
            }

            console.log(`[CHECK-IN] Success: token=${token} member=${memberId}`);

            AuditLogger.log('check_in', memberId, token, 'success', null, clientIp, {
              checkedInAt: checkedInAt,
              scanCount: row.scan_count + 1
            });

            res.status(200).json({
              success: true,
              message: 'Check-in successful',
              token: token,
              member_id: memberId,
              verified_at: checkedInAt,
              checked_in_at: checkedInAt,
              scan_count: row.scan_count + 1
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('[ERROR] checkIn:', error.message);
    AuditLogger.log('check_in', null, null, 'failure', 500, req.ip, {
      reason: 'Unexpected error',
      error: error.message
    });
    res.status(500).json({
      error: 'Internal server error',
      code: 500
    });
  }
};

/**
 * GET /api/check-in-status?token=X
 * Check if a token has been verified/checked-in
 *
 * Phase 2 enhancements:
 * - Token expiration validation
 * - Returns expiresAt, scan_count
 * - Enhanced error responses
 * - Audit logging for status checks
 */
const checkInStatus = (req, res) => {
  try {
    const { token } = req.query;
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

    if (!token) {
      return res.status(400).json({
        error: 'token query parameter is required',
        code: 400
      });
    }

    if (!validateTokenFormat(token)) {
      AuditLogger.log('status_check', null, token, 'failure', 400, clientIp, {
        reason: 'Invalid token format'
      });
      return res.status(400).json({
        error: 'Invalid token format',
        code: 400
      });
    }

    // Parameterized query
    db.get(
      `SELECT token, created_at, expiresAt, verified_at, checked_in_at, scan_count, member_id
       FROM tokens
       WHERE token = ?`,
      [token],
      (err, row) => {
        if (err) {
          console.error('[DB ERROR] Check-in status:', err.message);
          AuditLogger.log('status_check', null, token, 'failure', 500, clientIp, {
            reason: 'Database error',
            error: err.message
          });
          return res.status(500).json({
            error: 'Database error',
            code: 500
          });
        }

        if (!row) {
          AuditLogger.log('status_check', null, token, 'failure', 404, clientIp, {
            reason: 'Token not found'
          });
          return res.status(404).json({
            error: 'Token not found',
            code: 404
          });
        }

        // Check expiration
        const now = new Date();
        const expiresAt = new Date(row.expiresAt);
        const isExpired = now > expiresAt;

        AuditLogger.log('status_check', row.member_id, token, 'success', null, clientIp, {
          isCheckedIn: !!row.checked_in_at,
          isExpired: isExpired,
          scanCount: row.scan_count
        });

        res.status(200).json({
          success: true,
          token: row.token,
          member_id: row.member_id,
          created_at: row.created_at,
          expiresAt: row.expiresAt,
          is_expired: isExpired,
          verified_at: row.verified_at,
          checked_in_at: row.checked_in_at,
          is_checked_in: !!row.checked_in_at,
          scan_count: row.scan_count
        });
      }
    );
  } catch (error) {
    console.error('[ERROR] checkInStatus:', error.message);
    AuditLogger.log('status_check', null, null, 'failure', 500, req.ip, {
      reason: 'Unexpected error',
      error: error.message
    });
    res.status(500).json({
      error: 'Internal server error',
      code: 500
    });
  }
};

module.exports = {
  generateQR,
  verifyToken,
  checkIn,
  checkInStatus
};
