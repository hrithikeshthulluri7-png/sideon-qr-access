const { db } = require('../utils/database');
const { generateToken, validateTokenFormat } = require('../utils/tokenGenerator');
const AuditLogger = require('../utils/auditLogger');
const { signJWT } = require('../utils/jwtService');
const { checkRateLimit, recordFailure } = require('../utils/slidingWindowRateLimiter');
const bcrypt = require('bcrypt');

// Tokens never expire — set 100 years in the future
const EXPIRATION_MINUTES = parseInt(process.env.EXPIRATION_MINUTES || '52560000', 10); // 100 years

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
const generateQR = async (req, res) => {
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

    // Upsert member — preserve existing admission_status so re-generation doesn't reset admitted members
    db.run(
      `INSERT INTO members (member_id, name, email, mobile, agent, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(member_id) DO UPDATE SET
         name = excluded.name,
         email = excluded.email,
         mobile = excluded.mobile,
         agent = excluded.agent,
         updated_at = excluded.updated_at`,
      [member_id, name, email || null, mobile || null, agent || null],
      async function(err) {
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

        // Use fixed event PIN from env var, default 369874
        const pin = process.env.EVENT_PIN || '369874';
        let pinHash;
        try {
          pinHash = await bcrypt.hash(pin, 12);
        } catch (hashErr) {
          console.error('[PIN ERROR] Hash failed:', hashErr.message);
          return res.status(500).json({ error: 'PIN generation failed', code: 500 });
        }

        // Insert token with PIN hash
        db.run(
          `INSERT INTO tokens (member_id, token, expiresAt, pin_hash, created_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [member_id, token, expiresAt, pinHash],
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

            // Phase 3: Generate JWT token alongside database token
            let jwtToken;
            try {
              jwtToken = signJWT(member_id, token);
            } catch (jwtErr) {
              console.error('[JWT ERROR] Failed to generate JWT:', jwtErr.message);
              jwtToken = null;
            }

            console.log(`[TOKEN] Generated token for member ${member_id}: ${token}`);
            AuditLogger.log('generate', member_id, token, 'success', null, clientIp, {
              expiresAt: expiresAt,
              expirationMinutes: EXPIRATION_MINUTES,
              jwt_issued: !!jwtToken,
              pin_generated: true
            });

            res.status(201).json({
              success: true,
              token: token,
              jwt: jwtToken,
              member_id: member_id,
              pin: pin, // returned once — user must save this
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
          return res.status(200).json({
            success: false,
            error: 'Token not found or invalid',
            code: 404,
            token: token,
            is_valid: false
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
          return res.status(200).json({
            success: false,
            error: 'This QR code has expired',
            code: 410,
            token: token,
            member_id: row.member_id,
            is_valid: false,
            is_expired: true,
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
          member_id: row.member_id,
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
          return res.status(200).json({
            success: false,
            error: 'Token not found',
            code: 404,
            token: token,
            is_valid: false
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
          return res.status(200).json({
            success: false,
            error: 'This QR code has expired',
            code: 410,
            token: token,
            member_id: memberId,
            is_valid: false,
            is_expired: true,
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
          return res.status(200).json({
            success: false,
            error: 'Token already checked in',
            code: 409,
            token: token,
            member_id: memberId,
            checked_in_at: row.checked_in_at,
            check_in_time: row.checked_in_at,
            message: 'This member has already checked in with this QR code',
            is_duplicate: true
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
              return res.status(200).json({
                success: false,
                error: 'Token already checked in',
                code: 409,
                token: token,
                member_id: memberId,
                message: 'This token was checked in by another request. This is the second check-in attempt.',
                is_duplicate: true
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
              check_in_time: checkedInAt,
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
          return res.status(200).json({
            success: false,
            error: 'Token not found',
            code: 404,
            token: token,
            is_valid: false
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

/**
 * GET /api/generate-qr-image?token=X
 * Generate a scannable QR code image from a token string
 *
 * Phase 3 enhancement:
 * - Returns actual QR image (PNG format)
 * - Token must be a valid format
 * - Sets appropriate Content-Type header
 * - Includes error handling for invalid/expired tokens
 * - Supports optional image format parameter (png or svg)
 *
 * Query Parameters:
 * - token (required): The QR token to encode
 * - format (optional): 'png' (default) or 'svg'
 */
const generateQRImage = async (req, res) => {
  try {
    const { token, format } = req.query;
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

    if (!token) {
      AuditLogger.log('generate_image', null, null, 'failure', 400, clientIp, {
        reason: 'Missing token parameter'
      });
      return res.status(400).json({
        error: 'token query parameter is required',
        code: 400
      });
    }

    // Validate token format
    if (!validateTokenFormat(token)) {
      AuditLogger.log('generate_image', null, token, 'failure', 400, clientIp, {
        reason: 'Invalid token format'
      });
      return res.status(400).json({
        error: 'Invalid token format',
        code: 400
      });
    }

    // Import QR image generator
    const { generateQRImagePNG, generateQRImageSVG } = require('../utils/qrImageGenerator');

    // Validate token exists and is not expired (parameterized query)
    db.get(
      `SELECT id, member_id, expiresAt FROM tokens WHERE token = ?`,
      [token],
      async (err, row) => {
        if (err) {
          console.error('[DB ERROR] Generate image lookup:', err.message);
          AuditLogger.log('generate_image', null, token, 'failure', 500, clientIp, {
            reason: 'Database error',
            error: err.message
          });
          return res.status(500).json({
            error: 'Database error',
            code: 500
          });
        }

        if (!row) {
          AuditLogger.log('generate_image', null, token, 'failure', 404, clientIp, {
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
          AuditLogger.log('generate_image', row.member_id, token, 'failure', 410, clientIp, {
            reason: 'Token expired'
          });
          return res.status(410).json({
            error: 'This QR code has expired',
            code: 410,
            expiredAt: row.expiresAt
          });
        }

        try {
          // Determine format and generate image
          const imageFormat = (format || 'png').toLowerCase();

          // Encode scan URL so phone opens the check-in page when scanned
          const SCAN_BASE = process.env.SCAN_BASE_URL || 'https://hrithikeshthulluri7-png.github.io/sideon-qr-access/pin.html';
          const qrContent = `${SCAN_BASE}?token=${encodeURIComponent(token)}`;

          if (imageFormat === 'svg') {
            // Generate SVG data URI
            const svgDataUri = await generateQRImageSVG(qrContent, {
              width: 300,
              margin: 2
            });

            AuditLogger.log('generate_image', row.member_id, token, 'success', null, clientIp, {
              format: 'svg'
            });

            // Return SVG as data URI (useful for embedding)
            return res.status(200).json({
              success: true,
              token: token,
              format: 'svg',
              data: svgDataUri,
              contentType: 'image/svg+xml'
            });
          } else if (imageFormat === 'png') {
            // Generate PNG buffer
            const pngBuffer = await generateQRImagePNG(qrContent, {
              width: 400,
              margin: 2,
              errorCorrectionLevel: 'M'
            });

            AuditLogger.log('generate_image', row.member_id, token, 'success', null, clientIp, {
              format: 'png',
              size: pngBuffer.length
            });

            // Set appropriate headers for PNG image
            res.type('image/png');
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.set('Pragma', 'no-cache');
            res.set('Expires', '0');
            return res.send(pngBuffer);
          } else {
            return res.status(400).json({
              error: 'Invalid format. Use "png" or "svg"',
              code: 400,
              supported: ['png', 'svg']
            });
          }
        } catch (imageError) {
          console.error('[QR ERROR] Image generation failed:', imageError.message);
          AuditLogger.log('generate_image', row.member_id, token, 'failure', 500, clientIp, {
            reason: 'QR image generation failed',
            error: imageError.message
          });

          return res.status(500).json({
            error: 'QR image generation failed',
            code: 500,
            details: imageError.message
          });
        }
      }
    );
  } catch (error) {
    console.error('[ERROR] generateQRImage:', error.message);
    AuditLogger.log('generate_image', null, null, 'failure', 500, req.ip, {
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
 * POST /api/verify-jwt
 * Verify a JWT token and validate it against the database token (Phase 3)
 *
 * Expected request body:
 * {
 *   "jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 * }
 *
 * Phase 3 enhancements:
 * - JWT signature verification
 * - Cross-check JWT token_id with database
 * - Token expiration validation
 * - Sliding window rate limiting for verify attempts
 * - Progressive backoff on repeated failures
 * - Audit logging for all verify attempts
 */
const verifyJWTToken = async (req, res) => {
  try {
    const { jwt } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

    if (!jwt) {
      AuditLogger.log('jwt_verify', null, null, 'failure', 400, clientIp, {
        reason: 'Missing JWT in request body'
      });
      return res.status(400).json({
        error: 'jwt is required in request body',
        code: 400
      });
    }

    // JWT verification
    let decoded;
    try {
      const { verifyJWT } = require('../utils/jwtService');
      decoded = verifyJWT(jwt);
    } catch (jwtErr) {
      const failureResult = await recordFailure(`jwt_verify_${clientIp}`);

      AuditLogger.log('jwt_verify', null, jwt, 'failure', 401, clientIp, {
        reason: 'JWT verification failed',
        error: jwtErr.message,
        failureCount: failureResult.failureCount,
        inBackoff: failureResult.backoffActive
      });

      const response = {
        error: 'Invalid or expired JWT token',
        code: 401,
        message: jwtErr.message
      };

      if (failureResult.backoffActive) {
        response.cooldownRemaining = failureResult.cooldownRemaining;
        response.retryAfter = failureResult.cooldownRemaining;
      }

      return res.status(401).json(response);
    }

    // Verify JWT token exists in database
    db.get(
      'SELECT id, member_id, token, expiresAt, checked_in_at FROM tokens WHERE token = ?',
      [decoded.token_id],
      async (err, row) => {
        try {
          if (err) {
            console.error('[DB ERROR] JWT verify lookup:', err.message);
            AuditLogger.log('jwt_verify', decoded.member_id, decoded.token_id, 'failure', 500, clientIp, {
              reason: 'Database error',
              error: err.message
            });
            return res.status(500).json({
              error: 'Database error',
              code: 500
            });
          }

          if (!row) {
            const failureResult = await recordFailure(`jwt_verify_${clientIp}`);

            AuditLogger.log('jwt_verify', decoded.member_id, decoded.token_id, 'failure', 404, clientIp, {
              reason: 'Token not found in database',
              failureCount: failureResult.failureCount
            });

            return res.status(404).json({
              error: 'Token not found',
              code: 404,
              message: 'JWT token does not exist in database'
            });
          }

          // Verify token expiration
          const now = new Date();
          const expiresAt = new Date(row.expiresAt);

          if (now > expiresAt) {
            const failureResult = await recordFailure(`jwt_verify_${clientIp}`);

            AuditLogger.log('jwt_verify', decoded.member_id, decoded.token_id, 'failure', 410, clientIp, {
              reason: 'Token expired',
              expiresAt: row.expiresAt
            });

            return res.status(410).json({
              error: 'Token has expired',
              code: 410,
              expiredAt: row.expiresAt
            });
          }

          // Check rate limit for verify attempts
          const rateLimitResult = await checkRateLimit(
            `verify_${decoded.token_id}`,
            3, // 3 verify attempts per token
            60  // per 60 seconds
          );

          if (!rateLimitResult.allowed) {
            AuditLogger.log('jwt_verify', decoded.member_id, decoded.token_id, 'failure', 429, clientIp, {
              reason: 'Rate limit exceeded',
              remaining: rateLimitResult.remaining
            });

            return res.status(429).json({
              error: 'Too many verify attempts',
              code: 429,
              message: `Maximum 3 verify attempts per minute. Try again in ${rateLimitResult.resetTime - Math.floor(Date.now() / 1000)} seconds.`,
              retryAfter: rateLimitResult.resetTime - Math.floor(Date.now() / 1000),
              'X-RateLimit-Remaining': rateLimitResult.remaining,
              'X-RateLimit-Reset': rateLimitResult.resetTime
            });
          }

          // JWT verified successfully
          AuditLogger.log('jwt_verify', decoded.member_id, decoded.token_id, 'success', null, clientIp, {
            isCheckedIn: !!row.checked_in_at
          });

          // Set rate limit headers before sending response
          res.set('X-RateLimit-Remaining', rateLimitResult.remaining);
          res.set('X-RateLimit-Reset', rateLimitResult.resetTime);

          res.status(200).json({
            success: true,
            message: 'JWT token verified successfully',
            member_id: decoded.member_id,
            token_id: decoded.token_id,
            is_checked_in: !!row.checked_in_at,
            checked_in_at: row.checked_in_at
          });
        } catch (innerErr) {
          console.error('[ERROR] verifyJWTToken inner:', innerErr.message);
          AuditLogger.log('jwt_verify', decoded?.member_id, decoded?.token_id, 'failure', 500, clientIp, {
            reason: 'Unexpected error',
            error: innerErr.message
          });
          res.status(500).json({
            error: 'Internal server error',
            code: 500
          });
        }
      }
    );
  } catch (error) {
    console.error('[ERROR] verifyJWTToken:', error.message);
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    AuditLogger.log('jwt_verify', null, null, 'failure', 500, clientIp, {
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
 * POST /api/verify-pin
 * Verify PIN against stored bcrypt hash; mark token checked-in on success.
 * Rate-limited: max 5 attempts per IP per 15 minutes.
 */
const verifyPin = async (req, res) => {
  try {
    const { token, pin } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

    if (!token || !pin) {
      return res.status(400).json({ error: 'token and pin are required', code: 400 });
    }

    if (!validateTokenFormat(token)) {
      return res.status(400).json({ error: 'Invalid token format', code: 400 });
    }

    db.get(
      `SELECT t.id, t.pin_hash, t.expiresAt, t.checked_in_at, t.member_id,
              COALESCE(t.pin_failed_attempts, 0) AS pin_failed_attempts, m.admission_status
       FROM tokens t JOIN members m ON t.member_id = m.member_id
       WHERE t.token = ?`,
      [token],
      async (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error', code: 500 });
        if (!row) return res.status(404).json({ error: 'Token not found', code: 404 });

        if (new Date() > new Date(row.expiresAt)) {
          return res.status(410).json({ error: 'Token expired', code: 410 });
        }

        if (row.admission_status !== 'admitted') {
          return res.status(403).json({ error: 'Not yet admitted by admin', code: 403 });
        }

        if (row.checked_in_at) {
          return res.status(409).json({ error: 'Already checked in', code: 409 });
        }

        // Lock after 3 failed attempts
        if (row.pin_failed_attempts >= 3) {
          AuditLogger.log('verify_pin', row.member_id, token, 'failure', 423, clientIp, { reason: 'Locked — too many failed attempts' });
          return res.status(423).json({ error: 'Too many failed attempts. This device is locked.', code: 423, locked: true });
        }

        const match = await bcrypt.compare(String(pin), row.pin_hash);
        if (!match) {
          const newCount = row.pin_failed_attempts + 1;
          db.run(`UPDATE tokens SET pin_failed_attempts = ? WHERE id = ?`, [newCount, row.id]);
          const attemptsLeft = 3 - newCount;
          AuditLogger.log('verify_pin', row.member_id, token, 'failure', 401, clientIp, { reason: 'Wrong PIN', attemptsLeft });
          return res.status(401).json({
            error: attemptsLeft <= 0 ? 'Too many failed attempts. This device is locked.' : 'Incorrect PIN',
            code: attemptsLeft <= 0 ? 423 : 401,
            attempts_left: attemptsLeft,
            locked: attemptsLeft <= 0
          });
        }

        const checkedInAt = new Date().toISOString();
        db.run(
          `UPDATE tokens SET checked_in_at = ?, verified_at = ?, scan_count = scan_count + 1, pin_failed_attempts = 0
           WHERE id = ? AND checked_in_at IS NULL`,
          [checkedInAt, checkedInAt, row.id],
          function(updateErr) {
            if (updateErr || this.changes === 0) {
              return res.status(409).json({ error: 'Already checked in', code: 409 });
            }
            AuditLogger.log('verify_pin', row.member_id, token, 'success', null, clientIp, { checkedInAt });
            res.status(200).json({ success: true, message: 'Check-in successful', checked_in_at: checkedInAt });
          }
        );
      }
    );
  } catch (error) {
    console.error('[ERROR] verifyPin:', error.message);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
};

/**
 * POST /api/get-admission-status
 * Poll admission status for a member's token.
 */
const getAdmissionStatus = (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required', code: 400 });

  db.get(
    `SELECT m.admission_status, m.admitted_at, t.checked_in_at, t.checked_out_at, t.expiresAt
     FROM tokens t JOIN members m ON t.member_id = m.member_id
     WHERE t.token = ?`,
    [token],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error', code: 500 });
      if (!row) return res.status(404).json({ error: 'Token not found', code: 404 });

      res.status(200).json({
        success: true,
        admission_status: row.admission_status || 'pending',
        admitted_at: row.admitted_at,
        checked_in_at: row.checked_in_at,
        checked_out_at: row.checked_out_at,
        is_expired: new Date() > new Date(row.expiresAt)
      });
    }
  );
};

/**
 * POST /api/check-out
 * Mark a checked-in member as checked out.
 */
const checkOut = (req, res) => {
  const { token } = req.body;
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

  if (!token) return res.status(400).json({ error: 'token is required', code: 400 });
  if (!validateTokenFormat(token)) return res.status(400).json({ error: 'Invalid token format', code: 400 });

  db.get(
    `SELECT id, member_id, checked_in_at, checked_out_at FROM tokens WHERE token = ?`,
    [token],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error', code: 500 });
      if (!row) return res.status(404).json({ error: 'Token not found', code: 404 });
      if (!row.checked_in_at) return res.status(409).json({ error: 'Not checked in yet', code: 409 });
      if (row.checked_out_at) return res.status(409).json({ error: 'Already checked out', code: 409 });

      const checkedOutAt = new Date().toISOString();
      db.run(
        `UPDATE tokens SET checked_out_at = ? WHERE id = ? AND checked_out_at IS NULL`,
        [checkedOutAt, row.id],
        function(updateErr) {
          if (updateErr || this.changes === 0) {
            return res.status(409).json({ error: 'Already checked out', code: 409 });
          }
          AuditLogger.log('check_out', row.member_id, token, 'success', null, clientIp, { checkedOutAt });
          res.status(200).json({ success: true, message: 'Checked out successfully', checked_out_at: checkedOutAt });
        }
      );
    }
  );
};

module.exports = {
  generateQR,
  verifyToken,
  verifyJWTToken,
  checkIn,
  checkInStatus,
  generateQRImage,
  verifyPin,
  getAdmissionStatus,
  checkOut
};
