const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for member check-in attempts
 * Max 10 verification requests per minute per member
 */
const memberRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per windowMs
  keyGenerator: (req) => {
    // Rate limit by member_id, then by token (body or query), then fall back to IP
    return req.body?.member_id || req.body?.token || req.query?.token || req.ip || 'unknown';
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many verification requests',
      code: 429,
      retryAfter: 60,
      message: 'Maximum 10 verification requests per minute. Please wait before trying again.'
    });
  }
});

/**
 * Rate limiter for failed check-in attempts
 * Tracks failed attempts by IP address
 * Max 5 failed attempts per minute per IP
 */
const failureRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 failed attempts per windowMs
  keyGenerator: (req) => {
    // Rate limit by token (query or body) then fall back to IP
    return req.query?.token || req.body?.token || req.ip || 'unknown';
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many failed attempts',
      code: 429,
      retryAfter: 60,
      message: 'Too many failed verification attempts from your IP. Please wait before trying again.'
    });
  }
});

module.exports = {
  memberRateLimiter,
  failureRateLimiter
};
