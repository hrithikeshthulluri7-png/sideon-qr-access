const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * JWT Service for Phase 3 Authentication
 * Handles JWT token generation, signing, verification
 */

const JWT_SECRET = process.env.JWT_SECRET || generateJWTSecret();
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h'; // 1 hour default

/**
 * Generate a secure JWT secret if one doesn't exist
 * Must be stored in .env file (not in code)
 */
function generateJWTSecret() {
  const secret = crypto.randomBytes(32).toString('hex');
  console.warn('[JWT] WARNING: JWT_SECRET not found in .env. Generated temporary secret.');
  console.warn('[JWT] Please add to .env: JWT_SECRET=' + secret);
  return secret;
}

/**
 * Sign a JWT token
 *
 * @param {string} member_id - Member ID
 * @param {string} token_id - Database token ID (uuid)
 * @returns {string} Signed JWT token
 * @throws {Error} If member_id or token_id is invalid
 */
function signJWT(member_id, token_id) {
  // Validate parameters
  if (!member_id || typeof member_id !== 'string' || member_id.trim() === '') {
    throw new Error('member_id must be a non-empty string');
  }
  if (!token_id || typeof token_id !== 'string' || token_id.trim() === '') {
    throw new Error('token_id must be a non-empty string');
  }

  try {
    const payload = {
      member_id: member_id,
      token_id: token_id,
      iat: Math.floor(Date.now() / 1000),
      iss: 'sideon-qr-access'
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: JWT_EXPIRY,
      noTimestamp: false
    });

    return token;
  } catch (err) {
    console.error('[JWT ERROR] signJWT failed:', err.message);
    throw new Error('Failed to sign JWT token');
  }
}

/**
 * Verify a JWT token
 *
 * @param {string} token - JWT token to verify
 * @returns {object} Decoded payload on success
 * @throws {Error} On verification failure
 */
function verifyJWT(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'sideon-qr-access'
    });
    return decoded;
  } catch (err) {
    console.error('[JWT ERROR] verifyJWT failed:', err.message);
    throw new Error('Invalid or expired JWT token');
  }
}

/**
 * Decode JWT without verification (for inspection only)
 *
 * @param {string} token - JWT token to decode
 * @returns {object} Decoded payload
 */
function decodeJWT(token) {
  try {
    return jwt.decode(token);
  } catch (err) {
    return null;
  }
}

/**
 * Check if JWT is expired
 *
 * @param {object} payload - Decoded JWT payload
 * @returns {boolean} True if expired
 */
function isJWTExpired(payload) {
  if (!payload || !payload.exp) return true;
  return Math.floor(Date.now() / 1000) > payload.exp;
}

module.exports = {
  signJWT,
  verifyJWT,
  decodeJWT,
  isJWTExpired,
  JWT_SECRET,
  JWT_EXPIRY
};
