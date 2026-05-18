const { verifyJWT, decodeJWT } = require('../utils/jwtService');
const AuditLogger = require('../utils/auditLogger');

/**
 * JWT Verification Middleware for Phase 3
 * Validates JWT token in Authorization header
 */

/**
 * Verify JWT token from Authorization header
 * Expected format: Bearer <jwt_token>
 */
const verifyJWTToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

    if (!authHeader) {
      AuditLogger.log('jwt_verify_attempt', null, null, 'failure', 401, clientIp, {
        reason: 'Missing Authorization header'
      });
      return res.status(401).json({
        error: 'Authorization header missing',
        code: 401,
        message: 'JWT token is required'
      });
    }

    // Extract token from "Bearer <token>" format
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      AuditLogger.log('jwt_verify_attempt', null, null, 'failure', 401, clientIp, {
        reason: 'Invalid Authorization header format'
      });
      return res.status(401).json({
        error: 'Invalid Authorization header format',
        code: 401,
        message: 'Use Bearer <token> format'
      });
    }

    const jwtToken = parts[1];

    // Verify JWT signature and expiration
    let decoded;
    try {
      decoded = verifyJWT(jwtToken);
    } catch (err) {
      AuditLogger.log('jwt_verify_attempt', null, null, 'failure', 401, clientIp, {
        reason: 'JWT verification failed',
        error: err.message
      });
      return res.status(401).json({
        error: 'Invalid or expired JWT token',
        code: 401,
        message: err.message
      });
    }

    // Attach decoded JWT to request for use in controllers
    req.jwt = decoded;
    req.member_id = decoded.member_id;
    req.token_id = decoded.token_id;

    AuditLogger.log('jwt_verify_attempt', decoded.member_id, decoded.token_id, 'success', null, clientIp, {
      iat: new Date(decoded.iat * 1000).toISOString()
    });

    next();
  } catch (error) {
    console.error('[JWT MIDDLEWARE ERROR]', error.message);
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    AuditLogger.log('jwt_verify_attempt', null, null, 'failure', 500, clientIp, {
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
 * Optional JWT verification (doesn't fail if missing, but validates if present)
 */
const verifyJWTTokenOptional = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      // No JWT provided, continue without it
      return next();
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      // Invalid format, continue without it
      return next();
    }

    const jwtToken = parts[1];

    // Verify JWT
    try {
      const decoded = verifyJWT(jwtToken);
      req.jwt = decoded;
      req.member_id = decoded.member_id;
      req.token_id = decoded.token_id;
    } catch (err) {
      // Invalid JWT, continue without it
      console.warn('[JWT MIDDLEWARE] Invalid optional JWT:', err.message);
    }

    next();
  } catch (error) {
    console.error('[JWT MIDDLEWARE ERROR]', error.message);
    next();
  }
};

module.exports = {
  verifyJWTToken,
  verifyJWTTokenOptional
};
