const crypto = require('crypto');

/**
 * Generate a secure QR access token
 * Format: SIDN_EVENT_2026_M{MEMBER_ID}_{RANDOM_12_BYTES}
 *
 * No plaintext member data is embedded in the token itself.
 * The random portion ensures each token is unique and cryptographically secure.
 *
 * @param {string} memberId - The member ID (e.g., "00147")
 * @returns {string} - Generated token
 */
const generateToken = (memberId) => {
  if (!memberId || typeof memberId !== 'string') {
    throw new Error('Invalid member ID');
  }

  // Generate 12 random bytes and convert to hex
  const randomBytes = crypto.randomBytes(12).toString('hex');

  // Format: SIDN_EVENT_2026_M{MEMBER_ID}_{RANDOM}
  const token = `SIDN_EVENT_2026_M${memberId}_${randomBytes}`;

  return token;
};

/**
 * Validate token format
 * @param {string} token - Token to validate
 * @returns {boolean}
 */
const validateTokenFormat = (token) => {
  const pattern = /^SIDN_EVENT_2026_M[0-9]+_[a-f0-9]{24}$/;
  return pattern.test(token);
};

/**
 * Extract member ID from token (for logging/debugging only)
 * @param {string} token - Token to parse
 * @returns {string|null} - Member ID or null if invalid format
 */
const extractMemberIdFromToken = (token) => {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const match = token.match(/^SIDN_EVENT_2026_M(\d+)_/);
  return match ? match[1] : null;
};

module.exports = {
  generateToken,
  validateTokenFormat,
  extractMemberIdFromToken
};
