const { db } = require('../utils/database');
const { generateToken, validateTokenFormat } = require('../utils/tokenGenerator');

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
 */
const generateQR = (req, res) => {
  try {
    const { member_id, name, email, mobile, agent } = req.body;

    // Validation
    if (!member_id || !name) {
      return res.status(400).json({
        error: 'member_id and name are required',
        status: 400
      });
    }

    // Insert or update member
    db.run(
      `INSERT OR REPLACE INTO members (member_id, name, email, mobile, agent, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [member_id, name, email || null, mobile || null, agent || null],
      function(err) {
        if (err) {
          console.error('[DB ERROR] Insert member:', err.message);
          return res.status(500).json({ error: 'Database error', status: 500 });
        }

        // Generate token
        let token;
        try {
          token = generateToken(member_id);
        } catch (tokenErr) {
          console.error('[TOKEN ERROR]', tokenErr.message);
          return res.status(500).json({ error: 'Token generation failed', status: 500 });
        }

        // Insert token
        db.run(
          `INSERT INTO tokens (member_id, token, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
          [member_id, token],
          function(err) {
            if (err) {
              console.error('[DB ERROR] Insert token:', err.message);
              return res.status(500).json({ error: 'Token storage failed', status: 500 });
            }

            console.log(`[TOKEN] Generated token for member ${member_id}: ${token}`);

            res.status(201).json({
              success: true,
              token: token,
              member_id: member_id,
              created_at: new Date().toISOString(),
              message: 'QR token generated successfully'
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('[ERROR] generateQR:', error.message);
    res.status(500).json({ error: 'Internal server error', status: 500 });
  }
};

/**
 * GET /api/verify?token=X
 * Verify a token and retrieve member information
 *
 * Returns member data without plaintext storage of sensitive info in token
 */
const verifyToken = (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        error: 'token query parameter is required',
        status: 400
      });
    }

    // Validate token format
    if (!validateTokenFormat(token)) {
      return res.status(404).json({
        error: 'Invalid token format',
        status: 404
      });
    }

    // Look up token and member
    db.get(
      `SELECT t.token, t.created_at, t.verified_at, t.checked_in_at,
              m.member_id, m.name, m.email, m.mobile, m.agent
       FROM tokens t
       JOIN members m ON t.member_id = m.member_id
       WHERE t.token = ?`,
      [token],
      (err, row) => {
        if (err) {
          console.error('[DB ERROR] Verify token:', err.message);
          return res.status(500).json({ error: 'Database error', status: 500 });
        }

        if (!row) {
          return res.status(404).json({
            error: 'Token not found or invalid',
            status: 404
          });
        }

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
            verified_at: row.verified_at,
            checked_in_at: row.checked_in_at,
            is_checked_in: !!row.checked_in_at
          }
        });
      }
    );
  } catch (error) {
    console.error('[ERROR] verifyToken:', error.message);
    res.status(500).json({ error: 'Internal server error', status: 500 });
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
 */
const checkIn = (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: 'token is required',
        status: 400
      });
    }

    if (!validateTokenFormat(token)) {
      return res.status(404).json({
        error: 'Invalid token format',
        status: 404
      });
    }

    // Check if token exists and hasn't been checked in
    db.get(
      `SELECT id, member_id, checked_in_at FROM tokens WHERE token = ?`,
      [token],
      (err, row) => {
        if (err) {
          console.error('[DB ERROR] Check-in lookup:', err.message);
          return res.status(500).json({ error: 'Database error', status: 500 });
        }

        if (!row) {
          return res.status(404).json({
            error: 'Token not found',
            status: 404
          });
        }

        // Prevent duplicate check-ins
        if (row.checked_in_at) {
          return res.status(409).json({
            error: 'Token already checked in',
            status: 409,
            checked_in_at: row.checked_in_at
          });
        }

        // Mark as checked in
        db.run(
          `UPDATE tokens SET checked_in_at = CURRENT_TIMESTAMP, verified_at = CURRENT_TIMESTAMP
           WHERE token = ?`,
          [token],
          function(err) {
            if (err) {
              console.error('[DB ERROR] Check-in update:', err.message);
              return res.status(500).json({ error: 'Check-in failed', status: 500 });
            }

            console.log(`[CHECK-IN] Token verified: ${token} for member ${row.member_id}`);

            res.status(200).json({
              success: true,
              message: 'Check-in successful',
              token: token,
              member_id: row.member_id,
              checked_in_at: new Date().toISOString()
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('[ERROR] checkIn:', error.message);
    res.status(500).json({ error: 'Internal server error', status: 500 });
  }
};

/**
 * GET /api/check-in-status?token=X
 * Check if a token has been verified/checked-in
 */
const checkInStatus = (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        error: 'token query parameter is required',
        status: 400
      });
    }

    if (!validateTokenFormat(token)) {
      return res.status(404).json({
        error: 'Invalid token format',
        status: 404
      });
    }

    db.get(
      `SELECT token, created_at, verified_at, checked_in_at, member_id FROM tokens WHERE token = ?`,
      [token],
      (err, row) => {
        if (err) {
          console.error('[DB ERROR] Check-in status:', err.message);
          return res.status(500).json({ error: 'Database error', status: 500 });
        }

        if (!row) {
          return res.status(404).json({
            error: 'Token not found',
            status: 404
          });
        }

        res.status(200).json({
          success: true,
          token: row.token,
          member_id: row.member_id,
          created_at: row.created_at,
          verified_at: row.verified_at,
          checked_in_at: row.checked_in_at,
          is_checked_in: !!row.checked_in_at
        });
      }
    );
  } catch (error) {
    console.error('[ERROR] checkInStatus:', error.message);
    res.status(500).json({ error: 'Internal server error', status: 500 });
  }
};

module.exports = {
  generateQR,
  verifyToken,
  checkIn,
  checkInStatus
};
